import { useEffect, useRef, useState } from 'react';
import type { StudioState } from '@/state/studio-store';

export function ConsolePanel({ state }: { readonly state: StudioState }) {
	const [open, setOpen] = useState(true);
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
				<span className="console-hint">演示输出 · 只读</span>
			</header>
			{open && (
				<div className="console-body" ref={bodyRef}>
					{state.console.length === 0 && <div className="console-line is-info">等待会话输出…</div>}
					{state.console.map(line => (
						<div className={`console-line is-${line.kind}`} key={line.id}>{line.text}</div>
					))}
				</div>
			)}
			{open && <div className="console-input"><span>REPL</span><input disabled placeholder="REPL 尚未启用；真实适配器接入后再开放" /></div>}
		</section>
	);
}