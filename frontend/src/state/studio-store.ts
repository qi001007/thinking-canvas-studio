import { reduceDebugEvent, initialDebugModelState, type DebugEvent, type DebugModelState } from '@core/application/debug-model';
import { diffScenes, EMPTY_SCENE_DIFF, type SceneDiff } from '@core/canvas/diff';
import { createManualStep, createTraceSnapshot, type ManualBoard } from '@core/canvas/documents';
import { projectSnapshot } from '@core/canvas/projector';
import type {
	CapabilitySet,
	CardData,
	Coverage,
	NormalizedDebugSnapshot,
	SceneDto,
	SessionSnapshot,
	StackFrameSnapshot,
	TraceSnapshot
} from '@core/domain/contracts';
import type { AppInfo, ConsoleLine, FileEntry, HostClient, LanguagePackage } from '@/host/types';

export type StudioMode = 'manual' | 'debug';

export interface Breakpoint {
	readonly id: string;
	readonly source: string;
	readonly line: number;
	readonly enabled: boolean;
}

export interface StudioSession {
	readonly sessionId: string;
	readonly runId: string;
	readonly threadId: string;
	readonly capabilities: CapabilitySet;
	readonly scripted: boolean;
}

export interface StudioState {
	readonly ready: boolean;
	readonly hostMode: 'demo' | 'desktop';
	readonly app?: AppInfo;
	readonly files: readonly FileEntry[];
	readonly languages: readonly LanguagePackage[];
	readonly activeFile: string;
	readonly editorText: string;
	readonly savedText: string;
	readonly mode: StudioMode;
	readonly manualBoard: ManualBoard;
	readonly manualStepIndex: number;
	readonly selectedNodeId?: string;
	readonly debug: DebugModelState;
	readonly session?: StudioSession;
	readonly selectedThreadId?: string;
	readonly selectedFrameId?: string;
	readonly snapshots: readonly TraceSnapshot[];
	readonly snapshotIndex: number;
	readonly running: boolean;
	readonly breakpoints: readonly Breakpoint[];
	readonly console: readonly ConsoleLine[];
	readonly status: string;
	readonly scene: SceneDto;
	readonly coverage: Coverage;
	readonly diff: SceneDiff;
}

const EMPTY_CAPS: CapabilitySet = {
	stackTrace: false,
	scopes: false,
	variables: false,
	evaluate: false,
	setVariable: false,
	readMemory: false
};

const EMPTY_SCENE: SceneDto = { nodes: [], edges: [] };

function emptyManualBoard(): ManualBoard {
	return {
		id: 'board-empty',
		title: '手绘',
		scene: EMPTY_SCENE,
		annotations: [],
		layout: { positions: {}, zoom: 1 },
		steps: []
	};
}

export function initialState(): StudioState {
	return {
		ready: false,
		hostMode: 'demo',
		files: [],
		languages: [],
		activeFile: '',
		editorText: '',
		savedText: '',
		mode: 'debug',
		manualBoard: emptyManualBoard(),
		manualStepIndex: -1,
		debug: initialDebugModelState,
		snapshots: [],
		snapshotIndex: -1,
		running: false,
		breakpoints: [],
		console: [],
		status: '正在连接宿主…',
		scene: EMPTY_SCENE,
		coverage: { state: 'unknown', knownMissing: ['No runtime data.'] },
		diff: EMPTY_SCENE_DIFF
	};
}

export class StudioStore {
	private state = initialState();
	private readonly listeners = new Set<() => void>();
	private readonly unsubscribers: Array<() => void> = [];

	constructor(private readonly host: HostClient) {}

	readonly getSnapshot = (): StudioState => this.state;

	readonly subscribe = (listener: () => void): (() => void) => {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	};

	async init(): Promise<void> {
		this.unsubscribers.push(this.host.onDebugEvent(event => this.handleDebugEvent(event)));
		this.unsubscribers.push(this.host.onConsole(line => this.appendConsole(line)));
		try {
			const [app, files, languages, board] = await Promise.all([
				this.host.info(),
				this.host.listFiles(),
				this.host.listLanguages(),
				this.host.loadManualBoard()
			]);
			const activeFile = files.find(file => file.path === 'main.py')?.path ?? files[0]?.path ?? '';
			const editorText = activeFile ? await this.host.readFile(activeFile) : '';
			this.set({
				ready: true,
				hostMode: app.mode,
				app,
				files,
				languages,
				manualBoard: board,
				activeFile,
				editorText,
				savedText: editorText,
				breakpoints: [
					{ id: 'bp-1', source: 'main.py', line: 7, enabled: true },
					{ id: 'bp-2', source: 'main.py', line: 9, enabled: false }
				],
				status: app.mode === 'demo' ? '演示宿主已连接' : '桌面宿主已连接'
			});
			await this.startDebug();
		} catch (error) {
			this.set({
				ready: true,
				status: `宿主初始化失败：${error instanceof Error ? error.message : String(error)}`
			});
		}
	}

	dispose(): void {
		for (const unsubscribe of this.unsubscribers) unsubscribe();
		this.host.dispose?.();
		this.unsubscribers.length = 0;
		this.listeners.clear();
	}

	async startDebug(): Promise<void> {
		if (this.state.running) return;
		this.set({ mode: 'debug', status: '正在启动演示会话…' });
		try {
			const session = await this.host.startDebug();
			this.set({ session: { ...session, scripted: session.scripted ?? true }, running: true, status: '演示会话运行中' });
		} catch (error) {
			this.set({ running: false, status: `启动失败：${errorMessage(error)}` });
		}
	}

	async stopDebug(): Promise<void> {
		try {
			await this.host.stopDebug();
			this.set({ running: false, status: '会话已停止' });
		} catch (error) {
			this.set({ status: `停止失败：${errorMessage(error)}` });
		}
	}

	async continueDebug(): Promise<void> {
		if (!this.state.session) return;
		try {
			await this.host.continueDebug(this.state.session.threadId);
		} catch (error) {
			this.set({ status: `继续失败：${errorMessage(error)}` });
		}
	}

	async stepDebug(kind: 'over' | 'into' | 'out'): Promise<void> {
		if (!this.state.session) return;
		try {
			await this.host.stepDebug(this.state.session.threadId, kind);
		} catch (error) {
			this.set({ status: `单步失败：${errorMessage(error)}` });
		}
	}

	selectFrame(threadId: string, frameId: string): void {
		this.set({ selectedThreadId: threadId, selectedFrameId: frameId });
	}

	selectSnapshot(index: number): void {
		const clamped = Math.max(-1, Math.min(index, this.state.snapshots.length - 1));
		this.set({ snapshotIndex: clamped, mode: 'debug' });
		this.refreshScene();
	}

	backToLive(): void {
		this.set({ snapshotIndex: -1 });
		this.refreshScene();
	}

	selectManualStep(index: number): void {
		const clamped = Math.max(-1, Math.min(index, this.state.manualBoard.steps.length - 1));
		this.set({ manualStepIndex: clamped, mode: 'manual' });
		this.refreshScene();
	}

	async setMode(mode: StudioMode): Promise<void> {
		this.set({ mode });
		if (mode === 'debug' && !this.state.session) await this.startDebug();
		this.refreshScene();
	}

	async openFile(path: string): Promise<void> {
		if (path === this.state.activeFile) return;
		try {
			if (this.state.editorText !== this.state.savedText) await this.saveFile();
			const text = await this.host.readFile(path);
			this.set({ activeFile: path, editorText: text, savedText: text, status: `已打开 ${path}` });
		} catch (error) {
			this.set({ status: `打开失败：${errorMessage(error)}` });
		}
	}

	updateEditorText(text: string): void {
		this.set({ editorText: text, status: text === this.state.savedText ? '已保存' : '有未保存修改' });
	}

	async saveFile(): Promise<void> {
		if (!this.state.activeFile) return;
		try {
			await this.host.writeFile(this.state.activeFile, this.state.editorText);
			this.set({ savedText: this.state.editorText, status: `已保存 ${this.state.activeFile}` });
		} catch (error) {
			this.set({ status: `保存失败：${errorMessage(error)}` });
		}
	}

	toggleBreakpoint(source: string, line: number): void {
		const existing = this.state.breakpoints.find(item => item.source === source && item.line === line);
		if (!existing) {
			this.set({
				breakpoints: [...this.state.breakpoints, { id: `bp-${crypto.randomUUID()}`, source, line, enabled: true }]
			});
			return;
		}
		this.set({
			breakpoints: this.state.breakpoints.map(item => item === existing ? { ...item, enabled: !item.enabled } : item)
		});
	}

	removeBreakpoint(id: string): void {
		this.set({ breakpoints: this.state.breakpoints.filter(item => item.id !== id) });
	}

	selectNode(id: string | undefined): void {
		this.set({ selectedNodeId: id });
	}

	addManualCard(kind: 'array' | 'list' | 'dict' | 'variable' | 'sticky'): void {
		const id = `layout:manual:${crypto.randomUUID()}`;
		const card = defaultCard(kind);
		const label = kind === 'sticky' ? '便签' : kind === 'variable' ? '变量' : kind;
		const candidates = [
			{ x: 330, y: 210 },
			{ x: 330, y: 390 },
			{ x: 20, y: 520 },
			{ x: 330, y: 520 }
		];
		const used = new Set(Object.values(this.state.manualBoard.layout.positions).map(position => `${position.x},${position.y}`));
		const position = candidates.find(candidate => !used.has(`${candidate.x},${candidate.y}`)) ?? candidates[candidates.length - 1]!;
		const scene: SceneDto = {
			nodes: [...this.state.manualBoard.scene.nodes, {
				id,
				valueId: `manual:${id}`,
				label,
				kind: 'manual',
				card
			}],
			edges: [...this.state.manualBoard.scene.edges]
		};
		const board: ManualBoard = {
			...this.state.manualBoard,
			scene,
			layout: {
				...this.state.manualBoard.layout,
				positions: {
					...this.state.manualBoard.layout.positions,
					[id]: position
				}
			}
		};
		this.set({ manualBoard: board, selectedNodeId: id, mode: 'manual' });
		this.refreshScene();
		void this.persistBoard();
	}

	moveManualNode(id: string, x: number, y: number): void {
		const board: ManualBoard = {
			...this.state.manualBoard,
			layout: {
				...this.state.manualBoard.layout,
				positions: { ...this.state.manualBoard.layout.positions, [id]: { x, y } }
			}
		};
		this.set({ manualBoard: board });
	}

	commitManualBoard(): void {
		void this.persistBoard();
	}

	recordManualStep(): void {
		const title = `步骤 ${this.state.manualBoard.steps.length + 1}`;
		const step = createManualStep(this.state.manualBoard, title);
		const board: ManualBoard = { ...this.state.manualBoard, steps: [...this.state.manualBoard.steps, step] };
		this.set({ manualBoard: board, manualStepIndex: -1, status: `已记录 ${title}` });
		this.refreshScene();
		void this.persistBoard();
	}

	deleteManualNode(id: string): void {
		const scene: SceneDto = {
			nodes: this.state.manualBoard.scene.nodes.filter(node => node.id !== id),
			edges: this.state.manualBoard.scene.edges.filter(edge => edge.from !== id && edge.to !== id)
		};
		const board: ManualBoard = { ...this.state.manualBoard, scene };
		this.set({ manualBoard: board, selectedNodeId: undefined });
		this.refreshScene();
		void this.persistBoard();
	}

	private handleDebugEvent(event: DebugEvent): void {
		const before = this.state;
		const debug = reduceDebugEvent(before.debug, event);
		const patch: { -readonly [K in keyof StudioState]?: StudioState[K] } = { debug };
		if (event.type === 'runStarted') {
			patch.running = true;
			patch.status = '已启动脚本演示会话';
		}
		if (event.type === 'threadStopped') {
			patch.running = false;
			patch.selectedThreadId = event.threadId;
		}
		if (event.type === 'threadResumed') {
			patch.running = true;
			patch.selectedFrameId = undefined;
			patch.status = '运行中…';
		}
		if (event.type === 'runEnded') {
			patch.running = false;
			patch.status = '会话已结束';
		}
		if (event.type === 'framesLoaded') {
			const selected = event.frames.find(frame => frame.id === before.selectedFrameId) ?? event.frames[0];
			patch.selectedThreadId = event.threadId;
			patch.selectedFrameId = selected?.id;
			patch.running = false;
			const snapshot = this.snapshotFrom(debug, event.label);
			if (snapshot) {
				patch.snapshots = [...before.snapshots, snapshot];
				patch.snapshotIndex = -1;
				patch.status = `停点 ${snapshot.sequence} · ${snapshot.label}`;
			}
		}
		this.set(patch);
		if (event.type === 'framesLoaded' || event.type === 'threadResumed' || event.type === 'runEnded') {
			this.refreshScene();
		}
	}

	private snapshotFrom(model: DebugModelState, label: string | undefined): TraceSnapshot | undefined {
		if (!model.runId || !model.sessionId) return undefined;
		const frames = Object.values(model.threads).flatMap(thread => thread.frames);
		const sequence = this.state.snapshots.length + 1;
		return createTraceSnapshot({
			id: `trace-${model.runId}-${sequence}`,
			sequence,
			label: label ?? `停点 ${sequence}`,
			capturedAt: new Date().toISOString(),
			runId: model.runId,
			sessionId: model.sessionId,
			coverage: frames.length > 0
				? { state: 'complete', knownMissing: [] }
				: { state: 'unknown', reason: 'No frame was captured.', knownMissing: ['frames'] },
			frames
		});
	}

	private refreshScene(): void {
		const state = this.state;
		if (state.mode === 'manual') {
			const steps = state.manualBoard.steps;
			const index = state.manualStepIndex >= 0 ? Math.min(state.manualStepIndex, steps.length - 1) : -1;
			const current = index >= 0 ? steps[index]?.scene : state.manualBoard.scene;
			const previous = index > 0 ? steps[index - 1]?.scene : undefined;
			const scene = current ?? EMPTY_SCENE;
			this.set({
				scene,
				coverage: { state: 'complete', knownMissing: [] },
				diff: diffScenes(previous, scene)
			});
			return;
		}
		if (state.snapshots.length === 0) {
			const projection = projectSnapshot(this.normalizedSnapshot(state.debug));
			this.set({ scene: projection.scene, coverage: projection.coverage, diff: EMPTY_SCENE_DIFF });
			return;
		}
		const index = state.snapshotIndex >= 0
			? Math.min(state.snapshotIndex, state.snapshots.length - 1)
			: state.snapshots.length - 1;
		const current = state.snapshots[index]!;
		const previous = index > 0 ? state.snapshots[index - 1] : undefined;
		const projection = projectSnapshot(current);
		const previousScene = previous ? projectSnapshot(previous).scene : undefined;
		this.set({
			scene: projection.scene,
			coverage: projection.coverage,
			diff: diffScenes(previousScene, projection.scene)
		});
	}

	private normalizedSnapshot(model: DebugModelState): NormalizedDebugSnapshot {
		const sessionState = model.sessionState === 'inactive' ? 'initializing' : model.sessionState;
		const session: SessionSnapshot = {
			id: model.sessionId ?? 'inactive',
			runId: model.runId ?? 'inactive',
			state: sessionState,
			capabilities: model.capabilities ?? EMPTY_CAPS,
			threads: Object.values(model.threads).map(thread => ({ ...thread }))
		};
		return {
			session,
			coverage: sessionState === 'stopped'
				? { state: 'unknown', reason: 'Waiting for captured frames.', knownMissing: ['frames'] }
				: { state: 'unknown', reason: `Session is ${sessionState}.`, knownMissing: ['frames'] }
		};
	}

	private appendConsole(line: ConsoleLine): void {
		this.set({ console: [...this.state.console.slice(-199), line] });
	}

	private async persistBoard(): Promise<void> {
		try {
			await this.host.saveManualBoard(this.state.manualBoard);
		} catch (error) {
			this.set({ status: `画板保存失败：${errorMessage(error)}` });
		}
	}

	private set(patch: Partial<StudioState>): void {
		this.state = { ...this.state, ...patch };
		for (const listener of this.listeners) listener();
	}
}

export function selectedFrame(state: StudioState): StackFrameSnapshot | undefined {
	if (!state.selectedFrameId) return undefined;
	for (const thread of Object.values(state.debug.threads)) {
		const frame = thread.frames.find(item => item.id === state.selectedFrameId);
		if (frame) return frame;
	}
	return undefined;
}

export function currentSnapshot(state: StudioState): TraceSnapshot | undefined {
	if (state.snapshots.length === 0) return undefined;
	const index = state.snapshotIndex >= 0 ? state.snapshotIndex : state.snapshots.length - 1;
	return state.snapshots[index];
}

export function breakpointsFor(state: StudioState, source: string): readonly Breakpoint[] {
	return state.breakpoints.filter(item => item.source === source);
}

function defaultCard(kind: 'array' | 'list' | 'dict' | 'variable' | 'sticky'): CardData {
	switch (kind) {
		case 'array':
			return { kind: 'array', rows: [[{ value: '1' }, { value: '2' }, { value: '3' }]] };
		case 'list':
			return { kind: 'list', items: [{ value: '1' }, { value: '2' }] };
		case 'dict':
			return { kind: 'dict', entries: [{ key: 'key', value: 'value' }] };
		case 'sticky':
			return { kind: 'sticky', tone: 'note', text: '写一条不变量…' };
		case 'variable':
			return { kind: 'variable', value: '0' };
	}
}

function errorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
