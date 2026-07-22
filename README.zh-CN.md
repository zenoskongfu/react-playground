# React Playground

[English README](./README.md)

一个仿 VS Code 风格的浏览器端 React Playground。它提供 Monaco 编辑器、虚拟文件工作区、TSX/JSX 实时编译，以及基于 iframe 的 React 示例预览。

## 功能特性

- 仿 VS Code 的工作台：标题栏、活动栏、编辑器标签、资源管理器、面板、状态栏
- 基于 Monaco 的编辑体验，支持多文件 Model、撤销历史、语言模式和格式化快捷键
- 虚拟工作区，支持编辑 React、TypeScript、CSS、JSON、Markdown 文件
- Babel 编译器运行在 Web Worker 中，避免编译阻塞主线程输入
- 支持相对路径模块解析、CSS import、JSON import 和 index 文件解析
- 通过 `localStorage` 和 URL hash 保存、分享工作区内容
- 命令面板支持工作台、预览、格式化和 AI 审查相关命令
- Mock AI 助手流程，包含 explain、generate、refactor、diff review、apply、discard 状态

## 快速开始

```bash
pnpm install
pnpm dev
```

然后打开终端里 Vite 输出的开发服务器地址。

## 脚本

```bash
pnpm dev       # 启动本地开发服务器
pnpm build     # 类型检查并构建生产包
pnpm preview   # 本地预览生产构建
pnpm lint      # 运行 ESLint
```

## 项目结构

```text
src/ReactPlayground/
├── PlaygroundContext.tsx        # 共享 TypeScript 类型
├── files.ts                     # 初始虚拟工作区模板
├── template/                    # Playground 默认加载的文件
├── components/
│   └── Message/                 # 悬浮消息组件
└── workbench/
    ├── stores/                  # Zustand 状态层
    │   ├── workspaceStore.ts    # 文件、树、标签页、持久化
    │   ├── layoutStore.ts       # 主题、面板、活动视图、命令面板
    │   ├── aiStore.ts           # Mock AI 聊天和 WorkspaceEdit 审查流程
    │   └── commandsStore.ts     # 命令注册表
    ├── browser/
    │   ├── workbench.tsx        # 主工作台骨架
    │   └── parts/               # 标题栏、活动栏、编辑器、面板、状态栏
    └── contrib/
        ├── explorer/            # 文件树和侧边栏
        ├── commandPalette/      # 命令面板 UI
        ├── preview/             # 实时预览、编译 Worker、iframe 模板
        └── aiAssistant/         # AI 操作栏
```

## 架构说明

项目参考 VS Code OSS 的 workbench/contrib 分层组织：

| 模块 | 职责 |
| --- | --- |
| `workspaceStore` | 虚拟文件、文件树、当前文件、打开标签、持久化 |
| `layoutStore` | 主题、当前活动视图、面板显示、命令面板状态 |
| `commandsStore` | 静态命令注册和命令执行 |
| `aiStore` | Mock AI 消息和待审查 WorkspaceEdit |
| `WorkbenchEditor` | Monaco 生命周期、Model 缓存、快捷键、Diff 模式 |
| `compiler.worker` | Babel 转换和本地模块到 Blob URL 的解析 |
| `PreviewView` | 防抖编译、iframe 注入、错误展示 |

主要数据流：

```text
用户编辑代码
  -> Monaco onDidChangeContent
  -> workspaceStore.updateFileValue()
  -> files 快照变化
  -> PreviewView 防抖 500ms
  -> compiler.worker 编译入口和本地依赖
  -> PreviewView 将编译后代码注入 iframe srcDoc
```

工作区持久化单独运行：

```text
files 快照变化
  -> Zustand 模块级 subscribe
  -> 防抖 1500ms
  -> 写入 localStorage + URL hash
  -> 清除 dirty 标记
```

## 关键实现

### Zustand 状态层

项目把状态拆成多个聚焦的 Zustand store，而不是一个 React Context Provider。组件只订阅自己需要的字段，因此代码输入这种高频变化不会带动无关的工作台区域重渲染。

`workspaceFiles` 保存完整 UI 状态，例如 `dirty` 和 `readonly`。派生出来的 `files` 快照更精简，只用于编译和持久化。`files` 中故意不包含 `dirty`，避免清除 dirty 标记时再次触发持久化，形成循环。

### Monaco Model

每个工作区文件对应一个 Monaco `ITextModel`，文件切换时保留独立的撤销历史和光标状态。编辑器实例本身复用，只通过 `editor.setModel(model)` 切换文件。

编辑器还会为所有工作区文件预创建 Model，这样 Monaco TypeScript 能在文件尚未打开时解析同级 import，减少误报。

### 编译 Worker

`compiler.worker.ts` 在 Web Worker 中运行 Babel，避免同步 transform 阻塞输入。它从 `src/main.tsx` 入口开始，用 React 和 TypeScript preset 编译 TSX/JSX，并把本地 import 重写为生成的 Blob URL。

支持的本地 import 包括：

- `.ts`、`.tsx`、`.js`、`.jsx`
- `.json`，转换为 `export default`
- `.css`，转换为运行时注入样式的模块
- 省略扩展名的 import，以及 `index.ts` / `index.tsx`

### 预览运行时

`PreviewView` 使用手动防抖调度编译，并给每次请求附加 `requestId`。旧编译结果会被丢弃，避免用户快速输入时预览回退到旧状态。

如果编译失败，iframe 会保留上一次成功预览，而不是刷新成空白页。若 Worker 五秒内没有响应，看门狗会重建 Worker。

### AI 流程

当前 AI 助手是 Mock 实现，但审查流程完整：操作会生成 pending `WorkspaceEdit`，编辑器可以展示 Diff，用户可以选择应用或丢弃。接入真实模型时，只需要替换 `aiStore` 中的模拟响应生成逻辑。

## 开发说明

- 入口文件：`src/main.tsx`
- 默认可编辑组件：`src/App.tsx`
- 只读虚拟文件：`src/main.tsx`、`import-map.json`
- 工作区加载优先级：URL hash、`localStorage`、内置模板
- 主 UI 骨架：`src/ReactPlayground/workbench/browser/workbench.tsx`

## 技术栈

- React 18
- Vite 5
- TypeScript
- Zustand
- Monaco Editor
- Babel Standalone
- Ant Design
- Allotment
- Sass

