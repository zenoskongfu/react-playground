# React Playground

一个仿 VSCode 风格的在线代码编辑器，支持实时编译 TSX/JSX 并在预览面板中渲染结果。

```bash
pnpm install
pnpm dev
```

---

## 目录

- [整体架构](#整体架构)
- [目录结构](#目录结构)
- [数据流全景](#数据流全景)
- [核心模块解说](#核心模块解说)
  - [PlaygroundContext — 类型注册表](#playgroundcontext--类型注册表)
  - [workspaceStore — 文件管理](#workspacestore--文件管理)
  - [layoutStore — 布局状态](#layoutstore--布局状态)
  - [aiStore — AI 交互](#aistore--ai-交互)
  - [commandsStore — 命令注册表](#commandsstore--命令注册表)
  - [WorkbenchEditor — Monaco 编辑器](#workbencheditor--monaco-编辑器)
  - [compiler.worker — Babel 编译器](#compilerworker--babel-编译器)
  - [PreviewView — 实时预览](#previewview--实时预览)
- [关键技术问题 Q&A](#关键技术问题-qa)

---

## 整体架构

项目参考 [VSCode OSS](https://github.com/microsoft/vscode) 的分层约定组织代码，状态管理使用 [Zustand](https://zustand.docs.pmnd.rs/)：

```
src/ReactPlayground/
├── PlaygroundContext.tsx        # 纯类型文件（Type Hub），无运行时代码
├── workbench/
│   ├── stores/                  # Zustand 状态层（取代原来的 services/ hooks）
│   │   ├── workspaceStore.ts    # 文件管理、持久化
│   │   ├── layoutStore.ts       # 主题、面板、活动栏状态
│   │   ├── aiStore.ts           # AI 交互、WorkspaceEdit 审查
│   │   └── commandsStore.ts     # 命令注册表
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
| `workspaceStore` | `IWorkspaceContextService` + `IEditorService` |
| `layoutStore` | `ILayoutService` |
| `commandsStore` | `ICommandService` |
| `PlaygroundContext.tsx`（类型） | 各服务的接口定义（`IXxxService` 接口文件） |
| `compiler.worker.ts` | Extension Host Worker（未来迁移目标） |
| `workspaceFiles` state | Virtual File System（`vscode.workspace.fs`） |

---

## 目录结构

```
workbench/
├── stores/                      # 状态层（Zustand）
│   ├── workspaceStore.ts        # ⭐ 最核心的 store
│   ├── layoutStore.ts
│   ├── aiStore.ts
│   └── commandsStore.ts
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
workspaceStore.updateFileValue(path, value)
   │  写入 workspaceFiles，同步更新 files（派生值），dirty = true
   ▼
files 变化（store 内部同步更新）
   │
   ▼
┌──────────────────────────────────────────────────────────┐
│                    两条并行更新链路                          │
│                                                          │
│  持久化链路（workspaceStore.subscribe 模块级）              │
│    files 变化 → 1500ms 防抖 → localStorage + URL hash     │
│    → 清除 dirty 标志                                       │
│                                                          │
│  编译链路（PreviewView 订阅 files）                         │
│    useWorkspaceStore(s => s.files) 变化                   │
│    → 500ms 防抖 → Worker.postMessage({ files, requestId }) │
│    → Babel 编译 → COMPILED_CODE                           │
│    → setIframeContent → iframe srcDoc 更新                │
└──────────────────────────────────────────────────────────┘
```

**Zustand 订阅的精确性**：`PreviewView` 只订阅 `files`，`StatusbarPart` 只订阅 `selectedFileName`。用户每次击键时，`workspaceFiles` 变化会同步更新 `files`，只有真正订阅了这两个字段的组件才会重渲染——`ActivitybarPart`、`StatusbarPart`（只读 selectedFileName）不受影响，避免了 React Context 模式下"任何状态变化 → 所有消费者重渲染"的问题。

---

## 核心模块解说

### PlaygroundContext — 类型注册表

**文件**：[`PlaygroundContext.tsx`](src/ReactPlayground/PlaygroundContext.tsx)

迁移到 Zustand 后，这个文件不再有任何运行时代码，只保留所有跨文件共享的 TypeScript 类型定义。相当于项目的"类型注册表"：

- `WorkspaceFile` / `Files` — 运行时文件对象和持久化格式
- `WorkspaceEdit` — AI 生成的待审查变更
- `WorkbenchCommand` — 命令注册表中的单条命令
- `Theme` / `ActivityView` / `PanelView` — 布局相关枚举类型

其他文件通过 `import type` 引入这里的类型，类型集中在一处便于维护。

> **与原来的区别**：之前这个文件还包含 `PlaygroundProvider` 和 `PlaygroundContext`，负责把 4 个 hook 的返回值组合成一个 Context 值注入子组件树。迁移到 Zustand 后 Provider 不再需要，`App.tsx` 里也不再有任何包裹组件。

---

### workspaceStore — 文件管理

**文件**：[`workbench/stores/workspaceStore.ts`](src/ReactPlayground/workbench/stores/workspaceStore.ts)

最核心的 store，管理工作区所有文件。

#### 状态初始化优先级

```
URL hash（分享链接）> localStorage（上次编辑）> 内置模板
```

初始化时调用 `isStaleWorkspace()` 检测旧版数据格式并丢弃（旧版文件放在根目录、含 `@ts-nocheck`、引用旧版 esm.sh 等特征）。

#### 三个派生字段同步更新

store 里的 `files` 和 `tree` 是 `workspaceFiles` 的派生值，每次 `setWorkspaceFiles` 都在同一次 `set` 里同步更新三者：

```ts
setWorkspaceFiles: (updater) => {
  set((state) => {
    const next = typeof updater === 'function' ? updater(state.workspaceFiles) : updater
    return { workspaceFiles: next, files: workspaceToFiles(next), tree: buildTree(next) }
  })
}
```

这样订阅 `files` 的组件（编译器触发方）和订阅 `workspaceFiles` 的组件（文件树）可以各自独立精准订阅。

#### 两套文件格式

| 格式 | 用途 | 包含字段 |
|------|------|---------|
| `WorkspaceFile`（运行时） | UI 渲染、编辑器状态 | path, name, value, language, dirty, readonly |
| `Files`（精简版） | 编译器、持久化 | name, value, language |

> **为什么要两套格式？**
> `dirty` 是 UI 状态，不应影响编译器。如果把 `dirty` 放进 `files`，清除 dirty 就会触发 `files` 变化，进而重新触发持久化 effect 和编译器——形成无限循环。

#### 持久化防抖（模块级 subscribe）

```
files 变化（store 内部同步）
   → workspaceStore.subscribe(s => s.files, handler)  ← 模块加载时注册，只注册一次
   → clearTimeout → setTimeout(1500ms)
   → 写 localStorage + URL hash
   → 清除 dirty 标志
```

> 为什么放模块级而不是 `useEffect`？组件 mount/unmount 会导致重复订阅或短暂空窗，store 模块只加载一次，subscribe 的生命周期和 store 绑定，不受组件生命周期影响。

#### `beforeunload` 强制写入

持久化是 1500ms 延迟的，用户关闭页面时定时器可能还没触发。在模块级注册 `beforeunload`，直接读 `useWorkspaceStore.getState().files`（总是最新值，没有过期闭包问题）。

---

### layoutStore — 布局状态

**文件**：[`workbench/stores/layoutStore.ts`](src/ReactPlayground/workbench/stores/layoutStore.ts)

管理所有"界面显示状态"：颜色主题、活动栏选中项、底部面板显示/切换、命令面板开关。

`Cmd+Shift+P` 快捷键的 `keydown` 监听器也在模块级注册（与之前放在 `useEffect` 里的逻辑一样，只是生命周期换成了模块级）。Monaco 编辑器会拦截这个快捷键，`WorkbenchEditor.tsx` 里通过 `addCommand` 把它转发给 `window`，确保在编辑器内也能触发命令面板。

---

### aiStore — AI 交互

**文件**：[`workbench/stores/aiStore.ts`](src/ReactPlayground/workbench/stores/aiStore.ts)

管理 AI 聊天消息和 WorkspaceEdit 审查流程。

#### WorkspaceEdit 流程

```
用户点击 "Explain / Generate / Refactor"
   ↓
aiStore.askAi(action) → 读取 workspaceStore.getState() 获取当前文件内容
   ↓
生成 pendingEdit（含 before/after diff）→ set({ pendingEdit })
   ↓
WorkbenchEditor 订阅 pendingEdit → 切换到 Diff 模式显示变更
   ↓
用户点击 Apply  → applyWorkspaceEdit() → workspaceStore.getState().setWorkspaceFiles(...)
           Discard → discardWorkspaceEdit() → set({ pendingEdit: null })
```

> **与原 hook 的关键区别**：原来 `useAiAssistant` 需要通过 slice 参数接收 workspace 和 layout 的能力（因为 hook 不能消费自己所在 Provider 的 Context）。现在 aiStore 直接调用 `useWorkspaceStore.getState()` 和 `useLayoutStore.getState()`，`getState()` 始终返回最新值，没有过期闭包问题，也不需要传参。

> **当前是 Mock 实现**：`askAi` 里的 AI 响应是硬编码的，未接入真实 LLM API。整个流程（diff 审查、apply/discard）是完整的，接入真实 API 时只需替换 `after` 的生成逻辑。

---

### commandsStore — 命令注册表

**文件**：[`workbench/stores/commandsStore.ts`](src/ReactPlayground/workbench/stores/commandsStore.ts)

维护一个命令列表，通过命令面板（`Cmd+Shift+P`）或 `executeCommand(id)` 触发。

目前注册的命令：

| ID | 描述 | 快捷键 |
|----|------|--------|
| `workbench.action.showCommands` | 打开命令面板 | ⌘⇧P |
| `workbench.action.openPreview` | 显示预览面板 | — |
| `workbench.action.toggleTheme` | 切换主题 | — |
| `editor.action.formatDocument` | 格式化文档 | ⌘J |
| `ai.explainSelection` | AI 解释选中内容 | — |
| `ai.generateComponent` | AI 生成组件 | — |
| `workspace.applyEdit` | 应用 AI 变更 | — |

> **与原 hook 的关键区别**：原来 `useCommands` 用 `useMemo` 管理 commands 数组，因为 `run` 函数通过闭包捕获外部状态，状态变化时必须重建整个数组才能读到新值。现在每个 `run` 在执行时调用 `getState()`，commands 数组是静态的——store 初始化时创建一次，永远不变，不需要 `useMemo`。

---

### WorkbenchEditor — Monaco 编辑器

**文件**：[`workbench/browser/parts/editor/workbenchEditor.tsx`](src/ReactPlayground/workbench/browser/parts/editor/workbenchEditor.tsx)

#### TextModel 缓存

Monaco 里每个文件对应一个 `ITextModel` 对象，保存文件内容、撤销历史、光标位置。

文件切换时用 `editor.setModel(model)` 而不是销毁/重建编辑器——每个文件的撤销历史独立保留。所有文件共享一个编辑器实例，用 `modelCache` 追踪创建的 model，便于文件删除/重命名时调用 `releaseModel()` 清理。

#### 解决焦点丢失问题

**问题根因**：`onFormat` 在父组件里是内联箭头函数（每次渲染都是新引用），如果编辑器创建 effect 依赖 `[onFormat]`，每次 `workspaceFiles` 变化 → 父组件重渲染 → `onFormat` 引用变化 → effect 清理并重建编辑器 → 新编辑器无焦点 → 输入中断。

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

- 编译成功：把 URL 列表发回主线程，由主线程在下次成功编译时回收（等 iframe 加载完新页面后）
- 编译失败：立即在 Worker 里回收（失败结果不会被 iframe 使用）

#### `customResolver`：核心 Babel 插件

这个插件实现了浏览器端的模块解析。当 Babel 解析 AST 遇到 `import './Foo'` 时，把路径替换成对应的 blob URL：

```
import Button from './Button'
   ↓（customResolver 处理后）
import Button from 'blob:http://localhost:5173/abc123'
```

---

### PreviewView — 实时预览

**文件**：[`workbench/contrib/preview/browser/previewView.tsx`](src/ReactPlayground/workbench/contrib/preview/browser/previewView.tsx)

#### 精准订阅

```tsx
const files = useWorkspaceStore((s) => s.files)
```

只订阅 `files`，不订阅 `workspaceFiles`。`files` 是精简版（不含 dirty），只有文件内容真正变化时才更新，不会因 dirty 标志的切换而触发额外渲染。

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

用户快速输入时，可能同时有多个编译请求在 Worker 里排队。早发出的请求编译更慢，可能在新请求完成之后才返回，导致 iframe 显示旧代码。通过 `requestId` 识别并丢弃过期响应：

```tsx
if (data.requestId !== latestRequestIdRef.current) return
```

#### 看门狗（Watchdog）

Babel 在处理某些极端代码时可能卡死。发出编译请求后启动 5 秒定时器，没收到回复就 `terminate()` 旧 Worker 并创建新的：

```tsx
watchdogRef.current = setTimeout(() => setupWorker(), 5000)
// 收到 Worker 响应时：clearTimeout(watchdogRef.current)
```

#### 错误不刷新预览

编译失败时，**不更新** `iframeContent`——用户在输入不完整代码时，预览保留上一次成功的结果，不会出现空白页：

```tsx
if (data.type === 'COMPILE_ERROR') {
  setError(message)
  // 故意不写 setIframeContent()，保留上次成功预览
}
```

---

## 关键技术问题 Q&A

**Q：为什么从 React Context 迁移到 Zustand？**

A：React Context 的问题是"任何状态变化会让所有消费者重渲染"。用 Context 时，用户每次击键都会更新 `workspaceFiles`，进而导致 `ActivitybarPart`、`StatusbarPart`、`CommandPalette` 等和文件内容完全无关的组件重渲染。

Zustand 的 selector 机制让每个组件只订阅自己需要的字段：`StatusbarPart` 订阅 `selectedFileName`，`PreviewView` 订阅 `files`，它们之间互不影响。

---

**Q：为什么 `commandsStore` 不需要 `useMemo`，而原来的 `useCommands` hook 需要？**

A：原来 `run` 函数通过 React 闭包捕获外部状态（如 `selectedFileName`），状态变化后旧闭包里的值已经过期，必须重建整个 commands 数组（`useMemo`）才能让 `run` 读到新值。

Zustand store 里的 `run` 在执行时调用 `getState()`，始终读到最新状态，没有闭包过期问题。commands 数组是静态的，store 初始化时创建一次，不需要 `useMemo`，也不会引起任何组件重渲染。

---

**Q：为什么 `useRef` 在这里比 `useState` 更合适？**

A：当数据需要被"事件回调"或"闭包"访问，但变化时不需要触发渲染时，用 `useRef`。
典型场景：`requestId`（只需最新值，不需要渲染）、`workerRef`（Worker 实例，不影响 UI）。

Zustand 里则换成 `getState()`——store actions 里随时调用 `getState()` 读最新值，替代了大量 `useRef` 的用途。

---

**Q：`workspaceToFiles` 为什么不包含 `dirty` 字段？**

A：`files` 是编译器和持久化 subscribe 的依赖。如果 `dirty` 包含在 `files` 里，清除 `dirty` 就会使 `files` 变化，触发持久化 subscribe，然后再清除 `dirty`，形成无限循环。把 `dirty` 从 `files` 里排除，让它只存在于 `workspaceFiles`（UI 层），就切断了这个循环。

---

**Q：Monaco 为什么需要维护 `modelCache`？**

A：Monaco 内部有全局 model 注册表（`monaco.editor.getModel(uri)`），但它不暴露"哪些 model 是我们创建的"。文件被删除/重命名时，我们需要精准清理对应的 model，`modelCache` 提供了这个入口。

`releaseModel` 从 editor 层导出，`workspaceStore` 在 `removeFile` / `updateFileName` 时通过动态 `import()` 调用它（延迟加载，避免循环依赖，因为 workbenchEditor 在类型层面依赖 PlaygroundContext，而 PlaygroundContext 的类型又在 workspaceStore 里被引用）。

---

**Q：`Cmd+Shift+P` 快捷键是怎么在 Monaco 编辑器内部触发的？**

A：Monaco 会拦截很多快捷键，包括 `Cmd+Shift+P`。我们在 Monaco 的 `addCommand` 里把它转发给 `window`，`layoutStore` 模块级注册的 `window.addEventListener('keydown', ...)` 接收到后更新 `commandPaletteOpen: true`，订阅了这个字段的 `CommandPalette` 组件重渲染，命令面板就显示出来了。
