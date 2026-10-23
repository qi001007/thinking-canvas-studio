import type { CapabilitySet, ValueSnapshot } from '../domain/contracts.ts';
import { CANVAS_LIMITS } from '../canvas/projector.ts';

export interface CommandAvailability {
	readonly enabled: boolean;
	readonly hostAuthorizationRequired: true;
	readonly reason?: string;
}

export type DebugCommand = 'inspect' | 'evaluate' | 'edit-value' | 'read-memory';
export type SessionCommandState = 'initializing' | 'running' | 'stopped' | 'partial-unsupported' | 'ended';

/** This describes UI availability only. A host must separately authorize every request. */
export function presentCommandAvailability(
	capabilities: CapabilitySet,
	command: DebugCommand,
	sessionState?: SessionCommandState,
	threadState?: 'running' | 'stopped' | 'partial-unsupported'
): CommandAvailability {
	if (sessionState !== 'stopped' || threadState !== 'stopped') {
		const reason = sessionState === 'partial-unsupported' || threadState === 'partial-unsupported'
			? 'Partial or unconfirmed stop is unsupported for inspection.'
			: 'A confirmed full stop is required.';
		return { enabled: false, hostAuthorizationRequired: true, reason };
	}
	const supported = command === 'inspect' ? capabilities.stackTrace && capabilities.scopes && capabilities.variables
		: command === 'evaluate' ? capabilities.evaluate
			: command === 'edit-value' ? capabilities.setVariable
				: capabilities.readMemory;
	if (supported) return { enabled: true, hostAuthorizationRequired: true };
	const reason = command === 'inspect' ? 'Adapter path does not provide stack frames, scopes, and variables.'
		: command === 'evaluate' ? 'Adapter path does not support evaluation.'
			: command === 'edit-value' ? 'Adapter path does not support setting variables.'
				: 'Adapter path does not support reading memory.';
	return { enabled: false, hostAuthorizationRequired: true, reason };
}

export interface VariableRowDto {
	readonly id: string;
	readonly name: string;
	readonly value: string;
	readonly type?: string;
	readonly expandable: boolean;
}

export function presentVariableRows(values: readonly ValueSnapshot[]): readonly VariableRowDto[] {
	return values.map(value => ({
		id: value.id,
		name: value.name,
		value: value.value,
		type: value.type,
		expandable: value.handle?.kind === 'variable' && value.handle.reference > 0
	}));
}

export interface VariablePageDto {
	readonly rows: readonly VariableRowDto[];
	readonly page: number;
	readonly hasMore: boolean;
}

export function presentVariablePage(values: readonly ValueSnapshot[], page = 0): VariablePageDto {
	const safePage = Math.max(0, Math.floor(page));
	const start = safePage * CANVAS_LIMITS.maxValuesPerPage;
	return {
		rows: presentVariableRows(values.slice(start, start + CANVAS_LIMITS.maxValuesPerPage)),
		page: safePage,
		hasMore: start + CANVAS_LIMITS.maxValuesPerPage < values.length
	};
}
