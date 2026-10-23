import type { CanvasEdge, CanvasNode, CardData, ContainerKind, Coverage, NormalizedDebugSnapshot, PersistedValue, SceneDto, TraceSnapshot, ValueSnapshot } from '../domain/contracts.ts';

export const CANVAS_LIMITS = Object.freeze({ maxNodes: 500, maxVisitedValues: 5_000, maxDepth: 64, maxValuesPerPage: 100 });

export interface CanvasProjection {
	readonly scene: SceneDto;
	readonly coverage: Coverage;
}

/** Layout keys approximate continuity from source/function/call depth and variable paths; they do not promise persistent object identity. */
export function projectSnapshot(snapshot: NormalizedDebugSnapshot | TraceSnapshot): CanvasProjection {
	const nodes: CanvasNode[] = [];
	const edges: CanvasEdge[] = [];
	const identities = new Map<string, string>();
	const kindsByNodeId = new Map<string, CanvasNode['kind']>();
	const missing = [...snapshot.coverage.knownMissing];
	const normalizedUnavailable = 'session' in snapshot && snapshot.session.state !== 'stopped' && snapshot.session.state !== 'partial-unsupported';
	const hasUnsupportedPartial = 'session' in snapshot && (snapshot.session.state === 'partial-unsupported'
		|| snapshot.session.threads.some(thread => thread.state === 'partial-unsupported'));
	if (hasUnsupportedPartial) missing.push('Partial stop is unsupported for inspection.');
	if (normalizedUnavailable) missing.push(`Runtime scene unavailable while session is ${snapshot.session.state}.`);
	let visitedValues = 0;
	let truncated = false;
	let edgeSequence = 0;
	const addEdge = (edge: Omit<CanvasEdge, 'id'>): void => {
		edges.push({ id: JSON.stringify(['edge', edgeSequence++]), ...edge });
	};

	const frameNodeIds: string[] = [];
	const frames = normalizedUnavailable ? [] : 'session' in snapshot
		? snapshot.session.threads.filter(thread => thread.state === 'stopped').flatMap(thread => thread.frames)
		: snapshot.frames;
	const sameFunctionDepth = new Map<string, number>();

	for (const frame of frames) {
		if (nodes.length >= CANVAS_LIMITS.maxNodes) {
			truncated = true;
			missing.push('Canvas node limit reached.');
			break;
		}
		const functionKey = JSON.stringify([frame.source ?? '', frame.name]);
		const callDepth = sameFunctionDepth.get(functionKey) ?? 0;
		sameFunctionDepth.set(functionKey, callDepth + 1);
		const framePath = ['frame', frame.source ?? '', frame.name, callDepth] as const;
		const frameKey = layoutKey(framePath);
		nodes.push({
			id: frameKey,
			valueId: frame.id,
			label: frame.name,
			kind: 'stack-frame',
			origin: 'runtime',
			card: { kind: 'stack-frame', name: frame.name, source: frame.source, line: frame.line }
		});
		frameNodeIds.push(frameKey);
		kindsByNodeId.set(frameKey, 'stack-frame');

		const scopeOccurrences = new Map<string, number>();
		for (const scope of frame.scopes) {
			const scopeOccurrence = scopeOccurrences.get(scope.name) ?? 0;
			scopeOccurrences.set(scope.name, scopeOccurrence + 1);
			const occurrences = new Map<string, number>();
			for (const value of scope.values) {
				if (!visitValue(value, frameKey, [...framePath, 'scope', scope.name, scopeOccurrence], occurrences, 0, nodes, edges, identities, kindsByNodeId, addEdge, () => {
					visitedValues++;
					return visitedValues;
				}, () => {
					truncated = true;
					missing.push('Canvas traversal budget reached.');
				})) break;
			}
			if (truncated) break;
		}
		if (truncated) break;
	}

	for (let index = 0; index < frameNodeIds.length - 1; index++) {
		addEdge({
			from: frameNodeIds[index + 1]!,
			to: frameNodeIds[index]!,
			kind: 'calls',
			label: frames[index]?.name ?? 'call'
		});
	}
	if (truncated && missing.length === 0) missing.push('Canvas projection was truncated.');
	const state = normalizedUnavailable ? 'unknown' : truncated || hasUnsupportedPartial ? 'partial' : snapshot.coverage.state;
	return {
		scene: { nodes, edges },
		coverage: {
			state,
			reason: normalizedUnavailable ? `Runtime session is ${snapshot.session.state}; no live frames were projected.` : truncated ? 'Canvas projection reached a safety limit.' : hasUnsupportedPartial ? 'Partial stop cannot be inspected.' : snapshot.coverage.reason,
			knownMissing: [...new Set(missing)]
		}
	};
}

function visitValue(
	value: PersistedValue | ValueSnapshot,
	parent: string,
	path: readonly (string | number)[],
	siblingOccurrences: Map<string, number>,
	depth: number,
	nodes: CanvasNode[],
	edges: CanvasEdge[],
	identities: Map<string, string>,
	kindsByNodeId: Map<string, CanvasNode['kind']>,
	addEdge: (edge: Omit<CanvasEdge, 'id'>) => void,
	countVisited: () => number,
	markTruncated: () => void
): boolean {
	if (nodes.length >= CANVAS_LIMITS.maxNodes || (depth >= CANVAS_LIMITS.maxDepth && (!!value.structure || value.children.length > 0)) || countVisited() > CANVAS_LIMITS.maxVisitedValues) {
		markTruncated();
		return false;
	}

	const kind = value.structure;
	const signature = JSON.stringify([value.name, value.type ?? '', kind ?? '']);
	const occurrence = siblingOccurrences.get(signature) ?? 0;
	siblingOccurrences.set(signature, occurrence + 1);
	const valuePath = [...path, 'value', value.name, value.type ?? '', kind ?? '', occurrence];
	const children = value.children;
	let childParent = parent;

	if (kind) {
		const key = layoutKey(valuePath);
		const identityKey = value.collectorIdentity && JSON.stringify([value.collectorIdentity.collector, value.collectorIdentity.objectId]);
		const existing = identityKey ? identities.get(identityKey) : undefined;
		nodes.push({
			id: key,
			valueId: value.id,
			label: value.name || value.value,
			kind,
			type: value.type,
			metadata: value.tensorMetadata,
			origin: 'runtime',
			card: cardFromValue(value)
		});
		kindsByNodeId.set(key, kind);
		addEdge({
			from: parent,
			to: key,
			kind: kindsByNodeId.get(parent) === 'pointer' || kindsByNodeId.get(parent) === 'reference' ? 'points-to' : 'contains'
		});
		if (existing) {
			addEdge({ from: key, to: existing, kind: 'alias' });
			return true;
		}
		if (identityKey) identities.set(identityKey, key);
		childParent = key;
	}

	const childOccurrences = new Map<string, number>();
	for (const child of children) {
		if (!visitValue(child, childParent, valuePath, childOccurrences, depth + 1, nodes, edges, identities, kindsByNodeId, addEdge, countVisited, markTruncated)) return false;
	}
	return true;
}

function layoutKey(path: readonly (string | number)[]): string {
	return `layout:${JSON.stringify(path)}`;
}

function cardFromValue(value: PersistedValue | ValueSnapshot): CardData {
	const shape = tensorShape(value.tensorMetadata);
	if (value.structure === 'tensor' || shape.length > 0) {
		return {
			kind: 'tensor',
			shape,
			dtype: typeof value.tensorMetadata?.dtype === 'string' ? value.tensorMetadata.dtype : value.type,
			preview: value.value
		};
	}
	if (value.structure === 'pointer' || value.structure === 'reference') {
		return { kind: 'pointer', reference: value.value };
	}
	const container = inferContainerKind(value);
	if (container === 'dict') {
		return { kind: 'dict', entries: value.children.map(child => ({ key: child.name, value: child.value })) };
	}
	if (container === 'set') {
		return { kind: 'set', items: value.children.map(child => ({ value: child.value })) };
	}
	if (container === 'array' || container === 'matrix') {
		const nested = value.children.some(child => child.children.length > 0);
		if (container === 'matrix' || nested) {
			return {
				kind: 'matrix',
				rows: value.children.map(child => child.children.length > 0
					? child.children.map(item => ({ value: item.value }))
					: [{ value: child.value }])
			};
		}
		return { kind: 'array', rows: [value.children.map(child => ({ value: child.value }))] };
	}
	if (container === 'list' || container === 'tuple') {
		return { kind: 'list', items: value.children.map(child => ({ value: child.value })) };
	}
	if (value.structure === 'struct' || value.structure === 'heap') {
		return { kind: 'struct', fields: value.children.map(child => ({ name: child.name, value: child.value, type: child.type })) };
	}
	return { kind: 'variable', value: value.value };
}

function inferContainerKind(value: PersistedValue | ValueSnapshot): ContainerKind | undefined {
	if (value.containerKind) return value.containerKind;
	const type = (value.type ?? '').toLowerCase();
	if (type.includes('dict') || type.includes('map')) return 'dict';
	if (type.includes('set')) return 'set';
	if (type.includes('tuple')) return 'tuple';
	if (type.includes('matrix') || type.includes('ndarray')) return 'matrix';
	if (type.includes('array')) return 'array';
	if (type.includes('list') || type.includes('vector') || type.includes('deque')) return 'list';
	return undefined;
}

function tensorShape(metadata: PersistedValue['tensorMetadata']): readonly number[] {
	const shape = metadata?.shape;
	if (!Array.isArray(shape)) return [];
	return shape.filter((item): item is number => typeof item === 'number' && Number.isFinite(item));
}
