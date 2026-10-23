import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createHostClient } from '@/host/create-host';
import { SceneCanvas } from '@/canvas/SceneCanvas';
import { MonacoEditor } from '@/editor/MonacoEditor';
import { languageForPath } from '@/editor/monaco-setup';
import { ConsolePanel } from '@/panels/ConsolePanel';
import { FileSidebar } from '@/panels/FileSidebar';
import { Inspector } from '@/panels/Inspector';
import { Timeline } from '@/panels/Timeline';
import { Topbar } from '@/panels/Topbar';
import {
	breakpointsFor,
	currentSnapshot,
	selectedFrame,
	StudioStore,
	type StudioMode
} from '@/state/studio-store';

export function StudioApp() {
	const [store, setStore] = useState<StudioStore | null>(null);
	const storeRef = useRef<StudioStore | null>(null);

	useEffect(() => {
		let cancelled = false;
		void createHostClient().then(host => {
			if (cancelled) return;
			const next = new StudioStore(host);
			storeRef.current = next;
			setStore(next);
			void next.init();
		});
		return () => {
			cancelled = true;
			storeRef.current?.dispose();
			storeRef.current = null;
		};
	}, []);

	if (!store) return <BootScreen message="正在连接本地宿主…" />;
	return <StudioView store={store} />;
}

function StudioView({ store }: { readonly store: StudioStore }) {
	const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
	const [editorRatio, setEditorRatio] = useState(0.52);
	const workbenchRef = useRef<HTMLDivElement | null>(null);
	const splitDragRef = useRef(false);
	const isHistory = state.mode === 'manual' ? state.manualStepIndex >= 0 : state.snapshotIndex >= 0;
	const snapshot = currentSnapshot(state);
	const historyFrame = snapshot?.frames.find(frame => frame.id === state.selectedFrameId) ?? snapshot?.frames[0];
	const liveFrame = selectedFrame(state);
	const currentLine = isHistory ? historyFrame?.line : liveFrame?.line;
	const dirty = state.editorText !== state.savedText;

	if (!state.ready) return <BootScreen message={state.status} />;

	const backToLive = () => {
		if (state.mode === 'manual') store.selectManualStep(-1);
		else store.backToLive();
	};
	const setMode = (mode: StudioMode) => void store.setMode(mode);

	return (
		<div className="studio-shell">
			<Topbar
				state={state}
				onMode={setMode}
				onStart={() => void store.startDebug()}
				onContinue={() => void store.continueDebug()}
				onStep={kind => void store.stepDebug(kind)}
				onStop={() => void store.stopDebug()}
				onSave={() => void store.saveFile()}
			/>
			<div className="studio-body">
				<FileSidebar
					state={state}
					onOpenFile={path => void store.openFile(path)}
					onMode={setMode}
					onAddCard={kind => store.addManualCard(kind)}
				/>
				<main className="workbench">
					<div className="workbench-main" ref={workbenchRef}>
						<section className="editor-pane" style={{ flexBasis: `${editorRatio * 100}%` }}>
							<div className="pane-tabbar">
								<div className="editor-tab is-active">
									<span className="tab-language">{languageForPath(state.activeFile)}</span>
									<span>{state.activeFile || '未打开文件'}</span>
									{dirty && <span className="dirty-dot" title="有未保存修改" />}
								</div>
								<span className="tabbar-hint">{languageForPath(state.activeFile)} · {state.breakpoints.filter(item => item.source === state.activeFile && item.enabled).length} 个断点</span>
							</div>
							<MonacoEditor
								path={state.activeFile || 'untitled.py'}
								value={state.editorText}
								breakpoints={breakpointsFor(state, state.activeFile)}
								currentLine={currentLine}
								onChange={value => store.updateEditorText(value)}
								onSave={() => void store.saveFile()}
								onToggleBreakpoint={line => store.toggleBreakpoint(state.activeFile, line)}
							/>
						</section>
						<div
							className="splitter"
							role="separator"
							aria-orientation="vertical"
							onPointerDown={event => {
								splitDragRef.current = true;
								event.currentTarget.setPointerCapture(event.pointerId);
							}}
							onPointerMove={event => {
								if (!splitDragRef.current) return;
								const rect = workbenchRef.current?.getBoundingClientRect();
								if (!rect) return;
								setEditorRatio(Math.max(0.32, Math.min(0.72, (event.clientX - rect.left) / rect.width)));
							}}
							onPointerUp={() => {
								splitDragRef.current = false;
							}}
						/>
						<section className="canvas-pane">
							<div className="pane-toolbar">
								<div className="canvas-title">
									<span className="canvas-title-icon" aria-hidden="true" />
									<strong>{state.mode === 'manual' ? '手绘画布' : '运行时画布'}</strong>
									<span className="canvas-subtitle">{state.scene.nodes.length} 个对象 · {state.scene.edges.length} 条关系</span>
								</div>
								<div className="canvas-meta">
									<span className={`coverage-badge is-${state.coverage.state}`}>{state.coverage.state}</span>
									{state.mode === 'debug' && <span className="canvas-meta-label">只投影结构化值</span>}
								</div>
							</div>
							{isHistory && (
								<div className="history-banner">
									<span>只读回看 · {state.mode === 'manual' ? `第 ${state.manualStepIndex + 1} 步` : snapshot?.label ?? '历史停点'}</span>
									<button type="button" className="btn btn-small" onClick={backToLive}>回到当前</button>
								</div>
							)}
							<SceneCanvas
								scene={state.scene}
								mode={state.mode}
								layout={state.manualBoard.layout}
								diff={state.diff}
								selectedNodeId={state.selectedNodeId}
								readOnly={state.mode === 'debug' || isHistory}
								onSelect={id => store.selectNode(id)}
								onMove={(id, x, y) => store.moveManualNode(id, x, y)}
								onCommitMove={() => store.commitManualBoard()}
							/>
						</section>
					</div>
					{state.mode === 'debug' && <ConsolePanel state={state} />}
					<Timeline
						state={state}
						onSelectSnapshot={index => store.selectSnapshot(index)}
						onSelectManualStep={index => store.selectManualStep(index)}
						onBackToLive={backToLive}
						onRecordStep={() => store.recordManualStep()}
					/>
				</main>
				<Inspector
					state={state}
					onSelectFrame={(threadId, frameId) => store.selectFrame(threadId, frameId)}
					onToggleBreakpoint={(source, line) => store.toggleBreakpoint(source, line)}
					onRemoveBreakpoint={id => store.removeBreakpoint(id)}
					onDeleteNode={id => store.deleteManualNode(id)}
				/>
			</div>
			<footer className="statusbar">
				{state.mode === 'manual' ? (
					<>
						<span className="status-dot is-stopped" />
						<span>手绘模式</span>
						<span className="status-sep" />
						<span>{state.manualBoard.steps.length} 步 · {state.manualBoard.scene.nodes.length} 个对象</span>
					</>
				) : (
					<>
						<span className={`status-dot is-${state.debug.sessionState}`} />
						<span>{state.running ? '运行中' : state.debug.sessionState}</span>
						<span className="status-sep" />
						<span>{state.session?.scripted ? '脚本化演示 · 未执行用户代码' : state.hostMode === 'demo' ? '演示宿主' : '本地宿主'}</span>
						<span className="status-sep" />
						<span>{state.coverage.state === 'partial' ? `部分采集：${state.coverage.knownMissing.length} 项` : `覆盖：${state.coverage.state}`}</span>
					</>
				)}
				<span className="status-right">
					{state.mode === 'manual' ? `${state.manualBoard.steps.length} 个步骤` : `${state.snapshots.length} 个停点 · ${state.console.length} 条输出`}
				</span>
			</footer>
		</div>
	);
}

function BootScreen({ message }: { readonly message: string }) {
	return (
		<div className="boot-screen">
			<div className="boot-mark"><img src="/brand.png" alt="" /></div>
			<h1>Thinking Canvas Studio</h1>
			<p>{message}</p>
			<div className="boot-progress"><span /></div>
		</div>
	);
}