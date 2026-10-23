import type { ManualBoard } from '@core/canvas/documents';
import type {
	CapabilitySet,
	RuntimeHandle,
	ScopeSnapshot,
	StackFrameSnapshot,
	ValueSnapshot
} from '@core/domain/contracts';
import type { FileEntry, LanguagePackage } from '@/host/types';

export const DEMO_SESSION_ID = 'demo-session';
export const DEMO_RUN_ID = 'demo-run';
export const DEMO_THREAD_ID = 'thread-main';

export const demoCapabilities: CapabilitySet = {
	stackTrace: true,
	scopes: true,
	variables: true,
	evaluate: false,
	setVariable: false,
	readMemory: false
};

export const demoFiles: readonly FileEntry[] = [
	{ path: 'main.py', name: 'main.py', kind: 'file', language: 'python' },
	{ path: 'two_sum.py', name: 'two_sum.py', kind: 'file', language: 'python' },
	{ path: 'notes.md', name: 'notes.md', kind: 'file', language: 'markdown' }
];

export const demoLanguages: readonly LanguagePackage[] = [
	{ id: 'python', name: 'Python', extensions: ['.py'], adapter: 'debugpy', status: 'demo' },
	{ id: 'cpp', name: 'C / C++', extensions: ['.c', '.cpp', '.h', '.hpp'], adapter: 'gdb', status: 'not-installed' },
	{ id: 'typescript', name: 'TypeScript / JavaScript', extensions: ['.ts', '.tsx', '.js', '.jsx'], adapter: 'js-debug', status: 'not-installed' },
	{ id: 'java', name: 'Java', extensions: ['.java'], adapter: 'java-debug', status: 'not-installed' }
];

export const demoFileContents: Readonly<Record<string, string>> = {
	'main.py': `def bubble_sort(nums: list[int]) -> list[int]:
    n = len(nums)
    seen = {}
    for i in range(n - 1):
        swapped = False
        for j in range(n - 1 - i):
            seen[nums[j]] = j
            if nums[j] > nums[j + 1]:
                nums[j], nums[j + 1] = nums[j + 1], nums[j]
                swapped = True
        if not swapped:
            break
    return nums


if __name__ == "__main__":
    print(bubble_sort([5, 1, 4, 2]))
`,
	'two_sum.py': `def two_sum(nums: list[int], target: int) -> list[int]:
    seen: dict[int, int] = {}
    for index, value in enumerate(nums):
        need = target - value
        if need in seen:
            return [seen[need], index]
        seen[value] = index
    return []


if __name__ == "__main__":
    print(two_sum([2, 7, 11, 15], 9))
`,
	'notes.md': `# 冒泡排序 · 第一轮

- 不变量：j 扫过的位置已经有序。
- 指针 i 表示当前轮次，j 表示当前比较位置。
- 每次交换后，nums 和 seen 都会变化。
`
};

export interface DemoStep {
	readonly label: string;
	readonly line: number;
	readonly nums: readonly number[];
	readonly seen: Readonly<Record<string, number>>;
	readonly i: number;
	readonly j: number;
	readonly swapped: boolean;
}

export const demoSteps: readonly DemoStep[] = [
	{ label: '初始状态', line: 2, nums: [5, 1, 4, 2], seen: {}, i: 0, j: 0, swapped: false },
	{ label: '比较 5 与 1', line: 6, nums: [5, 1, 4, 2], seen: { '5': 0 }, i: 0, j: 0, swapped: false },
	{ label: '交换 5 与 1', line: 7, nums: [1, 5, 4, 2], seen: { '5': 0, '1': 1 }, i: 0, j: 0, swapped: true },
	{ label: '比较 5 与 4', line: 6, nums: [1, 5, 4, 2], seen: { '5': 0, '1': 1, '4': 2 }, i: 0, j: 1, swapped: true },
	{ label: '交换 5 与 4', line: 7, nums: [1, 4, 5, 2], seen: { '5': 0, '1': 1, '4': 2 }, i: 0, j: 1, swapped: true },
	{ label: '比较 5 与 2', line: 6, nums: [1, 4, 5, 2], seen: { '5': 0, '1': 1, '4': 2, '2': 3 }, i: 0, j: 2, swapped: true },
	{ label: '交换 5 与 2', line: 7, nums: [1, 4, 2, 5], seen: { '5': 0, '1': 1, '4': 2, '2': 3 }, i: 0, j: 2, swapped: true },
	{ label: '第一轮结束', line: 9, nums: [1, 4, 2, 5], seen: { '5': 0, '1': 1, '4': 2, '2': 3 }, i: 0, j: 2, swapped: true }
];

const manualNodes = [
	{
		id: 'layout:manual:function',
		valueId: 'manual:function',
		label: 'bubbleSort',
		kind: 'manual' as const,
		card: {
			kind: 'function' as const,
			signature: 'bubbleSort(nums) → nums',
			input: '[5, 1, 4, 2]',
			output: '[1, 2, 4, 5]',
			complexity: 'O(n²) / O(1)'
		}
	},
	{
		id: 'layout:manual:invariant',
		valueId: 'manual:invariant',
		label: '不变量',
		kind: 'manual' as const,
		card: { kind: 'sticky' as const, tone: 'invariant' as const, text: '每一轮把当前最大的元素推到右端。j 扫过的位置已经有序。' }
	},
	{
		id: 'layout:manual:array',
		valueId: 'manual:array',
		label: 'nums',
		kind: 'manual' as const,
		card: { kind: 'array' as const, rows: [[{ value: '5' }, { value: '1' }, { value: '4' }, { value: '2' }]] }
	},
	{
		id: 'layout:manual:swapped',
		valueId: 'manual:swapped',
		label: 'swapped',
		kind: 'manual' as const,
		card: { kind: 'variable' as const, value: 'true' }
	}
];

export const demoManualBoard: ManualBoard = {
	id: 'board-demo',
	title: '冒泡排序 · 手绘',
	scene: {
		nodes: manualNodes,
		edges: [
			{ id: 'edge-function-array', from: 'layout:manual:function', to: 'layout:manual:array', kind: 'contains', label: '输入' },
			{ id: 'edge-function-swapped', from: 'layout:manual:function', to: 'layout:manual:swapped', kind: 'contains', label: '状态' }
		]
	},
	annotations: [],
	layout: {
		zoom: 1,
		positions: {
			'layout:manual:function': { x: 20, y: 20 },
			'layout:manual:invariant': { x: 330, y: 20 },
			'layout:manual:array': { x: 20, y: 210 },
			'layout:manual:swapped': { x: 20, y: 380 }
		}
	},
	steps: []
};

function handle(stopEpoch: number, kind: RuntimeHandle['kind'], reference: number, threadId = DEMO_THREAD_ID): RuntimeHandle {
	return {
		sessionId: DEMO_SESSION_ID,
		runId: DEMO_RUN_ID,
		stopEpoch,
		threadId,
		kind,
		reference
	};
}

function scalar(id: string, name: string, value: string, type: string): ValueSnapshot {
	return { id, name, value, type, children: [] };
}

function listValue(id: string, name: string, values: readonly number[], frameHandle: RuntimeHandle): ValueSnapshot {
	return {
		id,
		name,
		value: `[${values.join(', ')}]`,
		type: 'list[int]',
		structure: 'container',
		containerKind: 'list',
		handle: { ...frameHandle, kind: 'variable', reference: 3 },
		children: values.map((value, index) => scalar(`${id}-${index}`, `[${index}]`, String(value), 'int'))
	};
}

function dictValue(id: string, name: string, entries: Readonly<Record<string, number>>, frameHandle: RuntimeHandle): ValueSnapshot {
	return {
		id,
		name,
		value: `{${Object.entries(entries).map(([key, value]) => `${key}: ${value}`).join(', ')}}`,
		type: 'dict[int, int]',
		structure: 'container',
		containerKind: 'dict',
		handle: { ...frameHandle, kind: 'variable', reference: 4 },
		children: Object.entries(entries).map(([key, value]) => scalar(`${id}-${key}`, key, String(value), 'int'))
	};
}

export function buildDemoFrames(stepIndex: number): readonly StackFrameSnapshot[] {
	const step = demoSteps[Math.max(0, Math.min(stepIndex, demoSteps.length - 1))]!;
	const stopEpoch = 1 + stepIndex * 2;
	const frameHandle = handle(stopEpoch, 'frame', 1);
	const scopeHandle = handle(stopEpoch, 'scope', 2);
	const locals: ScopeSnapshot = {
		id: 'scope-locals',
		name: 'Locals',
		expensive: false,
		handle: scopeHandle,
		values: [
			listValue(`nums-${stepIndex}`, 'nums', step.nums, frameHandle),
			dictValue(`seen-${stepIndex}`, 'seen', step.seen, frameHandle),
			scalar('i', 'i', String(step.i), 'int'),
			scalar('j', 'j', String(step.j), 'int'),
			scalar('swapped', 'swapped', String(step.swapped), 'bool')
		]
	};
	return [
		{
			id: 'frame-bubble',
			name: 'bubble_sort',
			source: 'main.py',
			line: step.line,
			column: 1,
			handle: frameHandle,
			scopes: [locals]
		},
		{
			id: 'frame-module',
			name: '<module>',
			source: 'main.py',
			line: 17,
			column: 1,
			handle: handle(stopEpoch, 'frame', 10),
			scopes: []
		}
	];
}

export function demoConsoleLine(text: string, kind: 'stdout' | 'info' = 'info') {
	return { id: `console-${crypto.randomUUID()}`, kind, text };
}
