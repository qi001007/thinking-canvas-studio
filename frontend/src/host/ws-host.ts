import type { DebugEvent } from '@core/application/debug-model';
import type { ManualBoard } from '@core/canvas/documents';
import type { RuntimeHandle, ScopeSnapshot, StackFrameSnapshot, ValueSnapshot } from '@core/domain/contracts';
import type {
	AppInfo,
	ConsoleLine,
	DebugStartResult,
	FileEntry,
	HostClient,
	LanguagePackage,
	RealRunRequest,
	StaticAnalysis,
	WorkbenchInfo,
	ThreadStopContext,
	VariablePage
} from '@/host/types';

interface BridgeInfo {
	readonly port: number;
	readonly token: string;
	readonly mode: 'desktop' | 'demo';
}

interface RpcResponse {
	readonly jsonrpc: '2.0';
	readonly id: number;
	readonly result?: unknown;
	readonly error?: { readonly code: number; readonly message: string };
}

interface RpcEvent {
	readonly jsonrpc: '2.0';
	readonly method: string;
	readonly params?: unknown;
}

interface Pending {
	readonly resolve: (value: unknown) => void;
	readonly reject: (error: Error) => void;
	readonly timer: ReturnType<typeof setTimeout>;
}

export class WebSocketHostClient implements HostClient {
	private socket?: WebSocket;
	private sequence = 0;
	private readonly pending = new Map<number, Pending>();
	private readonly debugListeners = new Set<(event: DebugEvent) => void>();
	private readonly consoleListeners = new Set<(line: ConsoleLine) => void>();
	private readonly ready: Promise<void>;

	constructor(private readonly bridge: BridgeInfo) {
		this.ready = this.connect();
	}

	async info(): Promise<AppInfo> {
		return this.request<AppInfo>('app.info', {});
	}

	async listLanguages(): Promise<readonly LanguagePackage[]> {
		return this.request<readonly LanguagePackage[]>('languages.list', {});
	}

	async listFiles(): Promise<readonly FileEntry[]> {
		return this.request<readonly FileEntry[]>('workspace.list', {});
	}

	async readFile(path: string): Promise<string> {
		const result = await this.request<{ readonly content: string }>('workspace.readText', { path });
		return result.content;
	}

	async createWorkbench(sourceFile: string): Promise<WorkbenchInfo> {
		return this.request<WorkbenchInfo>('workbench.create', { sourceFile });
	}

	async readWorkbench(path: string): Promise<WorkbenchInfo> {
		return this.request<WorkbenchInfo>('workbench.info', { path });
	}

	async writeWorkbench(path: string, content: string): Promise<void> {
		await this.request('workbench.write', { path, content });
	}

	async analyzeFile(path: string): Promise<StaticAnalysis> {
		return this.request<StaticAnalysis>('analysis.analyze', { path });
	}

	async writeFile(path: string, content: string): Promise<void> {
		await this.request('workspace.writeText', { path, content });
	}

	async loadManualBoard(): Promise<ManualBoard> {
		return this.request<ManualBoard>('boards.load', {});
	}

	async saveManualBoard(board: ManualBoard): Promise<void> {
		await this.request('boards.save', { board });
	}

	async startDebug(): Promise<DebugStartResult> {
		return this.request<DebugStartResult>('debug.start', {});
	}

	async startRealDebug(request: RealRunRequest): Promise<DebugStartResult> {
		return this.request<DebugStartResult>('debug.startReal', {
			receiptId: request.receiptId,
			program: request.program,
			breakpoints: [...request.breakpoints],
			mode: request.mode,
		});
	}

	async stopDebug(): Promise<void> {
		await this.request('debug.stop', {});
	}

	async continueDebug(threadId: string): Promise<void> {
		await this.request('debug.continue', { threadId });
	}

	async stepDebug(threadId: string, kind: 'over' | 'into' | 'out'): Promise<void> {
		await this.request('debug.step', { threadId, kind });
	}

	async pauseDebug(threadId: string): Promise<void> {
		await this.request('debug.pause', { threadId });
	}

	async getStackFrames(context: ThreadStopContext): Promise<readonly StackFrameSnapshot[]> {
		return this.request<readonly StackFrameSnapshot[]>('debug.stackFrames', { context });
	}

	async getScopes(frame: RuntimeHandle): Promise<readonly ScopeSnapshot[]> {
		return this.request<readonly ScopeSnapshot[]>('debug.scopes', { frame });
	}

	async getVariables(container: RuntimeHandle, page?: VariablePage): Promise<readonly ValueSnapshot[]> {
		return this.request<readonly ValueSnapshot[]>('debug.variables', { container, page });
	}

	onDebugEvent(listener: (event: DebugEvent) => void): () => void {
		this.debugListeners.add(listener);
		return () => this.debugListeners.delete(listener);
	}

	onConsole(listener: (line: ConsoleLine) => void): () => void {
		this.consoleListeners.add(listener);
		return () => this.consoleListeners.delete(listener);
	}

	dispose(): void {
		this.socket?.close();
		this.socket = undefined;
		for (const pending of this.pending.values()) {
			clearTimeout(pending.timer);
			pending.reject(new Error('Bridge closed.'));
		}
		this.pending.clear();
	}

	private async connect(): Promise<void> {
		const socket = new WebSocket(`ws://127.0.0.1:${this.bridge.port}/bridge`);
		this.socket = socket;
		await new Promise<void>((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error('Bridge connection timed out.')), 8000);
			socket.onopen = () => {
				clearTimeout(timer);
				resolve();
			};
			socket.onerror = () => {
				clearTimeout(timer);
				reject(new Error('Bridge connection failed.'));
			};
		});
		socket.onmessage = event => this.onMessage(event.data);
		socket.onclose = () => {
			for (const pending of this.pending.values()) {
				clearTimeout(pending.timer);
				pending.reject(new Error('Bridge closed.'));
			}
			this.pending.clear();
		};
		await this.sendRaw('bridge.authenticate', { token: this.bridge.token });
	}

	private onMessage(raw: unknown): void {
		if (typeof raw !== 'string') return;
		let message: RpcResponse | RpcEvent;
		try {
			message = JSON.parse(raw) as RpcResponse | RpcEvent;
		} catch {
			return;
		}
		if ('id' in message) {
			const pending = this.pending.get(message.id);
			if (!pending) return;
			this.pending.delete(message.id);
			clearTimeout(pending.timer);
			if (message.error) pending.reject(new Error(message.error.message));
			else pending.resolve(message.result);
			return;
		}
		if (message.method === 'debug.event') {
			const event = message.params as DebugEvent;
			for (const listener of this.debugListeners) listener(event);
		}
		if (message.method === 'console.line') {
			const line = message.params as ConsoleLine;
			for (const listener of this.consoleListeners) listener(line);
		}
	}

	private async request<T = unknown>(method: string, params: Record<string, unknown>): Promise<T> {
		await this.ready;
		return this.sendRaw<T>(method, params);
	}

	private sendRaw<T = unknown>(method: string, params: Record<string, unknown>): Promise<T> {
		const id = ++this.sequence;
		return new Promise<T>((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`Bridge request timed out: ${method}`));
			}, 10000);
			this.pending.set(id, { resolve: value => resolve(value as T), reject, timer });
			this.socket?.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
		});
	}
}

export type { BridgeInfo };
