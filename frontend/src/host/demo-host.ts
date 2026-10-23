import type { DebugEvent } from '@core/application/debug-model';
import type { ManualBoard } from '@core/canvas/documents';
import type { RuntimeHandle, ScopeSnapshot, StackFrameSnapshot, ValueSnapshot } from '@core/domain/contracts';
import {
	DEMO_RUN_ID,
	DEMO_SESSION_ID,
	DEMO_THREAD_ID,
	buildDemoFrames,
	demoCapabilities,
	demoConsoleLine,
	demoFileContents,
	demoFiles,
	demoLanguages,
	demoManualBoard,
	demoSteps
} from '@/demo/demo-data';
import type {
	AppInfo,
	ConsoleLine,
	DebugStartResult,
	FileEntry,
	HostClient,
	LanguagePackage,
	ThreadStopContext,
	VariablePage
} from '@/host/types';

const delay = (milliseconds: number) => new Promise(resolve => setTimeout(resolve, milliseconds));

/** Scripted session for UI development. It never starts a process or evaluates user code. */
export class DemoHostClient implements HostClient {
	private readonly debugListeners = new Set<(event: DebugEvent) => void>();
	private readonly consoleListeners = new Set<(line: ConsoleLine) => void>();
	private stepIndex = 0;
	private started = false;
	private busy = false;
	private manualBoard: ManualBoard = structuredClone(demoManualBoard);
	private readonly files = new Map<string, string>(Object.entries(demoFileContents));

	async info(): Promise<AppInfo> {
		return { name: 'Thinking Canvas Studio', version: '0.1.0-demo', mode: 'demo', bridgeVersion: 1 };
	}

	async listLanguages(): Promise<readonly LanguagePackage[]> {
		return demoLanguages;
	}

	async listFiles(): Promise<readonly FileEntry[]> {
		return [...demoFiles];
	}

	async createWorkbench(): Promise<never> {
		throw new Error('函数工作台需要桌面 Python 宿主。');
	}

	async readWorkbench(): Promise<never> {
		throw new Error('函数工作台需要桌面 Python 宿主。');
	}

	async writeWorkbench(): Promise<never> {
		throw new Error('函数工作台需要桌面 Python 宿主。');
	}

	async analyzeFile(): Promise<never> {
		throw new Error('静态结构分析需要桌面 Python 宿主。');
	}

	async readFile(path: string): Promise<string> {
		const content = this.files.get(path);
		if (content === undefined) throw new Error(`File not found: ${path}`);
		return content;
	}

	async writeFile(path: string, content: string): Promise<void> {
		this.files.set(path, content);
	}

	async loadManualBoard(): Promise<ManualBoard> {
		return structuredClone(this.manualBoard);
	}

	async saveManualBoard(board: ManualBoard): Promise<void> {
		this.manualBoard = structuredClone(board);
	}

	async startDebug(): Promise<DebugStartResult> {
		this.started = true;
		this.stepIndex = 0;
		this.busy = false;
		this.emit({
			type: 'runStarted',
			runId: DEMO_RUN_ID,
			sessionId: DEMO_SESSION_ID,
			capabilities: demoCapabilities
		});
		this.emit({
			type: 'threadAdded',
			runId: DEMO_RUN_ID,
			sessionId: DEMO_SESSION_ID,
			threadId: DEMO_THREAD_ID,
			name: 'MainThread'
		});
		this.console(demoConsoleLine('已载入脚本化演示会话；没有执行用户代码。'));
		setTimeout(() => this.emitStop(0), 140);
		return {
			sessionId: DEMO_SESSION_ID,
			runId: DEMO_RUN_ID,
			threadId: DEMO_THREAD_ID,
			capabilities: demoCapabilities,
			scripted: true
		};
	}

	async startRealDebug(): Promise<never> {
		throw new Error('真实调试只在桌面窗口可用；浏览器预览使用脚本演示。');
	}

	async stopDebug(): Promise<void> {
		if (!this.started) return;
		this.started = false;
		this.busy = false;
		this.emit({ type: 'runEnded', runId: DEMO_RUN_ID, sessionId: DEMO_SESSION_ID });
		this.console(demoConsoleLine('演示会话已结束。'));
	}

	async continueDebug(_threadId: string): Promise<void> {
		await this.advance(demoSteps.length - 1);
	}

	async stepDebug(_threadId: string, _kind: 'over' | 'into' | 'out'): Promise<void> {
		await this.advance(Math.min(this.stepIndex + 1, demoSteps.length - 1));
	}

	async pauseDebug(_threadId: string): Promise<void> {
		return;
	}

	async getStackFrames(_context: ThreadStopContext): Promise<readonly StackFrameSnapshot[]> {
		return buildDemoFrames(this.stepIndex);
	}

	async getScopes(frame: RuntimeHandle): Promise<readonly ScopeSnapshot[]> {
		const match = buildDemoFrames(this.stepIndex).find(item => item.handle.reference === frame.reference);
		return match?.scopes ?? [];
	}

	async getVariables(container: RuntimeHandle, page?: VariablePage): Promise<readonly ValueSnapshot[]> {
		const values = flattenValues(buildDemoFrames(this.stepIndex));
		const match = values.find(item => item.handle?.reference === container.reference);
		const start = Math.max(0, page?.start ?? 0);
		const count = Math.max(1, page?.count ?? 100);
		return (match?.children ?? []).slice(start, start + count);
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
		this.debugListeners.clear();
		this.consoleListeners.clear();
	}

	private async advance(target: number): Promise<void> {
		if (!this.started || this.busy) return;
		if (target === this.stepIndex) return;
		this.busy = true;
		this.stepIndex = target;
		this.emit({
			type: 'threadResumed',
			runId: DEMO_RUN_ID,
			sessionId: DEMO_SESSION_ID,
			threadId: DEMO_THREAD_ID,
			allThreadsContinued: true
		});
		this.console(demoConsoleLine(`继续运行到第 ${target + 1} 个演示停点。`, 'stdout'));
		await delay(180);
		this.emitStop(target);
		this.busy = false;
	}

	private emitStop(stepIndex: number): void {
		const step = demoSteps[stepIndex]!;
		this.emit({
			type: 'threadStopped',
			runId: DEMO_RUN_ID,
			sessionId: DEMO_SESSION_ID,
			threadId: DEMO_THREAD_ID,
			allThreadsStopped: true
		});
		this.emit({
			type: 'framesLoaded',
			runId: DEMO_RUN_ID,
			sessionId: DEMO_SESSION_ID,
			threadId: DEMO_THREAD_ID,
			stopEpoch: 1 + stepIndex * 2,
			frames: buildDemoFrames(stepIndex),
			label: step.label
		});
		this.console(demoConsoleLine(`停点 ${stepIndex + 1}: ${step.label} · main.py:${step.line}`, 'stdout'));
	}

	private emit(event: DebugEvent): void {
		for (const listener of this.debugListeners) listener(event);
	}

	private console(line: ConsoleLine): void {
		for (const listener of this.consoleListeners) listener(line);
	}
}

function flattenValues(frames: readonly StackFrameSnapshot[]): ValueSnapshot[] {
	const values: ValueSnapshot[] = [];
	const visit = (value: ValueSnapshot) => {
		values.push(value);
		value.children.forEach(visit);
	};
	for (const frame of frames) {
		for (const scope of frame.scopes) scope.values.forEach(visit);
	}
	return values;
}
