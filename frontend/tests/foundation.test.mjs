import test from 'node:test';
import assert from 'node:assert/strict';
import { initialDebugModelState, isThreadInspectable, reduceDebugEvent } from '../core/application/debug-model.ts';
import { DebugViewModel } from '../core/application/debug-view-model.ts';
import { createManualStep, createTraceSnapshot } from '../core/canvas/documents.ts';
import { diffScenes } from '../core/canvas/diff.ts';
import { projectSnapshot } from '../core/canvas/projector.ts';
import { presentCommandAvailability, presentVariablePage, presentVariableRows } from '../core/presentation/presenters.ts';

const caps = { stackTrace: true, scopes: true, variables: true, evaluate: true, setVariable: true, readMemory: true };
const missingCaps = { stackTrace: true, scopes: true, variables: true, evaluate: false, setVariable: false, readMemory: false };
const handle = (runId, stopEpoch, threadId = 'thread-1', sessionId = 'session-1') => ({ sessionId, runId, stopEpoch, threadId, kind: 'frame', reference: 1 });
const frame = (id, runId = 'run-1', stopEpoch = 1) => ({ id, name: id, handle: handle(runId, stopEpoch), scopes: [] });

function stoppedState() {
	let state = reduceDebugEvent(initialDebugModelState, { type: 'runStarted', runId: 'run-1', sessionId: 'session-1', capabilities: caps });
	state = reduceDebugEvent(state, { type: 'threadAdded', runId: 'run-1', sessionId: 'session-1', threadId: 'thread-1', name: 'Main' });
	state = reduceDebugEvent(state, { type: 'threadStopped', runId: 'run-1', sessionId: 'session-1', threadId: 'thread-1', allThreadsStopped: true });
	state = reduceDebugEvent(state, { type: 'framesLoaded', runId: 'run-1', sessionId: 'session-1', threadId: 'thread-1', stopEpoch: 1, frames: [frame('frame-1'), frame('frame-2')] });
	return state;
}

test('resume invalidates paused handles and in-flight inspection replies', () => {
	const view = new DebugViewModel();
	const beforeResume = stoppedState();
	view.selectFrame('session-1', 'thread-1', 'frame-1');
	const pending = view.beginInspectionRequest(beforeResume);
	assert.ok(pending);
	const resumed = reduceDebugEvent(beforeResume, { type: 'threadResumed', runId: 'run-1', sessionId: 'session-1', threadId: 'thread-1' });
	assert.equal(resumed.threads['thread-1'].frames.length, 0);
	assert.equal(resumed.threads['thread-1'].stopEpoch, 2);
	assert.equal(view.acceptInspectionReply(pending, resumed), false);
});

test('partial continuation invalidates every thread and blocks all inspection until a full stop', () => {
	let state = reduceDebugEvent(initialDebugModelState, { type: 'runStarted', runId: 'run-1', sessionId: 'session-1', capabilities: caps });
	state = reduceDebugEvent(state, { type: 'threadAdded', runId: 'run-1', sessionId: 'session-1', threadId: 'thread-1', name: 'Main' });
	state = reduceDebugEvent(state, { type: 'threadAdded', runId: 'run-1', sessionId: 'session-1', threadId: 'thread-2', name: 'Worker' });
	state = reduceDebugEvent(state, { type: 'threadStopped', runId: 'run-1', sessionId: 'session-1', threadId: 'thread-1', allThreadsStopped: true });
	state = reduceDebugEvent(state, { type: 'framesLoaded', runId: 'run-1', sessionId: 'session-1', threadId: 'thread-2', stopEpoch: 1, frames: [{ ...frame('worker-frame'), handle: handle('run-1', 1, 'thread-2') }] });
	assert.equal(state.threads['thread-2'].frames.length, 1);
	state = reduceDebugEvent(state, { type: 'threadResumed', runId: 'run-1', sessionId: 'session-1', threadId: 'thread-1', allThreadsContinued: false });
	assert.equal(state.sessionState, 'partial-unsupported');
	assert.equal(state.threads['thread-1'].state, 'partial-unsupported');
	assert.equal(state.threads['thread-2'].state, 'partial-unsupported');
	assert.equal(state.threads['thread-2'].frames.length, 0);
	assert.equal(isThreadInspectable(state.threads['thread-2']), false);
	state = reduceDebugEvent(state, { type: 'threadStopped', runId: 'run-1', sessionId: 'session-1', threadId: 'thread-2', allThreadsStopped: true });
	assert.equal(state.sessionState, 'stopped');
	assert.equal(state.threads['thread-1'].state, 'stopped');
	assert.equal(state.threads['thread-2'].state, 'stopped');
});

test('uncontrolled session-state events cannot revive stale inspectable handles', () => {
	const state = stoppedState();
	const forged = reduceDebugEvent(state, { type: 'sessionState', runId: 'run-1', sessionId: 'session-1', state: 'running' });
	assert.equal(forged, state);
});

test('a newly added thread invalidates a previously complete stop snapshot', () => {
	const state = stoppedState();
	const changed = reduceDebugEvent(state, { type: 'threadAdded', runId: 'run-1', sessionId: 'session-1', threadId: 'late-thread', name: 'Late' });
	assert.equal(changed.sessionState, 'partial-unsupported');
	assert.equal(changed.threads['thread-1'].frames.length, 0);
	assert.equal(changed.threads['late-thread'].state, 'partial-unsupported');
});

test('late reply for a previous selected frame is rejected', () => {
	const state = stoppedState();
	const view = new DebugViewModel();
	view.selectFrame('session-1', 'thread-1', 'frame-1');
	const first = view.beginInspectionRequest(state);
	view.selectFrame('session-1', 'thread-1', 'frame-2');
	assert.ok(first);
	assert.equal(view.acceptInspectionReply(first, state), false);
	const second = view.beginInspectionRequest(state);
	assert.ok(second);
	assert.equal(view.acceptInspectionReply(second, state), true);
});

test('events from an old run or different session cannot change the current model', () => {
	const state = stoppedState();
	const oldRunEvent = reduceDebugEvent(state, { type: 'threadResumed', runId: 'old-run', sessionId: 'session-1', threadId: 'thread-1' });
	const wrongSessionEvent = reduceDebugEvent(state, { type: 'threadResumed', runId: 'run-1', sessionId: 'other-session', threadId: 'thread-1' });
	assert.equal(oldRunEvent, state);
	assert.equal(wrongSessionEvent, state);
	const nextRun = reduceDebugEvent(state, { type: 'runStarted', runId: 'run-2', sessionId: 'session-2', capabilities: caps });
	assert.deepEqual(nextRun.threads, {});
});

test('handles from another session or stop epoch are rejected with the frame response', () => {
	let state = reduceDebugEvent(initialDebugModelState, { type: 'runStarted', runId: 'run-1', sessionId: 'session-1', capabilities: caps });
	state = reduceDebugEvent(state, { type: 'threadAdded', runId: 'run-1', sessionId: 'session-1', threadId: 'thread-1', name: 'Main' });
	state = reduceDebugEvent(state, { type: 'threadStopped', runId: 'run-1', sessionId: 'session-1', threadId: 'thread-1', allThreadsStopped: true });
	const badFrame = { ...frame('stale', 'run-1', 1), handle: handle('run-1', 1, 'thread-1', 'other-session') };
	const rejected = reduceDebugEvent(state, { type: 'framesLoaded', runId: 'run-1', sessionId: 'session-1', threadId: 'thread-1', stopEpoch: 1, frames: [badFrame] });
	assert.equal(rejected.threads['thread-1'].frames.length, 0);
});

test('missing capabilities disable commands with a reason', () => {
	assert.equal(presentCommandAvailability(caps, 'inspect').enabled, false);
	assert.equal(presentCommandAvailability(caps, 'evaluate', 'stopped', 'stopped').enabled, true);
	assert.equal(presentCommandAvailability(missingCaps, 'evaluate', 'stopped', 'stopped').enabled, false);
	assert.equal(presentCommandAvailability(caps, 'evaluate', 'running', 'running').enabled, false);
	assert.equal(presentCommandAvailability(caps, 'edit-value', 'partial-unsupported', 'partial-unsupported').enabled, false);
	assert.equal(presentCommandAvailability(missingCaps, 'edit-value', 'stopped', 'stopped').enabled, false);
	assert.equal(presentCommandAvailability(caps, 'read-memory', 'stopped', 'stopped').enabled, true);
	assert.equal(presentCommandAvailability(missingCaps, 'read-memory', 'stopped', 'stopped').enabled, false);
	assert.equal(presentCommandAvailability(caps, 'inspect', 'stopped', 'stopped').hostAuthorizationRequired, true);
	assert.equal(presentCommandAvailability(caps, 'inspect', 'partial-unsupported', 'partial-unsupported').enabled, false);
});

test('partial stop is explicitly unsupported for inspection; unknown capture remains unknown', () => {
	let state = reduceDebugEvent(initialDebugModelState, { type: 'runStarted', runId: 'run-1', sessionId: 'session-1', capabilities: caps });
	state = reduceDebugEvent(state, { type: 'threadAdded', runId: 'run-1', sessionId: 'session-1', threadId: 'thread-1', name: 'Main' });
	state = reduceDebugEvent(state, { type: 'threadStopped', runId: 'run-1', sessionId: 'session-1', threadId: 'thread-1', allThreadsStopped: false });
	assert.equal(state.threads['thread-1'].state, 'partial-unsupported');
	assert.equal(isThreadInspectable(state.threads['thread-1']), false);
	const view = new DebugViewModel();
	view.selectFrame('session-1', 'thread-1', 'missing-frame');
	assert.equal(view.beginInspectionRequest(state), undefined);
	const trace = createTraceSnapshot({ id: 'trace-1', capturedAt: '2026-10-23T00:00:00Z', runId: 'run-1', sessionId: 'session-1', coverage: { state: 'unknown', reason: 'No capture source.', knownMissing: [] }, frames: [] });
	assert.equal(trace.coverage.state, 'unknown');
});

test('canvas suppresses scalars and does not infer aliases from matching DAP handles', () => {
	const sharedHandle = handle('run-1', 1);
	const snapshot = {
		session: { id: 'session-1', runId: 'run-1', state: 'stopped', capabilities: caps, threads: [{ id: 'thread-1', name: 'Main', state: 'stopped', stopEpoch: 1, frames: [{ ...frame('frame-1'), scopes: [{ id: 'local', name: 'Locals', expensive: false, handle: { ...sharedHandle, kind: 'scope' }, values: [
			{ id: 'scalar', name: 'count', value: '3', handle: { ...sharedHandle, kind: 'variable' }, children: [] },
			{ id: 'object-a', name: 'a', value: '{…}', structure: 'struct', handle: { ...sharedHandle, kind: 'variable' }, children: [] },
			{ id: 'object-b', name: 'b', value: '{…}', structure: 'struct', handle: { ...sharedHandle, kind: 'variable' }, children: [] }
		] }] }] }] },
		coverage: { state: 'complete', knownMissing: [] }
	};
	const projected = projectSnapshot(snapshot);
	assert.equal(projected.scene.nodes.filter(node => node.kind === 'struct').length, 2);
	assert.equal(projected.scene.nodes.some(node => node.valueId === 'scalar'), false);
	assert.equal(projected.scene.edges.some(edge => edge.kind === 'alias'), false);
	assert.equal(presentVariableRows(snapshot.session.threads[0].frames[0].scopes[0].values).length, 3);
});

test('alias edges require explicit collector identity evidence', () => {
	const snapshot = {
		id: 'trace-1', capturedAt: '2026-10-23T00:00:00Z', runId: 'run-1', sessionId: 'session-1',
		coverage: { state: 'complete', knownMissing: [] },
		frames: [{ id: 'frame-1', name: 'main', scopes: [{ id: 'locals', name: 'Locals', expensive: false, values: [
			{ id: 'one', name: 'one', value: 'obj', structure: 'heap', collectorIdentity: { collector: 'heap-scan', objectId: 'obj-7' }, children: [] },
			{ id: 'two', name: 'two', value: 'obj', structure: 'reference', collectorIdentity: { collector: 'heap-scan', objectId: 'obj-7' }, children: [] },
			{ id: 'three', name: 'three', value: 'obj', structure: 'pointer', collectorIdentity: { collector: 'heap-scan', objectId: 'obj-7' }, children: [] },
			{ id: 'four', name: 'four', value: 'other', structure: 'struct', collectorIdentity: { collector: 'heap-scan', objectId: 'obj-8' }, children: [] }
		] }] }]
	};
	const { scene } = projectSnapshot(snapshot);
	assert.deepEqual(scene.nodes.filter(node => ['one', 'two', 'three'].includes(node.label)).map(node => node.label), ['one', 'two', 'three']);
	const aliasEdges = scene.edges.filter(edge => edge.kind === 'alias');
	assert.equal(aliasEdges.length, 2);
	assert.equal(aliasEdges[0].from, scene.nodes.find(node => node.label === 'two').id);
	assert.equal(aliasEdges[0].to, scene.nodes.find(node => node.label === 'one').id);
	assert.equal(new Set(scene.edges.map(edge => edge.id)).size, scene.edges.length);
	assert.equal(scene.nodes.filter(node => node.label === 'four').length, 1);
	assert.equal(aliasEdges.some(edge => edge.from === scene.nodes.find(node => node.label === 'four').id || edge.to === scene.nodes.find(node => node.label === 'four').id), false);
});

test('live running snapshots do not project stale frames', () => {
	const snapshot = {
		session: { id: 'session-1', runId: 'run-1', state: 'running', capabilities: caps, threads: [{ id: 'thread-1', name: 'Main', state: 'stopped', stopEpoch: 1, frames: [frame('stale-frame')] }] },
		coverage: { state: 'complete', knownMissing: [] }
	};
	const projected = projectSnapshot(snapshot);
	assert.deepEqual(projected.scene.nodes, []);
	assert.equal(projected.coverage.state, 'unknown');
	assert.match(projected.coverage.reason, /no live frames/);
});

test('manual board is independent; trace snapshot deep-clones allowed DTO fields and drops extras', () => {
	const metadata = { shape: [2, 3] };
	const externalIdentity = { collector: 'heap', objectId: 'object-1' };
	const source = { id: 'trace-1', capturedAt: '2026-10-23T00:00:00Z', runId: 'run-1', sessionId: 'session-1', handle: handle('run-1', 1), unknown: 'remove', coverage: { state: 'complete', knownMissing: [], extra: 'remove' }, frames: [{ id: 'frame-1', name: 'main', handle: handle('run-1', 1), scopes: [{ id: 'scope-1', name: 'Locals', expensive: false, handle: { ...handle('run-1', 1), kind: 'scope' }, values: [{ id: 'value-1', name: 'x', value: '1', handle: { ...handle('run-1', 1), kind: 'variable' }, structure: 'heap', tensorMetadata: metadata, collectorIdentity: externalIdentity, unknown: 'remove', children: [] }] }] }] };
	const trace = createTraceSnapshot(source);
	const manualBoard = { id: 'board-1', scene: { nodes: [{ id: 'layout:manual', valueId: 'manual-value', label: 'idea', kind: 'struct' }], edges: [] }, annotations: [], layout: { positions: {}, zoom: 1 } };
	assert.equal(trace.frames.length, 1);
	assert.equal('unknown' in trace, false);
	assert.equal('handle' in trace.frames[0], false);
	assert.equal('handle' in trace.frames[0].scopes[0], false);
	assert.equal('handle' in trace.frames[0].scopes[0].values[0], false);
	assert.equal('extra' in trace.coverage, false);
	assert.notEqual(trace.frames[0].scopes[0].values[0].tensorMetadata, metadata);
	assert.notEqual(trace.frames[0].scopes[0].values[0].collectorIdentity, externalIdentity);
	metadata.shape.push(4);
	externalIdentity.objectId = 'mutated';
	assert.deepEqual(trace.frames[0].scopes[0].values[0].tensorMetadata.shape, [2, 3]);
	assert.equal(trace.frames[0].scopes[0].values[0].collectorIdentity.objectId, 'object-1');
	assert.equal(manualBoard.scene.nodes[0].valueId, 'manual-value');
	assert.equal(Object.isFrozen(trace), true);
});

test('layout keys survive source line changes and unique variable reorder; budget truncation is reported', () => {
	const build = (line, values, frameId) => ({
		id: 'trace', capturedAt: 'time', runId: 'run', sessionId: 'session', coverage: { state: 'complete', knownMissing: [] },
		frames: [{ id: frameId, name: 'calculate', source: 'file.py', line, scopes: [{ id: 'scope', name: 'Locals', expensive: false, values }] }]
	});
	const valuesA = [
		{ id: 'a1', name: 'alpha', value: 'obj', structure: 'struct', children: [] },
		{ id: 'b1', name: 'beta', value: 'obj', structure: 'struct', children: [] }
	];
	const valuesB = [
		{ id: 'b2', name: 'beta', value: 'obj', structure: 'struct', children: [] },
		{ id: 'a2', name: 'alpha', value: 'obj', structure: 'struct', children: [] }
	];
	const first = projectSnapshot(build(10, valuesA, 'runtime-frame-1'));
	const second = projectSnapshot(build(20, valuesB, 'runtime-frame-2'));
	assert.deepEqual(first.scene.nodes.map(node => node.id).sort(), second.scene.nodes.map(node => node.id).sort());
	assert.notEqual(first.scene.nodes.find(node => node.kind === 'stack-frame').valueId, second.scene.nodes.find(node => node.kind === 'stack-frame').valueId);
	const many = Array.from({ length: 510 }, (_, i) => ({ id: `v${i}`, name: `v${i}`, value: '{…}', structure: 'struct', children: [] }));
	const limited = projectSnapshot(build(1, many, 'frame'));
	assert.equal(limited.coverage.state, 'partial');
	assert.ok(limited.coverage.knownMissing.some(reason => reason.includes('budget') || reason.includes('node limit')));
});

test('depth and visited-value budgets stop deep and scalar-only traversals explicitly', () => {
	const base = { id: 'trace', capturedAt: 'time', runId: 'run', sessionId: 'session', coverage: { state: 'complete', knownMissing: [] } };
	let deep = { id: 'leaf', name: 'leaf', value: '{…}', structure: 'struct', children: [] };
	for (let i = 0; i < 100; i++) deep = { id: `${i}`, name: `child-${i}`, value: '{…}', structure: 'struct', children: [deep] };
	const deepResult = projectSnapshot({ ...base, frames: [{ id: 'frame', name: 'main', scopes: [{ id: 'scope', name: 'Locals', expensive: false, values: [deep] }] }] });
	assert.equal(deepResult.coverage.state, 'partial');
	const scalars = Array.from({ length: 5_100 }, (_, i) => ({ id: `${i}`, name: `v${i}`, value: `${i}`, children: [] }));
	const scalarResult = projectSnapshot({ ...base, frames: [{ id: 'frame', name: 'main', scopes: [{ id: 'scope', name: 'Locals', expensive: false, values: [{ id: 'root', name: 'root', value: '', children: scalars }] }] }] });
	assert.equal(scalarResult.coverage.state, 'partial');
});

test('page presenter makes variable paging explicit', () => {
	const values = Array.from({ length: 205 }, (_, i) => ({ id: `${i}`, name: `v${i}`, value: `${i}`, children: [] }));
	assert.deepEqual({ rows: presentVariablePage(values).rows.length, hasMore: presentVariablePage(values).hasMore }, { rows: 100, hasMore: true });
	assert.deepEqual({ rows: presentVariablePage(values, 2).rows.length, hasMore: presentVariablePage(values, 2).hasMore }, { rows: 5, hasMore: false });
});

test('projected cards expose list, dict and tensor payloads for the shared renderer', () => {
	const snapshot = {
		id: 'trace-cards', capturedAt: 'time', runId: 'run', sessionId: 'session',
		coverage: { state: 'complete', knownMissing: [] },
		frames: [{
			id: 'frame', name: 'main', source: 'main.py', line: 4,
			scopes: [{
				id: 'locals', name: 'Locals', expensive: false,
				values: [
					{ id: 'nums', name: 'nums', value: '[1, 2]', type: 'list[int]', structure: 'container', containerKind: 'list', children: [
						{ id: 'n0', name: '[0]', value: '1', children: [] },
						{ id: 'n1', name: '[1]', value: '2', children: [] }
					] },
					{ id: 'seen', name: 'seen', value: '{1: 0}', type: 'dict[int, int]', structure: 'container', containerKind: 'dict', children: [
						{ id: 'k1', name: '1', value: '0', children: [] }
					] },
					{ id: 'tensor', name: 'tensor', value: 'tensor([...])', type: 'Tensor', structure: 'tensor', tensorMetadata: { shape: [2, 3], dtype: 'float32' }, children: [] }
				]
			}]
		}]
	};
	const { scene } = projectSnapshot(snapshot);
	const nums = scene.nodes.find(node => node.label === 'nums');
	const seen = scene.nodes.find(node => node.label === 'seen');
	const tensor = scene.nodes.find(node => node.label === 'tensor');
	assert.deepEqual(nums.card, { kind: 'list', items: [{ value: '1' }, { value: '2' }] });
	assert.deepEqual(seen.card, { kind: 'dict', entries: [{ key: '1', value: '0' }] });
	assert.equal(tensor.card.kind, 'tensor');
	assert.deepEqual(tensor.card.shape, [2, 3]);
	assert.equal(tensor.card.dtype, 'float32');
});

test('scene diff marks changed cells without flagging unchanged siblings', () => {
	const before = {
		nodes: [{ id: 'n', valueId: 'v', label: 'nums', kind: 'container', card: { kind: 'array', rows: [[{ value: '1' }, { value: '2' }]] } }],
		edges: []
	};
	const after = {
		nodes: [{ id: 'n', valueId: 'v2', label: 'nums', kind: 'container', card: { kind: 'array', rows: [[{ value: '1' }, { value: '3' }]] } }],
		edges: []
	};
	const diff = diffScenes(before, after);
	assert.equal(diff.changedNodeIds.has('n'), true);
	assert.equal(diff.changedValueIds.has('v2'), true);
	assert.equal(diff.changedParts.get('n')?.has('cell:0:1'), true);
	assert.equal(diff.changedParts.get('n')?.has('cell:0:0'), false);
});

test('manual step copies scene data and remains independent of later edits', () => {
	const board = {
		id: 'b', title: 'T', annotations: [], layout: { positions: {}, zoom: 1 }, steps: [],
		scene: { nodes: [{ id: 'n', valueId: 'v', label: 'x', kind: 'manual', card: { kind: 'variable', value: '1' } }], edges: [] }
	};
	const step = createManualStep(board, '第一步');
	assert.equal(step.title, '第一步');
	assert.notEqual(step.scene, board.scene);
	board.scene.nodes[0].card.value = '2';
	assert.equal(step.scene.nodes[0].card.value, '1');
});
