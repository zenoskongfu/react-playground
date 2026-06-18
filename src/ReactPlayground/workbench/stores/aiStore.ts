/**
 * aiStore — AI 辅助功能状态（Zustand 版）
 *
 * 取代了原来的 useAiAssistant hook。
 *
 * 与 hook 版本的关键区别：
 *   - hook 版本通过 slice 参数接收 workspace 和 layout 的能力，原因是 hook 不能消费
 *     自己所在 Provider 的 Context。
 *   - store 版本直接通过 useWorkspaceStore.getState() 和 useLayoutStore.getState()
 *     读取最新状态，不需要传参，也不存在闭包过期问题（getState 始终返回最新值）。
 */

import { create } from 'zustand'
import type { AiAction, AiMessage, WorkspaceEdit, WorkspaceFile } from '../../PlaygroundContext'
import { fileName2Language, normalizePath } from '../../utils'
import { readOnlyFilePaths } from '../../files'
import { useWorkspaceStore } from './workspaceStore'
import { useLayoutStore } from './layoutStore'

const makeEditId = () => Math.random().toString(36).slice(2, 10)
const fileNameFromPath = (path: string) => path.split('/').pop() || path

const createWorkspaceFile = (path: string, value = ''): WorkspaceFile => {
  const normalizedPath = normalizePath(path)
  return {
    path: normalizedPath,
    name: fileNameFromPath(normalizedPath),
    value,
    language: fileName2Language(normalizedPath),
    readonly: readOnlyFilePaths.includes(normalizedPath),
  }
}

interface AiState {
  aiMessages: AiMessage[]
  pendingEdit: WorkspaceEdit | null
  output: string[]
}

interface AiActions {
  setOutput: (updater: string[] | ((current: string[]) => string[])) => void
  askAi: (action: AiAction) => void
  applyWorkspaceEdit: () => void
  discardWorkspaceEdit: () => void
}

export type AiStore = AiState & AiActions

export const useAiStore = create<AiStore>((set, get) => ({
  aiMessages: [
    {
      id: 'welcome',
      role: 'assistant',
      content: '我会基于当前文件生成 WorkspaceEdit，并先进入 Diff Review。',
    },
  ],
  pendingEdit: null,
  output: [
    'VSCode-like services initialized with local adapter.',
    'Extension host mock registered: commands, webview, workspace edit.',
  ],

  setOutput: (updater) =>
    set((state) => ({
      output: typeof updater === 'function' ? updater(state.output) : updater,
    })),

  askAi: (action) => {
    // 直接从 workspaceStore 读取最新状态，无过期闭包问题
    const { workspaceFiles, selectedFileName } = useWorkspaceStore.getState()
    const currentFile = workspaceFiles[selectedFileName]
    if (!currentFile) return

    const targetPath =
      action === 'generate-component' ? 'src/components/GeneratedPanel.tsx' : selectedFileName
    const before = workspaceFiles[targetPath]?.value || ''
    const after =
      action === 'generate-component'
        ? `export function GeneratedPanel() {\n  return (\n    <section className="generated-panel">\n      <strong>AI generated component</strong>\n      <p>Mocked from the current workspace context.</p>\n    </section>\n  )\n}\n`
        : `${currentFile.value}\n\n/* AI mock suggestion: extracted from ${currentFile.name} with VSCode-like WorkspaceEdit review. */\n`

    const title =
      action === 'explain-selection'
        ? 'Explain current selection'
        : action === 'generate-test'
          ? 'Generate unit test scaffold'
          : action === 'fix-error'
            ? 'Analyze runtime error'
            : action === 'refactor-file'
              ? 'Refactor current file'
              : 'Generate component example'

    set((state) => ({
      pendingEdit: {
        id: makeEditId(),
        title,
        description: `Mock AI created a WorkspaceEdit for ${targetPath}. Review the diff before applying.`,
        changes: [{ path: targetPath, before, after }],
      },
      aiMessages: [
        ...state.aiMessages,
        { id: makeEditId(), role: 'user', content: title },
        {
          id: makeEditId(),
          role: 'assistant',
          content: `已生成 ${targetPath} 的变更计划，等待你在 Diff Review 中确认。`,
        },
      ],
    }))

    useLayoutStore.getState().setActiveActivity('ai')
  },

  applyWorkspaceEdit: () => {
    const { pendingEdit } = get()
    if (!pendingEdit) return

    // 通过 workspaceStore 的 action 做函数式更新，读到的是 store 里最新的 workspaceFiles
    useWorkspaceStore.getState().setWorkspaceFiles((current) => {
      const next = { ...current }
      pendingEdit.changes.forEach((change) => {
        const path = normalizePath(change.path)
        const existing = next[path]
        next[path] = {
          ...createWorkspaceFile(path, change.after),
          ...existing,
          path,
          name: fileNameFromPath(path),
          value: change.after,
          language: fileName2Language(path),
          dirty: true,
        }
      })
      return next
    })

    get().setOutput((logs) => [`Applied WorkspaceEdit: ${pendingEdit.title}`, ...logs])

    useWorkspaceStore.getState().setOpenTabs((tabs) => {
      const nextTabs = [...tabs]
      pendingEdit.changes.forEach((change) => {
        const path = normalizePath(change.path)
        if (!nextTabs.includes(path)) nextTabs.push(path)
      })
      return nextTabs
    })
    useWorkspaceStore.getState().setSelectedFileNameRaw(normalizePath(pendingEdit.changes[0].path))
    set({ pendingEdit: null })
  },

  discardWorkspaceEdit: () => {
    const { pendingEdit } = get()
    if (pendingEdit) {
      get().setOutput((logs) => [`Discarded WorkspaceEdit: ${pendingEdit.title}`, ...logs])
    }
    set({ pendingEdit: null })
  },
}))
