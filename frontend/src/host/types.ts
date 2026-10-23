import type { DebugEvent } from '@core/application/debug-model';
import type { ManualBoard } from '@core/canvas/documents';
import type { CapabilitySet, Coverage, RuntimeHandle, SceneDto, ScopeSnapshot, StackFrameSnapshot, ValueSnapshot } from '@core/domain/contracts';

export interface AppInfo {
	readonly name: string;
	readonly version: string;
	readonly mode: 'demo' | 'desktop';
	readonly bridgeVersion: number;
}

export interface FileEntry {
	readonly path: string;
	readonly name: string;
	readonly kind: 'file' | 'directory';
	readonly language?: string;
}

export interface LanguagePackage {
	readonly id: string;
	readonly name: string;
	readonly extensions: readonly string[];
	readonly adapter: string;
	readonly status: 'demo' | 'available' | 'not-installed';
}

export interface ThreadStopContext {
	readonly sessionId: string;
	readonly runId: string;
	readonly threadId: string;
	readonly stopEpoch: number;
}

export interface DebugStartResult {
	readonly sessionId: string;
	readonly runId: string;
	readonly threadId: string;
	readonly capabilities: CapabilitySet;
	readonly scripted?: boolean;
}

export interface RealRunRequest {
	readonly receiptId: string;
	readonly program: string;
	readonly breakpoints: readonly number[];
	readonly mode: 'debug' | 'record';
}

export interface WorkbenchInfo {
	readonly path: string;
	readonly sourceFile: string;
	readonly language: string;
	readonly content: string;
}

export type GraphView = 'overview' | 'structure' | 'data';

export interface GraphFocusOption {
	readonly id: string;
	readonly label: string;
	readonly kind: string;
	readonly line?: number;
}

export interface StaticAnalysis {
	readonly scene: SceneDto;
	readonly coverage: Coverage;
	readonly error?: string;
	readonly sourceFile?: string;
	readonly view?: GraphView;
	readonly focus?: string | null;
	readonly focusOptions?: readonly GraphFocusOption[];
	readonly hiddenNodeCount?: number;
	readonly stats?: {
		readonly nodes: number;
		readonly edges: number;
		readonly functions: number;
		readonly classes: number;
	};
}

export interface VariablePage {
	readonly start?: number;
	readonly count?: number;
	readonly filter?: 'named' | 'indexed';
}

export interface ConsoleLine {
	readonly id: string;
	readonly kind: 'stdout' | 'stderr' | 'info' | 'error';
	readonly text: string;
}

export interface HostClient {
	info(): Promise<AppInfo>;
	listLanguages(): Promise<readonly LanguagePackage[]>;
	listFiles(): Promise<readonly FileEntry[]>;
	createWorkbench(sourceFile: string): Promise<WorkbenchInfo>;
	readWorkbench(path: string): Promise<WorkbenchInfo>;
	writeWorkbench(path: string, content: string): Promise<void>;
	analyzeFile(path: string, view?: GraphView, focus?: string): Promise<StaticAnalysis>;
	readFile(path: string): Promise<string>;
	writeFile(path: string, content: string): Promise<void>;
	loadManualBoard(): Promise<ManualBoard>;
	saveManualBoard(board: ManualBoard): Promise<void>;
	startDebug(): Promise<DebugStartResult>;
	startRealDebug(request: RealRunRequest): Promise<DebugStartResult>;
	stopDebug(): Promise<void>;
	continueDebug(threadId: string): Promise<void>;
	stepDebug(threadId: string, kind: 'over' | 'into' | 'out'): Promise<void>;
	pauseDebug(threadId: string): Promise<void>;
	getStackFrames(context: ThreadStopContext): Promise<readonly StackFrameSnapshot[]>;
	getScopes(frame: RuntimeHandle): Promise<readonly ScopeSnapshot[]>;
	getVariables(container: RuntimeHandle, page?: VariablePage): Promise<readonly ValueSnapshot[]>;
	onDebugEvent(listener: (event: DebugEvent) => void): () => void;
	onConsole(listener: (line: ConsoleLine) => void): () => void;
	dispose?(): void;
}
