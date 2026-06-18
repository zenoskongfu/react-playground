/**
 * workspaceStore — 工作区文件状态（Zustand 版）
 *
 * 这个 store 取代了原来的 useWorkspaceFiles hook。
 *
 * 迁移到 Zustand 的核心收益：
 *   - 组件可以精确订阅自己需要的字段（如只订阅 selectedFileName），
 *     其他字段变化时不会触发该组件的重渲染。
 *   - 使用 React Context 时，任何文件内容变化（每次击键）都会让所有
 *     Context 消费者重渲染——包括 Activitybar、Statusbar 这些和文件内容无关的组件。
 *   - store 的 actions 在 store 模块内定义，不需要在 Provider 里组合，也不需要
 *     通过 slice 参数传递依赖，逻辑更内聚。
 *
 * 持久化设计：
 *   - 用 subscribe 在 store 外部监听 files 变化，1500ms 防抖后写入 localStorage + URL hash。
 *   - 页面关闭时（beforeunload）强制同步写一次，防止最后几秒的编辑丢失。
 *   - subscribe 在模块级注册（不在 React 组件里），避免多次 mount/unmount 导致重复订阅。
 */

import { create } from 'zustand'
import { subscribeWithSelector } from 'zustand/middleware'
import type { Files, WorkspaceFile, WorkspaceTreeNode } from '../../PlaygroundContext'
import { initFiles, readOnlyFilePaths } from '../../files'
import { compress, fileName2Language, normalizePath, uncompress } from '../../utils'

// localStorage key 带版本号，以便将来格式升级时能识别并丢弃旧缓存
const STORAGE_KEY = 'vscode-web-playground-workspace-v2'

// ─── 工具函数（从 useWorkspaceFiles 原样复制，逻辑不变）───────────────────────

const isStaleWorkspace = (files: Files) => {
  const filePaths = Object.keys(files)
  const hasLegacyFlatTemplate = filePaths.includes('App.tsx') || filePaths.includes('main.tsx')
  const hasStaleTemplate = Object.values(files).some((file) => file.value.includes('@ts-nocheck'))
  const importMap = files['import-map.json']?.value || ''
  const hasLegacyImportMap = importMap.includes('"react-dom/client": "https://esm.sh/react-dom@18.2.0"')
  const hasLegacyMainEntry =
    files['src/main.tsx']?.value.includes("import ReactDOM from 'react-dom/client'") || false
  return hasLegacyFlatTemplate || hasStaleTemplate || hasLegacyImportMap || hasLegacyMainEntry
}

const getFilesFromStorage = () => {
  try {
    const cached = window.localStorage.getItem(STORAGE_KEY)
    if (!cached) return undefined
    const files = JSON.parse(cached) as Files
    return isStaleWorkspace(files) ? undefined : files
  } catch {
    return undefined
  }
}

const getFilesFromUrl = () => {
  try {
    if (!window.location.hash) return undefined
    const hash = uncompress(window.location.hash.slice(1))
    const files = JSON.parse(hash) as Files
    return isStaleWorkspace(files) ? undefined : files
  } catch {
    return undefined
  }
}

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

const filesToWorkspace = (files: Files): Record<string, WorkspaceFile> => {
  return Object.keys(files).reduce<Record<string, WorkspaceFile>>((acc, path) => {
    const normalizedPath = normalizePath(path)
    acc[normalizedPath] = { ...createWorkspaceFile(normalizedPath), value: files[path].value }
    return acc
  }, {})
}

/**
 * workspaceToFiles：WorkspaceFile → Files（精简版，给编译器和持久化使用）。
 * 故意省略 dirty：dirty 是纯 UI 状态，如果放进来会导致持久化 effect 和 dirty 清除
 * 之间形成循环触发。
 */
const workspaceToFiles = (workspaceFiles: Record<string, WorkspaceFile>): Files => {
  return Object.keys(workspaceFiles).reduce<Files>((acc, path) => {
    const file = workspaceFiles[path]
    acc[path] = { name: path, value: file.value, language: file.language }
    return acc
  }, {})
}

const buildTree = (workspaceFiles: Record<string, WorkspaceFile>): WorkspaceTreeNode[] => {
  const root: WorkspaceTreeNode[] = []
  const folders = new Map<string, WorkspaceTreeNode[]>()
  folders.set('', root)

  Object.values(workspaceFiles)
    .sort((a, b) => a.path.localeCompare(b.path))
    .forEach((file) => {
      const parts = file.path.split('/')
      let parentPath = ''
      parts.slice(0, -1).forEach((part) => {
        const currentPath = parentPath ? `${parentPath}/${part}` : part
        const parent = folders.get(parentPath) || root
        let folder = parent.find((node) => node.path === currentPath)
        if (!folder) {
          folder = { path: currentPath, name: part, type: 'folder', children: [] }
          parent.push(folder)
          folders.set(currentPath, folder.children || [])
        }
        parentPath = currentPath
      })
      const parent = folders.get(parentPath) || root
      parent.push({ path: file.path, name: file.name, type: 'file', file })
    })

  const sortNodes = (nodes: WorkspaceTreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    nodes.forEach((node) => { if (node.children) sortNodes(node.children) })
  }
  sortNodes(root)
  return root
}

// ─── Store 类型 ──────────────────────────────────────────────────────────────

interface WorkspaceState {
  workspaceFiles: Record<string, WorkspaceFile>
  // files 和 tree 是 workspaceFiles 的派生值，每次 workspaceFiles 变化时同步更新。
  // 在 store 里直接存储（而不是在组件里用 useMemo 计算），
  // 这样订阅 files 的组件（编译器触发方）和订阅 workspaceFiles 的组件（文件树）
  // 可以各自独立订阅，只在自己关心的数据变化时重渲染。
  files: Files
  tree: WorkspaceTreeNode[]
  selectedFileName: string
  openTabs: string[]
}

interface WorkspaceActions {
  setWorkspaceFiles: (updater: Record<string, WorkspaceFile> | ((current: Record<string, WorkspaceFile>) => Record<string, WorkspaceFile>)) => void
  setSelectedFileNameRaw: (path: string) => void
  setOpenTabs: (updater: string[] | ((current: string[]) => string[])) => void
  setSelectedFileName: (fileName: string) => void
  updateFileValue: (fileName: string, value: string) => void
  formatFile: (fileName: string) => void
  setFiles: (files: Files) => void
  addFile: (fileName: string) => void
  removeFile: (fileName: string) => void
  updateFileName: (oldFileName: string, newFileName: string) => void
  closeTab: (fileName: string) => void
}

export type WorkspaceStore = WorkspaceState & WorkspaceActions

// ─── 初始状态 ────────────────────────────────────────────────────────────────

const initialWorkspaceFiles = filesToWorkspace(getFilesFromUrl() || getFilesFromStorage() || initFiles)

// ─── Store 创建 ──────────────────────────────────────────────────────────────

export const useWorkspaceStore = create<WorkspaceStore>()(
  subscribeWithSelector((set, get) => ({
  // 初始状态：优先 URL hash → localStorage → 内置模板
  workspaceFiles: initialWorkspaceFiles,
  files: workspaceToFiles(initialWorkspaceFiles),
  tree: buildTree(initialWorkspaceFiles),
  selectedFileName: 'src/App.tsx',
  openTabs: ['src/App.tsx'],

  // ── 内部 setter（供 aiStore 等其他 store 调用）──────────────────────────────

  setWorkspaceFiles: (updater) => {
    set((state) => {
      const next =
        typeof updater === 'function' ? updater(state.workspaceFiles) : updater
      // 同步更新 files 和 tree，保持三个派生字段始终一致
      return { workspaceFiles: next, files: workspaceToFiles(next), tree: buildTree(next) }
    })
  },

  setSelectedFileNameRaw: (path) => set({ selectedFileName: path }),

  setOpenTabs: (updater) => {
    set((state) => ({
      openTabs: typeof updater === 'function' ? updater(state.openTabs) : updater,
    }))
  },

  // ── 公共操作 API ──────────────────────────────────────────────────────────

  setSelectedFileName: (fileName) => {
    const normalizedPath = normalizePath(fileName)
    const { workspaceFiles, openTabs } = get()
    if (!workspaceFiles[normalizedPath]) return
    set({
      selectedFileName: normalizedPath,
      openTabs: openTabs.includes(normalizedPath) ? openTabs : [...openTabs, normalizedPath],
    })
  },

  updateFileValue: (fileName, value) => {
    const normalizedPath = normalizePath(fileName)
    // 用函数式更新读取最新状态（getState 在 action 内部等同于读取当前最新值）
    get().setWorkspaceFiles((current) => {
      const file = current[normalizedPath]
      if (!file || file.readonly) return current
      return { ...current, [normalizedPath]: { ...file, value, dirty: true } }
    })
  },

  formatFile: (fileName) => {
    const normalizedPath = normalizePath(fileName)
    get().setWorkspaceFiles((current) => {
      const file = current[normalizedPath]
      if (!file || file.readonly) return current
      return {
        ...current,
        [normalizedPath]: {
          ...file,
          value: file.value.trimEnd() ? `${file.value.trimEnd()}\n` : file.value,
          dirty: true,
        },
      }
    })
  },

  setFiles: (nextFiles) => {
    get().setWorkspaceFiles(filesToWorkspace(nextFiles))
  },

  addFile: (fileName) => {
    const normalizedPath = normalizePath(fileName)
    const { workspaceFiles, openTabs } = get()
    if (workspaceFiles[normalizedPath]) {
      get().setSelectedFileName(normalizedPath)
      return
    }
    const next = { ...workspaceFiles, [normalizedPath]: createWorkspaceFile(normalizedPath) }
    set({
      workspaceFiles: next,
      files: workspaceToFiles(next),
      tree: buildTree(next),
      selectedFileName: normalizedPath,
      openTabs: [...openTabs, normalizedPath],
    })
  },

  removeFile: (fileName) => {
    const normalizedPath = normalizePath(fileName)
    const { workspaceFiles, selectedFileName, openTabs } = get()
    const file = workspaceFiles[normalizedPath]
    if (!file || file.readonly) return

    // 延迟 import 避免循环依赖：workbenchEditor 在类型层面依赖 PlaygroundContext，
    // PlaygroundContext（类型层）没有 runtime 依赖，所以这里动态 import 是安全的
    import('../browser/parts/editor/workbenchEditor').then(({ releaseModel }) => {
      releaseModel(normalizedPath)
    })

    const next = { ...workspaceFiles }
    delete next[normalizedPath]
    const nextTabs = openTabs.filter((tab) => tab !== normalizedPath)
    set({
      workspaceFiles: next,
      files: workspaceToFiles(next),
      tree: buildTree(next),
      openTabs: nextTabs.length ? nextTabs : ['src/App.tsx'],
      selectedFileName: selectedFileName === normalizedPath
        ? (nextTabs[nextTabs.length - 1] || 'src/App.tsx')
        : selectedFileName,
    })
  },

  updateFileName: (oldFileName, newFileName) => {
    const oldPath = normalizePath(oldFileName)
    const newPath = normalizePath(newFileName)
    const { workspaceFiles, selectedFileName, openTabs } = get()
    const file = workspaceFiles[oldPath]
    if (!file || file.readonly || !newPath || workspaceFiles[newPath]) return

    import('../browser/parts/editor/workbenchEditor').then(({ releaseModel }) => {
      releaseModel(oldPath)
    })

    const next = { ...workspaceFiles }
    delete next[oldPath]
    next[newPath] = { ...createWorkspaceFile(newPath, file.value), dirty: true }
    set({
      workspaceFiles: next,
      files: workspaceToFiles(next),
      tree: buildTree(next),
      openTabs: openTabs.map((tab) => (tab === oldPath ? newPath : tab)),
      selectedFileName: selectedFileName === oldPath ? newPath : selectedFileName,
    })
  },

  closeTab: (fileName) => {
    const normalizedPath = normalizePath(fileName)
    const { openTabs, selectedFileName } = get()
    const nextTabs = openTabs.filter((tab) => tab !== normalizedPath)
    const finalTabs = nextTabs.length ? nextTabs : ['src/App.tsx']
    const nextSelected =
      selectedFileName === normalizedPath
        ? (finalTabs[finalTabs.length - 1] || 'src/App.tsx')
        : selectedFileName
    set({ openTabs: finalTabs, selectedFileName: nextSelected })
  },
})))

// ─── 模块级持久化订阅 ────────────────────────────────────────────────────────

/**
 * 在 store 模块级（组件树外部）订阅 files 变化，实现防抖持久化。
 *
 * 为什么放模块级而不是在 useEffect 里？
 *   - 避免 React 组件 mount/unmount 导致重复订阅或短暂空窗期
 *   - store 模块只加载一次，subscribe 也只注册一次，生命周期和 store 绑定而非组件
 *
 * Zustand 的 subscribe 接收一个 selector（取出 files）和一个 listener（响应变化），
 * 只有 files 引用变化时才触发 listener，不受其他状态变化影响。
 */
let persistTimer: ReturnType<typeof setTimeout> | null = null

useWorkspaceStore.subscribe(
  (state) => state.files,
  (files) => {
    // 防抖：每次 files 变化重置定时器，1500ms 后才真正写入
    if (persistTimer !== null) clearTimeout(persistTimer)
    persistTimer = setTimeout(() => {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(files))
      window.location.hash = compress(JSON.stringify(files))
      // 持久化完成后清除 dirty 标志
      useWorkspaceStore.getState().setWorkspaceFiles((current) => {
        const hasDirty = Object.values(current).some((f) => f.dirty)
        if (!hasDirty) return current
        const next: Record<string, WorkspaceFile> = {}
        Object.entries(current).forEach(([path, f]) => {
          next[path] = f.dirty ? { ...f, dirty: false } : f
        })
        return next
      })
      persistTimer = null
    }, 1500)
  },
)

// beforeunload 强制同步写入（防抖可能还没触发就关了页面）
window.addEventListener('beforeunload', () => {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(useWorkspaceStore.getState().files))
})
