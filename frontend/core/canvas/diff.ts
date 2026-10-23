import type { CardData, CanvasNode, SceneDto, ValueId } from '../domain/contracts.ts';

export interface SceneDiff {
	readonly changedNodeIds: ReadonlySet<string>;
	readonly changedValueIds: ReadonlySet<ValueId>;
	readonly changedParts: ReadonlyMap<string, ReadonlySet<string>>;
}

export const EMPTY_SCENE_DIFF: SceneDiff = {
	changedNodeIds: new Set(),
	changedValueIds: new Set(),
	changedParts: new Map()
};

/** Compares visual facts only. Runtime identities (valueId) may change on every stop. */
export function diffScenes(previous: SceneDto | undefined, current: SceneDto): SceneDiff {
	if (!previous) return EMPTY_SCENE_DIFF;
	const previousById = new Map(previous.nodes.map(node => [node.id, node]));
	const changedNodeIds = new Set<string>();
	const changedValueIds = new Set<ValueId>();
	const changedParts = new Map<string, ReadonlySet<string>>();

	for (const node of current.nodes) {
		const before = previousById.get(node.id);
		if (!before) continue;
		const changed = diffParts(before, node);
		if (changed.size === 0) continue;
		changedNodeIds.add(node.id);
		changedValueIds.add(node.valueId);
		changedParts.set(node.id, changed);
	}

	return { changedNodeIds, changedValueIds, changedParts };
}

function diffParts(before: CanvasNode, after: CanvasNode): Set<string> {
	const changed = new Set<string>();
	const previousParts = partsOf(before.card);
	const nextParts = partsOf(after.card);
	for (const [key, value] of nextParts) {
		if (previousParts.get(key) !== value) changed.add(key);
	}
	for (const key of previousParts.keys()) {
		if (!nextParts.has(key)) changed.add(key);
	}
	if (before.label !== after.label) changed.add('label');
	if (before.type !== after.type) changed.add('type');
	return changed;
}

function partsOf(card: CardData | undefined): Map<string, string> {
	const parts = new Map<string, string>();
	if (!card) return parts;
	switch (card.kind) {
		case 'array':
		case 'matrix':
			card.rows.forEach((row, rowIndex) => row.forEach((cell, columnIndex) => {
				parts.set(`cell:${rowIndex}:${columnIndex}`, cell.value);
			}));
			break;
		case 'list':
		case 'set':
			card.items.forEach((item, index) => parts.set(`item:${index}`, item.value));
			break;
		case 'dict':
			card.entries.forEach(entry => parts.set(`entry:${entry.key}`, entry.value));
			break;
		case 'struct':
			card.fields.forEach(field => parts.set(`field:${field.name}`, field.value));
			break;
		case 'pointer':
			parts.set('reference', card.reference ?? '');
			parts.set('target', card.target ?? '');
			break;
		case 'tensor':
			parts.set('shape', card.shape.join('x'));
			parts.set('dtype', card.dtype ?? '');
			parts.set('preview', card.preview ?? '');
			break;
		case 'stack-frame':
			parts.set('source', card.source ?? '');
			parts.set('line', String(card.line ?? ''));
			break;
		case 'function':
			parts.set('signature', card.signature);
			parts.set('input', card.input ?? '');
			parts.set('output', card.output ?? '');
			parts.set('complexity', card.complexity ?? '');
			break;
		case 'sticky':
		case 'variable':
		case 'node':
		case 'text':
			parts.set('value', card.kind === 'sticky' ? card.text : card.value);
			break;
	}
	return parts;
}
