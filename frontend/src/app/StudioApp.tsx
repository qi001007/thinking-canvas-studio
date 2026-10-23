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
	const [editorRatio, setEditorRatio] = useState(0.44);
	const [detailEditorRatio, setDetailEditorRatio] = useState(0.36);
	const workbenchRef = useRef<HTMLDivElement | null>(null);
	const splitDragRef = useRef(false);
	const isHistory = state.mode === 'manual' ? state.manualStepIndex >= 0 : state.canvasView === 'runtime' && state.snapshotIndex >= 0;
	const effectiveEditorRatio = state.mode === 'debug' && state.canvasView === 'static' && state.graphView !== 'overview' ? detailEditorRatio : editorRatio;
	const snapshot = currentSnapshot(state);
	const historyFrame = snapshot?.frames.find(frame => frame.id === state.selectedFrameId) ?? snapshot?.frames[0];
	const liveFrame = selectedFrame(state);
	const currentLine = isHistory ? historyFrame?.line : state.canvasView === 'runtime' ? liveFrame?.line : undefined;
	const dirty = state.editorText !== state.savedText;
	const activeLabel = state.activeFile.replace(/\\/g, '/').startsWith('.thinking-canvas/workbench/')
		? `函数工作台 · ${state.workbench?.sourceFile ?? '源文件'}`
		: state.activeFile;

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
				onStartReal={mode => void store.startRealDebug(mode)}
				onContinue={() => void store.continueDebug()}
				onPause={() => void store.pauseDebug()}
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
					onCreateWorkbench={() => void store.createWorkbench()}
					onOpenWorkbench={path => void store.openWorkbench(path)}
				/>
				<main className="workbench">
					<div className="workbench-main" ref={workbenchRef}>
						<section className="editor-pane" style={{ flexBasis: `${effectiveEditorRatio * 100}%` }}>
							<div className="pane-tabbar">
								<div className="editor-tab is-active">
									<span className="tab-language">{languageForPath(state.activeFile)}</span>
									<span>{activeLabel || '未打开文件'}</span>
									{dirty && <span className="dirty-dot" title="有未保存修改" />}
								</div>
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
								const ratio = Math.max(0.32, Math.min(0.72, (event.clientX - rect.left) / rect.width));
								if (state.mode === 'debug' && state.canvasView === 'static' && state.graphView !== 'overview') setDetailEditorRatio(ratio);
								else setEditorRatio(ratio);
							}}
							onPointerUp={() => {
								splitDragRef.current = false;
							}}
						/>
						<section className="canvas-pane">
							<div className="pane-toolbar">
								<div className="canvas-title">
									<span className="canvas-title-icon" aria-hidden="true" />
									<strong>{state.mode === 'manual' ? '手绘画布' : state.canvasView === 'static' ? '静态结构' : '运行时画布'}</strong>
									<span
										className="canvas-subtitle"
										title={state.mode === 'debug' && state.canvasView === 'static' && state.staticStats
											? `结构视图 · ${state.staticStats.functions} 函数 / ${state.staticStats.classes} 类；聚焦类看成员，聚焦方法看内部`
											: '画布对象与关系'}
									>
										{state.scene.nodes.length} 卡 · {state.scene.edges.length} 边
									</span>
								</div>
								<div className="canvas-meta">
									{state.mode === 'debug' && state.canvasView === 'static' && (
										<>
											<div className="graph-view-switch">
												<button type="button" className={state.graphView === 'overview' ? 'is-active' : ''} onClick={() => { store.setGraphView('overview'); setEditorRatio(0.44); }}>总览</button>
												<button type="button" className={state.graphView === 'structure' ? 'is-active' : ''} onClick={() => { store.setGraphView('structure'); setDetailEditorRatio(0.36); }}>结构</button>
												<button type="button" className={state.graphView === 'data' ? 'is-active' : ''} onClick={() => { store.setGraphView('data'); setDetailEditorRatio(0.36); }}>数据</button>
											</div>
											<select
												className="graph-focus-select"
												value={state.graphFocus ?? ''}
												onChange={event => {
													setDetailEditorRatio(0.36);
													if (event.target.value) store.focusGraphNode(event.target.value);
													else store.clearGraphFocus();
												}}
												aria-label="聚焦函数或类"
												title="聚焦类看成员；聚焦方法看内部参数、变量和调用"
											>
												<option value="">聚焦：自动</option>
												{state.graphFocusOptions.map(option => (
													<option value={option.id} key={option.id}>{option.label}</option>
												))}
											</select>
										</>
									)}
									<div className="canvas-view-switch">
										<button type="button" className={state.canvasView === 'static' ? 'is-active' : ''} onClick={() => store.setCanvasView('static')}>静态</button>
										<button type="button" className={state.canvasView === 'runtime' ? 'is-active' : ''} onClick={() => store.setCanvasView('runtime')} disabled={state.snapshots.length === 0}>运行</button>
									</div>
									<span className={`coverage-badge is-${state.coverage.state}`}>{state.coverage.state}</span>
								</div>
							</div>
							{state.staticError && state.mode === 'debug' && state.canvasView === 'static' && (
								<div className="analysis-error">静态分析：{state.staticError}</div>
							)}
							{isHistory && (
								<div className="history-banner">
									<span>只读回看 · {state.mode === 'manual' ? `第 ${state.manualStepIndex + 1} 步` : snapshot?.label ?? '历史停点'}</span>
									<button type="button" className="btn btn-small" onClick={backToLive}>回到当前</button>
								</div>
							)}
							<SceneCanvas
								scene={state.scene}
								mode={state.mode}
								graphView={state.graphView}
								focusId={state.graphFocus}
								history={state.snapshots}
								historyIndex={state.snapshotIndex >= 0 ? state.snapshotIndex : state.snapshots.length - 1}
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
					{state.mode === 'debug' && <ConsolePanel state={state} onEvaluate={expression => void store.evaluateConsole(expression)} />}
					<Timeline
						state={state}
						onSelectSnapshot={index => store.selectSnapshot(index)}
						onSelectManualStep={index => store.selectManualStep(index)}
						onBackToLive={backToLive}
						onRecordStep={() => store.recordManualStep()}
						onTogglePlayback={() => store.togglePlayback()}
						onSpeedChange={speed => store.setPlaybackSpeed(speed)}
					/>
				</main>
				{!(state.mode === 'debug' && state.canvasView === 'static') && (
					<Inspector
						state={state}
						onSelectFrame={(threadId, frameId) => store.selectFrame(threadId, frameId)}
						onToggleBreakpoint={(source, line) => store.toggleBreakpoint(source, line)}
						onRemoveBreakpoint={id => store.removeBreakpoint(id)}
						onDeleteNode={id => store.deleteManualNode(id)}
						onAddWatch={expression => store.addWatch(expression)}
						onRemoveWatch={id => store.removeWatch(id)}
						onToggleWatch={id => store.toggleWatch(id)}
						onLoadVariablePage={(container, page) => store.loadVariablePage(container, page)}
					/>
				)}
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