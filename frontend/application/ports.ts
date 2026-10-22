import type { RuntimeHandle, SceneDto, SessionId, RunId, ThreadId, StackFrameSnapshot, ScopeSnapshot, ValueSnapshot } from '../domain/contracts.ts';

export interface ThreadStopContext {
	readonly sessionId: SessionId;
	readonly runId: RunId;
	readonly threadId: ThreadId;
	readonly stopEpoch: number;
}

export interface StackFramePage {
	readonly startFrame: number;
	readonly levels: number;
}

export interface VariablePageRequest {
	readonly filter?: 'named' | 'indexed';
	readonly start?: number;
	readonly count?: number;
}

/** Contract only. A real DAP transport/adapter is intentionally not included. */
export interface DapClient {
	getStackFrames(context: ThreadStopContext, page: StackFramePage, cancellation: AbortSignal): Promise<readonly StackFrameSnapshot[]>;
	getScopes(frame: RuntimeHandle, cancellation: AbortSignal): Promise<readonly ScopeSnapshot[]>;
	getVariables(container: RuntimeHandle, page: VariablePageRequest, cancellation: AbortSignal): Promise<readonly ValueSnapshot[]>;
}

export interface EditorPort {
	openSource(uri: string, line?: number, column?: number): Promise<void>;
}

export interface RendererPort {
	renderScene(scene: SceneDto): void;
}

/** Workspace persistence has no filesystem implementation in this foundation. */
export interface WorkspaceStore {
	load<T>(key: string): Promise<T | undefined>;
	save<T>(key: string, value: T): Promise<void>;
}
