import { AnsiUp } from 'ansi_up'

const ansi_up = new AnsiUp()

/**
 * 转义 HTML 字符
 * @param {string} str - 要转义的字符串。
 * @returns {string} 转义后的字符串。
 */
export function escapeHtml(str) {
	return str.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

/**
 * 安全地将值转换为字符串，处理无原型对象（如 Object.create(null)）。
 * @param {any} arg - 要转换的值。
 * @returns {string} 转换后的字符串。
 */
export function safeString(arg) {
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
 * @returns {string} 转换后的字符串。
 */
export function circularToString(target, options = {}) {
	const { depth = Infinity } = options

	const colors = {
		reset: '\x1b[0m',
		green: '\x1b[32m',
		yellow: '\x1b[33m',
		cyan: '\x1b[36m',
		grey: '\x1b[90m',
		magenta: '\x1b[35m'
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
		// 1. 处理原始类型
		if (typeof value === 'string') return `${colors.green}'${value}'${colors.reset}`
		if (typeof value === 'number') return `${colors.yellow}${value}${colors.reset}`
		if (typeof value === 'boolean') return `${colors.yellow}${value}${colors.reset}`
		if (value === undefined) return `${colors.grey}undefined${colors.reset}`
		if (value === null) return `${colors.reset}null${colors.reset}`
		if (typeof value === 'symbol') return `${colors.green}${value.toString()}${colors.reset}`
		if (typeof value === 'function') return `${colors.cyan}[Function: ${value.name || '(anonymous)'}]${colors.reset}`

		// 2. 处理特殊对象
		if (value instanceof Date) return `${colors.magenta}${value.toISOString()}${colors.reset}`
		if (value instanceof RegExp) return `${colors.magenta}${value.toString()}${colors.reset}`

		// 3. 处理循环引用检查
		const refId = circularIds.get(value)
		if (seen.has(value) && refId) return `${colors.cyan}[Circular *${refId}]${colors.reset}`

		// 4. 处理深度限制
		if (currentDepth > depth) return `${colors.cyan}[Object]${colors.reset}`

		// 标记为已处理
		seen.add(value)

		// 5. 构建对象/数组字符串
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

/**
 * 将参数格式化为 HTML 字符串。
 * @param {any} arg - 参数。
 * @returns {string} 格式化后的 HTML 字符串。
 */
function argToHtml(arg) {
	if (arg instanceof Error && arg.stack) return ansi_up.ansi_to_html(arg.stack)
	if ((arg === null || arg instanceof Object) && !(arg instanceof Function))
		try { return ansi_up.ansi_to_html(JSON.stringify(arg, null, '\t')) }
		catch { /* fall through */ }

	return ansi_up.ansi_to_html(circularToString(arg))
}

/**
 * 将 console 参数格式化为 HTML 字符串。
 * @param {any[]} args - console 方法接收的参数数组。
 * @returns {string} 格式化后的 HTML 字符串。
 */
export function argsToHtml(args) {
	if (args.length === 0) return ''
	const format = args[0]
	if (format?.constructor !== String)
		return args.map(argToHtml).join(' ')

	let html = ansi_up.ansi_to_html(format)
	let argIndex = 1
	let hasStyle = false

	const regex = /%[%Ocdfijos]/g
	html = html.replace(regex, (match) => {
		if (match === '%%') return '%'
		if (argIndex >= args.length) return match

		const arg = args[argIndex++]
		switch (match) {
			case '%c': {
				hasStyle = true
				return `</span><span style="${escapeHtml(safeString(arg))}">`
			}
			case '%s':
				return ansi_up.ansi_to_html(safeString(arg))
			case '%d':
			case '%i':
				return String(parseInt(safeString(arg)))
			case '%f':
				return String(parseFloat(safeString(arg)))
			case '%o':
			case '%O':
				return ansi_up.ansi_to_html(circularToString(arg))
			case '%j':
				try { return ansi_up.ansi_to_html(JSON.stringify(arg)) }
				catch { return ansi_up.ansi_to_html(safeString(arg)) }
		}
		return match
	})

	if (hasStyle) html = `<span>${html}</span>`

	const replaceTable = {
		'<span style="">': '<span>',
		'<span></span>': '',
	}

	Object.entries(replaceTable).forEach(([key, value]) => {
		html = html.replaceAll(key, value)
	})

	html += ' ' + args.slice(argIndex).map(argToHtml).join(' ')

	return html.trim().replaceAll('\n', '<br/>\n')
}
