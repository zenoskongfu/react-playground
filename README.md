# React Playground

一个仿 VSCode 风格的在线代码编辑器，支持实时编译 TSX/JSX 并在预览面板中渲染结果。

```bash
npm install
npm run dev
```

---

## 目录

- [整体架构](#整体架构)
- [目录结构](#目录结构)
- [数据流全景](#数据流全景)
- [核心模块解说](#核心模块解说)
  - [PlaygroundContext — 状态总线](#playgroundcontext--状态总线)
  - [useWorkspaceFiles — 文件管理](#useworkspacefiles--文件管理)
  - [useLayoutState — 布局状态](#uselayoutstate--布局状态)
  - [useAiAssistant — AI 交互](#useaiassistant--ai-交互)
  - [useCommands — 命令注册表](#usecommands--命令注册表)
  - [WorkbenchEditor — Monaco 编辑器](#workbencheditor--monaco-编辑器)
  - [compiler.worker — Babel 编译器](#compilerworker--babel-编译器)
  - [PreviewView — 实时预览](#previewview--实时预览)
- [关键技术问题 Q&A](#关键技术问题-qa)

---

## 整体架构

项目参考 [VSCode OSS](https://github.com/microsoft/vscode) 的分层约定组织代码：

```
src/ReactPlayground/
├── PlaygroundContext.tsx        # 类型定义 + 全局 Context Provider
├── workbench/
│   ├── services/                # 服务层：纯逻辑 hook，无 JSX
│   │   ├── workspace/           # 文件管理、持久化
│   │   ├── layout/              # 主题、面板、活动栏状态
│   │   ├── ai/                  # AI 交互、WorkspaceEdit 审查
│   │   └── commands/            # 命令注册表
│   ├── browser/
│   │   ├── parts/               # 各 UI 区域（titlebar、activitybar、editor、panel、statusbar）
│   │   └── workbench.tsx        # 主布局骨架（拼装所有 part）
│   └── contrib/                 # 独立功能贡献
│       ├── explorer/            # 文件树
│       ├── commandPalette/      # 命令面板
│       ├── preview/             # 实时预览 + 编译器 Worker
│       └── aiAssistant/         # AI 操作栏
└── components/
    └── Message/                 # 通用错误提示组件
```

与 VSCode OSS 的对应关系：

| 本项目 | VSCode OSS 对应层 |
|--------|------------------|
| `useWorkspaceFiles` | `IWorkspaceContextService` + `IEditorService` |
| `useLayoutState` | `ILayoutService` |
| `useCommands` | `ICommandService` |
| `PlaygroundContext.Provider` | `IInstantiationService`（服务注入容器） |
| `compiler.worker.ts` | Extension Host Worker（未来迁移目标） |
| `workspaceFiles` state | Virtual File System（`vscode.workspace.fs`）|

---

## 目录结构

```
workbench/
├── services/                    # 纯逻辑层
│   ├── workspace/
│   │   └── useWorkspaceFiles.ts # ⭐ 最核心的 hook
│   ├── layout/
│   │   └── useLayoutState.ts
│   ├── ai/
│   │   └── useAiAssistant.ts
│   └── commands/
│       └── useCommands.ts
│
├── browser/
│   ├── workbench.tsx            # 主布局（allotment 分栏）
│   └── parts/
│       ├── titlebar/            # 标题栏（命令中心入口）
│       ├── activitybar/         # 左侧图标栏
│       ├── editor/
│       │   ├── workbenchEditor.tsx  # Monaco 编辑器
│       │   └── editorGroupsView.tsx # 编辑器标签栏
│       ├── panel/               # 底部面板（Preview / Problems / Output）
│       └── statusbar/           # 底部状态栏
│
└── contrib/
    ├── explorer/browser/
    │   ├── explorerView.tsx     # 侧边栏（文件树 + AI 聊天）
    │   └── fileTree.tsx         # 文件树节点渲染
    ├── commandPalette/browser/
    │   └── commandPalettePart.tsx
    ├── preview/browser/
    │   ├── previewView.tsx      # 预览面板（iframe）
    │   ├── compiler.worker.ts   # Babel 编译 Worker
    │   └── iframe.html          # 预览 HTML 模板
    └── aiAssistant/browser/
        └── aiActionBar.tsx      # AI 快捷操作按钮栏
```

---

## 数据流全景

```
用户输入
   │
   ▼
Monaco onDidChangeContent
   │
   ▼
updateFileValue(path, value)     ← useWorkspaceFiles
   │  写入 workspaceFiles state，dirty = true
   ▼
files（useMemo 派生）            ← workspaceToFiles(workspaceFiles)
   │  省略 dirty，只保留 value/language
   ▼
┌──────────────────────────────────────────────────┐
│                  两条并行更新链路                    │
│                                                  │
│  持久化链路（useWorkspaceFiles）                    │
│    files 变化 → 1500ms 防抖 → localStorage + hash │
│                                                  │
│  编译链路（PreviewView）                           │
│    files 变化 → 500ms 防抖 → Worker.postMessage   │
│      → Babel 编译 → COMPILED_CODE                │
│      → setIframeContent → iframe srcDoc 更新      │
└──────────────────────────────────────────────────┘
```

---

## 核心模块解说

### PlaygroundContext — 状态总线

**文件**：[`PlaygroundContext.tsx`](src/ReactPlayground/PlaygroundContext.tsx)

这个文件做两件事：

1. **类型中心**：所有跨文件的共享类型都在这里定义（`WorkspaceFile`、`WorkspaceEdit`、`WorkbenchCommand` 等），其他文件通过 `import type` 引入。

2. **服务组合**：`PlaygroundProvider` 把 4 个 service hook 组合成一个统一的 Context 值：

```tsx
const workspace = useWorkspaceFiles()   // 文件管理
const layout    = useLayoutState()      // 布局状态
const ai        = useAiAssistant(...)   // AI 交互
const { commands, executeCommand } = useCommands(...)

<PlaygroundContext.Provider value={{ ...workspace, ...layout, ...ai, commands, executeCommand }}>
```

消费方（任意子组件）：

```tsx
const { files, selectedFileName, setSelectedFileName } = useContext(PlaygroundContext)
```

---

### useWorkspaceFiles — 文件管理

**文件**：[`workbench/services/workspace/useWorkspaceFiles.ts`](src/ReactPlayground/workbench/services/workspace/useWorkspaceFiles.ts)

最核心的 hook，管理工作区所有文件。

#### 状态初始化优先级

```
URL hash（分享链接）> localStorage（上次编辑）> 内置模板
```

初始化时调用 `isStaleWorkspace()` 检测是否是旧版数据并丢弃。

#### 两套文件格式

| 格式 | 用途 | 包含字段 |
|------|------|---------|
| `WorkspaceFile`（运行时） | UI 渲染、编辑器状态 | path, name, value, language, dirty, readonly |
| `Files`（精简版） | 编译器、持久化 | name, value, language |

两者通过 `workspaceToFiles` / `filesToWorkspace` 互相转换。

> **为什么要两套格式？**
> `dirty` 是 UI 状态，不应该影响编译结果（避免每次清除 dirty 标志都触发重新编译）。
> 如果把 `dirty` 包含在编译器拿到的 `files` 里，会引发无限更新循环。

#### 持久化防抖

```
files 变化 → clearTimeout → setTimeout(1500ms) → 写 localStorage + URL hash → 清除 dirty
```

不用 debounce 库的原因：`useEffect(debounce(fn), [files])` 每次执行都创建新的防抖函数，旧定时器被丢弃，防抖从来不触发。正确做法是手动管理 `setTimeout` + `clearTimeout`。

#### `beforeunload` 强制写入

持久化是 1500ms 延迟的，用户关闭页面时定时器可能还没触发。注册 `beforeunload` 事件，在页面关闭前同步写一次 localStorage。

> 注意：`beforeunload` 的回调通过 `filesRef` 读取最新数据，而不是直接读 `files`。
> 原因是事件回调是闭包，注册时捕获的 `files` 在之后的更新中不会自动变化（"过期闭包"问题），
> 通过 `ref` 可以始终读到最新值。

---

### useLayoutState — 布局状态

**文件**：[`workbench/services/layout/useLayoutState.ts`](src/ReactPlayground/workbench/services/layout/useLayoutState.ts)

管理所有"界面显示状态"，包括：颜色主题、活动栏选中项、底部面板显示/切换、命令面板开关。

同时在这里注册全局 `Cmd+Shift+P` 快捷键——Monaco 编辑器会拦截它，`WorkbenchEditor.tsx` 里用 `addCommand` 把它转发给 `window`，确保在编辑器内也能触发命令面板。

---

### useAiAssistant — AI 交互

**文件**：[`workbench/services/ai/useAiAssistant.ts`](src/ReactPlayground/workbench/services/ai/useAiAssistant.ts)

管理 AI 聊天消息和 WorkspaceEdit 审查流程。

#### WorkspaceEdit 流程

```
用户点击 "Explain / Generate / Refactor"
   ↓
askAi(action) → 生成 pendingEdit（含 before/after diff）
   ↓
WorkbenchEditor 切换到 Diff 模式显示变更
   ↓
用户点击 Apply → applyWorkspaceEdit() → 写入 workspaceFiles
           Discard → discardWorkspaceEdit() → 清除 pendingEdit
```

> **当前是 Mock 实现**：`askAi` 里的 AI 响应是硬编码的，未接入真实 LLM API。
> 整个流程（diff 审查、apply/discard）是完整的，接入真实 API 时只需替换 `after` 的生成逻辑。

---

### useCommands — 命令注册表

**文件**：[`workbench/services/commands/useCommands.ts`](src/ReactPlayground/workbench/services/commands/useCommands.ts)

维护一个命令列表，通过命令面板（Cmd+Shift+P）或 `executeCommand(id)` 触发。

目前注册的命令：

| ID | 描述 | 快捷键 |
|----|------|--------|
| `workbench.action.showCommands` | 打开命令面板 | ⌘⇧P |
| `workbench.action.openPreview` | 显示预览面板 | - |
| `workbench.action.toggleTheme` | 切换主题 | - |
| `editor.action.formatDocument` | 格式化文档 | ⌘J |
| `ai.explainSelection` | AI 解释选中内容 | - |
| `ai.generateComponent` | AI 生成组件 | - |
| `workspace.applyEdit` | 应用 AI 变更 | - |

---

### WorkbenchEditor — Monaco 编辑器

**文件**：[`workbench/browser/parts/editor/workbenchEditor.tsx`](src/ReactPlayground/workbench/browser/parts/editor/workbenchEditor.tsx)

#### TextModel 缓存

Monaco 里每个文件对应一个 `ITextModel` 对象，它保存文件内容、撤销历史、光标位置。

文件切换时用 `editor.setModel(model)` 而不是销毁/重建编辑器——这样每个文件的撤销历史独立保留。

所有文件共享一个编辑器实例，用 `modelCache` 追踪我们创建的 model，便于文件删除/重命名时调用 `releaseModel()` 清理。

#### 解决焦点丢失问题

**问题根因**：`onFormat` 在父组件里是内联箭头函数（每次渲染都是新引用），如果编辑器创建 effect 依赖 `[onFormat]`，每次 `files` 变化 → 父组件重渲染 → `onFormat` 引用变化 → effect 清理并重建编辑器 → 新编辑器无焦点 → 输入中断。

**修复方式**：用 `useRef` 保存 `onFormat`，编辑器只创建一次（`[]` 依赖），快捷键处理器通过 `ref.current()` 调用，始终读到最新版本：

```tsx
const onFormatRef = useRef(onFormat)
useEffect(() => { onFormatRef.current = onFormat }, [onFormat])

// 编辑器创建 effect 的依赖数组是 []，不再因 onFormat 变化而重建
editorRef.current.addCommand(KeyMod.CtrlCmd | KeyCode.KeyJ, () => onFormatRef.current())
```

#### 预建所有文件的 Model

Monaco TypeScript 服务只能分析"已有 Model"的文件。如果 A.tsx 引用了 B.tsx，但 B.tsx 还没被打开过（没有 Model），TypeScript 就会报 `Cannot find module './B'` 的误报。

解决：工作区文件列表变化时，为所有文件预建 Monaco Model：

```tsx
useEffect(() => {
  Object.values(allFiles).forEach(f => {
    if (!monaco.editor.getModel(uriForPath(f.path))) {
      monaco.editor.createModel(f.value, f.language, uriForPath(f.path))
    }
  })
}, [allFiles])
```

#### `fixedOverflowWidgets: true`

Monaco 的悬浮提示（hover card）默认在 editor 容器内渲染，受 `overflow: hidden` 裁切，会被上方的标签栏遮住。开启此选项后，这些 widget 渲染到 `document.body`，不受裁切。

---

### compiler.worker — Babel 编译器

**文件**：[`workbench/contrib/preview/browser/compiler.worker.ts`](src/ReactPlayground/workbench/contrib/preview/browser/compiler.worker.ts)

运行在独立 Web Worker 线程里，避免 Babel 编译阻塞主线程 UI。

#### 编译流程

```
收到 { files, requestId }
   ↓
compile(files)
   ├── 找到入口文件（src/main.tsx）
   └── babelTransform(filename, code, files)
         ├── 添加 React import（如果缺少的话）
         ├── Babel transform（react + typescript presets）
         └── customResolver 插件（遍历 import 声明）
               ├── .css 文件 → css2Js()  → blob URL
               ├── .json 文件 → json2Js() → blob URL
               └── .ts/.tsx 文件 → 递归 babelTransform → blob URL
   ↓
postMessage({ type: 'COMPILED_CODE', data, requestId, blobUrls })
```

#### Blob URL 追踪

每次 `import` 的本地模块都会通过 `URL.createObjectURL()` 变成 blob URL，让浏览器能 `import` 它。这些 URL 不自动释放，需要手动 `revokeObjectURL()`。

- 编译成功：把 URL 列表发回主线程，由主线程决定何时回收（等 iframe 加载完新页面后）
- 编译失败：立即在 Worker 里回收（失败结果不会被 iframe 使用）

#### `customResolver`：核心 Babel 插件

这个插件实现了浏览器端的模块解析。当 Babel 解析 AST 遇到 `import './Foo'` 时，把路径替换成对应的 blob URL，让浏览器能直接 `import` 内存中的内容：

```
import Button from './Button'
   ↓（customResolver 处理后）
import Button from 'blob:http://localhost:5173/abc123'
```

---

### PreviewView — 实时预览

**文件**：[`workbench/contrib/preview/browser/previewView.tsx`](src/ReactPlayground/workbench/contrib/preview/browser/previewView.tsx)

#### 防抖调度（关键模式）

**错误写法**（常见误区）：
```tsx
// ❌ 每次 files 变化 useEffect 重新执行，都创建新的 debounce 函数，旧定时器丢失
useEffect(debounce(() => worker.postMessage(files), 500), [files])
```

**正确写法**：
```tsx
// ✅ cleanup 函数清除上一次定时器，每次 files 变化重设，这才是真正的防抖
useEffect(() => {
  clearTimeout(scheduleTimerRef.current)
  scheduleTimerRef.current = setTimeout(() => {
    worker.postMessage({ files, requestId: ++latestRequestIdRef.current })
  }, 500)
}, [files])
```

#### requestId 防"时间旅行"

用户快速输入时，可能同时有多个编译请求在 Worker 里排队。第 3 次编译可能比第 2 次先返回：

```
请求 #1 发出
请求 #2 发出（覆盖 #1 还未完成）
请求 #2 完成 → iframe 显示最新内容 ✅
请求 #1 完成 → 不能用！它的结果是旧的代码
```

通过 `requestId` 识别并丢弃过期响应：
```tsx
if (data.requestId !== latestRequestIdRef.current) return
```

#### 看门狗（Watchdog）

Babel 在处理某些极端代码时可能卡死（如无限递归的类型推断）。发出编译请求后启动 5 秒定时器，如果没有收到回复就 `terminate()` 旧 Worker 并创建新的：

```tsx
watchdogRef.current = setTimeout(() => setupWorker(), 5000)
// 收到 Worker 响应时：clearTimeout(watchdogRef.current)
```

#### 错误不刷新预览

编译失败时，**不更新** `iframeContent`——用户在输入不完整的代码时（如 `import $`），预览保留上一次成功的结果，不会出现空白页：

```tsx
if (data.type === 'COMPILE_ERROR') {
  setError(message)
  // 故意不写 setIframeContent()，保留上次成功预览
}
```

---

## 关键技术问题 Q&A

**Q：为什么 `useRef` 在这里比 `useState` 更合适？**

A：当数据需要被"事件回调"或"闭包"访问，但变化时不需要触发渲染时，用 `useRef`。
典型场景：`requestId`（只需最新值，不需要渲染）、`filesRef`（给 beforeunload 用，不需要渲染）、`workerRef`（Worker 实例，不影响 UI）。

---

**Q：`workspaceToFiles` 为什么不包含 `dirty` 字段？**

A：`files` 是编译器和持久化 effect 的依赖。如果 `dirty` 包含在 `files` 里，清除 `dirty` 就会使 `files` 变化，触发持久化 effect，然后再清除 `dirty`，形成无限循环。把 `dirty` 从 `files` 里排除，让它只存在于 `workspaceFiles`（UI 层），就切断了这个循环。

---

**Q：Monaco 为什么需要维护 `modelCache`？**

A：Monaco 内部有全局 model 注册表（`monaco.editor.getModel(uri)`），但它不暴露"哪些 model 是我们创建的"。文件被删除/重命名时，我们需要清理对应的 model，`modelCache` 提供了精准清理的入口。

---

**Q：`releaseModel` 是从 editor 层导出给 workspace 层使用的，这有没有问题？**

A：这是单向的跨层调用（workspace 调用 editor），不构成循环依赖。从模块加载角度看：`PlaygroundContext → useWorkspaceFiles → workbenchEditor → PlaygroundContext`，最后这条 `workbenchEditor → PlaygroundContext` 是 TypeScript 类型 import（编译后被抹除），运行时模块图里不存在，所以不会形成加载死锁。

---

**Q：`Cmd+Shift+P` 快捷键是怎么在 Monaco 编辑器内部触发的？**

A：Monaco 会拦截很多快捷键，包括 `Cmd+Shift+P`。我们在 Monaco 的 `addCommand` 里把它转发给 `window`，`useLayoutState` 里注册的 `window.addEventListener('keydown', ...)` 就能接收到，进而打开命令面板。
