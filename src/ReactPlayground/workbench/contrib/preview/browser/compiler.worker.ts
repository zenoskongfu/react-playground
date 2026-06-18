/**
 * compiler.worker.ts — Babel 编译 Worker
 *
 * 这个文件运行在独立的 Web Worker 线程里，不在主线程执行。
 *
 * 为什么用 Worker？
 *   Babel 的 transform() 是纯 CPU 密集型的同步操作，
 *   放在主线程里会阻塞 UI，导致用户输入卡顿。
 *   把它放到 Worker 线程，编译期间主线程依然流畅响应输入。
 *
 * 消息协议（与 previewView.tsx 对应）：
 *   主线程 → Worker: { files: Files, requestId: number }
 *   Worker → 主线程（成功）: { type: 'COMPILED_CODE', data: string, requestId, blobUrls: string[] }
 *   Worker → 主线程（失败）: { type: 'COMPILE_ERROR', error: Error, requestId }
 */

import { transform } from "@babel/standalone";
import { File, Files } from "../../../../PlaygroundContext";
import { ENTRY_FILE_NAME } from "../../../../files";

const LEGACY_ENTRY_FILE_NAME = "main.tsx"; // 兼容旧工作区的入口文件名

// ─── Blob URL 追踪 ────────────────────────────────────────────────────────────

/**
 * compileBlobUrls：本次编译产生的所有 blob URL。
 *
 * 为什么要追踪 blob URL？
 *   编译器会把每个本地模块（CSS、JSON、TS）的内容转成 blob URL，
 *   让 ES Module import 能加载它们。但 blob URL 不会自动回收，
 *   需要显式调用 URL.revokeObjectURL() 释放内存。
 *
 * 策略：
 *   - 每次编译开始时清空这个数组
 *   - 编译成功：把 URL 列表发回主线程，由主线程决定何时回收
 *     （要等 iframe 加载完当前这批模块，才能安全回收上一批）
 *   - 编译失败：立即在 Worker 里回收，因为 iframe 不会加载失败的结果
 *
 * 用模块级变量而非函数参数传递，因为 customResolver 是 Babel 插件，
 * 它的调用堆栈不经过我们的手，只能通过共享变量传递数据。
 */
let compileBlobUrls: string[] = [];

// ─── 代码预处理 ───────────────────────────────────────────────────────────────

/**
 * beforeTransformCode：Babel 转换前的预处理。
 *
 * React 17 之前需要在每个 JSX 文件里手动 import React，
 * 这里自动添加，省去用户每次都要写的麻烦。
 * 只对 .jsx/.tsx 文件处理，且检查文件里是否已经有 React import。
 */
export const beforeTransformCode = (filename: string, code: string) => {
	let _code = code;
	// 手动添加 import react from 'React'
	const regexReact = /import\s+React/g;
	if ((filename.endsWith(".jsx") || filename.endsWith(".tsx")) && !regexReact.test(code)) {
		_code = `import React from 'react';\n${code}`;
	}
	return _code;
};

/**
 * babelTransform：用 Babel 把 TSX/JSX 转换成浏览器可运行的 ES Module。
 *
 * presets：
 *   - react：处理 JSX 语法（<div> → React.createElement）
 *   - typescript：去掉类型注解
 *
 * plugins：
 *   - customResolver：自定义模块解析插件（核心！处理本地 import）
 *
 * retainLines: true：保持源码行号对应关系，方便调试报错定位到原始文件
 */
export const babelTransform = (filename: string, code: string, files: Files) => {
	const _code = beforeTransformCode(filename, code);
	let result = "";
	try {
		result = transform(_code, {
			presets: ["react", "typescript"],
			filename,
			plugins: [customResolver(files, filename)],
			retainLines: true,
		}).code!;
	} catch (e) {
		console.error("编译出错", e);
	}
	return result;
};

// ─── 模块路径解析 ─────────────────────────────────────────────────────────────

/** 取路径的目录部分（类似 Node.js 的 path.dirname） */
const dirname = (path: string) => path.split("/").slice(0, -1).join("/");

/**
 * normalizeSegments：把含有 ./ 和 ../ 的路径规范化。
 * 例：src/components/../utils → src/utils
 */
const normalizeSegments = (path: string) => {
	const parts: string[] = [];
	path.split("/").forEach((part) => {
		if (!part || part === ".") return;
		if (part === "..") {
			parts.pop(); // 遇到 .. 就退一级
			return;
		}
		parts.push(part);
	});
	return parts.join("/");
};

/**
 * getModuleFile：在 files 里查找 import 语句对应的文件。
 *
 * 先尝试精确匹配，如果没有扩展名就按优先级依次尝试：
 *   .ts → .tsx → .js → .jsx → .json → .css → /index.ts → /index.tsx
 * 这模拟了 Node.js / webpack 的模块解析行为。
 */
const getModuleFile = (files: Files, importer: string, modulePath: string) => {
	// 把相对路径解析为绝对路径（基于当前文件的目录）
	let moduleName = normalizeSegments(`${dirname(importer)}/${modulePath}`);
	const exactFile = files[moduleName];
	if (exactFile) return exactFile;

	if (!moduleName.includes(".")) {
		const realModuleName = [
			`${moduleName}.ts`,
			`${moduleName}.tsx`,
			`${moduleName}.js`,
			`${moduleName}.jsx`,
			`${moduleName}.json`,
			`${moduleName}.css`,
			`${moduleName}/index.ts`,
			`${moduleName}/index.tsx`,
		].find((key) => files[key]);
		if (realModuleName) {
			moduleName = realModuleName;
		}
	}
	return files[moduleName];
};

// ─── Blob URL 创建 ────────────────────────────────────────────────────────────

/**
 * createTrackedBlob：创建 blob URL 并记录到 compileBlobUrls。
 *
 * URL.createObjectURL 把内存中的数据包装成一个可以被 import 的 URL（blob:// 协议）。
 * 浏览器把这个 URL 当成普通的 ES Module URL 来加载，
 * 所以编译后的代码里的 import 语句可以直接引用它。
 */
const createTrackedBlob = (content: string, type: string) => {
	const url = URL.createObjectURL(new Blob([content], { type }));
	compileBlobUrls.push(url); // 记录，方便后续回收
	return url;
};

/**
 * json2Js：把 JSON 文件转换成 ES Module。
 * 包装成 `export default {...}` 的形式，让 import data from './data.json' 能正常工作。
 */
const json2Js = (file: File) => {
	return createTrackedBlob(`export default ${file.value}`, "application/javascript");
};

/**
 * css2Js：把 CSS 文件转换成会注入 <style> 标签的 JS 模块。
 *
 * 浏览器里不能直接 import './style.css'（不像 webpack/vite 有 loader），
 * 所以把 CSS 内容包装成一段 JS：运行时创建 <style> 元素并插入到 <head>。
 * randomId 用时间戳防止多个 CSS 文件的 style 元素 ID 冲突。
 */
const css2Js = (file: File) => {
	const randomId = new Date().getTime();
	const js = `
(() => {
    const stylesheet = document.createElement('style')
    stylesheet.setAttribute('id', 'style_${randomId}_${file.name}')
    document.head.appendChild(stylesheet)

    const styles = document.createTextNode(\`${file.value}\`)
    stylesheet.innerHTML = ''
    stylesheet.appendChild(styles)
})()
    `;
	return createTrackedBlob(js, "application/javascript");
};

// ─── Babel 插件：自定义模块解析器 ─────────────────────────────────────────────

/**
 * customResolver：Babel AST 插件，拦截所有以 . 开头的 import 语句。
 *
 * Babel 在解析 AST 时遍历每个节点，visitor.ImportDeclaration 会在遇到
 * import 语句时被调用。我们把 import 的路径（source.value）替换成 blob URL，
 * 这样浏览器运行编译后的代码时，import './Button' 就变成了 import 'blob://...'。
 *
 * 处理逻辑：
 *   - CSS 文件 → 转换成注入样式的 JS 模块（css2Js）
 *   - JSON 文件 → 转换成 export default 的 JS 模块（json2Js）
 *   - 其他 TS/TSX 文件 → 递归调用 babelTransform 编译，再转成 blob URL
 *
 * 注意：这里的递归（babelTransform → customResolver → babelTransform）
 * 会按依赖树深度优先地编译所有本地模块，最终每个模块都变成独立的 blob URL。
 */
function customResolver(files: Files, filename: string) {
	return {
		visitor: {
			// 处理import语句
			ImportDeclaration(path: any) {
				const modulePath = path.node.source.value;
				// 只处理相对路径的 import（以 . 开头），第三方包（如 react）不处理
				if (modulePath.startsWith(".")) {
					const file = getModuleFile(files, filename, modulePath);
					if (!file) return;

					if (file.name.endsWith(".css")) {
						path.node.source.value = css2Js(file);
					} else if (file.name.endsWith(".json")) {
						path.node.source.value = json2Js(file);
					} else {
						// 递归编译 TS/TSX 模块，编译结果作为 blob URL
						path.node.source.value = createTrackedBlob(
							babelTransform(file.name, file.value, files),
							"application/javascript",
						);
					}
				}
			},
		},
	};
}

// ─── 入口编译 ─────────────────────────────────────────────────────────────────

/**
 * compile：从入口文件开始编译整个工作区。
 *
 * 只需编译入口文件（src/main.tsx），customResolver 插件会在编译过程中
 * 递归地把所有 import 的本地模块也编译成 blob URL，形成完整的依赖图。
 */
export const compile = (files: Files) => {
	const main = files[ENTRY_FILE_NAME] || files[LEGACY_ENTRY_FILE_NAME];
	if (!main) {
		throw new Error(`Entry file not found. Expected ${ENTRY_FILE_NAME} or ${LEGACY_ENTRY_FILE_NAME}.`);
	}
	return babelTransform(main.name, main.value, files);
};

// ─── Worker 消息处理 ──────────────────────────────────────────────────────────

/**
 * 监听来自主线程的编译请求。
 *
 * 每次请求开始时重置 compileBlobUrls，确保不同编译请求的 blob URL 不会混在一起。
 * requestId 原样回传给主线程，主线程靠它判断是否是最新的请求结果。
 */
self.addEventListener("message", ({ data }) => {
	const { files, requestId } = data;
	compileBlobUrls = []; // 开始新的编译，清空上次的 URL 列表

	try {
		const result = compile(files);
		self.postMessage({
			type: "COMPILED_CODE",
			data: result,
			requestId,
			blobUrls: [...compileBlobUrls], // 发回 blob URL 列表，由主线程管理回收时机
		});
	} catch (e) {
		// 编译失败：立即回收这次编译产生的部分 blob URL（它们不会被使用）
		compileBlobUrls.forEach((url) => URL.revokeObjectURL(url));
		compileBlobUrls = [];
		self.postMessage({ type: "COMPILE_ERROR", error: e, requestId });
	}
});
