import * as monaco from 'monaco-editor/editor/editor.api';
import editorWorker from 'monaco-editor/editor/editor.worker.js?worker';
import 'monaco-editor/languages/definitions/python/register.js';
import 'monaco-editor/languages/definitions/cpp/register.js';
import 'monaco-editor/languages/definitions/java/register.js';
import 'monaco-editor/languages/definitions/typescript/register.js';
import 'monaco-editor/languages/definitions/javascript/register.js';
import 'monaco-editor/languages/definitions/markdown/register.js';
import 'monaco-editor/languages/definitions/css/register.js';
import 'monaco-editor/languages/definitions/html/register.js';

(self as unknown as { MonacoEnvironment: { getWorker: () => Worker } }).MonacoEnvironment = {
	getWorker(): Worker {
		return new editorWorker();
	}
};

monaco.editor.defineTheme('thinking-canvas', {
	base: 'vs',
	inherit: true,
	rules: [
		{ token: 'comment', foreground: '8a949e', fontStyle: 'italic' },
		{ token: 'keyword', foreground: '2f5d8a' },
		{ token: 'string', foreground: '3d7a58' },
		{ token: 'number', foreground: 'b45454' },
		{ token: 'type', foreground: '76558f' },
		{ token: 'function', foreground: '234a70' },
		{ token: 'variable', foreground: '24313d' },
		{ token: 'delimiter', foreground: '6d7a86' }
	],
	colors: {
		'editor.background': '#fbfaf6',
		'editor.foreground': '#24313d',
		'editorLineNumber.foreground': '#b3aa99',
		'editorLineNumber.activeForeground': '#2f5d8a',
		'editor.lineHighlightBackground': '#f4f1e9',
		'editor.lineHighlightBorder': '#00000000',
		'editor.selectionBackground': '#dce9f5',
		'editor.inactiveSelectionBackground': '#eee9dd',
		'editorCursor.foreground': '#2f5d8a',
		'editorIndentGuide.background1': '#ebe6da',
		'editorIndentGuide.activeBackground1': '#d5cfc2',
		'editorWidget.background': '#ffffff',
		'editorWidget.border': '#e5e1d8',
		'editorSuggestWidget.background': '#ffffff',
		'editorSuggestWidget.border': '#e5e1d8',
		'editorSuggestWidget.selectedBackground': '#e9f1f8',
		'editorHoverWidget.background': '#ffffff',
		'editorHoverWidget.border': '#e5e1d8',
		'editorGutter.background': '#fbfaf6',
		'editorOverviewRuler.border': '#00000000',
		'scrollbarSlider.background': '#cec7b955',
		'scrollbarSlider.hoverBackground': '#b3aa9988',
		'scrollbarSlider.activeBackground': '#b3aa99aa'
	}
});

export function languageForPath(path: string): string {
	const extension = path.slice(path.lastIndexOf('.')).toLowerCase();
	const languages: Record<string, string> = {
		'.py': 'python',
		'.ts': 'typescript',
		'.tsx': 'typescript',
		'.js': 'javascript',
		'.jsx': 'javascript',
		'.java': 'java',
		'.c': 'c',
		'.h': 'c',
		'.cpp': 'cpp',
		'.hpp': 'cpp',
		'.json': 'json',
		'.md': 'markdown',
		'.css': 'css',
		'.html': 'html'
	};
	return languages[extension] ?? 'plaintext';
}

export { monaco };