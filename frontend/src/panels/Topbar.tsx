import type { StudioMode, StudioState } from '@/state/studio-store';

interface TopbarProps {
	readonly state: StudioState;
	readonly onMode: (mode: StudioMode) => void;
	readonly onStart: () => void;
	readonly onContinue: () => void;
	readonly onStep: (kind: 'over' | 'into' | 'out') => void;
	readonly onStop: () => void;
	readonly onSave: () => void;
}

export function Topbar({ state, onMode, onStart, onContinue, onStep, onStop, onSave }: TopbarProps) {
	const stopped = state.debug.sessionState === 'stopped';
	const canControl = stopped && !!state.selectedFrameId;
	const hasSession = !!state.session && state.debug.sessionState !== 'ended';
	const dirty = state.editorText !== state.savedText;
	const modeLabel = state.mode === 'manual' ? '手绘' : '调试';
	return (
		<header className="topbar">
			<div className="brand-block">
				<img className="brand-mark" src="/brand.png" alt="" />
				<div className="brand-copy">
					<strong>Thinking Canvas Studio</strong>
					<span>算法思考 · 图形调试</span>
				</div>
			</div>
			<div className="topbar-center">
				<div className="mode-switch" role="group" aria-label="工作模式">
					<button type="button" className={state.mode === 'manual' ? 'is-active' : ''} onClick={() => onMode('manual')}>手绘</button>
					<button type="button" className={state.mode === 'debug' ? 'is-active' : ''} onClick={() => onMode('debug')}>调试</button>
				</div>
				<div className="file-chip">
					<span className="file-chip-dot" />
					<span>{state.activeFile || '未打开文件'}</span>
					{state.mode === 'manual' && <em>手绘 · {state.manualBoard.steps.length} 步</em>}
					{state.mode === 'debug' && <em>{modeLabel} · {state.snapshots.length} 个停点</em>}
				</div>
			</div>
			<div className="run-controls">
				{state.mode === 'debug' && !hasSession && (
					<button type="button" className="btn btn-primary" onClick={onStart} disabled={state.running}>
						<span className="run-triangle" /> 运行演示
					</button>
				)}
				{state.mode === 'debug' && hasSession && (
					<>
						<button type="button" className="btn" onClick={onContinue} disabled={!canControl || state.running} title="继续运行到下一个停点">继续</button>
						<div className="step-group" role="group" aria-label="单步">
							<button type="button" className="btn btn-compact" onClick={() => onStep('over')} disabled={!canControl || state.running} title="单步跳过">步过</button>
							<button type="button" className="btn btn-compact" onClick={() => onStep('into')} disabled={!canControl || state.running} title="单步进入">步入</button>
							<button type="button" className="btn btn-compact" onClick={() => onStep('out')} disabled={!canControl || state.running} title="单步跳出">步出</button>
						</div>
						<button type="button" className="btn btn-danger-ghost" onClick={onStop} disabled={state.running && !state.session} title="结束演示会话">停止</button>
					</>
				)}
				{state.mode === 'manual' && <span className="manual-mode-note">手绘模式 · 自动保存</span>}
				<button type="button" className="btn btn-quiet" onClick={onSave} disabled={!dirty} title="保存文件">保存</button>
				{state.session?.scripted && <span className="demo-badge" title="脚本化数据；未执行用户代码">脚本演示</span>}
			</div>
		</header>
	);
}