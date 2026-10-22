import type { Coverage, MetadataValue, SceneDto, TraceSnapshot } from '../domain/contracts.ts';

export interface Annotation {
	readonly id: string;
	readonly targetId: string;
	readonly text: string;
}

export interface LayoutViewState {
	readonly positions: Readonly<Record<string, { readonly x: number; readonly y: number }>>;
	readonly zoom: number;
}

/** User-owned diagram state; independent from any runtime or trace truth store. */
export interface ManualBoard {
	readonly id: string;
	readonly scene: SceneDto;
	readonly annotations: readonly Annotation[];
	readonly layout: LayoutViewState;
}

export interface TraceDocument {
	readonly trace: TraceSnapshot;
	readonly annotations: readonly Annotation[];
	readonly layout: LayoutViewState;
}

export function createTraceSnapshot(input: TraceSnapshot): TraceSnapshot {
	return deepFreeze({
		id: input.id,
		capturedAt: input.capturedAt,
		runId: input.runId,
		sessionId: input.sessionId,
		coverage: normalizeCoverage(input.coverage),
		frames: input.frames.map(frame => ({
			id: frame.id,
			name: frame.name,
			source: frame.source,
			line: frame.line,
			scopes: frame.scopes.map(scope => ({
				id: scope.id,
				name: scope.name,
				expensive: scope.expensive,
				values: scope.values.map(stripRuntimeFields)
			}))
		}))
	});
}

export function normalizeCoverage(coverage: Coverage): Coverage {
	if (coverage.state === 'complete' && coverage.knownMissing.length > 0) {
		return { state: 'partial', reason: coverage.reason ?? 'Some data is missing.', knownMissing: [...coverage.knownMissing] };
	}
	return { state: coverage.state, reason: coverage.reason, knownMissing: [...coverage.knownMissing] };
}

function stripRuntimeFields(value: TraceSnapshot['frames'][number]['scopes'][number]['values'][number]): TraceSnapshot['frames'][number]['scopes'][number]['values'][number] {
	const { id, name, value: displayValue, type, structure, tensorMetadata, collectorIdentity, children } = value;
	return {
		id, name, value: displayValue, type, structure,
		tensorMetadata: tensorMetadata ? cloneMetadata(tensorMetadata) : undefined,
		collectorIdentity: collectorIdentity ? { collector: collectorIdentity.collector, objectId: collectorIdentity.objectId } : undefined,
		children: children.map(stripRuntimeFields)
	};
}

function cloneMetadata(value: Readonly<Record<string, MetadataValue>>): Readonly<Record<string, MetadataValue>> {
	return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneMetadataValue(item)]));
}

function cloneMetadataValue(value: MetadataValue): MetadataValue {
	if (Array.isArray(value)) return value.map(item => cloneMetadataValue(item));
	if (value && typeof value === 'object') return cloneMetadata(value as Readonly<Record<string, MetadataValue>>);
	return value;
}

function deepFreeze<T>(value: T): T {
	if (value && typeof value === 'object' && !Object.isFrozen(value)) {
		Object.freeze(value);
		for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
	}
	return value;
}
