import { useEffect, useMemo, useRef, useState, type PointerEvent, type WheelEvent } from 'react';
import type { SceneDiff } from '@core/canvas/diff';
import type { LayoutViewState } from '@core/canvas/documents';
import type { CanvasNode, CardData, SceneDto } from '@core/domain/contracts';

interface SceneCanvasProps {
	readonly scene: SceneDto;
	readonly mode: 'manual' | 'debug';
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
	function: 300
};

const CARD_HEIGHT: Record<CardData['kind'], number> = {
	array: 130,
	matrix: 160,
	list: 145,
	set: 125,
	dict: 140,
	variable: 90,
	node: 90,
	text: 90,
	struct: 150,
	pointer: 90,
	tensor: 140,
	'stack-frame': 84,
	sticky: 130,
	function: 160
};

export function SceneCanvas({
	scene,
	mode,
	layout,
	diff,
	selectedNodeId,
	readOnly = false,
	onSelect,
	onMove,
	onCommitMove
}: SceneCanvasProps) {
	const [viewport, setViewport] = useState<Viewport>({ x: 24, y: 16, zoom: 1 });
	const viewportRef = useRef<HTMLDivElement | null>(null);
	const panRef = useRef<{ x: number; y: number; startX: number; startY: number } | null>(null);
	const dragRef = useRef<{ id: string; startX: number; startY: number; originX: number; originY: number } | null>(null);
	const positions = useMemo(() => layoutPositions(scene, layout), [scene, layout]);
	const sceneKey = useMemo(() => scene.nodes.map(node => node.id).join('|'), [scene.nodes]);

	useEffect(() => {
		const surface = viewportRef.current;
		if (!surface) return;
		const width = surface.clientWidth;
		const height = surface.clientHeight;
		if (width === 0 || height === 0 || scene.nodes.length === 0) {
			setViewport({ x: 24, y: 16, zoom: 1 });
			return;
		}
		let maxX = 0;
		let maxY = 0;
		for (const node of scene.nodes) {
			const position = positions[node.id];
			if (!position) continue;
			const size = sizeOf(node);
			maxX = Math.max(maxX, position.x + size.width);
			maxY = Math.max(maxY, position.y + size.height);
		}
		const zoom = Math.max(0.4, Math.min(1, (width - 48) / Math.max(1, maxX), (height - 48) / Math.max(1, maxY)));
		setViewport({ x: 24, y: 20, zoom });
	}, [sceneKey, mode]);

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
					{scene.edges.map(edge => {
						const from = positions[edge.from];
						const to = positions[edge.to];
						if (!from || !to) return null;
						const fromNode = scene.nodes.find(node => node.id === edge.from);
						const toNode = scene.nodes.find(node => node.id === edge.to);
						const fromSize = fromNode ? sizeOf(fromNode) : { width: 0, height: 0 };
						const toSize = toNode ? sizeOf(toNode) : { width: 0, height: 0 };
						const start = edgeStart(from, fromSize, to);
						const end = edgeEnd(to, toSize, from);
						const middle = (start.x + end.x) / 2;
						const path = `M ${start.x} ${start.y} C ${middle} ${start.y}, ${middle} ${end.y}, ${end.x} ${end.y}`;
						return (
							<path
								key={edge.id}
								d={path}
								className={`scene-edge scene-edge-${edge.kind}`}
								markerEnd={edge.kind === 'contains' ? undefined : edge.kind === 'alias' ? 'url(#arrow-alias)' : 'url(#arrow-accent)'}
							/>
						);
					})}
				</svg>
				{scene.nodes.map(node => {
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
								diff.changedNodeIds.has(node.id) ? 'is-changed' : ''
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
					<p>{mode === 'debug' ? '等待第一个停点' : '还没有卡片'}</p>
					<small>{mode === 'debug' ? '点击“真实运行”或“运行演示”后，运行时会在这里生成结构卡片' : '从左侧手绘工具添加卡片，或切换到调试模式'}</small>
				</div>
			)}
			<div className="canvas-zoom">
				<button type="button" onClick={() => changeZoom(-0.1)} aria-label="缩小">−</button>
				<span>{Math.round(viewport.zoom * 100)}%</span>
				<button type="button" onClick={() => changeZoom(0.1)} aria-label="放大">+</button>
				<button type="button" className="canvas-fit" onClick={() => setViewport({ x: 24, y: 16, zoom: 1 })}>重置</button>
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
			);
		case 'list':
		case 'set':
			if (card.items.length === 0) return <div className="canvas-empty-inline">空{card.kind === 'set' ? '集合' : '列表'}</div>;
			return (
				<div className="canvas-items">
					{card.items.map((item, index) => (
						<div className={`canvas-item ${changedParts?.has(`item:${index}`) ? 'is-changed' : ''}`} key={index}>
							<span className="canvas-item-index">{index}</span>
							<span>{item.value}</span>
						</div>
					))}
				</div>
			);
		case 'dict':
			if (card.entries.length === 0) return <div className="canvas-empty-inline">空字典</div>;
			return (
				<div className="canvas-items">
					{card.entries.map(entry => (
						<div className={`canvas-item canvas-dict-row ${changedParts?.has(`entry:${entry.key}`) ? 'is-changed' : ''}`} key={entry.key}>
							<span className="canvas-dict-key">{entry.key}</span>
							<span>{entry.value}</span>
						</div>
					))}
				</div>
			);
		case 'struct':
			return (
				<div className="canvas-items">
					{card.fields.map(field => (
						<div className={`canvas-item ${changedParts?.has(`field:${field.name}`) ? 'is-changed' : ''}`} key={field.name}>
							<span className="canvas-field-name">{field.name}</span>
							<span>{field.value}</span>
						</div>
					))}
				</div>
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
			return <div className="canvas-frame-loc">{card.source ?? 'source'} : {card.line ?? '—'}</div>;
		case 'sticky':
			return <div className={`canvas-sticky ${card.tone === 'invariant' ? 'is-invariant' : ''}`}>{card.text}</div>;
		case 'function':
			return (
				<div className="canvas-function">
					<div className="canvas-signature">{card.signature}</div>
					<div className="canvas-function-meta"><span>输入</span>{card.input ?? '—'}</div>
					<div className="canvas-function-meta"><span>输出</span>{card.output ?? '—'}</div>
					<div className="canvas-complexity">{card.complexity ?? ''}</div>
				</div>
			);
		case 'variable':
		case 'node':
		case 'text':
			return <div className="canvas-big-value">{card.value}</div>;
	}
}

function layoutPositions(scene: SceneDto, layout: LayoutViewState): Record<string, Point> {
	const positions: Record<string, Point> = {};
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

function sizeOf(node: CanvasNode): { width: number; height: number } {
	const kind = node.card?.kind ?? 'variable';
	return { width: CARD_WIDTH[kind], height: CARD_HEIGHT[kind] };
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