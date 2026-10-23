import type { StudioMode, StudioState } from '@/state/studio-store';

interface FileSidebarProps {
	readonly state: StudioState;
	readonly onOpenFile: (path: string) => void;
	readonly onMode: (mode: StudioMode) => void;
	readonly onAddCard: (kind: 'array' | 'list' | 'dict' | 'variable' | 'sticky') => void;
	readonly onCreateWorkbench: () => void;
	readonly onOpenWorkbench: (path: string) => void;
}

export function FileSidebar({ state, onOpenFile, onMode, onAddCard, onCreateWorkbench, onOpenWorkbench }: FileSidebarProps) {
	return (
		<aside className="files-pane">
			<div className="pane-heading">
				<span>文件</span>
				<span className="pane-count">{state.files.length}</span>
			</div>
			<div className="file-list">
				{state.files.map(file => (
					<button
						type="button"
						key={file.path}
						className={`file-row ${state.activeFile === file.path ? 'is-active' : ''}`}
						onClick={() => onOpenFile(file.path)}
					>
						<span className={`file-icon file-icon-${file.language ?? 'text'}`} />
						<span className="file-name">{file.name}</span>
						{file.path === state.activeFile && state.editorText !== state.savedText && <span className="dirty-dot" title="有未保存修改" />}
					</button>
				))}
			</div>
			<div className="pane-divider" />
			<div className="pane-heading">
				<span>画板</span>
				<button type="button" className="pane-action" onClick={() => onMode('manual')}>手绘</button>
			</div>
			<button type="button" className={`board-row ${state.mode === 'manual' ? 'is-active' : ''}`} onClick={() => onMode('manual')}>
				<span className="board-glyph" aria-hidden="true" />
				<span className="board-copy">
					<strong>{state.manualBoard.title}</strong>
					<small>{state.manualBoard.scene.nodes.length} 个对象 · {state.manualBoard.steps.length} 步</small>
				</span>
			</button>
			<div className="pane-divider" />
			<div className="pane-heading">
				<span>函数工作台</span>
				<button type="button" className="pane-action" onClick={onCreateWorkbench} disabled={!state.activeFile.toLowerCase().endsWith('.py')} title={state.activeFile.toLowerCase().endsWith('.py') ? '从当前 Python 文件创建工作台' : '工作台目前只支持 Python'}>新建</button>
			</div>
			{state.workbench ? (
				<button type="button" className={`board-row ${state.activeFile === state.workbench.path ? 'is-active' : ''}`} onClick={() => onOpenWorkbench(state.workbench!.path)}>
					<span className="workbench-glyph">ƒ</span>
					<span className="board-copy">
						<strong>函数工作台</strong>
						<small>继承自 {state.workbench.sourceFile || '源文件'}</small>
					</span>
				</button>
			) : (
				<p className="sidebar-note">从当前文件创建一个干净的函数/类。运行时会继承源文件的 import 和顶层定义。</p>
			)}
			<div className="pane-divider" />
			<div className="pane-heading">
				<span>手绘工具</span>
				<span className="pane-hint">新增卡片</span>
			</div>
			<div className="manual-tools">
				<button type="button" onClick={() => onAddCard('array')}>数组</button>
				<button type="button" onClick={() => onAddCard('list')}>列表</button>
				<button type="button" onClick={() => onAddCard('dict')}>字典</button>
				<button type="button" onClick={() => onAddCard('variable')}>变量</button>
				<button type="button" onClick={() => onAddCard('sticky')}>便签</button>
			</div>
			<div className="pane-divider" />
			<div className="pane-heading">
				<span>语言</span>
				<span className="pane-hint">适配器</span>
			</div>
			<div className="language-list">
				{state.languages.map(language => (
					<div className="language-row" key={language.id} title={`${language.adapter} · ${language.extensions.join(', ')}`}>
						<span>{language.name}</span>
						<small className={`language-status is-${language.status}`}>{language.status === 'demo' ? '演示' : language.status === 'available' ? '可用' : '未安装'}</small>
					</div>
				))}
			</div>
			<div className="sidebar-footer">
				<span className={`host-dot is-${state.hostMode}`} />
				{state.hostMode === 'demo' ? '脚本化演示宿主' : '本地桌面宿主'}
			</div>
		</aside>
	);
}