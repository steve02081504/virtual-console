import { pathToFileURL } from '../core/stack.mjs'

const OSC8_START = '\x1b]8;;'
const OSC8_SEP = '\x07'
const OSC8_END = '\x1b]8;;\x07'

/**
 * OSC 8 超链接（7-bit ESC），用于终端 ANSI 输出。
 * @param {string} href - 目标 URL（如 `file:///…`）。
 * @param {string} [visibleText=''] - 可见文本（可含 ANSI）。
 * @returns {string} 包裹后的串；`href` 为空时仅返回可见文本。
 */
export function osc8AnsiHyperlink(href, visibleText = '') {
	const label = String(visibleText ?? '')
	if (!href) return label
	return `${OSC8_START}${href}${OSC8_SEP}${label}${OSC8_END}`
}

/**
 * 将单条栈帧格式化为 OSC 8 可点击行（与 {@link RenderEngine} 中 `traceStack` 分支一致）。
 * @param {{ filePath?: string, line?: number, column?: number, raw: string }} frame - 解析后的栈帧。
 * @returns {string} 含或不含 OSC 8 的单行文本。
 */
export function traceStackFrameOsc8Ansi(frame) {
	if (!frame.filePath || !(frame.line > 0))
		return frame.raw
	const href = `${pathToFileURL(frame.filePath)}:${frame.line}:${frame.column}`
	return osc8AnsiHyperlink(href, frame.raw)
}
