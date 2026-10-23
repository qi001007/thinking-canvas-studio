import { useEffect, useRef } from 'react';
import type { Breakpoint } from '@/state/studio-store';
import { languageForPath, monaco } from '@/editor/monaco-setup';

interface MonacoEditorProps {
	readonly path: string;
	readonly value: string;
	readonly breakpoints: readonly Breakpoint[];
	readonly currentLine?: number;
	readonly readOnly?: boolean;
	readonly onChange: (value: string) => void;
	readonly onSave: () => void;
	readonly onToggleBreakpoint: (line: number) => void;
}

export function MonacoEditor({
	path,
	value,
	breakpoints,
	currentLine,
	readOnly = false,
	onChange,
	onSave,
	onToggleBreakpoint
}: MonacoEditorProps) {
	const containerRef = useRef<HTMLDivElement | null>(null);
	const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
	const modelsRef = useRef(new Map<string, monaco.editor.ITextModel>());
	const viewStatesRef = useRef(new Map<string, monaco.editor.ICodeEditorViewState | null>());
	const decorationsRef = useRef<string[]>([]);
	const callbacksRef = useRef({ onChange, onSave, onToggleBreakpoint });
	callbacksRef.current = { onChange, onSave, onToggleBreakpoint };

	useEffect(() => {
		if (!containerRef.current) return;
		const editor = monaco.editor.create(containerRef.current, {
			value: '',
			language: 'plaintext',
			theme: 'thinking-canvas',
			fontFamily: '"JetBrains Mono", "Cascadia Code", "SFMono-Regular", Consolas, monospace',
			fontSize: 13,
			lineHeight: 21,
			letterSpacing: 0.1,
			minimap: { enabled: false },
			glyphMargin: true,
			folding: true,
			lineNumbersMinChars: 3,
			renderLineHighlight: 'all',
			scrollBeyondLastLine: false,
			smoothScrolling: true,
			automaticLayout: true,
			padding: { top: 12, bottom: 24 },
			tabSize: 4,
			insertSpaces: true,
			wordWrap: 'off',
			overviewRulerBorder: false,
			hideCursorInOverviewRuler: true,
			scrollbar: { verticalScrollbarSize: 8, horizontalScrollbarSize: 8, useShadows: false },
			stickyScroll: { enabled: false },
			bracketPairColorization: { enabled: false },
			guides: { bracketPairs: false, indentation: true }
		});
		editorRef.current = editor;
		const changeSubscription = editor.onDidChangeModelContent(() => {
			callbacksRef.current.onChange(editor.getValue());
		});
		const mouseSubscription = editor.onMouseDown(event => {
			if (event.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN && event.target.position) {
				callbacksRef.current.onToggleBreakpoint(event.target.position.lineNumber);
			}
		});
		const saveAction = editor.addAction({
			id: 'studio.save',
			label: 'Save file',
			keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
			run: () => callbacksRef.current.onSave()
		});
		return () => {
			saveAction.dispose();
			mouseSubscription.dispose();
			changeSubscription.dispose();
			editor.dispose();
			for (const model of modelsRef.current.values()) model.dispose();
			modelsRef.current.clear();
			editorRef.current = null;
		};
	}, []);

	useEffect(() => {
		const editor = editorRef.current;
		if (!editor) return;
		const previousModel = editor.getModel();
		if (previousModel) viewStatesRef.current.set(previousModel.uri.toString(), editor.saveViewState());
		let model = modelsRef.current.get(path);
		if (!model) {
			model = monaco.editor.createModel(value, languageForPath(path), monaco.Uri.parse(`inmemory://studio/${path.replace(/\\/g, '/')}`));
			modelsRef.current.set(path, model);
		} else if (model.getValue() !== value) {
			model.setValue(value);
		}
		if (editor.getModel() !== model) editor.setModel(model);
		const viewState = viewStatesRef.current.get(model.uri.toString());
		if (viewState) editor.restoreViewState(viewState);
	}, [path, value]);

	useEffect(() => {
		editorRef.current?.updateOptions({ readOnly });
	}, [readOnly]);

	useEffect(() => {
		const editor = editorRef.current;
		if (!editor) return;
		const decorations: monaco.editor.IModelDeltaDecoration[] = [];
		for (const breakpoint of breakpoints) {
			if (!breakpoint.enabled) continue;
			decorations.push({
				range: new monaco.Range(breakpoint.line, 1, breakpoint.line, 1),
				options: {
					glyphMarginClassName: 'tc-breakpoint',
					linesDecorationsClassName: 'tc-breakpoint-mark',
					stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges
				}
			});
		}
		if (currentLine) {
			decorations.push({
				range: new monaco.Range(currentLine, 1, currentLine, 1),
				options: {
					isWholeLine: true,
					className: 'tc-current-line',
					glyphMarginClassName: 'tc-current-arrow',
					stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges
				}
			});
		}
		decorationsRef.current = editor.deltaDecorations(decorationsRef.current, decorations);
	}, [breakpoints, currentLine, path]);

	return <div className="monaco-host" ref={containerRef} />;
}