/**
 * PreviewView — 实时预览面板
 *
 * 核心流程：
 *   用户输入 → files 变化 → 500ms 防抖 → 发送给 Compiler Worker →
 *   Worker 用 Babel 编译 → 返回编译结果 → 注入 iframe 显示
 *
 * 主要解决的工程问题：
 *   1. 防抖调度：避免每次击键都触发编译，只在停顿 500ms 后才编译
 *   2. 请求 ID：编译是异步的，早发出的请求可能晚返回，用 ID 丢弃过期结果
 *   3. 看门狗：Babel 编译可能卡死（无限循环的 JSX 等），5s 无响应就重建 Worker
 *   4. Blob URL 生命周期：编译会产生 blob URL，及时回收避免内存泄漏
 *   5. 错误不刷新预览：编译失败时保留上次成功的预览，不显示空白页
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useWorkspaceStore } from '../../../stores/workspaceStore'
import iframeRaw from './iframe.html?raw'        // 预览的 HTML 模板，?raw 表示作为字符串导入
import { IMPORT_MAP_FILE_NAME } from '../../../../files'
import { Message } from '../../../../components/Message'
import CompilerWorker from './compiler.worker?worker' // Vite 的 ?worker 语法，打包为独立 Worker chunk

interface IframeMessage {
    data: {
      type: string
      message: string
    }
}

export default function PreviewView() {
    const files = useWorkspaceStore((s) => s.files)
    const [error, setError] = useState('')
    // iframeContent 用 srcDoc 注入到 iframe，变化时 iframe 会重新加载页面
    const [iframeContent, setIframeContent] = useState('')

    // ── 用 ref 管理所有需要跨渲染访问的值 ────────────────────────────────────
    // 这里大量使用 useRef 而不是 useState，原因：
    // Worker 的消息回调是在注册时创建的闭包，之后 React state 怎么变它都读不到新值（过期闭包）。
    // 存在 ref 里，消息回调通过 .current 读到的始终是最新值。

    const workerRef = useRef<Worker>()

    /**
     * latestRequestIdRef：请求版本号，每次发出编译请求时递增。
     *
     * 场景：用户快速输入时，可能同时有多个编译请求在 Worker 里排队。
     * 早发出的请求编译完成后，比它晚发出的请求可能已经开始编译了。
     * 通过对比 requestId，旧请求的结果会被直接丢弃，防止"时间旅行"：
     * 用户看到的预览回退到之前某个中间状态。
     */
    const latestRequestIdRef = useRef(0)

    /** scheduleTimerRef：防抖定时器的句柄，用于清除上一次的定时器 */
    const scheduleTimerRef = useRef<ReturnType<typeof setTimeout>>()

    /**
     * watchdogRef：看门狗定时器。
     *
     * 每次向 Worker 发消息前重设，5s 内没收到回复就认为 Worker 卡死，
     * 调用 setupWorker() 终止旧 Worker 并创建新的。
     * 这处理了 Babel 编译无限递归等极端情况。
     */
    const watchdogRef = useRef<ReturnType<typeof setTimeout>>()

    /**
     * prevBlobUrlsRef：上一次成功编译产生的 blob URL 列表。
     *
     * Compiler Worker 为每个本地模块（CSS、JSON、JS）创建 blob URL，
     * 这些 URL 在 iframe 加载完模块后就可以回收了。
     * 但要等到下一次成功编译时才回收——因为 iframe 可能还在引用它们：
     *   此次编译成功 → 回收上次的 blob URLs（iframe 已切换到新模块）→ 保存本次的 blob URLs
     */
    const prevBlobUrlsRef = useRef<string[]>([])

    /**
     * filesRef：始终持有最新的 files 快照。
     *
     * buildIframeContent 读 import-map，但它被 worker.addEventListener 闭包捕获，
     * 不通过 ref 的话就会读到注册时的旧 files。
     */
    const filesRef = useRef(files)
    useEffect(() => { filesRef.current = files }, [files])

    // ── 构建 iframe HTML ───────────────────────────────────────────────────────

    /**
     * 把编译后的 JS 代码注入到 HTML 模板里。
     *
     * iframe.html 是一个预备好的模板，有两个占位符：
     *   1. <script type="importmap"></script>：运行时模块路径映射（react → CDN URL）
     *   2. <script type="module" id="appSrc"></script>：用户代码的入口
     *
     * 通过字符串替换把编译结果和 import map 填进去，
     * 再赋给 iframe 的 srcDoc，浏览器就会在沙箱里运行这段代码。
     */
    const buildIframeContent = (code: string) => {
        const importMap = filesRef.current[IMPORT_MAP_FILE_NAME]?.value || '{"imports":{}}'
        return iframeRaw
            .replace('<script type="importmap"></script>', `<script type="importmap">${importMap}</script>`)
            .replace('<script type="module" id="appSrc"></script>', `<script type="module" id="appSrc">${code}</script>`)
    }

    // ── Worker 管理 ───────────────────────────────────────────────────────────

    /**
     * setupWorker：创建（或重建）Compiler Worker。
     *
     * 终止旧的 Worker：如果是因为看门狗超时触发的重建，旧 Worker 可能还在运行，
     * 必须先 terminate() 才能让它释放内存，否则会有僵尸 Worker 持续占用 CPU。
     */
    const setupWorker = () => {
        workerRef.current?.terminate()
        const worker = new CompilerWorker()
        workerRef.current = worker

        worker.addEventListener('message', ({ data }) => {
            // 收到任何回复，说明 Worker 还活着，取消看门狗
            clearTimeout(watchdogRef.current)

            // 丢弃过期响应：比 latestRequestIdRef.current 旧的结果直接忽略
            if (data.requestId !== latestRequestIdRef.current) return

            if (data.type === 'COMPILED_CODE') {
                // 现在可以安全回收上一次的 blob URLs 了——
                // iframe 已经收到新的 srcDoc，会重新加载，不再引用旧的 blob URLs
                prevBlobUrlsRef.current.forEach(url => URL.revokeObjectURL(url))
                prevBlobUrlsRef.current = data.blobUrls || []

                setError('')
                setIframeContent(buildIframeContent(data.data))
            } else if (data.type === 'COMPILE_ERROR') {
                setError(String((data.error as Error)?.message || data.error || 'Compile failed'))
                // 不更新 iframeContent——保留上次成功的预览页面，不让用户看到空白
            }
        })
    }

    /** 挂载时启动 Worker，卸载时清理所有资源 */
    useEffect(() => {
        setupWorker()
        return () => {
            workerRef.current?.terminate()
            clearTimeout(scheduleTimerRef.current)
            clearTimeout(watchdogRef.current)
            // 组件卸载时回收所有未释放的 blob URLs
            prevBlobUrlsRef.current.forEach(url => URL.revokeObjectURL(url))
        }
    }, [])

    // ── 防抖调度 ─────────────────────────────────────────────────────────────

    /**
     * 每次 files 变化时，重置防抖定时器，500ms 后发送编译请求。
     *
     * 为什么不用 debounce 库？
     *   常见错误写法：useEffect(debounce(() => worker.postMessage(files), 500), [files])
     *   问题：React 每次执行 useEffect 都会重新调用 debounce(fn, 500)，
     *   创建一个全新的 debounced 函数，之前的定时器句柄就丢失了，防抖永远不触发。
     *
     *   正确做法：用 clearTimeout + setTimeout 手动管理，
     *   通过 useRef 保存定时器 ID，cleanup 函数清除上一次的定时器。
     *   这才是真正的防抖——每次 files 变化清掉旧定时器，重设新的。
     */
    useEffect(() => {
        clearTimeout(scheduleTimerRef.current)
        scheduleTimerRef.current = setTimeout(() => {
            // 每次发送请求时递增 ID，这个值会随消息一起发给 Worker
            const requestId = ++latestRequestIdRef.current

            // 重设看门狗：如果 5s 后 Worker 没有回复，认为它卡死了
            clearTimeout(watchdogRef.current)
            watchdogRef.current = setTimeout(() => {
                setupWorker()
            }, 5000)

            // 把当前文件快照和请求 ID 一起发给 Worker
            workerRef.current?.postMessage({ files, requestId })
        }, 500)
    }, [files])

    // ── 接收 iframe 内部的运行时错误 ─────────────────────────────────────────

    /**
     * iframe.html 里的 error handler 会用 window.parent.postMessage 上报运行时错误，
     * 这里监听并展示出来。
     *
     * 用 useCallback(fn, []) 保证函数引用稳定，
     * 这样下面的 addEventListener effect 依赖数组只需写 [handleIframeMessage]，
     * 不会因为函数引用变化而重复注册/移除监听器。
     */
    const handleIframeMessage = useCallback((msg: IframeMessage) => {
        const { type, message } = msg.data
        if (type === 'ERROR') setError(message)
    }, [])

    useEffect(() => {
        window.addEventListener('message', handleIframeMessage)
        return () => window.removeEventListener('message', handleIframeMessage)
    }, [handleIframeMessage])

    // ── 渲染 ──────────────────────────────────────────────────────────────────

    return <div style={{ height: '100%' }}>
        <iframe
            srcDoc={iframeContent}  // 用 srcDoc 而不是 src，不需要服务端，纯浏览器沙箱运行
            style={{
                width: '100%',
                height: '100%',
                padding: 0,
                border: 'none',
            }}
        />
        {/* Message 悬浮在 iframe 上方，显示编译错误，不影响预览显示 */}
        <Message type='error' content={error} />
    </div>
}
