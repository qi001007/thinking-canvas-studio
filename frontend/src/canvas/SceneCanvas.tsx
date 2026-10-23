import { useEffect, useMemo, useRef, useState, type PointerEvent, type WheelEvent } from 'react';
import { graphlib, layout as dagreLayout } from '@dagrejs/dagre';
import type { SceneDiff } from '@core/canvas/diff';
import type { LayoutViewState } from '@core/canvas/documents';
import type { CanvasNode, CardData, SceneDto, TraceSnapshot } from '@core/domain/contracts';

interface SceneCanvasProps {
	readonly scene: SceneDto;
	readonly mode: 'manual' | 'debug';
	readonly graphView?: 'overview' | 'structure' | 'data';
	readonly focusId?: string;
	readonly history?: readonly TraceSnapshot[];
	readonly historyIndex?: number;
	readonly layout: LayoutViewState;
	readonly diff: SceneDiff;
	readonly selectedNodeId?: string;
	readonly readOnly?: boolean;
	readonly onSelect: (id: string | undefined) => void;
	readonly onMove: (id: string, x: number, y: number) => void;
	readonly onCommitMove: () => void;
}

interface Point {
	readonly x: number;
	readonly y: number;
}

interface Viewport {
	readonly x: number;
	readonly y: number;
	readonly zoom: number;
}

interface FrameRegion {
	readonly id: string;
	readonly title: string;
	readonly subtitle: string;
	readonly params: readonly string[];
	readonly hideNodeId?: string;
	readonly variant?: 'frame' | 'control';
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
}

const SURFACE_WIDTH = 2400;
const SURFACE_HEIGHT = 1600;

const CARD_WIDTH: Record<CardData['kind'], number> = {
	array: 280,
	matrix: 330,
	list: 250,
	set: 230,
	dict: 270,
	variable: 200,
	node: 200,
	text: 220,
	struct: 270,
	pointer: 210,
	tensor: 260,
	'stack-frame': 210,
	sticky: 260,
	function: 300,
	class: 300,
	parameter: 210,
	module: 260,
	import: 240,
	call: 280,
	external: 230,
	loop: 260,
	branch: 240
};

const STATIC_CARD_WIDTH: Partial<Record<CardData['kind'], number>> = {
	class: 250,
	function: 250,
	parameter: 180,
	variable: 170,
	module: 220,
	import: 200,
	call: 230,
	external: 180,
	loop: 210,
	branch: 220
};

const CARD_HEIGHT: Record<CardData['kind'], number> = {
	array: 150,
	matrix: 160,
	list: 165,
	set: 150,
	dict: 160,
	variable: 90,
	node: 90,
	text: 90,
	struct: 165,
	pointer: 90,
	tensor: 140,
	'stack-frame': 84,
	sticky: 130,
	function: 160,
	class: 180,
	parameter: 92,
	module: 100,
	import: 110,
	call: 140,
	external: 92,
	loop: 100,
	branch: 84
};

export function SceneCanvas({
	scene,
	mode,
	graphView = 'overview',
	focusId,
	history,
	historyIndex,
	layout,
	diff,
	selectedNodeId,
	readOnly = false,
	onSelect,
	onMove,
	onCommitMove
}: SceneCanvasProps) {
	const [viewport, setViewport] = useState<Viewport>({ x: 24, y: 16, zoom: 1 });
	const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 });
	const viewportRef = useRef<HTMLDivElement | null>(null);
	const panRef = useRef<{ x: number; y: number; startX: number; startY: number } | null>(null);
	const dragRef = useRef<{ id: string; startX: number; startY: number; originX: number; originY: number } | null>(null);
	const positions = useMemo(() => layoutPositions(scene, layout, graphView, focusId), [scene, layout, graphView, focusId]);
	const sceneKey = useMemo(() => scene.nodes.map(node => node.id).join('|'), [scene.nodes]);
	const regions = useMemo(() => frameRegions(scene, positions, graphView, focusId), [scene, positions, graphView, focusId]);
	const hiddenNodeIds = useMemo(() => new Set(regions.map(region => region.hideNodeId).filter((id): id is string => !!id)), [regions]);
	const loopTracks = useMemo(
		() => loopHistory(scene, history, historyIndex, focusId),
		[scene, history, historyIndex, focusId]
	);
	const visibleEdges = useMemo(() => {
		const isStatic = scene.nodes.some(node => node.origin === 'static');
		if (!isStatic) return scene.edges;
		const frameFocus = focusId
			?? scene.nodes.find(node => node.card?.kind === 'class')?.id
			?? scene.nodes.find(node => node.card?.kind === 'function' && !String(node.label).startsWith('__main__'))?.id;
		const allowed = graphView === 'structure'
			? new Set(['defines', 'parameter', 'method', 'field', 'inherits', 'iterates', 'calls', 'returns', 'imports', 'uses', 'nested'])
			: graphView === 'data'
				? new Set(['parameter', 'field', 'defines', 'flows', 'produces', 'returns', 'iterates', 'reads', 'writes', 'contains'])
				: new Set(['defines', 'calls', 'inherits', 'imports', 'uses', 'nested', 'method', 'field', 'parameter']);
		return scene.edges.filter(edge => {
			if (!allowed.has(edge.kind)) return false;
			if (['contains', 'nested'].includes(edge.kind)) return false;
			if (edge.from === frameFocus && ['defines', 'parameter', 'method', 'field'].includes(edge.kind)) return false;
			return true;
		});
	}, [scene, graphView, focusId]);

	useEffect(() => {
		const surface = viewportRef.current;
		if (!surface) return;
		const update = () => setViewportSize({ width: surface.clientWidth, height: surface.clientHeight });
		update();
		const observer = new ResizeObserver(update);
		observer.observe(surface);
		return () => observer.disconnect();
	}, []);

	useEffect(() => {
		if (viewportSize.width === 0 || viewportSize.height === 0 || scene.nodes.length === 0) {
			setViewport({ x: 24, y: 16, zoom: 1 });
			return;
		}
		setViewport(fitViewport(scene, positions, viewportSize.width, viewportSize.height, regions));
	}, [sceneKey, mode, graphView, focusId, viewportSize.width, viewportSize.height]);

	const startPan = (event: PointerEvent<HTMLDivElement>) => {
		if (event.target !== event.currentTarget) return;
		event.currentTarget.setPointerCapture(event.pointerId);
		panRef.current = { x: viewport.x, y: viewport.y, startX: event.clientX, startY: event.clientY };
	};
	const movePan = (event: PointerEvent<HTMLDivElement>) => {
		const pan = panRef.current;
		if (!pan) return;
		setViewport(current => ({ ...current, x: pan.x + event.clientX - pan.startX, y: pan.y + event.clientY - pan.startY }));
	};
	const endPan = () => {
		panRef.current = null;
	};

	const startDrag = (event: PointerEvent<HTMLDivElement>, node: CanvasNode) => {
		event.stopPropagation();
		onSelect(node.id);
		if (mode !== 'manual' || readOnly || event.button !== 0) return;
		event.currentTarget.setPointerCapture(event.pointerId);
		const origin = positions[node.id] ?? { x: 0, y: 0 };
		dragRef.current = { id: node.id, startX: event.clientX, startY: event.clientY, originX: origin.x, originY: origin.y };
	};
	const moveDrag = (event: PointerEvent<HTMLDivElement>) => {
		const drag = dragRef.current;
		if (!drag) return;
		onMove(drag.id, drag.originX + (event.clientX - drag.startX) / viewport.zoom, drag.originY + (event.clientY - drag.startY) / viewport.zoom);
	};
	const endDrag = () => {
		if (!dragRef.current) return;
		dragRef.current = null;
		onCommitMove();
	};

	const changeZoom = (delta: number) => {
		setViewport(current => ({ ...current, zoom: Math.max(0.4, Math.min(1.8, current.zoom + delta)) }));
	};

	return (
		<div className="scene-viewport" ref={viewportRef}>
			<div
				className="scene-surface"
				style={{ transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.zoom})` }}
				onPointerDown={startPan}
				onPointerMove={movePan}
				onPointerUp={endPan}
				onPointerCancel={endPan}
				onWheel={(event: WheelEvent<HTMLDivElement>) => {
					if (!event.ctrlKey && !event.metaKey) return;
					event.preventDefault();
					changeZoom(event.deltaY < 0 ? 0.08 : -0.08);
				}}
				onClick={event => {
					if (event.target === event.currentTarget) onSelect(undefined);
				}}
			>
				<svg className="scene-edges" width={SURFACE_WIDTH} height={SURFACE_HEIGHT} aria-hidden="true">
					<defs>
						<marker id="arrow-accent" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto">
							<path d="M0,0 L9,4.5 L0,9 Z" fill="var(--accent)" />
						</marker>
						<marker id="arrow-alias" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto">
							<path d="M0,0 L9,4.5 L0,9 Z" fill="var(--violet)" />
						</marker>
					</defs>
					{visibleEdges.map((edge, edgeIndex) => {
						if (hiddenNodeIds.has(edge.from) || hiddenNodeIds.has(edge.to)) return null;
						const from = positions[edge.from];
						const to = positions[edge.to];
						if (!from || !to) return null;
						const fromNode = scene.nodes.find(node => node.id === edge.from);
						const toNode = scene.nodes.find(node => node.id === edge.to);
						const fromSize = fromNode ? sizeOf(fromNode) : { width: 0, height: 0 };
						const toSize = toNode ? sizeOf(toNode) : { width: 0, height: 0 };
						const start = edgeStart(from, fromSize, to);
						const end = edgeEnd(to, toSize, from);
						const outgoing = visibleEdges.filter(item => item.from === edge.from);
						const incoming = visibleEdges.filter(item => item.to === edge.to);
						const outIndex = outgoing.findIndex(item => item.id === edge.id);
						const inIndex = incoming.findIndex(item => item.id === edge.id);
						const startPort = { x: start.x + (outIndex - (outgoing.length - 1) / 2) * 14, y: start.y };
						const endPort = { x: end.x + (inIndex - (incoming.length - 1) / 2) * 14, y: end.y };
						const lane = ((edgeIndex % 7) - 3) * 16;
						const middle = (startPort.x + endPort.x) / 2 + lane;
						const labelY = (startPort.y + endPort.y) / 2 - 4 + ((edgeIndex % 3) - 1) * 12;
						const path = `M ${startPort.x} ${startPort.y} C ${middle} ${startPort.y}, ${middle} ${endPort.y}, ${endPort.x} ${endPort.y}`;
						return (
							<g key={edge.id}>
								<title>{edge.kind}{edge.label ? ` · ${edge.label}` : ''}</title>
								<path
									d={path}
									className={`scene-edge scene-edge-${edge.kind}`}
									markerEnd={edge.kind === 'contains' || edge.kind === 'defines' ? undefined : edge.kind === 'alias' ? 'url(#arrow-alias)' : 'url(#arrow-accent)'}
								/>
								{edge.label && ['calls', 'returns', 'inherits', 'imports', 'parameter', 'iterates'].includes(edge.kind) && (
									<text className="scene-edge-label" x={middle} y={labelY}>
										{edge.label}
									</text>
								)}
							</g>
						);
					})}
				</svg>
				{regions.map(region => {
					const loopId = region.id.startsWith('control:') ? region.id.slice('control:'.length) : undefined;
					const track = loopId ? loopTracks[loopId] : undefined;
					return (
						<div
							className={`scene-frame-region ${region.variant === 'control' ? 'is-control' : ''}`}
							key={region.id}
							style={{ left: region.x, top: region.y, width: region.width, height: region.height }}
						>
							<div className="scene-frame-head">
								<strong>{region.title}</strong>
								<span>{region.subtitle}</span>
								{region.params.length > 0 && (
									<div className="scene-frame-params">
										{region.params.map(param => <span key={param}>{param}</span>)}
									</div>
								)}
							</div>
							{track && (
								<div className="scene-loop-track" style={{ top: 46 }}>
									{track.truncated && <span className="is-muted">…</span>}
									{track.chips.map((chip, index) => (
										<span className={index === track.chips.length - 1 ? 'is-current' : ''} key={chip.iteration}>
											{chip.iteration}. {chip.text}
										</span>
									))}
								</div>
							)}
						</div>
					);
				})}
				{scene.nodes.filter(node => !hiddenNodeIds.has(node.id)).map(node => {
					const position = positions[node.id] ?? { x: 0, y: 0 };
					const size = sizeOf(node);
					const changedParts = diff.changedParts.get(node.id);
					return (
						<div
							key={node.id}
							className={[
								'canvas-card',
								`canvas-card-${node.card?.kind ?? 'variable'}`,
								selectedNodeId === node.id ? 'is-selected' : '',
								diff.changedNodeIds.has(node.id) ? 'is-changed' : '',
								node.origin === 'static' ? 'is-static' : '',
								node.origin === 'runtime' ? 'is-runtime' : ''
							].filter(Boolean).join(' ')}
							style={{ left: position.x, top: position.y, width: size.width, minHeight: size.height }}
							onPointerDown={event => startDrag(event, node)}
							onPointerMove={moveDrag}
							onPointerUp={endDrag}
							onPointerCancel={endDrag}
							onClick={event => {
								event.stopPropagation();
								onSelect(node.id);
							}}
						>
							<CardHeader node={node} changedParts={changedParts} />
							<CardBody node={node} changedParts={changedParts} />
						</div>
					);
				})}
			</div>
			{scene.nodes.length === 0 && (
				<div className="canvas-empty">
					<div className="canvas-empty-mark" aria-hidden="true">
						<span />
						<span />
						<span />
						<span />
					</div>
					<p>{mode === 'debug' ? '等待停点' : '空画布'}</p>
					<small>{mode === 'debug' ? '运行后显示结构' : '从左侧添加卡片'}</small>
				</div>
			)}
			{scene.edges.length > 0 && (
				<div className="canvas-legend" aria-label="关系图例">
					<span><i className="legend-line is-call" />调用/结构</span>
					<span><i className="legend-line is-iter" />迭代</span>
					<span><i className="legend-line is-data" />数据流</span>
				</div>
			)}
			<div className="canvas-zoom">
				<button type="button" onClick={() => changeZoom(-0.1)} aria-label="缩小">−</button>
				<span>{Math.round(viewport.zoom * 100)}%</span>
				<button type="button" onClick={() => changeZoom(0.1)} aria-label="放大">+</button>
				<button
					type="button"
					className="canvas-fit"
					onClick={() => {
						const surface = viewportRef.current;
						if (!surface) return;
						setViewport(fitViewport(scene, positions, surface.clientWidth, surface.clientHeight, regions));
					}}
				>适配</button>
			</div>
		</div>
	);
}

function CardHeader({ node, changedParts }: { readonly node: CanvasNode; readonly changedParts?: ReadonlySet<string> }) {
	const card = node.card;
	const type = node.type ?? card?.kind ?? node.kind;
	return (
		<div className="canvas-card-head">
			<span className="canvas-card-title">{node.label}</span>
			<span className="canvas-card-type">{type}</span>
			{changedParts?.has('label') && <span className="canvas-change-dot" title="有变化" />}
		</div>
	);
}

function CardBody({ node, changedParts }: { readonly node: CanvasNode; readonly changedParts?: ReadonlySet<string> }) {
	const card = node.card;
	if (!card) return <div className="canvas-card-body muted">无结构数据</div>;
	switch (card.kind) {
		case 'array':
		case 'matrix':
			return (
				<>
					<div className={`canvas-grid canvas-grid-${card.kind}`}>
						{card.rows.map((row, rowIndex) => (
							<div className="canvas-grid-row" key={rowIndex}>
								{row.map((cell, columnIndex) => (
									<span
										className={`canvas-cell ${changedParts?.has(`cell:${rowIndex}:${columnIndex}`) ? 'is-changed' : ''}`}
										key={`${rowIndex}:${columnIndex}`}
									>
										{cell.value}
									</span>
								))}
							</div>
						))}
					</div>
					{card.truncated && <MoreRow shown={card.rows.reduce((count, row) => count + row.length, 0)} total={card.total} />}
				</>
			);
		case 'list':
		case 'set':
			if (card.items.length === 0 && !card.truncated) return <div className="canvas-empty-inline">空{card.kind === 'set' ? '集合' : '列表'}</div>;
			return (
				<>
					<div className="canvas-items">
						{card.items.map((item, index) => (
							<div className={`canvas-item ${changedParts?.has(`item:${index}`) ? 'is-changed' : ''}`} key={index}>
								<span className="canvas-item-index">{index}</span>
								<span>{item.value}</span>
							</div>
						))}
					</div>
					{card.truncated && <MoreRow shown={card.items.length} total={card.total} />}
				</>
			);
		case 'dict':
			if (card.entries.length === 0 && !card.truncated) return <div className="canvas-empty-inline">空字典</div>;
			return (
				<>
					<div className="canvas-items">
						{card.entries.map(entry => (
							<div className={`canvas-item canvas-dict-row ${changedParts?.has(`entry:${entry.key}`) ? 'is-changed' : ''}`} key={entry.key}>
								<span className="canvas-dict-key">{entry.key}</span>
								<span>{entry.value}</span>
							</div>
						))}
					</div>
					{card.truncated && <MoreRow shown={card.entries.length} total={card.total} />}
				</>
			);
		case 'struct':
			return (
				<>
					<div className="canvas-items">
						{card.fields.map(field => (
							<div className={`canvas-item ${changedParts?.has(`field:${field.name}`) ? 'is-changed' : ''}`} key={field.name}>
								<span className="canvas-field-name">{field.name}</span>
								<span>{field.value}</span>
							</div>
						))}
					</div>
					{card.truncated && <MoreRow shown={card.fields.length} total={card.total} />}
				</>
			);
		case 'pointer':
			return <div className="canvas-big-value">{card.reference ?? card.target ?? 'null'}</div>;
		case 'tensor':
			return (
				<div className="canvas-tensor">
					<div><span>shape</span><strong>{card.shape.join(' × ') || '—'}</strong></div>
					<div><span>dtype</span><strong>{card.dtype ?? '—'}</strong></div>
					<div className="canvas-tensor-preview">{card.preview ?? '—'}</div>
				</div>
			);
		case 'stack-frame':
			return <div className="canvas-frame-loc">{shortSource(card.source)}:{card.line ?? '—'}</div>;
		case 'module':
			return <div className="canvas-module"><span>{card.path}</span>{card.source && <small>继承 · {card.source}</small>}</div>;
		case 'class':
			return (
				<div className="canvas-class">
					<div className="canvas-signature">{card.name}{card.bases.length > 0 ? `(${card.bases.join(', ')})` : ''}</div>
					{card.fields && card.fields.length > 0 && <div className="canvas-function-meta"><span>字段</span>{compactList(card.fields)}</div>}
					{card.methods && card.methods.length > 0 && <div className="canvas-function-meta"><span>方法</span>{compactList(card.methods)}</div>}
					{card.line && <div className="canvas-complexity">line {card.line}</div>}
				</div>
			);
		case 'parameter':
			return (
				<div className="canvas-parameter">
					<span>{card.name}</span>
					{card.type && <em>{card.type}</em>}
					{card.value !== undefined ? <small>{card.value}</small> : card.defaultValue && <small>= {card.defaultValue}</small>}
				</div>
			);
		case 'import':
			return <div className="canvas-import"><span>{card.module}</span>{card.names && card.names.length > 0 && <small>{card.names.join(', ')}</small>}</div>;
		case 'call':
			return (
				<div className="canvas-call">
					<div className="canvas-signature">{card.target}</div>
					{card.args && card.args.length > 0 && <div className="canvas-call-args">{card.args.join(', ')}</div>}
					{card.line && <div className="canvas-complexity">line {card.line}</div>}
				</div>
			);
		case 'external':
			return <div className="canvas-external"><span>{card.target}</span>{card.category && <small>{card.category}</small>}</div>;
		case 'loop':
			return <div className="canvas-loop"><span>{card.header}</span>{card.line && <small>line {card.line}</small>}</div>;
		case 'branch':
			return <div className="canvas-branch"><span>{card.condition}</span>{card.line && <small>line {card.line}</small>}</div>;
		case 'sticky':
			return <div className={`canvas-sticky ${card.tone === 'invariant' ? 'is-invariant' : ''}`}>{card.text}</div>;
		case 'function':
			return (
				<div className="canvas-function">
					<div className="canvas-signature">{card.signature}</div>
					{card.params && card.params.length > 0 && <div className="canvas-function-meta"><span>参数</span>{card.params.join(', ')}</div>}
					<div className="canvas-function-meta"><span>输出</span>{card.returns ?? card.output ?? '—'}</div>
					{card.complexity && <div className="canvas-complexity">{card.complexity}</div>}
					{card.line && <div className="canvas-complexity">line {card.line}</div>}
				</div>
			);
		case 'variable':
		case 'node':
		case 'text':
			return <div className="canvas-big-value">{card.value}</div>;
	}
}

function frameRegions(
	scene: SceneDto,
	positions: Record<string, Point>,
	graphView: 'overview' | 'structure' | 'data',
	focusId: string | undefined
): FrameRegion[] {
	if (scene.nodes.some(node => node.kind === 'stack-frame')) {
		const byId = new Map(scene.nodes.map(node => [node.id, node]));
		const frames = scene.nodes.filter(node => node.kind === 'stack-frame');
		const regions: FrameRegion[] = [];
		for (const frame of frames) {
			const included = new Set<string>();
			const queue = [frame.id];
			while (queue.length > 0) {
				const current = queue.pop()!;
				if (included.has(current)) continue;
				included.add(current);
				for (const edge of scene.edges) {
					if ((edge.from === current || edge.to === current) && ['contains', 'points-to', 'alias'].includes(edge.kind)) {
						const next = edge.from === current ? edge.to : edge.from;
						if (byId.has(next) && !included.has(next)) queue.push(next);
					}
				}
			}
			let minY = Number.POSITIVE_INFINITY;
			let maxY = 0;
			let minX = Number.POSITIVE_INFINITY;
			let maxX = 0;
			for (const id of included) {
				const node = byId.get(id);
				const position = positions[id];
				if (!node || !position) continue;
				const size = sizeOf(node);
				minX = Math.min(minX, position.x);
				minY = Math.min(minY, position.y);
				maxX = Math.max(maxX, position.x + size.width);
				maxY = Math.max(maxY, position.y + size.height);
			}
			if (!Number.isFinite(minX) || !Number.isFinite(minY)) continue;
			const card = frame.card?.kind === 'stack-frame' ? frame.card : undefined;
			regions.push({
				id: `frame:${frame.id}`,
				title: frame.label,
				subtitle: card ? `${shortSource(card.source)}:${card.line ?? '—'}` : '当前栈帧',
				params: [],
				hideNodeId: frame.id,
				x: minX - 24,
				y: frame.kind === 'stack-frame' ? positions[frame.id]?.y ?? minY : minY - 46,
				width: maxX - minX + 48,
				height: maxY - (positions[frame.id]?.y ?? minY) + 26
			});
		}
		return regions;
	}
	const overlay = scene.nodes.some(node => node.origin === 'runtime') && scene.nodes.some(node => node.origin === 'static');
	if (!scene.nodes.some(node => node.origin === 'static') || (graphView !== 'structure' && graphView !== 'data' && !overlay)) return [];
	const focus = scene.nodes.find(node => node.id === focusId)
		?? scene.nodes.find(node => node.card?.kind === 'class')
		?? scene.nodes.find(node => node.card?.kind === 'function');
	if (!focus || (focus.card?.kind !== 'class' && focus.card?.kind !== 'function')) return [];
	const byId = new Map(scene.nodes.map(node => [node.id, node]));
	const internal = new Set(['parameter', 'defines', 'contains', 'writes', 'reads', 'produces', 'flows', 'returns', 'iterates', 'nested', 'field', 'method']);
	const included = new Set([focus.id]);
	let changed = true;
	while (changed) {
		changed = false;
		for (const edge of scene.edges) {
			if (!internal.has(edge.kind)) continue;
			if (included.has(edge.from) && byId.has(edge.to) && !included.has(edge.to)) {
				included.add(edge.to);
				changed = true;
			}
			if (included.has(edge.to) && byId.has(edge.from) && !included.has(edge.from)) {
				included.add(edge.from);
				changed = true;
			}
		}
	}
	const hideFocus = focus.card?.kind === 'function' || focus.card?.kind === 'class';
	if (hideFocus) included.delete(focus.id);
	const parentMap = structuralParentMap(scene);
	const childMap = new Map<string, string[]>();
	for (const [child, parent] of parentMap) {
		childMap.set(parent, [...(childMap.get(parent) ?? []), child]);
	}
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = 0;
	let maxY = 0;
	for (const id of included) {
		const node = byId.get(id);
		const position = positions[id];
		if (!node || !position) continue;
		const size = sizeOf(node);
		minX = Math.min(minX, position.x);
		minY = Math.min(minY, position.y);
		maxX = Math.max(maxX, position.x + size.width);
		maxY = Math.max(maxY, position.y + size.height);
	}
	if (!Number.isFinite(minX) || !Number.isFinite(minY)) return [];
	const padding = 28;
	const header = 46;
	const params = focus.card.kind === 'function' ? focus.card.params ?? [] : focus.card.bases;
	const subtitle = focus.card.kind === 'function'
		? focus.card.signature
		: focus.card.kind === 'class' ? `类${focus.card.bases.length > 0 ? ` · 继承 ${focus.card.bases.join(', ')}` : ''}` : '';
	const regions: FrameRegion[] = [{
		id: `frame:${focus.id}`,
		title: focus.label,
		subtitle,
		params,
		hideNodeId: hideFocus ? focus.id : undefined,
		variant: 'frame',
		x: minX - padding,
		y: Math.max(0, minY - header - 14),
		width: maxX - minX + padding * 2,
		height: maxY - minY + header + padding + 14
	}];
	const collectDescendants = (id: string): string[] => {
		const result: string[] = [];
		const visit = (parent: string) => {
			for (const child of childMap.get(parent) ?? []) {
				result.push(child);
				visit(child);
			}
		};
		visit(id);
		return result;
	};
	for (const node of scene.nodes) {
		if (node.card?.kind !== 'loop' && node.card?.kind !== 'branch') continue;
		const position = positions[node.id];
		if (!position) continue;
		const descendants = collectDescendants(node.id);
		let controlMinX = position.x;
		let controlMinY = position.y;
		let controlMaxX = position.x + sizeOf(node).width;
		let controlMaxY = position.y + sizeOf(node).height;
		for (const id of descendants) {
			const child = byId.get(id);
			const childPosition = positions[id];
			if (!child || !childPosition) continue;
			const size = sizeOf(child);
			controlMinX = Math.min(controlMinX, childPosition.x);
			controlMinY = Math.min(controlMinY, childPosition.y);
			controlMaxX = Math.max(controlMaxX, childPosition.x + size.width);
			controlMaxY = Math.max(controlMaxY, childPosition.y + size.height);
		}
		const title = node.card.kind === 'loop' ? node.card.header : node.card.condition;
		regions.push({
			id: `control:${node.id}`,
			title,
			subtitle: node.card.line ? `line ${node.card.line}` : '',
			params: [],
			hideNodeId: node.id,
			variant: 'control',
			x: controlMinX - 14,
			y: controlMinY,
			width: controlMaxX - controlMinX + 28,
			height: controlMaxY - controlMinY + 20
		});
	}
	return regions;
}

function layoutPositions(scene: SceneDto, layout: LayoutViewState, graphView: 'overview' | 'structure' | 'data', focusId: string | undefined): Record<string, Point> {
	const positions: Record<string, Point> = {};
	if (scene.nodes.some(node => node.origin === 'static')) {
		return staticGraphPositions(scene, layout, graphView, focusId);
	}
	if (scene.nodes.some(node => node.kind === 'stack-frame')) {
		return runtimeFramePositions(scene);
	}
	let frameIndex = 0;
	let valueIndex = 0;
	for (const node of scene.nodes) {
		const stored = layout.positions[node.id];
		if (stored) {
			positions[node.id] = stored;
			continue;
		}
		if (node.kind === 'stack-frame') {
			positions[node.id] = { x: 24, y: 48 + frameIndex * 138 };
			frameIndex++;
			continue;
		}
		positions[node.id] = { x: 270, y: 32 + valueIndex * 190 };
		valueIndex++;
	}
	return positions;
}

function runtimeFramePositions(scene: SceneDto): Record<string, Point> {
	const positions: Record<string, Point> = {};
	const frames = scene.nodes.filter(node => node.kind === 'stack-frame');
	const byId = new Map(scene.nodes.map(node => [node.id, node]));
	const assigned = new Set<string>();
	const memberIds = new Map<string, string[]>();
	for (const frame of frames) {
		const ids: string[] = [];
		const queue = [frame.id];
		const seen = new Set<string>();
		while (queue.length > 0) {
			const current = queue.pop()!;
			if (seen.has(current)) continue;
			seen.add(current);
			if (current !== frame.id) ids.push(current);
			for (const edge of scene.edges) {
				if ((edge.from === current || edge.to === current) && ['contains', 'points-to', 'alias'].includes(edge.kind)) {
					const next = edge.from === current ? edge.to : edge.from;
					if (byId.has(next) && !seen.has(next)) queue.push(next);
				}
			}
		}
		memberIds.set(frame.id, ids);
	}
	let top = 56;
	for (const frame of frames) {
		const members = (memberIds.get(frame.id) ?? []).filter(id => !assigned.has(id)).map(id => byId.get(id)!).filter(Boolean);
		members.forEach(node => assigned.add(node.id));
		const columns = members.length > 4 ? 2 : Math.max(1, Math.min(2, members.length));
		const rows = Math.ceil(members.length / columns);
		const columnWidths = Array.from({ length: columns }, () => 0);
		rows && members.forEach((node, index) => {
			const column = index % columns;
			columnWidths[column] = Math.max(columnWidths[column] ?? 0, sizeOf(node).width);
		});
		const rowHeights = Array.from({ length: rows }, (_, row) => {
			let height = 0;
			for (let column = 0; column < columns; column++) {
				const node = members[row * columns + column];
				if (node) height = Math.max(height, sizeOf(node).height);
			}
			return height;
		});
		const header = 46;
		const padding = 22;
		const gap = 18;
		const width = padding * 2 + columnWidths.reduce((total, value) => total + value, 0) + gap * Math.max(0, columns - 1);
		const height = header + padding * 2 + rowHeights.reduce((total, value) => total + value, 0) + gap * Math.max(0, rows - 1);
		positions[frame.id] = { x: 40, y: top };
		let cursorY = top + header + padding;
		for (let row = 0; row < rows; row++) {
			let cursorX = 40 + padding;
			for (let column = 0; column < columns; column++) {
				const node = members[row * columns + column];
				if (node) positions[node.id] = { x: cursorX, y: cursorY };
				cursorX += (columnWidths[column] ?? 0) + gap;
			}
			cursorY += (rowHeights[row] ?? 0) + gap;
		}
		top += Math.max(110, height) + 60;
	}
	for (const node of scene.nodes) {
		if (!positions[node.id]) positions[node.id] = { x: 40, y: top };
	}
	return positions;
}

function staticGraphPositions(scene: SceneDto, layout: LayoutViewState, graphView: 'overview' | 'structure' | 'data', focusId: string | undefined): Record<string, Point> {
	const positions: Record<string, Point> = {};
	if (scene.nodes.length === 0) return positions;
	const overlay = scene.nodes.some(node => node.origin === 'runtime') && scene.nodes.some(node => node.origin === 'static');
	if (graphView === 'structure' || graphView === 'data' || overlay) {
		const functionLayout = functionMemberGrid(scene, positions, focusId);
		if (functionLayout) return positions;
		const memberLayout = classMemberGrid(scene, positions);
		if (memberLayout) return positions;
	}
	const graph = new graphlib.Graph();
	graph.setGraph({
		rankdir: 'TB',
		align: 'UL',
		nodesep: 72,
		ranksep: 96,
		marginx: 40,
		marginy: graphView === 'overview' ? 32 : 90,
		ranker: 'network-simplex'
	});
	graph.setDefaultEdgeLabel(() => ({}));
	for (const node of scene.nodes) {
		const size = sizeOf(node);
		graph.setNode(node.id, { width: size.width, height: size.height });
	}
	for (const edge of scene.edges) {
		if (graph.hasNode(edge.from) && graph.hasNode(edge.to)) {
			graph.setEdge(edge.from, edge.to);
		}
	}
	dagreLayout(graph);
	for (const node of scene.nodes) {
		const positioned = graph.node(node.id) as { x: number; y: number; width: number; height: number } | undefined;
		const stored = layout.positions[node.id];
		if (stored) {
			positions[node.id] = stored;
		} else if (positioned) {
			positions[node.id] = { x: positioned.x - positioned.width / 2, y: positioned.y - positioned.height / 2 };
		} else {
			positions[node.id] = { x: 32, y: 36 };
		}
	}
	return positions;
}

function shortSource(source: string | undefined): string {
	if (!source) return 'source';
	return source.split(/[\\/]/).pop() ?? source;
}

function MoreRow({ shown, total }: { readonly shown: number; readonly total?: number }) {
	return (
		<div className="canvas-more">
			<span>…</span>
			<small>{typeof total === 'number' ? `共 ${total} 项 · 已显示 ${shown}` : `已显示 ${shown} 项`}</small>
		</div>
	);
}

function compactList(items: readonly string[], limit = 8): string {
	if (items.length <= limit) return items.join(', ');
	return `${items.slice(0, limit).join(', ')} +${items.length - limit}`;
}

function sizeOf(node: CanvasNode): { width: number; height: number } {
	const card = node.card;
	const kind = card?.kind ?? 'variable';
	if (node.origin === 'static') {
		const text = card && (card.kind === 'variable' || card.kind === 'text' || card.kind === 'node')
			? card.value
			: card?.kind === 'function' ? card.signature
				: card?.kind === 'loop' ? card.header
					: card?.kind === 'branch' ? card.condition
						: card?.kind === 'class' ? `${card.name}(${card.bases.join(', ')})`
							: node.label;
		if (card && ['variable', 'text', 'node', 'function', 'loop', 'branch', 'class'].includes(card.kind)) {
			const width = Math.max(220, Math.min(360, 120 + text.length * 7));
			const charsPerLine = Math.max(1, Math.floor((width - 36) / 7));
			const lines = Math.max(1, Math.ceil(text.length / charsPerLine));
			const baseHeight = card.kind === 'function' ? 150 : card.kind === 'class' ? 170 : card.kind === 'loop' ? 100 : 86;
			return { width, height: Math.min(240, baseHeight + Math.max(0, lines - 1) * 18) };
		}
	}
	const width = node.origin === 'static' ? STATIC_CARD_WIDTH[kind] ?? CARD_WIDTH[kind] : CARD_WIDTH[kind];
	return { width, height: CARD_HEIGHT[kind] };
}

interface LoopTrack {
	readonly truncated: boolean;
	readonly chips: readonly { readonly iteration: number; readonly text: string }[];
}

function loopHistory(
	scene: SceneDto,
	history: readonly TraceSnapshot[] | undefined,
	historyIndex: number | undefined,
	focusId: string | undefined
): Record<string, LoopTrack> {
	if (!history || history.length === 0 || !scene.nodes.some(node => node.origin === 'runtime')) return {};
	const focus = scene.nodes.find(node => node.id === focusId)
		?? scene.nodes.find(node => node.card?.kind === 'function' && !String(node.label).startsWith('__main__'))
		?? scene.nodes.find(node => node.card?.kind === 'function');
	const focusName = focus?.label;
	const loops = scene.nodes.filter(node => node.card?.kind === 'loop');
	const lastIndex = historyIndex !== undefined && historyIndex >= 0
		? Math.min(historyIndex, history.length - 1)
		: history.length - 1;
	const snapshots = history.slice(0, lastIndex + 1);
	const tracks: Record<string, LoopTrack> = {};
	for (const loop of loops) {
		const defined = new Set(scene.edges.filter(edge => edge.from === loop.id && edge.kind === 'defines').map(edge => edge.to));
		const names = scene.edges
			.filter(edge => edge.from === loop.id && edge.kind === 'writes' && !defined.has(edge.to))
			.map(edge => scene.nodes.find(node => node.id === edge.to)?.label)
			.filter((name): name is string => !!name);
		if (names.length === 0) continue;
		const chips: { iteration: number; text: string }[] = [];
		for (const snapshot of snapshots) {
			const frame = (focusName ? snapshot.frames.find(item => item.name === focusName) : undefined) ?? snapshot.frames[0];
			if (!frame) continue;
			const values = new Map<string, string>();
			for (const scope of frame.scopes) {
				for (const value of scope.values) values.set(value.name, value.value);
			}
			if (!names.every(name => values.has(name))) continue;
			const text = names.map(name => `${name}=${(values.get(name) ?? '').slice(0, 18)}`).join(' · ');
			if (chips.at(-1)?.text === text) continue;
			chips.push({ iteration: chips.length + 1, text });
		}
		if (chips.length === 0) continue;
		tracks[loop.id] = {
			truncated: chips.length > 6,
			chips: chips.slice(-6)
		};
	}
	return tracks;
}

function structuralParentMap(scene: SceneDto): Map<string, string> {
	const priority = new Map([
		['nested', 0],
		['defines', 1],
		['parameter', 2],
		['writes', 3],
		['iterates', 4],
		['contains', 5]
	]);
	const parent = new Map<string, string>();
	const scores = new Map<string, number>();
	for (const edge of scene.edges) {
		const score = priority.get(edge.kind);
		if (score === undefined || edge.from === edge.to) continue;
		const current = scores.get(edge.to);
		if (current === undefined || score < current) {
			parent.set(edge.to, edge.from);
			scores.set(edge.to, score);
		}
	}
	return parent;
}

function functionMemberGrid(scene: SceneDto, positions: Record<string, Point>, focusId: string | undefined): boolean {
	const focus = scene.nodes.find(node => node.id === focusId && node.card?.kind === 'function')
		?? scene.nodes.find(node => node.card?.kind === 'function' && !String(node.label).startsWith('__main__'));
	if (!focus || focus.card?.kind !== 'function') return false;
	const byId = new Map(scene.nodes.map(node => [node.id, node]));
	const parent = structuralParentMap(scene);
	const childrenOf = (id: string) => scene.nodes.filter(node => parent.get(node.id) === id);
	const isControl = (node: CanvasNode) => node.card?.kind === 'loop' || node.card?.kind === 'branch';
	const layoutNode = (node: CanvasNode, x: number, y: number): { width: number; height: number } => {
		if (!isControl(node)) {
			const size = sizeOf(node);
			positions[node.id] = { x, y };
			return size;
		}
		const children = childrenOf(node.id);
		const header = 48;
		const padding = 18;
		const gap = 20;
		let cursorY = y + header + padding;
		let width = 260;
		for (const child of children) {
			const size = layoutNode(child, x + padding, cursorY);
			width = Math.max(width, size.width + padding * 2);
			cursorY += size.height + gap;
		}
		positions[node.id] = { x, y };
		return { width, height: Math.max(100, cursorY - y + 10) };
	};
	positions[focus.id] = { x: 40, y: 90 };
	const direct = childrenOf(focus.id);
	const columns = Math.min(direct.length > 3 ? 3 : 2, Math.max(1, direct.length));
	const columnWidth = 320;
	const columnGap = 30;
	const columnX = Array.from({ length: columns }, (_, index) => 40 + index * (columnWidth + columnGap));
	const columnY = Array.from({ length: columns }, () => 140);
	direct.forEach((child, index) => {
		const column = index % columns;
		const size = layoutNode(child, columnX[column] ?? 40, columnY[column] ?? 140);
		columnY[column] = (columnY[column] ?? 140) + size.height + 24;
	});
	const bottom = Math.max(140, ...columnY);
	for (const node of scene.nodes) {
		if (positions[node.id]) continue;
		if (!byId.has(node.id)) continue;
		const size = sizeOf(node);
		positions[node.id] = { x: 40, y: bottom };
	}
	return true;
}

function classMemberGrid(scene: SceneDto, positions: Record<string, Point>): boolean {
	const classes = scene.nodes.filter(node => node.card?.kind === 'class');
	if (classes.length === 0) return false;
	const ranked = classes
		.map(node => ({ node, outgoing: scene.edges.filter(edge => edge.from === node.id) }))
		.sort((a, b) => b.outgoing.length - a.outgoing.length);
	const focus = ranked[0];
	if (!focus || focus.outgoing.length < 3) return false;
	const memberIds = new Set(
		focus.outgoing
			.filter(edge => edge.kind === 'field' || edge.kind === 'method' || edge.kind === 'inherits' || edge.kind === 'parameter')
			.map(edge => edge.to)
	);
	const kindRank = (node: CanvasNode) =>
		node.card?.kind === 'class' ? 0 : node.card?.kind === 'variable' || node.card?.kind === 'parameter' ? 1 : 2;
	const members = scene.nodes
		.filter(node => memberIds.has(node.id))
		.sort((a, b) => kindRank(a) - kindRank(b) || (a.card?.kind === 'function' && b.card?.kind === 'function' ? (a.card.line ?? 0) - (b.card.line ?? 0) : 0));
	if (members.length < 3) return false;
	if (scene.edges.some(edge => edge.from !== focus.node.id && (memberIds.has(edge.from) || memberIds.has(edge.to)))) return false;
	const columns = Math.min(4, Math.max(3, Math.ceil(Math.sqrt(members.length))));
	const cellWidth = Math.max(...members.map(node => sizeOf(node).width));
	const gapX = 36;
	const gapY = 30;
	positions[focus.node.id] = { x: 40, y: 90 };
	let cursorX = 40;
	let cursorY = 140;
	let rowHeight = 0;
	members.forEach((node, index) => {
		const column = index % columns;
		if (column === 0 && index > 0) {
			cursorY += rowHeight + gapY;
			cursorX = 24;
			rowHeight = 0;
		}
		positions[node.id] = { x: cursorX, y: cursorY };
		cursorX += cellWidth + gapX;
		rowHeight = Math.max(rowHeight, sizeOf(node).height);
	});
	for (const node of scene.nodes) {
		if (!positions[node.id]) positions[node.id] = { x: 40, y: cursorY + rowHeight + gapY };
	}
	return true;
}

function fitViewport(
	scene: SceneDto,
	positions: Record<string, Point>,
	width: number,
	height: number,
	regions: readonly FrameRegion[] = []
): Viewport {
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = 0;
	let maxY = 0;
	for (const node of scene.nodes) {
		const position = positions[node.id];
		if (!position) continue;
		const size = sizeOf(node);
		minX = Math.min(minX, position.x);
		minY = Math.min(minY, position.y);
		maxX = Math.max(maxX, position.x + size.width);
		maxY = Math.max(maxY, position.y + size.height);
	}
	for (const region of regions) {
		minX = Math.min(minX, region.x);
		minY = Math.min(minY, region.y);
		maxX = Math.max(maxX, region.x + region.width);
		maxY = Math.max(maxY, region.y + region.height);
	}
	if (!Number.isFinite(minX) || !Number.isFinite(minY)) return { x: 24, y: 16, zoom: 1 };
	const contentWidth = Math.max(1, maxX - minX);
	const contentHeight = Math.max(1, maxY - minY);
	const padding = 32;
	const fit = Math.min(1, (width - padding * 2) / contentWidth, (height - padding * 2) / contentHeight);
	const staticScene = scene.nodes.some(node => node.origin === 'static');
	const zoom = Math.max(staticScene ? 0.42 : 0.4, fit);
	const scaledWidth = contentWidth * zoom;
	const scaledHeight = contentHeight * zoom;
	const x = scaledWidth <= width - padding * 2 ? (width - scaledWidth) / 2 - minX * zoom : padding - minX * zoom;
	const y = scaledHeight <= height - padding * 2 ? (height - scaledHeight) / 2 - minY * zoom : padding - minY * zoom;
	return { x, y, zoom };
}

function edgeStart(from: Point, fromSize: { width: number; height: number }, to: Point): Point {
	if (to.x > from.x + fromSize.width / 2) return { x: from.x + fromSize.width, y: from.y + fromSize.height / 2 };
	if (to.x < from.x - fromSize.width / 2) return { x: from.x, y: from.y + fromSize.height / 2 };
	return { x: from.x + fromSize.width / 2, y: from.y + fromSize.height };
}

function edgeEnd(to: Point, toSize: { width: number; height: number }, from: Point): Point {
	if (from.x > to.x + toSize.width / 2) return { x: to.x + toSize.width, y: to.y + toSize.height / 2 };
	if (from.x < to.x - toSize.width / 2) return { x: to.x, y: to.y + toSize.height / 2 };
	return { x: to.x + toSize.width / 2, y: to.y };
}