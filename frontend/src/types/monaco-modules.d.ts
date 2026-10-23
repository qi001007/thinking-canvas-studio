declare module 'monaco-editor/editor/editor.api' {
	export * from 'monaco-editor';
}

declare module 'monaco-editor/editor/editor.worker.js?worker' {
	const WorkerClass: new () => Worker;
	export default WorkerClass;
}

declare module 'monaco-editor/languages/definitions/*/register.js';