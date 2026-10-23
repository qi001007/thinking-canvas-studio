import type { Coverage, MetadataValue, PersistedFrame, PersistedValue, SceneDto, StackFrameSnapshot, TraceSnapshot, ValueSnapshot } from '../domain/contracts.ts';

export interface Annotation {
	readonly id: string;
	readonly targetId: string;
	readonly text: string;
	readonly kind?: 'note' | 'text' | 'arrow' | 'pen' | 'rect';
	readonly points?: readonly { readonly x: number; readonly y: number }[];
	readonly color?: string;
}

export interface LayoutViewState {
	readonly positions: Readonly<Record<string, { readonly x: number; readonly y: number }>>;
	readonly zoom: number;
}

export interface ManualStep {
	readonly id: string;
	readonly title: string;
	readonly createdAt: string;
	readonly scene: SceneDto;
}

/** User-owned diagram state; independent from any runtime or trace truth store. */
export interface ManualBoard {
	readonly id: string;
	readonly title: string;
	readonly scene: SceneDto;
	readonly annotations: readonly Annotation[];
	readonly layout: LayoutViewState;
	readonly steps: readonly ManualStep[];
}

export interface TraceDocument {
	readonly trace: TraceSnapshot;
	readonly annotations: readonly Annotation[];
	readonly layout: LayoutViewState;
}

export interface TraceSnapshotInput {
	readonly id: string;
	readonly sequence?: number;
	readonly label?: string;
	readonly capturedAt: string;
	readonly runId: string;
	readonly sessionId: string;
	readonly coverage: Coverage;
	readonly frames: readonly (PersistedFrame | StackFrameSnapshot)[];
}

export function createTraceSnapshot(input: TraceSnapshotInput): TraceSnapshot {
	return deepFreeze({
		id: input.id,
		sequence: input.sequence,
		label: input.label,
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

function stripRuntimeFields(value: PersistedValue | ValueSnapshot): PersistedValue {
	const { id, name, value: displayValue, type, structure, containerKind, tensorMetadata, collectorIdentity, children } = value;
	return {
		id, name, value: displayValue, type, structure, containerKind,
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

export function createManualStep(board: ManualBoard, title: string): ManualStep {
	return {
		id: `step-${crypto.randomUUID()}`,
		title,
		createdAt: new Date().toISOString(),
		scene: structuredClone(board.scene)
	};
}

export function cloneScene(scene: SceneDto): SceneDto {
	return structuredClone(scene);
}

function deepFreeze<T>(value: T): T {
	if (value && typeof value === 'object' && !Object.isFrozen(value)) {
		Object.freeze(value);
		for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
	}
	return value;
}
