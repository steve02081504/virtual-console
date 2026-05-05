import { pathToFileURL } from '../core/stack.mjs'
import { ansiToHtml } from '@steve02081504/ansi2html'

/** CSI「ESC [ … 最终字节」及常见两字节 ESC 序列（OSC 已由上文单独处理） */
const CSI_REGEX = /\x1b\[[\x30-\x3f]*[\x20-\x2f]*[\x40-\x7e]/g
const ESC_SIMPLE_REGEX = /\x1b[\x40-\x5f]/g

/** OSC 8 超链接（7-bit ESC） */
const OSC8_REGEX = /\u001B]8;;([^\u0007\u001B]*)(?:\u0007|\u001B\\)([\S\s]*?)\u001B]8;;(?:\u0007|\u001B\\)/g
/** OSC 8（C1 SS3 引导） */
const OSC8_C1_REGEX = /\u009D8;;([^\u0007\u001B]*)(?:\u0007|\u001B\\)([\S\s]*?)\u009D8;;(?:\u0007|\u001B\\)/g

/** 终端输出：OSC 8 超链接包络（7-bit ESC） */
const OSC8_LINK_START = '\x1b]8;;'
const OSC8_LINK_SEP = '\x07'
const OSC8_LINK_END = '\x1b]8;;\x07'

/**
 * 转义 HTML 字符
 * @param {string} str - 要转义的字符串。
 * @returns {string} 转义后的字符串。
 */
/** @type {Record<string, string>} */
const HTML_ESCAPES = {
	'&': '&amp;',
	'"': '&quot;',
	'<': '&lt;',
	'>': '&gt;',
}

/**
 * 转义 HTML 字符
 * @param {string} str - 要转义的字符串。
 * @returns {string} 转义后的字符串。
 */
export function escapeHtml(str) {
	return String(str).replace(/["&<>]/g, ch => HTML_ESCAPES[ch] ?? ch)
}

/**
 * 剥离窗口标题 OSC（0 / 2）。
 * @param {string} text - 原始文本。
 * @returns {string} 去掉 `\x1b]0;` / `\x1b]2;` 等标题序列后的字符串。
 */
export function stripOscTitleSequences(text) {
	return String(text || '')
		.replace(/\u001B][02];[\S\s]*?(?:\u0007|\u001B\\)/g, '')
		.replace(/\u009D[02];[\S\s]*?(?:\u0007|\u001B\\)/g, '')
}

/**
 * 剥离 OSC / ANSI / 零宽与控制字符（搜索、索引、`renderPlain` 专用）。
 * @param {string} text - 原始文本。
 * @returns {string} OSC8 仅保留可见标签文本；CSI 与其它控制符移除。
 */
export function stripTerminalDecorations(text) {
	let plain = stripOscTitleSequences(String(text || ''))
	plain = plain.replace(OSC8_REGEX, (m, h, label) => String(label || ''))
	plain = plain.replace(OSC8_C1_REGEX, (m, h, label) => String(label || ''))
	plain = plain.replace(/\u001B][^\u0007\u001B]*(?:\u0007|\u001B\\)/g, '')
	plain = plain.replace(/\u009D[^\u0007\u001B]*(?:\u0007|\u001B\\)/g, '')
	plain = plain.replace(CSI_REGEX, '')
	plain = plain.replace(ESC_SIMPLE_REGEX, '')
	plain = plain.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '')
	plain = plain.replace(/[\u200B-\u200D\uFEFF]/g, '')
	return plain
}

/**
 * OSC 8 超链接（7-bit ESC），用于终端 ANSI 输出。
 * @param {string} href - 目标 URL（如 `file:///…`）。
 * @param {string} [visibleText=''] - 可见文本（可含 ANSI）。
 * @returns {string} 包裹后的串；`href` 为空时仅返回可见文本。
 */
export function ansiHyperlink(href, visibleText = '') {
	const label = String(visibleText ?? '')
	if (!href) return label
	return `${OSC8_LINK_START}${href}${OSC8_LINK_SEP}${label}${OSC8_LINK_END}`
}

/**
 * 将单条栈帧格式化为 OSC 8 可点击行（与 `trace` 片段的 ANSI 分支一致）。
 * @param {{ filePath?: string, line?: number, column?: number, raw: string }} frame - 解析后的栈帧。
 * @returns {string} 含或不含 OSC 8 的单行文本。
 */
export function traceStackFrameAnsi(frame) {
	if (!frame.filePath || !(frame.line > 0))
		return frame.raw
	const href = `${pathToFileURL(frame.filePath)}:${frame.line}:${frame.column}`
	return ansiHyperlink(href, frame.raw)
}

/**
 * 终端文本块 → HTML：剥标题 OSC，解析 OSC8 锚点与 ANSI SGR（供片段 HTML 渲染 / 流式条目使用）。
 * @param {string} chunk - 原始片段。
 * @returns {string} 已转义且可安全插入 DOM 的 HTML 字符串。
 */
export function terminalChunkToHtml(chunk) {
	return ansiToHtml(stripOscTitleSequences(chunk))
}

/**
 * 将任意值转为字符串（`String` 失败时回退 JSON / Object.prototype.toString），用于 printf 等路径。
 * @param {any} arg - 要转换的值。
 * @returns {string} 转换后的字符串。
 */
export function coerceString(arg) {
	try {
		return String(arg)
	} catch {
		try {
			return JSON.stringify(arg)
		}
		catch {
			return Object.prototype.toString.call(arg)
		}
	}
}
