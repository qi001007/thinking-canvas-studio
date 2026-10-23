export type SessionId = string;
export type ThreadId = string;
export type FrameId = string;
export type ScopeId = string;
export type ValueId = string;
export type RunId = string;

export interface CapabilitySet {
	/** Normalized client feature availability; not a direct copy of DAP capabilities. */
	readonly stackTrace: boolean;
	readonly scopes: boolean;
	readonly variables: boolean;
	readonly evaluate: boolean;
	readonly setVariable: boolean;
	readonly readMemory: boolean;
}

export type HandleKind = 'frame' | 'scope' | 'variable';

/** A temporary DAP handle; valid only for this run and thread stop epoch. */
export interface RuntimeHandle {
	readonly sessionId: SessionId;
	readonly runId: RunId;
	readonly stopEpoch: number;
	readonly threadId: ThreadId;
	readonly kind: HandleKind;
	readonly reference: number;
}

export type ThreadExecutionState = 'running' | 'stopped' | 'partial-unsupported';

export interface SessionSnapshot {
	readonly id: SessionId;
	readonly runId: RunId;
	readonly state: 'initializing' | 'running' | 'stopped' | 'partial-unsupported' | 'ended';
	readonly capabilities: CapabilitySet;
	readonly threads: readonly ThreadSnapshot[];
}

export interface ThreadSnapshot {
	readonly id: ThreadId;
	readonly name: string;
	readonly state: ThreadExecutionState;
	readonly stopEpoch: number;
	readonly frames: readonly StackFrameSnapshot[];
	readonly message?: string;
}

export interface StackFrameSnapshot {
	readonly id: FrameId;
	readonly name: string;
	readonly source?: string;
	readonly line?: number;
	readonly column?: number;
	readonly handle: RuntimeHandle;
	readonly scopes: readonly ScopeSnapshot[];
}

export interface ScopeSnapshot {
	readonly id: ScopeId;
	readonly name: string;
	readonly expensive: boolean;
	readonly handle: RuntimeHandle;
	readonly values: readonly ValueSnapshot[];
}

export type StructureKind = 'container' | 'struct' | 'pointer' | 'reference' | 'heap' | 'tensor';
export type ContainerKind = 'array' | 'matrix' | 'list' | 'dict' | 'set' | 'tuple' | 'tensor';
export type MetadataValue = string | number | boolean | null | readonly MetadataValue[] | { readonly [key: string]: MetadataValue };

export interface CollectorIdentity {
	/** Identity produced by an explicit heap/object collector, never a DAP reference. */
	readonly collector: string;
	readonly objectId: string;
}

export interface ValueSnapshot {
	readonly id: ValueId;
	readonly name: string;
	readonly value: string;
	readonly type?: string;
	readonly evaluateName?: string;
	readonly handle?: RuntimeHandle;
	readonly structure?: StructureKind;
	readonly containerKind?: ContainerKind;
	readonly tensorMetadata?: Readonly<Record<string, MetadataValue>>;
	readonly collectorIdentity?: CollectorIdentity;
	readonly children: readonly ValueSnapshot[];
}

export interface Coverage {
	readonly state: 'complete' | 'partial' | 'unknown';
	readonly reason?: string;
	readonly knownMissing: readonly string[];
}

/** Normalized runtime state. Do not persist this as a trace: it contains live handles. */
export interface NormalizedDebugSnapshot {
	readonly session: SessionSnapshot;
	readonly coverage: Coverage;
}

export interface PersistedValue {
	readonly id: ValueId;
	readonly name: string;
	readonly value: string;
	readonly type?: string;
	readonly structure?: StructureKind;
	readonly containerKind?: ContainerKind;
	readonly tensorMetadata?: Readonly<Record<string, MetadataValue>>;
	readonly collectorIdentity?: CollectorIdentity;
	readonly children: readonly PersistedValue[];
}

export interface PersistedFrame {
	readonly id: FrameId;
	readonly name: string;
	readonly source?: string;
	readonly line?: number;
	readonly scopes: readonly {
		readonly id: ScopeId;
		readonly name: string;
		readonly expensive: boolean;
		readonly values: readonly PersistedValue[];
	}[];
}

export interface TraceSnapshot {
	readonly id: string;
	readonly sequence?: number;
	readonly label?: string;
	readonly capturedAt: string;
	readonly runId: RunId;
	readonly sessionId: SessionId;
	readonly coverage: Coverage;
	readonly frames: readonly PersistedFrame[];
}

export interface CardCell {
	readonly value: string;
}

export interface CardEntry {
	readonly key: string;
	readonly value: string;
}

export interface CardField {
	readonly name: string;
	readonly value: string;
	readonly type?: string;
}

/** Shared visual payload for manual cards and runtime-projected cards. */
export type CardData =
	| { readonly kind: 'array' | 'matrix'; readonly rows: readonly (readonly CardCell[])[] }
	| { readonly kind: 'list' | 'set'; readonly items: readonly CardCell[] }
	| { readonly kind: 'dict'; readonly entries: readonly CardEntry[] }
	| { readonly kind: 'variable' | 'node' | 'text'; readonly value: string }
	| { readonly kind: 'struct'; readonly fields: readonly CardField[] }
	| { readonly kind: 'pointer'; readonly target?: string; readonly reference?: string }
	| { readonly kind: 'tensor'; readonly shape: readonly number[]; readonly dtype?: string; readonly preview?: string }
	| { readonly kind: 'stack-frame'; readonly name: string; readonly source?: string; readonly line?: number }
	| { readonly kind: 'sticky'; readonly text: string; readonly tone?: 'note' | 'invariant' }
	| { readonly kind: 'function'; readonly signature: string; readonly input?: string; readonly output?: string; readonly complexity?: string };

export interface CanvasNode {
	readonly id: string;		// Stable layout key.
	readonly valueId: ValueId;	// Snapshot identity, separate from the stable layout key.
	readonly label: string;
	readonly kind: StructureKind | 'stack-frame' | 'manual';
	readonly type?: string;
	readonly metadata?: Readonly<Record<string, MetadataValue>>;
	readonly card?: CardData;
}

export interface CanvasEdge {
	readonly id: string;
	readonly from: string;
	readonly to: string;
	readonly kind: 'contains' | 'points-to' | 'alias';
	readonly label?: string;
}

export interface SceneDto {
	readonly nodes: readonly CanvasNode[];
	readonly edges: readonly CanvasEdge[];
}
