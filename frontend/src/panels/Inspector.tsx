import { useEffect, useState, type Dispatch, type FormEvent, type SetStateAction } from 'react';
import type { PersistedFrame, PersistedValue, RuntimeHandle, StackFrameSnapshot, ValueSnapshot } from '@core/domain/contracts';
import type { VariablePage, VariablePageResult } from '@/host/types';
import { currentSnapshot, type Breakpoint, type StudioState, type WatchExpression } from '@/state/studio-store';

type InspectorTab = 'variables' | 'stack' | 'breakpoints';
type DisplayFrame = PersistedFrame | StackFrameSnapshot;
type DisplayValue = PersistedValue | ValueSnapshot;

interface InspectorProps {
	readonly state: StudioState;
	readonly onSelectFrame: (threadId: string, frameId: string) => void;
	readonly onToggleBreakpoint: (source: string, line: number) => void;
	readonly onRemoveBreakpoint: (id: string) => void;
	readonly onDeleteNode: (id: string) => void;
	readonly onAddWatch: (expression: string) => void;
	readonly onRemoveWatch: (id: string) => void;
	readonly onToggleWatch: (id: string) => void;
	readonly onLoadVariablePage: (container: RuntimeHandle, page: VariablePage) => Promise<VariablePageResult>;
}

export function Inspector({
	state,
	onSelectFrame,
	onToggleBreakpoint,
	onRemoveBreakpoint,
	onDeleteNode,
	onAddWatch,
	onRemoveWatch,
	onToggleWatch,
	onLoadVariablePage
}: InspectorProps) {
	const [tab, setTab] = useState<InspectorTab>('variables');
	const snapshot = currentSnapshot(state);
	const endedRecord = state.debug.sessionState === 'ended' && !!snapshot;
	const isHistory = (state.snapshotIndex >= 0 || endedRecord) && !!snapshot;
	const frames = isHistory && snapshot ? snapshot.frames : Object.values(state.debug.threads).flatMap(thread => thread.frames);
	const selected = frames.find(frame => frame.id === state.selectedFrameId) ?? frames[0];
	const selectedObject = state.manualBoard.scene.nodes.find(node => node.id === state.selectedNodeId);

	return (
		<aside className="inspector-pane">
			<div className="inspector-heading">
				<div>
					<span className="eyebrow">INSPECTOR</span>
					<strong>{state.mode === 'manual' ? '手绘画布' : selected ? `${selected.name} · ${shortSource(selected.source)}:${selected.line ?? '—'}` : '调试检查器'}</strong>
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
						{tab === 'variables' && (
								<VariablesPanel
									state={state}
									frame={selected}
									onAddWatch={onAddWatch}
									onRemoveWatch={onRemoveWatch}
									onToggleWatch={onToggleWatch}
									onLoadPage={onLoadVariablePage}
								/>
							)}
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

function VariablesPanel({
	state,
	frame,
	onAddWatch,
	onRemoveWatch,
	onToggleWatch,
	onLoadPage
}: {
	readonly state: StudioState;
	readonly frame?: DisplayFrame;
	readonly onAddWatch: (expression: string) => void;
	readonly onRemoveWatch: (id: string) => void;
	readonly onToggleWatch: (id: string) => void;
	readonly onLoadPage: (container: RuntimeHandle, page: VariablePage) => Promise<VariablePageResult>;
}) {
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

	const showWatch = state.watchExpressions.length > 0 || state.session?.scripted === false;
	const canEvaluate = state.debug.sessionState === 'stopped'
		&& state.debug.capabilities?.evaluate === true
		&& state.session?.mode !== 'record'
		&& !!frame;
	return (
		<div className="variables-tree">
			{showWatch && (
				<WatchPanel
					items={state.watchExpressions}
					canEvaluate={canEvaluate}
					onAdd={onAddWatch}
					onRemove={onRemoveWatch}
					onToggle={onToggleWatch}
				/>
			)}
			{!frame && <EmptyInspector text="停点后显示变量。" />}
			{frame && frame.scopes.length === 0 && <EmptyInspector text="当前帧没有变量。" />}
			{frame && frame.scopes.map(scope => {
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
							<ValueRow
								key={`${scope.id}:${value.id}`}
								value={value}
								path={`${scope.id}:${value.id}`}
								depth={0}
								expanded={expanded}
								onToggle={setExpanded}
								onLoadPage={onLoadPage}
							/>
						))}
					</div>
				);
			})}
		</div>
	);
}

function WatchPanel({
	items,
	canEvaluate,
	onAdd,
	onRemove,
	onToggle
}: {
	readonly items: readonly WatchExpression[];
	readonly canEvaluate: boolean;
	readonly onAdd: (expression: string) => void;
	readonly onRemove: (id: string) => void;
	readonly onToggle: (id: string) => void;
}) {
	const [draft, setDraft] = useState('');
	const submit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (!draft.trim() || !canEvaluate) return;
		onAdd(draft);
		setDraft('');
	};
	return (
		<div className="watch-panel">
			<form className="watch-form" onSubmit={submit}>
				<input
					value={draft}
					onChange={event => setDraft(event.target.value)}
					placeholder="监视表达式"
					disabled={!canEvaluate}
					aria-label="监视表达式"
				/>
				<button type="submit" disabled={!canEvaluate || !draft.trim()}>+</button>
			</form>
			{items.map(item => (
				<div className={`watch-row ${item.error ? 'is-error' : ''}`} key={item.id}>
					<input
						type="checkbox"
						checked={item.enabled}
						onChange={() => onToggle(item.id)}
						aria-label={`启用 ${item.expression}`}
					/>
					<span className="watch-expression" title={item.expression}>{item.expression}</span>
					<span className={`watch-value ${item.error ? 'is-error' : item.stale ? 'is-stale' : ''}`} title={item.error ?? item.value}>
						{item.loading ? '…' : item.error ?? item.value ?? (item.stale ? '运行中' : '—')}
					</span>
					<button type="button" className="watch-remove" onClick={() => onRemove(item.id)} aria-label="删除监视">×</button>
				</div>
			))}
		</div>
	);
}

function ValueRow({
	value,
	path,
	depth,
	expanded,
	onToggle,
	onLoadPage
}: {
	readonly value: DisplayValue;
	readonly path: string;
	readonly depth: number;
	readonly expanded: Set<string>;
	readonly onToggle: Dispatch<SetStateAction<Set<string>>>;
	readonly onLoadPage: (container: RuntimeHandle, page: VariablePage) => Promise<VariablePageResult>;
}) {
	const key = `value:${path}`;
	const [extra, setExtra] = useState<readonly ValueSnapshot[]>([]);
	const [hasMore, setHasMore] = useState(value.hasMore === true);
	const [total, setTotal] = useState<number | undefined>(value.childCount ?? undefined);
	const [loading, setLoading] = useState(false);
	const [pageError, setPageError] = useState<string>();
	const children = [...value.children, ...extra];
	const handle = 'handle' in value ? value.handle : undefined;
	const hasChildren = children.length > 0 || (hasMore && !!handle);
	const open = expanded.has(key);
	const loadMore = async () => {
		if (!handle || loading) return;
		setLoading(true);
		try {
			const filter = value.containerKind === 'dict' || value.containerKind === 'set'
				? 'named'
				: value.containerKind ? 'indexed' : undefined;
			const result = await onLoadPage(handle, { start: children.length, count: 50, filter });
			setExtra(current => [...current, ...result.values]);
			setHasMore(result.hasMore);
			setTotal(result.childCount ?? total);
			setPageError(undefined);
		} catch (error) {
			setHasMore(false);
			setPageError(error instanceof Error ? error.message : '分页失败');
		} finally {
			setLoading(false);
		}
	};
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
			{open && hasChildren && (
				<>
					{children.map(child => (
						<ValueRow key={`${path}:${child.id}`} value={child} path={`${path}:${child.id}`} depth={depth + 1} expanded={expanded} onToggle={onToggle} onLoadPage={onLoadPage} />
					))}
					{loading && <div className="tree-more">加载中…</div>}
					{pageError && <div className="tree-more is-error">{pageError}</div>}
					{!loading && hasMore && (
						<button type="button" className="tree-more" onClick={() => void loadMore()} disabled={!handle}>
							{handle ? `加载更多 · 已显示 ${children.length}${typeof total === 'number' ? ` / ${total}` : ''}` : `更多未加载 · 已显示 ${children.length}`}
						</button>
					)}
				</>
			)}
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
	if (frames.length === 0) return <EmptyInspector text="停点后显示调用栈。" />;
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
	if (breakpoints.length === 0) return <EmptyInspector text="点击行号左侧添加断点。" />;
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
			<p className="inspector-note">点击行号左侧切换断点。</p>
		</div>
	);
}

function EmptyInspector({ text }: { readonly text: string }) {
	return <p className="empty-note inspector-empty">{text}</p>;
}

function shortSource(source: string | undefined): string {
	if (!source) return '';
	return source.split(/[\\/]/).pop() ?? source;
}

function toggle(key: string, update: Dispatch<SetStateAction<Set<string>>>): void {
	update(current => {
		const next = new Set(current);
		if (next.has(key)) next.delete(key);
		else next.add(key);
		return next;
	});
}