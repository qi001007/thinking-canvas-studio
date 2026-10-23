import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { StudioState } from '@/state/studio-store';

export function ConsolePanel({ state, onEvaluate }: { readonly state: StudioState; readonly onEvaluate: (expression: string) => void }) {
	const [open, setOpen] = useState(true);
	const [draft, setDraft] = useState('');
	const canEvaluate = state.debug.sessionState === 'stopped'
		&& state.debug.capabilities?.evaluate === true
		&& state.session?.mode !== 'record';
	const submit = (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault();
		if (!draft.trim() || !canEvaluate) return;
		onEvaluate(draft);
		setDraft('');
	};
	const bodyRef = useRef<HTMLDivElement | null>(null);
	useEffect(() => {
		const body = bodyRef.current;
		if (body) body.scrollTop = body.scrollHeight;
	}, [state.console.length, open]);
	return (
		<section className={`console-panel ${open ? '' : 'is-collapsed'}`}>
			<header className="console-head">
				<button type="button" className="console-toggle" onClick={() => setOpen(value => !value)} aria-expanded={open}>
					<span className={`tree-chevron ${open ? 'is-open' : ''}`} />
					控制台
				</button>
				<span className="console-hint">输出</span>
			</header>
			{open && (
				<div className="console-body" ref={bodyRef}>
					{state.console.length === 0 && <div className="console-line is-info">等待会话输出…</div>}
					{state.console.map(line => (
						<div className={`console-line is-${line.kind}`} key={line.id}>{line.text}</div>
					))}
				</div>
			)}
			{open && (
				<form className="console-input" onSubmit={submit}>
					<span>REPL</span>
					<input
						value={draft}
						onChange={event => setDraft(event.target.value)}
						disabled={!canEvaluate}
						placeholder={canEvaluate ? '输入表达式，回车求值' : '停点后可求值'}
						aria-label="REPL 表达式"
					/>
				</form>
			)}
		</section>
	);
}