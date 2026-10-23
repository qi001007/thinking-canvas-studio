import type { CapabilitySet, RunId, SessionId, StackFrameSnapshot, ThreadExecutionState, ThreadId } from '../domain/contracts.ts';

export interface DebugModelState {
	readonly runId?: RunId;
	readonly sessionId?: SessionId;
	readonly capabilities?: CapabilitySet;
	readonly sessionState: 'inactive' | 'initializing' | 'running' | 'stopped' | 'partial-unsupported' | 'ended';
	readonly threads: Readonly<Record<ThreadId, ThreadSnapshotState>>;
}

export interface ThreadSnapshotState {
	readonly id: ThreadId;
	readonly name: string;
	readonly state: ThreadExecutionState;
	readonly stopEpoch: number;
	readonly frames: readonly StackFrameSnapshot[];
}

export type DebugEvent =
	| { readonly type: 'runStarted'; readonly runId: RunId; readonly sessionId: SessionId; readonly capabilities: CapabilitySet }
	| { readonly type: 'runEnded'; readonly runId: RunId; readonly sessionId: SessionId }
	| { readonly type: 'runReady'; readonly runId: RunId; readonly sessionId: SessionId }
	| { readonly type: 'threadAdded'; readonly runId: RunId; readonly sessionId: SessionId; readonly threadId: ThreadId; readonly name: string }
	| { readonly type: 'threadStopped'; readonly runId: RunId; readonly sessionId: SessionId; readonly threadId: ThreadId; readonly allThreadsStopped?: boolean }
	| { readonly type: 'threadResumed'; readonly runId: RunId; readonly sessionId: SessionId; readonly threadId: ThreadId; readonly allThreadsContinued?: boolean }
	| { readonly type: 'framesLoaded'; readonly runId: RunId; readonly sessionId: SessionId; readonly threadId: ThreadId; readonly stopEpoch: number; readonly frames: readonly StackFrameSnapshot[]; readonly label?: string };

export const initialDebugModelState: DebugModelState = {
	sessionState: 'inactive',
	threads: {}
};

export function isThreadInspectable(thread: ThreadSnapshotState | undefined): boolean {
	return !!thread && thread.state === 'stopped';
}

export function reduceDebugEvent(state: DebugModelState, event: DebugEvent): DebugModelState {
	if (event.type === 'runStarted') {
		return {
			runId: event.runId,
			sessionId: event.sessionId,
			capabilities: event.capabilities,
			sessionState: 'initializing',
			threads: {}
		};
	}

	if (!state.runId || !state.sessionId || event.runId !== state.runId || event.sessionId !== state.sessionId) {
		return state;
	}

	if (event.type === 'runEnded') {
		return { ...initialDebugModelState, sessionState: 'ended' };
	}
	if (event.type === 'runReady') {
		if (state.sessionState !== 'initializing') {
			return state;
		}
		return clearAllThreadHandles(state, 'running', 'running');
	}
	if (event.type === 'threadAdded') {
		if (state.threads[event.threadId]) {
			return state;
		}
		const threads = {
			...state.threads,
			[event.threadId]: {
				id: event.threadId,
				name: event.name,
				state: 'running' as const,
				stopEpoch: 0,
				frames: []
			}
		};
		if (state.sessionState === 'stopped') {
			return clearAllThreadHandles({ ...state, threads }, 'partial-unsupported', 'partial-unsupported');
		}
		return {
			...state,
			threads
		};
	}

	const thread = state.threads[event.threadId];
	if (!thread) {
		return state;
	}

	if (event.type === 'threadStopped') {
		const isPartialOrUnknown = event.allThreadsStopped !== true;
		if (!isPartialOrUnknown) {
			const threads = Object.fromEntries(Object.values(state.threads).map(current => [current.id, {
				...current,
				state: 'stopped' as const,
				stopEpoch: current.stopEpoch + 1,
				frames: []
			}]));
			return { ...state, sessionState: 'stopped', threads };
		}
		return clearAllThreadHandles(state, 'partial-unsupported', 'partial-unsupported');
	}

	if (event.type === 'threadResumed') {
		if (event.allThreadsContinued === false) {
			return clearAllThreadHandles(state, 'partial-unsupported', 'partial-unsupported');
		}
		return clearAllThreadHandles(state, 'running', 'running');
	}

	if (event.type === 'framesLoaded') {
		if (state.sessionState !== 'stopped' || !isThreadInspectable(thread) || thread.stopEpoch !== event.stopEpoch || !event.frames.every(frame => hasCurrentFrameHandles(frame, state, thread))) {
			return state;
		}
		return replaceThread(state, { ...thread, frames: event.frames }, state.sessionState);
	}

	return state;
}

function hasCurrentFrameHandles(frame: StackFrameSnapshot, state: DebugModelState, thread: ThreadSnapshotState): boolean {
	const matches = (handle: StackFrameSnapshot['handle'], kind: 'frame' | 'scope' | 'variable'): boolean => handle.kind === kind
		&& handle.sessionId === state.sessionId
		&& handle.runId === state.runId
		&& handle.threadId === thread.id
		&& handle.stopEpoch === thread.stopEpoch;
	return matches(frame.handle, 'frame') && frame.scopes.every(scope => matches(scope.handle, 'scope')
		&& scope.values.every(value => hasCurrentValueHandles(value, matches)));
}

function hasCurrentValueHandles(value: StackFrameSnapshot['scopes'][number]['values'][number], matches: (handle: StackFrameSnapshot['handle'], kind: 'frame' | 'scope' | 'variable') => boolean): boolean {
	return (!value.handle || matches(value.handle, 'variable')) && value.children.every(child => hasCurrentValueHandles(child, matches));
}

function replaceThread(state: DebugModelState, thread: ThreadSnapshotState, sessionState: DebugModelState['sessionState']): DebugModelState {
	return {
		...state,
		sessionState,
		threads: { ...state.threads, [thread.id]: thread }
	};
}

function clearAllThreadHandles(state: DebugModelState, threadState: ThreadExecutionState, sessionState: DebugModelState['sessionState']): DebugModelState {
	const threads = Object.fromEntries(Object.values(state.threads).map(thread => [thread.id, {
		...thread,
		state: threadState,
		stopEpoch: thread.stopEpoch + 1,
		frames: []
	}]));
	return { ...state, sessionState, threads };
}
