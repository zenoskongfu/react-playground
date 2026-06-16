/**
 * useWorkspaceFiles — 工作区文件服务
 *
 * 这是整个 Playground 最核心的 hook，负责：
 *   1. 维护工作区所有文件的状态（workspaceFiles）
 *   2. 管理打开的标签页和当前选中的文件
 *   3. 将文件状态持久化到 localStorage 和 URL hash
 *   4. 对外暴露文件的增删改查操作
 *
 * 对应 VSCode OSS 中的 IWorkspaceContextService + IEditorService 层。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Files, WorkspaceFile, WorkspaceTreeNode } from '../../../PlaygroundContext'
import { initFiles, readOnlyFilePaths } from '../../../files'
import { compress, fileName2Language, normalizePath, uncompress } from '../../../utils'
// releaseModel 来自 Monaco 编辑器层：删除/重命名文件时需要销毁对应的 Monaco TextModel，
// 否则旧模型会继续占用内存，且重建同名文件时会拿到缓存的旧内容。
import { releaseModel } from '../../browser/parts/editor/workbenchEditor'

// localStorage key 带版本号，以便将来格式升级时能识别并丢弃旧缓存
const STORAGE_KEY = 'vscode-web-playground-workspace-v2'

// ─── 过期工作区检测 ──────────────────────────────────────────────────────────

/**
 * 检测缓存的工作区是否是早期版本遗留的"旧格式"数据。
 * 旧格式有以下特征：文件放在根目录（App.tsx）、代码带 @ts-nocheck、
 * import-map 指向旧版 esm.sh 地址等。
 * 检测到旧格式时直接丢弃，避免用旧数据污染新版本的工作区。
 */
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

/** 从 localStorage 读取工作区，读到旧格式返回 undefined */
const getFilesFromStorage = () => {
  try {
    const cached = window.localStorage.getItem(STORAGE_KEY)
    if (!cached) return undefined
    const files = JSON.parse(cached) as Files
    return isStaleWorkspace(files) ? undefined : files
  } catch (error) {
    console.error(error)
    return undefined
  }
}

/**
 * 从 URL hash 读取工作区（分享链接场景）。
 * hash 中的内容是经过压缩的 JSON，通过 uncompress 还原。
 */
const getFilesFromUrl = () => {
  try {
    if (!window.location.hash) return undefined
    const hash = uncompress(window.location.hash.slice(1))
    const files = JSON.parse(hash) as Files
    return isStaleWorkspace(files) ? undefined : files
  } catch (error) {
    console.error(error)
    return undefined
  }
}

// ─── 数据转换工具 ────────────────────────────────────────────────────────────

/** 从完整路径中取出文件名（最后一段） */
const fileNameFromPath = (path: string) => path.split('/').pop() || path

/** 根据路径创建一个新的 WorkspaceFile 对象，value 默认为空字符串 */
const createWorkspaceFile = (path: string, value = ''): WorkspaceFile => {
  const normalizedPath = normalizePath(path)
  return {
    path: normalizedPath,
    name: fileNameFromPath(normalizedPath),
    value,
    language: fileName2Language(normalizedPath), // 根据扩展名判断语言（tsx → typescript）
    readonly: readOnlyFilePaths.includes(normalizedPath), // import-map.json 等特殊文件只读
  }
}

/**
 * Files（持久化格式）→ WorkspaceFile（运行时格式）
 *
 * 注意：不恢复 dirty 字段——每次加载时文件都应该从"干净"状态开始，
 * 否则每次刷新页面都会看到 * 号，没有意义。
 */
const filesToWorkspace = (files: Files) => {
  return Object.keys(files).reduce<Record<string, WorkspaceFile>>((acc, path) => {
    const normalizedPath = normalizePath(path)
    acc[normalizedPath] = {
      ...createWorkspaceFile(normalizedPath),
      value: files[path].value,
    }
    return acc
  }, {})
}

/**
 * WorkspaceFile（运行时格式）→ Files（持久化/编译器格式）
 *
 * 故意省略 dirty 字段：
 *   - dirty 只是 UI 状态（文件名旁边的 * 号），不影响编译结果
 *   - 如果把 dirty 包含进来，每次用户输入后 files 就会变化，
 *     触发持久化 effect，然后清除 dirty，files 又变化…形成无限循环
 */
const workspaceToFiles = (workspaceFiles: Record<string, WorkspaceFile>): Files => {
  return Object.keys(workspaceFiles).reduce<Files>((acc, path) => {
    const file = workspaceFiles[path]
    acc[path] = {
      name: path,
      value: file.value,
      language: file.language,
    }
    return acc
  }, {})
}

/**
 * 把扁平的文件路径列表转换成树形结构供文件树组件渲染。
 *
 * 算法：用 Map 记录每个文件夹路径对应的子节点列表，
 * 遍历每个文件时沿路径逐段创建文件夹节点，最后把文件节点挂到父级。
 */
const buildTree = (workspaceFiles: Record<string, WorkspaceFile>) => {
  const root: WorkspaceTreeNode[] = []
  const folders = new Map<string, WorkspaceTreeNode[]>()
  folders.set('', root) // 根目录的子节点就是 root 数组本身

  Object.values(workspaceFiles)
    .sort((a, b) => a.path.localeCompare(b.path)) // 先排序保证文件夹节点先于子文件出现
    .forEach((file) => {
      const parts = file.path.split('/')
      let parentPath = ''
      // 逐段创建文件夹节点（如果还不存在的话）
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

      // 把文件节点挂到直接父级
      const parent = folders.get(parentPath) || root
      parent.push({ path: file.path, name: file.name, type: 'file', file })
    })

  // 递归排序：文件夹排在文件前面，同类型按名称字母序
  const sortNodes = (nodes: WorkspaceTreeNode[]) => {
    nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    nodes.forEach((node) => {
      if (node.children) sortNodes(node.children)
    })
  }
  sortNodes(root)
  return root
}

// ─── Hook 主体 ───────────────────────────────────────────────────────────────

export function useWorkspaceFiles() {
  /**
   * workspaceFiles：工作区所有文件的映射表，key 是归一化后的路径。
   *
   * 初始化优先级：URL hash（分享链接）> localStorage（上次编辑）> 内置模板
   * 用函数初始化（lazy init）是 React 的性能最佳实践——
   * 避免每次渲染都重新执行读取 localStorage 和解压缩的昂贵操作。
   */
  const [workspaceFiles, setWorkspaceFiles] = useState<Record<string, WorkspaceFile>>(() =>
    filesToWorkspace(getFilesFromUrl() || getFilesFromStorage() || initFiles),
  )
  const [selectedFileName, setSelectedFileNameRaw] = useState('src/App.tsx')
  const [openTabs, setOpenTabs] = useState(['src/App.tsx'])

  /**
   * files：编译器和持久化使用的精简版文件对象（不含 dirty、readonly 等 UI 字段）。
   * 使用 useMemo 避免每次渲染都创建新对象，只在 workspaceFiles 变化时重算。
   */
  const files = useMemo(() => workspaceToFiles(workspaceFiles), [workspaceFiles])
  const tree = useMemo(() => buildTree(workspaceFiles), [workspaceFiles])

  /**
   * filesRef：始终持有最新的 files 快照，专门给 beforeunload 事件处理器使用。
   *
   * 为什么不直接在 beforeunload 里读 files？
   * 因为 addEventListener 注册的函数会闭包捕获注册时的 files 值，
   * 之后 files 更新了，闭包里的值还是旧的（这就是"过期闭包"问题）。
   * 通过 ref 保存最新值，event handler 每次都能读到最新数据。
   */
  const filesRef = useRef(files)
  useEffect(() => {
    filesRef.current = files
  }, [files])

  // ── 持久化 effect ──────────────────────────────────────────────────────────

  /**
   * 防抖持久化：用户停止输入 1500ms 后，才把文件写入 localStorage 和 URL hash。
   *
   * 不用 debounce 库的原因：
   *   useEffect(debounce(fn, 1500), [files]) 这种写法看起来合理但有 Bug——
   *   每次 files 变化 React 都会重新执行 useEffect，也会重新调用 debounce(fn, 1500)，
   *   产生一个全新的 debounced 函数，旧的定时器就被遗弃了，防抖从来不会触发。
   *
   * 正确做法：在 effect 里手动管理 setTimeout，cleanup 函数清除上一次的定时器。
   * 每次 files 变化时，清掉旧定时器再重设新的，这才是真正的防抖。
   *
   * 写入完成后清除 dirty 标志（让文件名旁边的 * 消失）：
   *   dirty 不在 files 里（workspaceToFiles 故意省略了它），
   *   所以清除 dirty 不会触发 files 变化，也就不会重新触发这个 effect——
   *   没有无限循环风险。
   */
  useEffect(() => {
    const timerId = setTimeout(() => {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(files))
      // compress 是同步 CPU 密集操作（LZ 压缩），放在 setTimeout 里避免阻塞输入
      window.location.hash = compress(JSON.stringify(files))
      setWorkspaceFiles((current) => {
        const hasDirty = Object.values(current).some((f) => f.dirty)
        if (!hasDirty) return current // 没有 dirty 文件时直接返回同一引用，跳过渲染
        const next: Record<string, WorkspaceFile> = {}
        Object.entries(current).forEach(([path, f]) => {
          next[path] = f.dirty ? { ...f, dirty: false } : f
        })
        return next
      })
    }, 1500)
    return () => clearTimeout(timerId) // cleanup 清除上一次的定时器
  }, [files])

  /**
   * beforeunload 强制写入：用户关闭标签页时，1500ms 防抖可能还没触发，
   * 必须在这里同步写一次 localStorage，否则最后几秒的编辑会丢失。
   *
   * 注意：这里通过 filesRef 读取最新数据（见上方 filesRef 的注释）。
   * 依赖数组为 []，确保只注册一次事件监听器。
   */
  useEffect(() => {
    const flush = () => {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(filesRef.current))
    }
    window.addEventListener('beforeunload', flush)
    return () => window.removeEventListener('beforeunload', flush)
  }, [])

  // ── 公共操作 API ───────────────────────────────────────────────────────────

  /**
   * setSelectedFileName：切换当前选中文件，同时自动把它加入打开的标签页。
   * 做了安全检查：如果文件不存在于 workspaceFiles，静默忽略。
   */
  const setSelectedFileName = (fileName: string) => {
    const normalizedPath = normalizePath(fileName)
    if (!workspaceFiles[normalizedPath]) return
    setSelectedFileNameRaw(normalizedPath)
    setOpenTabs((tabs) => (tabs.includes(normalizedPath) ? tabs : [...tabs, normalizedPath]))
  }

  /**
   * updateFileValue：Monaco 编辑器内容变化时调用，标记文件为 dirty。
   *
   * 用 useCallback(fn, []) 包裹的原因：
   *   WorkbenchEditor 里有一个 effect 依赖 [file, onChange]，
   *   如果 onChange 每次渲染都是新函数引用，effect 会不停重跑，
   *   重跑会重新订阅 Monaco 的 onDidChangeContent 事件，产生短暂的监听空隙。
   *   useCallback(fn, []) 保证函数引用稳定（只创建一次），effect 不会不必要地重跑。
   *
   *   内部用函数式更新 setWorkspaceFiles((current) => ...)，
   *   这样不需要在依赖数组里写 workspaceFiles，避免 useCallback 失效。
   */
  const updateFileValue = useCallback((fileName: string, value: string) => {
    const normalizedPath = normalizePath(fileName)
    setWorkspaceFiles((current) => {
      const file = current[normalizedPath]
      if (!file || file.readonly) return current
      return { ...current, [normalizedPath]: { ...file, value, dirty: true } }
    })
  }, [])

  /** 格式化文件：去掉尾部多余空行，末尾保留一个换行符（标准代码格式） */
  const formatFile = (fileName: string) => {
    const normalizedPath = normalizePath(fileName)
    setWorkspaceFiles((current) => {
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
  }

  /** 整体替换工作区文件（从外部导入场景使用） */
  const setFiles = (nextFiles: Files) => {
    setWorkspaceFiles(filesToWorkspace(nextFiles))
  }

  /** 新建文件：若同名文件已存在，直接跳转到它而不是报错 */
  const addFile = (fileName: string) => {
    const normalizedPath = normalizePath(fileName)
    if (workspaceFiles[normalizedPath]) {
      setSelectedFileName(normalizedPath)
      return
    }
    setWorkspaceFiles((current) => ({
      ...current,
      [normalizedPath]: createWorkspaceFile(normalizedPath),
    }))
    setSelectedFileNameRaw(normalizedPath)
    setOpenTabs((tabs) => [...tabs, normalizedPath])
  }

  /**
   * 删除文件：
   *   1. 先调用 releaseModel 销毁 Monaco 的 TextModel（避免内存泄漏和缓存污染）
   *   2. 从 workspaceFiles 移除
   *   3. 从 openTabs 移除
   *   4. 如果删除的是当前选中文件，自动回退到 App.tsx
   */
  const removeFile = (fileName: string) => {
    const normalizedPath = normalizePath(fileName)
    const file = workspaceFiles[normalizedPath]
    if (!file || file.readonly) return
    releaseModel(normalizedPath) // 必须在 setWorkspaceFiles 之前调用，此时文件还存在
    setWorkspaceFiles((current) => {
      const next = { ...current }
      delete next[normalizedPath]
      return next
    })
    setOpenTabs((tabs) => tabs.filter((tab) => tab !== normalizedPath))
    if (selectedFileName === normalizedPath) {
      setSelectedFileNameRaw('src/App.tsx')
    }
  }

  /**
   * 重命名文件：
   *   1. 释放旧路径的 Monaco 模型（新路径会在下次渲染时重新创建）
   *   2. 删除旧 key，用新 key 创建新条目
   *   3. 更新所有引用了旧路径的 openTabs 和 selectedFileName
   */
  const updateFileName = (oldFileName: string, newFileName: string) => {
    const oldPath = normalizePath(oldFileName)
    const newPath = normalizePath(newFileName)
    const file = workspaceFiles[oldPath]
    // 安全检查：源文件存在、非只读、新路径非空、新路径不与已有文件冲突
    if (!file || file.readonly || !newPath || workspaceFiles[newPath]) return

    releaseModel(oldPath)
    setWorkspaceFiles((current) => {
      const next = { ...current }
      delete next[oldPath]
      next[newPath] = { ...createWorkspaceFile(newPath, file.value), dirty: true }
      return next
    })
    setOpenTabs((tabs) => tabs.map((tab) => (tab === oldPath ? newPath : tab)))
    if (selectedFileName === oldPath) {
      setSelectedFileNameRaw(newPath)
    }
  }

  /**
   * 关闭标签页（不删除文件，只从 tabs 移除）：
   *   关闭当前激活的标签时，自动切换到 tabs 数组里最后一个标签。
   *   如果关闭后没有任何标签，保底恢复 App.tsx 标签。
   */
  const closeTab = (fileName: string) => {
    const normalizedPath = normalizePath(fileName)
    setOpenTabs((tabs) => {
      const next = tabs.filter((tab) => tab !== normalizedPath)
      if (selectedFileName === normalizedPath) {
        setSelectedFileNameRaw(next[next.length - 1] || 'src/App.tsx')
      }
      return next.length ? next : ['src/App.tsx']
    })
  }

  return {
    workspaceFiles,
    files,
    tree,
    selectedFileName,
    openTabs,
    // 对外暴露的公共操作
    setSelectedFileName,
    addFile,
    removeFile,
    updateFileName,
    updateFileValue,
    formatFile,
    setFiles,
    closeTab,
    // 内部原始 setter，供 useAiAssistant 等其他 service hook 组合使用。
    // 之所以直接暴露 setter 而不是把 AI 逻辑写进这个 hook，
    // 是为了保持单一职责——这个 hook 只管文件状态，不管 AI 业务逻辑。
    setWorkspaceFiles,
    setOpenTabs,
    setSelectedFileNameRaw,
  }
}
