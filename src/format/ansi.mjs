import { AnsiUp } from 'ansi_up'

const ansi_up = new AnsiUp()

/** CSI「ESC [ … 最终字节」及常见两字节 ESC 序列（OSC 已由上文单独处理） */
const CSI_REGEX = /\x1b\[[\x30-\x3f]*[\x20-\x2f]*[\x40-\x7e]/g
const ESC_SIMPLE_REGEX = /\x1b[\x40-\x5f]/g

/** OSC 8 超链接（7-bit ESC） */
const OSC8_REGEX = /\u001B]8;;([^\u0007\u001B]*)(?:\u0007|\u001B\\)([\S\s]*?)\u001B]8;;(?:\u0007|\u001B\\)/g
/** OSC 8（C1 SS3 引导） */
const OSC8_C1_REGEX = /\u009D8;;([^\u0007\u001B]*)(?:\u0007|\u001B\\)([\S\s]*?)\u009D8;;(?:\u0007|\u001B\\)/g

/**
 * 转义 HTML 字符
 * @param {string} str - 要转义的字符串。
 * @returns {string} 转义后的字符串。
 */
export function escapeHtml(str) {
	return str.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
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
 * 剥离 OSC / ANSI / 零宽与控制字符，得到可供搜索、过滤的可见文本（与 `toString()` 语义对齐）。
 * @param {string} text - 原始文本。
 * @returns {string} OSC8 仅保留可见标签文本；CSI 与其它控制符移除。
 */
export function stripTerminalDecorations(text) {
	let plain = stripOscTitleSequences(String(text || ''))
	plain = plain.replace(OSC8_REGEX, (_full, _href, label) => String(label || ''))
	plain = plain.replace(OSC8_C1_REGEX, (_full, _href, label) => String(label || ''))
	plain = plain.replace(/\u001B][^\u0007\u001B]*(?:\u0007|\u001B\\)/g, '')
	plain = plain.replace(/\u009D[^\u0007\u001B]*(?:\u0007|\u001B\\)/g, '')
	plain = plain.replace(CSI_REGEX, '')
	plain = plain.replace(ESC_SIMPLE_REGEX, '')
	plain = plain.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '')
	plain = plain.replace(/[\u200B-\u200D\uFEFF]/g, '')
	return plain.trim()
}

/**
 * 终端文本块 → HTML：剥标题 OSC，OSC8→锚点，再经 AnsiUp（供 `argsToHtml` / 流式条目使用）。
 * @param {string} chunk - 原始片段。
 * @returns {string} 已转义且可安全插入 DOM 的 HTML 字符串。
 */
export function terminalChunkToHtml(chunk) {
	const cleaned = stripOscTitleSequences(chunk)
	let index = 0
	const placeholders = []
	/**
	 * `String.replace` 回调：把 OSC8 超链接替换为占位 token，最后再还原成 `<a>`。
	 * @param {string} _full - 完整匹配串（未使用）。
	 * @param {string} href - 链接 URL。
	 * @param {string} label - 链接可见文本（可含 ANSI）。
	 * @returns {string} 占位 token，后续替换为 HTML。
	 */
	const replaceLink = (_full, href, label) => {
		const token = `__OSC8_${index++}__`
		const labelInner = ansi_up.ansi_to_html(String(label || ''))
		const hrefAttr = escapeHtml(String(href || ''))
		placeholders.push({
			token,
			html: `<a href="${hrefAttr}" target="_blank" rel="noopener noreferrer" style="color:inherit">${labelInner}</a>`,
		})
		return token
	}
	const textWithPlaceholders = cleaned.replace(OSC8_REGEX, replaceLink).replace(OSC8_C1_REGEX, replaceLink)
	let html = ansi_up.ansi_to_html(textWithPlaceholders)
	for (const { token, html: linkHtml } of placeholders)
		html = html.replaceAll(token, linkHtml)
	return html
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

/**
 * 将对象转换为字符串，处理循环引用。
 * @param {any} target - 要转换的目标对象。
 * @param {object} [options] - 转换选项。
 * @param {number} [options.depth = Infinity] - 最大递归深度。
 * @param {boolean} [options.colorize = true] - 是否支持 ANSI 序列。
 * @returns {string} 转换后的字符串。如果 colorize 为 true，则返回 ANSI 序列化的字符串。
 */
export function circularToString(target, options = {}) {
	const { depth = Infinity, colorize = true } = options

	const colors = colorize ? {
		reset: '\x1b[0m',
		green: '\x1b[32m',
		yellow: '\x1b[33m',
		cyan: '\x1b[36m',
		grey: '\x1b[90m',
		magenta: '\x1b[35m'
	} : {
		reset: '',
		green: '',
		yellow: '',
		cyan: '',
		grey: '',
		magenta: '',
	}

	const circularIds = new Map()
	const walkStack = new Set()
	let idCounter = 1

	/**
	 * 扫描对象以检测循环引用。
	 * @param {any} value - 要扫描的值。
	 */
	function scan(value) {
		if (typeof value !== 'object' || value === null) return

		if (walkStack.has(value)) {
			if (!circularIds.has(value)) circularIds.set(value, idCounter++)
			return
		}

		walkStack.add(value)
		const keys = [...Object.keys(value), ...Object.getOwnPropertySymbols(value)]
		for (const key of keys) scan(value[key])
		walkStack.delete(value)
	}

	scan(target)
	const seen = new Set()

	/**
	 * 格式化值为字符串。
	 * @param {any} value - 要格式化的值。
	 * @param {number} currentDepth - 当前递归深度。
	 * @returns {string} 格式化后的字符串。
	 */
	function format(value, currentDepth) {
		if (typeof value === 'string') return `${colors.green}'${value}'${colors.reset}`
		if (typeof value === 'number') return `${colors.yellow}${value}${colors.reset}`
		if (typeof value === 'boolean') return `${colors.yellow}${value}${colors.reset}`
		if (value === undefined) return `${colors.grey}undefined${colors.reset}`
		if (value === null) return `${colors.reset}null${colors.reset}`
		if (typeof value === 'symbol') return `${colors.green}${value.toString()}${colors.reset}`
		if (typeof value === 'function') return `${colors.cyan}[Function: ${value.name || '(anonymous)'}]${colors.reset}`

		if (value instanceof Date) return `${colors.magenta}${value.toISOString()}${colors.reset}`
		if (value instanceof RegExp) return `${colors.magenta}${value.toString()}${colors.reset}`

		const refId = circularIds.get(value)
		if (seen.has(value) && refId) return `${colors.cyan}[Circular *${refId}]${colors.reset}`

		if (currentDepth > depth) return `${colors.cyan}[Object]${colors.reset}`

		seen.add(value)

		const isArray = Array.isArray(value)
		const prefix = refId ? `${colors.cyan}<ref *${refId}>${colors.reset} ` : ''
		const open = isArray ? '[' : '{'
		const close = isArray ? ']' : '}'

		const keys = [...Object.keys(value), ...Object.getOwnPropertySymbols(value)]

		if (!keys.length) return `${prefix}${open}${close}`

		const spaces = '\t'.repeat(currentDepth)
		const nextSpaces = '\t'.repeat(currentDepth + 1)

		const content = keys.map(key => {
			let keyStr = ''
			if (!isArray) {
				keyStr = typeof key === 'symbol' ? `[${key.toString()}]` : key
				if (!/^[$A-Z_a-z][\w$]*$/.test(keyStr)) keyStr = `'${keyStr.replaceAll('\'', '\\\'').replaceAll('\n', '\\n')}'`
				keyStr += ': '
			}
			const valStr = format(value[key], currentDepth + 1)
			return `${nextSpaces}${keyStr}${valStr}`
		}).join(',\n')
		seen.delete(value)
		return `${prefix}${open}\n${content}\n${spaces}${close}`
	}

	return format(target, 0)
}
