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
	const winDrive = /^([A-Za-z]):(\/|$)/.exec(normalized)
	if (winDrive) {
		const rest = normalized.slice(3)
		const encodedRest = rest ? rest.split('/').map(encodeURIComponent).join('/') : ''
		return `file:///${winDrive[1]}:/${encodedRest}`
	}
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
 * 解析单行 stack 文本，规则与 {@link getStackInfo} 一致（用于 Error 栈着色 / OSC8）。
 * @param {string} line - V8 等引擎输出的单行栈帧。
 * @returns {import('../shared.d.mts').StackFrame} 解析失败时仅含 `raw`，路径字段为空。
 */
export function parseStackTraceLine(line) {
	const match = line.match(/at\s+(?:(?<functionName>.*)\s+)?\((?<filePath>.*?):(?<line>\d+):(?<column>\d+)\)?$/) ||
		line.match(/(?:(?<functionName>.*)\s+)?@(?<filePath>.*?):(?<line>\d+):(?<column>\d+)$/) ||
		line.match(/at\s+(?<filePath>\S+):(?<line>\d+):(?<column>\d+)$/)
	/** @type {import('../shared.d.mts').StackFrame} */
	const result = {
		functionName: '',
		filePath: '',
		line: 0,
		column: 0,
		raw: line,
	}
	if (!match?.groups) return result
	const { functionName, filePath, line: lineStr, column } = match.groups
	if (functionName !== undefined) result.functionName = functionName
	if (filePath) {
		result.filePath = filePath.startsWith('file://') ? realpathSync(fileURLToPath(filePath)) : filePath
		result.line = Number(lineStr)
		result.column = Number(column)
	}
	return result
}

/**
 * 将原始 stack 字符串按与 {@link getStackInfo} / {@link parseErrorStack} 相同的规则切片后逐行解析。
 * @param {string} stackStr - `error.stack`。
 * @param {number} leadingLinesToSkip - 在应用 runtime 额外跳过之前，从顶部丢弃的行数。
 * @returns {import('../shared.d.mts').StackFrame[]} 解析得到的帧序列。
 */
function parseStackStringToFrames(stackStr, leadingLinesToSkip) {
	if (!stackStr || typeof stackStr !== 'string') return []
	const lines = stackStr.split('\n')
	if (lines.length === 1 && lines[0] === '')
		return []
	let skip = leadingLinesToSkip
	if (globalThis.chrome || !globalThis.document) skip++
	const stackLines = lines.slice(skip).filter(line => line.trim())
	return stackLines.map(line => parseStackTraceLine(line))
}

/**
 * 解析任意 `Error` 的栈：先丢弃 `skipNum` 行，再按 runtime（Chrome / Node / Deno 等）多跳过一行（通常为 `Error:` 标题行），与 {@link getStackInfo} 同源。
 * @param {unknown} error - 含 `stack` 的对象（一般为 `Error`）。
 * @param {number} [skipNum=0] - 额外跳过的顶行数（不含 runtime 那一行）。
 * @returns {import('../shared.d.mts').StackFrame[]} 错误栈帧数组。
 */
export function parseErrorStack(error, skipNum = 0) {
	if (!error || typeof /** @type {{ stack?: unknown }} */ error.stack !== 'string') return []
	return parseStackStringToFrames(/** @type {{ stack: string }} */ error.stack, skipNum)
}

/**
 * 是否适合生成可点击 OSC8 `href`（与 trace 栈一致：`http(s)`、`file:`、常见本地路径）。
 * @param {string} filePath - 解析出的路径段。
 * @returns {boolean} 可生成 OSC8 / file URL 时为 true。
 */
export function isLinkableStackPath(filePath) {
	if (!filePath || typeof filePath !== 'string') return false
	if (filePath.startsWith('node:')) return false
	if (/^https?:\/\//.test(filePath)) return true
	if (filePath.startsWith('file://')) return true
	if (/^eval/.test(filePath)) return false
	if (/^[/\\]/.test(filePath)) return true
	if (/^[A-Za-z]:[/\\]/.test(filePath)) return true
	return false
}

/**
 * 由解析栈帧得到 OSC8 目标 URL；不可链接时返回空串。
 * @param {import('../shared.d.mts').StackFrame} frame - {@link parseStackTraceLine} 产物。
 * @returns {string} 链接触点的 URL；不可链时为空串。
 */
export function stackFrameToOsc8Href(frame) {
	if (!frame?.filePath || !(frame.line > 0)) return ''
	const fp = frame.filePath
	if (!isLinkableStackPath(fp)) return ''
	if (/^https?:\/\//.test(fp)) return `${fp}:${frame.line}:${frame.column}`
	return `${pathToFileURL(fp)}:${frame.line}:${frame.column}`
}

/**
 * 获取当前执行点的调用栈信息，并按 `leadingLinesToSkip` 跳过 stack 字符串顶部的若干行。
 * `skip = 0` 表示仅应用运行时默认规则（见 {@link parseStackStringToFrames} 内 Chrome/Node 额外跳行），
 * 不从「调用者」起算隐式偏移； larger skip 值显式丢弃更多顶行。
 * @param {number} [leadingLinesToSkip=0] - 在 {@link parseStackStringToFrames} 规则之前从 `error.stack` 顶部丢弃的行数。
 * @returns {StackFrame[]} 解析后的栈帧数组；若运行时不提供 stack 则返回空数组。
 */
export function getStackInfo(leadingLinesToSkip = 0) {
	const error = new Error()
	if (!error.stack) return []
	return parseStackStringToFrames(error.stack, leadingLinesToSkip)
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
