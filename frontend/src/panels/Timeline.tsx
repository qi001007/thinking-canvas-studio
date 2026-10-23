import { useMemo } from 'react';
import { diffScenes } from '@core/canvas/diff';
import { projectSnapshot } from '@core/canvas/projector';
import type { SceneDto } from '@core/domain/contracts';
import type { StudioState } from '@/state/studio-store';

interface TimelineProps {
	readonly state: StudioState;
	readonly onSelectSnapshot: (index: number) => void;
	readonly onSelectManualStep: (index: number) => void;
	readonly onBackToLive: () => void;
	readonly onRecordStep: () => void;
}

interface TimelineEntry {
	readonly id: string;
	readonly label: string;
	readonly changes: number;
}

export function Timeline({ state, onSelectSnapshot, onSelectManualStep, onBackToLive, onRecordStep }: TimelineProps) {
	const entries = useMemo<TimelineEntry[]>(() => {
		if (state.mode === 'manual') {
			let previous: SceneDto | undefined;
			return state.manualBoard.steps.map((step, index) => {
				const changes = diffScenes(previous, step.scene).changedNodeIds.size;
				previous = step.scene;
				return { id: step.id, label: step.title || `步骤 ${index + 1}`, changes };
			});
		}
		let previous: SceneDto | undefined;
		return state.snapshots.map((snapshot, index) => {
			const projection = projectSnapshot(snapshot).scene;
			const changes = diffScenes(previous, projection).changedNodeIds.size;
			previous = projection;
			return { id: snapshot.id, label: snapshot.label ?? `帧 ${snapshot.sequence ?? index + 1}`, changes };
		});
	}, [state.mode, state.manualBoard.steps, state.snapshots]);

	const activeIndex = state.mode === 'manual' ? state.manualStepIndex : state.snapshotIndex;
	const live = activeIndex < 0;
	const maxIndex = Math.max(0, entries.length - 1);
	const currentIndex = live ? maxIndex : Math.min(activeIndex, maxIndex);
	const currentLabel = entries.length > 0 ? entries[currentIndex]?.label ?? '—' : '等待停点';
	const dropped = state.mode === 'debug' ? state.droppedSnapshots : 0;

	const select = (index: number) => {
		if (state.mode === 'manual') onSelectManualStep(index);
		else onSelectSnapshot(index);
	};
	const step = (delta: number) => {
		if (entries.length === 0) return;
		select(Math.max(0, Math.min(maxIndex, currentIndex + delta)));
	};

	return (
		<footer className="timeline">
			<div className="timeline-head">
				<span className="timeline-title">时间线</span>
				{state.mode === 'manual' ? (
					<button type="button" className="btn btn-primary btn-small" onClick={onRecordStep}>记录一步</button>
				) : (
					<span className={`timeline-live ${live ? 'is-live' : ''}`}>
						{entries.length} 帧{dropped > 0 ? ` · 保留最近 ${entries.length} / 丢弃 ${dropped}` : ''}
					</span>
				)}
			</div>
			<div className="timeline-track">
				<button type="button" className="timeline-arrow" disabled={entries.length === 0 || currentIndex === 0} onClick={() => step(-1)} aria-label="上一帧">‹</button>
				<div className="timeline-scrubber">
					<input
						type="range"
						min={0}
						max={maxIndex}
						value={entries.length === 0 ? 0 : currentIndex}
						onChange={event => select(Number(event.target.value))}
						disabled={entries.length === 0}
						aria-label="时间线帧"
					/>
					<div className="timeline-scale">
						<span>0</span>
						<span>{entries.length === 0 ? '—' : `${currentIndex + 1} / ${entries.length}`}</span>
						<span>{entries.length === 0 ? '—' : entries.length - 1}</span>
					</div>
				</div>
				<button type="button" className="timeline-arrow" disabled={entries.length === 0 || currentIndex >= maxIndex} onClick={() => step(1)} aria-label="下一帧">›</button>
			</div>
			<div className="timeline-current">
				<span className={live ? 'is-live' : ''}>{live ? '当前 · ' : '回看 · '}{currentLabel}</span>
				{!live && (
					<button type="button" className="btn btn-small" onClick={onBackToLive}>回到当前</button>
				)}
			</div>
		</footer>
	);
}