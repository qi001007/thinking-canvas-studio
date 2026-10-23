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
			return { id: snapshot.id, label: snapshot.label ?? `停点 ${snapshot.sequence ?? index + 1}`, changes };
		});
	}, [state.mode, state.manualBoard.steps, state.snapshots]);

	const activeIndex = state.mode === 'manual' ? state.manualStepIndex : state.snapshotIndex;
	const isLive = activeIndex < 0;
	const canGoBack = activeIndex > 0 || (isLive && entries.length > 1);
	const canGoForward = activeIndex >= 0 && activeIndex < entries.length - 1;

	const select = (index: number) => {
		if (state.mode === 'manual') onSelectManualStep(index);
		else onSelectSnapshot(index);
	};

	return (
		<footer className="timeline">
			<div className="timeline-head">
				<span className="timeline-title">时间线</span>
				{state.mode === 'manual' ? (
					<button type="button" className="btn btn-primary btn-small" onClick={onRecordStep}>记录一步</button>
				) : (
					<span className={`timeline-live ${isLive ? 'is-live' : ''}`}>{isLive ? '跟随当前停点' : '正在回看'}</span>
				)}
			</div>
			<div className="timeline-track">
				<button type="button" className="timeline-arrow" disabled={!canGoBack} onClick={() => select(activeIndex <= 0 ? 0 : activeIndex - 1)} aria-label="上一步">‹</button>
				<div className="timeline-chips">
					{entries.length === 0 && <span className="timeline-empty">{state.mode === 'manual' ? '还没有记录步骤' : '运行演示会话后出现停点'}</span>}
					{entries.map((entry, index) => (
						<button
							type="button"
							key={entry.id}
							className={`timeline-chip ${activeIndex === index ? 'is-active' : ''}`}
							onClick={() => select(index)}
							title={entry.label}
						>
							<span className="timeline-index">{index + 1}</span>
							<span className="timeline-label">{entry.label}</span>
							{entry.changes > 0 && <span className="timeline-change">{entry.changes}</span>}
						</button>
					))}
					{state.mode === 'debug' && entries.length > 0 && (
						<button type="button" className={`timeline-chip timeline-current ${isLive ? 'is-active' : ''}`} onClick={onBackToLive}>
							<span className="timeline-index">●</span>
							<span className="timeline-label">当前</span>
						</button>
					)}
				</div>
				<button type="button" className="timeline-arrow" disabled={!canGoForward} onClick={() => select(Math.min(entries.length - 1, activeIndex + 1))} aria-label="下一步">›</button>
			</div>
			{!isLive && (
				<div className="timeline-readonly">
					<span>只读回看</span>
					<button type="button" className="btn btn-small" onClick={onBackToLive}>回到当前</button>
				</div>
			)}
		</footer>
	);
}