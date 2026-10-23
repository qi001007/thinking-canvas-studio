import type { FrameId, RunId, SessionId, ThreadId } from '../domain/contracts.ts';
import type { DebugModelState } from './debug-model.ts';

export interface InspectionRequest {
	readonly generation: number;
	readonly runId: RunId;
	readonly sessionId: SessionId;
	readonly threadId: ThreadId;
	readonly stopEpoch: number;
	readonly frameId: FrameId;
}

export class DebugViewModel {
	private requestGeneration = 0;
	private selected?: { sessionId: SessionId; threadId: ThreadId; frameId: FrameId };

	selectFrame(sessionId: SessionId, threadId: ThreadId, frameId: FrameId): void {
		this.selected = { sessionId, threadId, frameId };
		this.requestGeneration++;
	}

	clearFocus(): void {
		this.selected = undefined;
		this.requestGeneration++;
	}

	beginInspectionRequest(state: DebugModelState): InspectionRequest | undefined {
		if (!this.selected || !state.runId || state.sessionId !== this.selected.sessionId) {
			return undefined;
		}
		const thread = state.threads[this.selected.threadId];
		if (state.sessionState !== 'stopped' || !thread || thread.state !== 'stopped' || !thread.frames.some(frame => frame.id === this.selected!.frameId)) {
			return undefined;
		}
		return {
			generation: this.requestGeneration,
			runId: state.runId,
			sessionId: this.selected.sessionId,
			threadId: thread.id,
			stopEpoch: thread.stopEpoch,
			frameId: this.selected.frameId
		};
	}

	acceptInspectionReply(request: InspectionRequest, state: DebugModelState): boolean {
		const thread = state.threads[request.threadId];
		return request.generation === this.requestGeneration
			&& request.runId === state.runId
			&& request.sessionId === state.sessionId
			&& state.sessionState === 'stopped'
			&& this.selected?.sessionId === request.sessionId
			&& this.selected.threadId === request.threadId
			&& this.selected.frameId === request.frameId
			&& !!thread
			&& thread.state === 'stopped'
			&& thread.stopEpoch === request.stopEpoch
			&& thread.frames.some(frame => frame.id === request.frameId);
	}
}
