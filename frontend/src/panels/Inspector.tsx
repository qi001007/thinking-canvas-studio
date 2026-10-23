import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';
import type { PersistedFrame, PersistedValue, StackFrameSnapshot, ValueSnapshot } from '@core/domain/contracts';
import { currentSnapshot, type Breakpoint, type StudioState } from '@/state/studio-store';

type InspectorTab = 'variables' | 'stack' | 'breakpoints';
type DisplayFrame = PersistedFrame | StackFrameSnapshot;
type DisplayValue = PersistedValue | ValueSnapshot;

interface InspectorProps {
	readonly state: StudioState;
	readonly onSelectFrame: (threadId: string, frameId: string) => void;
	readonly onToggleBreakpoint: (source: string, line: number) => void;
	readonly onRemoveBreakpoint: (id: string) => void;
	readonly onDeleteNode: (id: string) => void;
}

export function Inspector({ state, onSelectFrame, onToggleBreakpoint, onRemoveBreakpoint, onDeleteNode }: InspectorProps) {
	const [tab, setTab] = useState<InspectorTab>('variables');
	const snapshot = currentSnapshot(state);
	const isHistory = state.snapshotIndex >= 0 && !!snapshot;
	const frames = isHistory && snapshot ? snapshot.frames : Object.values(state.debug.threads).flatMap(thread => thread.frames);
	const selected = frames.find(frame => frame.id === state.selectedFrameId) ?? frames[0];
	const selectedObject = state.manualBoard.scene.nodes.find(node => node.id === state.selectedNodeId);

	return (
		<aside className="inspector-pane">
			<div className="inspector-heading">
				<div>
					<span className="eyebrow">INSPECTOR</span>
					<strong>{state.mode === 'manual' ? '手绘画布' : selected ? `${selected.name} · ${selected.source ?? ''}:${selected.line ?? '—'}` : '调试检查器'}</strong>
				</div>
				{isHistory && <span className="history-badge">历史</span>}
			</div>
			{state.mode === 'manual' && (
				<div className="manual-inspector">
					{selectedObject ? (
						<>
							<div className="manual-inspector-row"><span>对象</span><strong>{selectedObject.label}</strong></div>
							<div className="manual-inspector-row"><span>类型</span><strong>{selectedObject.card?.kind ?? selectedObject.kind}</strong></div>
							<button type="button" className="btn btn-danger-ghost" onClick={() => onDeleteNode(selectedObject.id)}>删除对象</button>
						</>
					) : (
						<p className="empty-note">选中画布上的对象查看属性。手绘画布与调试快照是两套事实，不会互相覆盖。</p>
					)}
				</div>
			)}
			{state.mode === 'debug' && (
				<>
					<div className="inspector-tabs" role="tablist">
						<button type="button" role="tab" aria-selected={tab === 'variables'} className={tab === 'variables' ? 'is-active' : ''} onClick={() => setTab('variables')}>变量</button>
						<button type="button" role="tab" aria-selected={tab === 'stack'} className={tab === 'stack' ? 'is-active' : ''} onClick={() => setTab('stack')}>调用栈</button>
						<button type="button" role="tab" aria-selected={tab === 'breakpoints'} className={tab === 'breakpoints' ? 'is-active' : ''} onClick={() => setTab('breakpoints')}>断点</button>
					</div>
					<div className="inspector-body">
						{tab === 'variables' && <VariablesPanel frame={selected} />}
						{tab === 'stack' && (
							<StackPanel
								state={state}
								frames={frames}
								isHistory={isHistory}
								selectedFrameId={selected?.id}
								onSelectFrame={onSelectFrame}
							/>
						)}
						{tab === 'breakpoints' && (
							<BreakpointsPanel
								breakpoints={state.breakpoints}
								activeFile={state.activeFile}
								onToggle={onToggleBreakpoint}
								onRemove={onRemoveBreakpoint}
							/>
						)}
					</div>
				</>
			)}
		</aside>
	);
}

function VariablesPanel({ frame }: { readonly frame?: DisplayFrame }) {
	const [expanded, setExpanded] = useState<Set<string>>(new Set());
	useEffect(() => {
		if (!frame) {
			setExpanded(new Set());
			return;
		}
		const next = new Set<string>();
		for (const scope of frame.scopes) {
			next.add(`scope:${scope.id}`);
			for (const value of scope.values.slice(0, 12)) {
				if (value.children.length > 0 && next.size < 40) next.add(`value:${scope.id}:${value.id}`);
			}
		}
		setExpanded(next);
	}, [frame?.id, frame?.name]);

	if (!frame) return <EmptyInspector text="没有可检查的栈帧。运行演示会话并停在一个停点后查看变量。" />;
	return (
		<div className="variables-tree">
			{frame.scopes.length === 0 && <EmptyInspector text="当前帧没有作用域数据。" />}
			{frame.scopes.map(scope => {
				const scopeKey = `scope:${scope.id}`;
				const open = expanded.has(scopeKey);
				return (
					<div className="scope-block" key={scope.id}>
						<button type="button" className="tree-row tree-scope" onClick={() => toggle(scopeKey, setExpanded)}>
							<span className={`tree-chevron ${open ? 'is-open' : ''}`} />
							<span className="tree-name">{scope.name}</span>
							{scope.expensive && <span className="tree-tag">expensive</span>}
							<span className="tree-count">{scope.values.length}</span>
						</button>
						{open && scope.values.map(value => (
							<ValueRow key={`${scope.id}:${value.id}`} value={value} path={`${scope.id}:${value.id}`} depth={0} expanded={expanded} onToggle={setExpanded} />
						))}
					</div>
				);
			})}
		</div>
	);
}

function ValueRow({
	value,
	path,
	depth,
	expanded,
	onToggle
}: {
	readonly value: DisplayValue;
	readonly path: string;
	readonly depth: number;
	readonly expanded: Set<string>;
	readonly onToggle: Dispatch<SetStateAction<Set<string>>>;
}) {
	const key = `value:${path}`;
	const hasChildren = value.children.length > 0;
	const open = expanded.has(key);
	return (
		<div className="tree-branch">
			<div className="tree-row" style={{ paddingLeft: 10 + depth * 16 }}>
				<button
					type="button"
					className={`tree-toggle ${hasChildren ? '' : 'is-empty'}`}
					onClick={() => hasChildren && toggle(key, onToggle)}
					aria-label={hasChildren ? (open ? '折叠' : '展开') : undefined}
				>
					<span className={`tree-chevron ${open ? 'is-open' : ''}`} />
				</button>
				<span className="tree-name">{value.name}</span>
				{value.type && <span className="tree-type">{value.type}</span>}
				<span className="tree-value">{value.value}</span>
			</div>
			{open && hasChildren && value.children.slice(0, 100).map(child => (
				<ValueRow key={`${path}:${child.id}`} value={child} path={`${path}:${child.id}`} depth={depth + 1} expanded={expanded} onToggle={onToggle} />
			))}
		</div>
	);
}

function StackPanel({
	state,
	frames,
	isHistory,
	selectedFrameId,
	onSelectFrame
}: {
	readonly state: StudioState;
	readonly frames: readonly DisplayFrame[];
	readonly isHistory: boolean;
	readonly selectedFrameId?: string;
	readonly onSelectFrame: (threadId: string, frameId: string) => void;
}) {
	if (frames.length === 0) return <EmptyInspector text="没有调用栈。运行演示会话后在停点查看。" />;
	return (
		<div className="stack-tree">
			{isHistory ? (
				<div className="thread-block">
					<div className="thread-row"><span className="thread-dot is-stopped" />历史停点</div>
					{frames.map(frame => (
						<FrameRow key={frame.id} frame={frame} threadId="history" selected={frame.id === selectedFrameId} onSelect={onSelectFrame} />
					))}
				</div>
			) : (
				Object.values(state.debug.threads).map(thread => (
					<div className="thread-block" key={thread.id}>
						<div className="thread-row">
							<span className={`thread-dot is-${thread.state}`} />
							{thread.name}
							<span className="thread-state">{thread.state}</span>
						</div>
						{thread.frames.map(frame => (
							<FrameRow key={frame.id} frame={frame} threadId={thread.id} selected={frame.id === selectedFrameId} onSelect={onSelectFrame} />
						))}
					</div>
				))
			)}
		</div>
	);
}

function FrameRow({
	frame,
	threadId,
	selected,
	onSelect
}: {
	readonly frame: DisplayFrame;
	readonly threadId: string;
	readonly selected: boolean;
	readonly onSelect: (threadId: string, frameId: string) => void;
}) {
	return (
		<button type="button" className={`frame-row ${selected ? 'is-selected' : ''}`} onClick={() => onSelect(threadId, frame.id)}>
			<span className="frame-name">{frame.name}</span>
			<span className="frame-loc">{frame.source ?? ''}:{frame.line ?? '—'}</span>
		</button>
	);
}

function BreakpointsPanel({
	breakpoints,
	activeFile,
	onToggle,
	onRemove
}: {
	readonly breakpoints: readonly Breakpoint[];
	readonly activeFile: string;
	readonly onToggle: (source: string, line: number) => void;
	readonly onRemove: (id: string) => void;
}) {
	if (breakpoints.length === 0) return <EmptyInspector text="还没有断点。点击编辑器行号左侧的空白处添加。" />;
	return (
		<div className="breakpoints-list">
			{breakpoints.map(breakpoint => (
				<div className={`breakpoint-row ${breakpoint.source === activeFile ? 'is-active' : ''}`} key={breakpoint.id}>
					<label className="breakpoint-check">
						<input type="checkbox" checked={breakpoint.enabled} onChange={() => onToggle(breakpoint.source, breakpoint.line)} />
						<span className={`breakpoint-dot ${breakpoint.enabled ? 'is-enabled' : ''}`} />
					</label>
					<span className="breakpoint-file">{breakpoint.source}</span>
					<span className="breakpoint-line">{breakpoint.line}</span>
					<button type="button" className="icon-button" onClick={() => onRemove(breakpoint.id)} title="删除断点">×</button>
				</div>
			))}
			<p className="inspector-note">点击编辑器行号左侧的 glyph 区可添加/切换断点。</p>
		</div>
	);
}

function EmptyInspector({ text }: { readonly text: string }) {
	return <p className="empty-note inspector-empty">{text}</p>;
}

function toggle(key: string, update: Dispatch<SetStateAction<Set<string>>>): void {
	update(current => {
		const next = new Set(current);
		if (next.has(key)) next.delete(key);
		else next.add(key);
		return next;
	});
}