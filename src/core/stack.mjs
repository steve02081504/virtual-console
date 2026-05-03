// 在非浏览器环境（Node.js / Deno 等）中加载 fs/url 以正确解析 file:// 路径；浏览器中降级为简单实现
/**
 * 默认 realpath 实现：在不支持 node:fs 的环境中保持原样返回。
 * @param {string} path - 待规范化的文件路径。
 * @returns {string} 规范化后的路径；在降级实现中等于输入值。
 */
let realpathSync = path => path
/**
 * 默认 fileURLToPath 实现：在不支持 node:url 的环境中尽量解析 URL pathname。
 * @param {string} path - `file://` URL 或普通路径字符串。
 * @returns {string} 解析后的本地路径；解析失败时回退原字符串。
 */
let fileURLToPath = path => { try { return new URL(path).pathname } catch { return path } }
/**
 * 默认 pathToFileURL 实现：将本地路径转换为 file:// URL 字符串，用于构造可点击链接。
 * 在 node:url 可用时会替换为原生实现，以正确处理 Windows 盘符等边界情况。
 * @param {string} path - 本地文件路径。
 * @returns {string} 对应的 file:// URL 字符串。
 */
export let pathToFileURL = path => {
	if (!path || path.includes('://')) return path
	const normalized = path.replace(/\\/g, '/')
	const base = normalized.startsWith('/') ? 'file://' : 'file:///'
	return base + normalized.split('/').map(encodeURIComponent).join('/')
}
if (!globalThis.document) await Promise.all([
	import('node:fs').then(m => { realpathSync = m.realpathSync }),
	import('node:url').then(m => {
		fileURLToPath = m.fileURLToPath
		/**
		 * 使用 Node 原生 `url.pathToFileURL` 生成含正确编码的 `href`。
		 * @param {string} p - 本地文件路径。
		 * @returns {string} 对应的 file:// URL 字符串。
		 */
		pathToFileURL = p => m.pathToFileURL(p).href
	}),
]).catch(() => { })

/**
 * 获取当前执行点的调用栈信息，并按 skip_num 跳过前若干内部帧。
 * @param {number} [skip_num=0] - 额外跳过的栈帧数（不含 getStackInfo 自身）。
 * @returns {StackFrame[]} 解析后的栈帧数组；若运行时不提供 stack 则返回空数组。
 */
export function getStackInfo(skip_num = 0) {
	const error = new Error()
	if (!error.stack) return []
	skip_num++ // skip getStackInfo itself
	if (globalThis.chrome || !globalThis.document) skip_num++ // chrome/node/deno: skip "Error:" line
	const stackLines = error.stack.split('\n').slice(skip_num).filter(line => line.trim())

	return stackLines.map(line => {
		const match = line.match(/at\s+(?:(?<functionName>.*)\s+)?\((?<filePath>.*?):(?<line>\d+):(?<column>\d+)\)?$/) ||
			line.match(/(?:(?<functionName>.*)\s+)?@(?<filePath>.*?):(?<line>\d+):(?<column>\d+)$/) ||
			line.match(/at\s+(?<filePath>\S+):(?<line>\d+):(?<column>\d+)$/)
		const result = {
			functionName: '',
			filePath: '',
			line: 0,
			column: 0,
			raw: line
		}
		if (match) {
			const { functionName, filePath, line, column } = match.groups
			result.functionName = functionName
			result.filePath = filePath.startsWith('file://') ? realpathSync(fileURLToPath(filePath)) : filePath
			result.line = Number(line)
			result.column = Number(column)
		}
		return result
	})
}

/**
 * 判断路径是否像 Node 嵌入的运行时栈帧（非用户源码）。
 * @param {string} filePath - `StackFrame.filePath`
 * @returns {boolean} 若路径疑似 Node/Deno 运行时内部帧（如 `node:internal/...`）则为 true。
 */
function isRuntimeInternalFilePath(filePath) {
	return /^node:/.test(filePath)
}

/**
 * 去掉栈顶连续的 Node 运行时内部帧（如 `node:internal/...`、`node:_stream_writable`、`deno:`）。
 * 用于 `process.stdout`/`stderr` 写入：流实现会在用户调用之上插入多层运行时栈。
 * @param {StackFrame[]} frames - `getStackInfo` 解析结果
 * @returns {StackFrame[]} 去掉栈顶连续运行时内部帧后的数组（无非内部帧时原样切片）。
 */
export function trimLeadingRuntimeInternalFrames(frames) {
	let index = frames.findIndex(f => !isRuntimeInternalFilePath(f.filePath))
	if (index === -1) index = 0
	return frames.slice(index)
}
