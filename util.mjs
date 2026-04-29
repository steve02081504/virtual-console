import { AnsiUp } from 'ansi_up'

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
let pathToFileURL = path => {
	if (!path || path.startsWith('file://')) return path
	const normalized = path.replace(/\\/g, '/')
	const base = normalized.startsWith('/') ? 'file://' : 'file:///'
	return base + normalized.split('/').map(encodeURIComponent).join('/')
}
if (!globalThis.document) await Promise.all([
	import('node:fs').then(m => { realpathSync = m.realpathSync }),
	import('node:url').then(m => {
		fileURLToPath = m.fileURLToPath
		/**
		 * @param {string} p - 本地文件路径。
		 * @returns {string} 对应的 file:// URL 字符串。
		 */
		pathToFileURL = p => m.pathToFileURL(p).href
	}),
]).catch(e => 0)

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
 * 格式化 console 参数为字符串。
 * @param {any[]} args - console 方法接收的参数数组。
 * @returns {string} 格式化后的单行字符串。
 */
export function formatArgs(args) {
	if (args.length === 0) return ''
	const format = args[0]
	if (format?.constructor !== String)
		return args.map(arg => {
			if (Object(arg) instanceof String) return arg
			if (arg instanceof Error && arg.stack) return arg.stack
			try {
				return JSON.stringify(arg, null, '\t')
			}
			catch {
				return safeString(arg)
			}
		}).join(' ')

	let output = ''
	let argIndex = 1
	let lastIndex = 0
	const regex = /%[%Ocdfijos]/g
	let match

	while ((match = regex.exec(format)) !== null) {
		output += format.slice(lastIndex, match.index)
		lastIndex = regex.lastIndex

		if (match[0] === '%%') {
			output += '%'
			continue
		}

		if (argIndex >= args.length) {
			output += match[0]
			continue
		}

		const arg = args[argIndex++]
		switch (match[0]) {
			case '%c':
				break
			case '%s':
				output += safeString(arg)
				break
			case '%d':
			case '%i':
				try { output += String(parseInt(arg)) }
				catch { output += 'NaN' }
				break
			case '%f':
				try { output += String(parseFloat(arg)) }
				catch { output += 'NaN' }
				break
			case '%o':
			case '%O':
				return circularToString(arg)
			case '%j':
				try { output += JSON.stringify(arg, null, '\t') }
				catch { output += safeString(arg) }
				break
		}
	}
	output += format.slice(lastIndex)

	while (argIndex < args.length) {
		const arg = args[argIndex++]
		if (output) output += ' '
		if (arg instanceof Error && arg.stack) output += arg.stack
		else if ((arg === null || arg instanceof Object) && !(arg instanceof Function))
			try { output += JSON.stringify(arg, null, '\t') }
			catch { output += safeString(arg) }

		else output += safeString(arg)
	}

	return output
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

/**
 * 单条日志条目，包含级别、参数、调用栈和时间戳。
 * 在 Node.js 和浏览器中均可使用。
 * 调用栈由 VirtualConsole#addEntry 负责采集，此处默认为空数组。
 */
export class LogEntry {
	/**
	 * @param {string} level - 日志级别。
	 * @param {any[]} args - 日志参数。
	 * @param {ReturnType<typeof getStackInfo>} [stack] - 调用栈。
	 * @param {number} [timestamp] - 日志时间戳（默认 Date.now()）。
	 */
	constructor(level, args, stack = [], timestamp = Date.now()) {
		/** @type {string} */
		this.level = level
		/** @type {any[]} */
		this.args = args
		/** @type {ReturnType<typeof getStackInfo>} */
		this.stack = stack
		/** @type {number} */
		this.timestamp = timestamp
	}
	/** @returns {string} 按 console 语义格式化后的纯文本日志内容。 */
	toString() { return formatArgs(this.args) }
	/** @returns {string} 按 console 语义格式化后的 HTML 日志内容。 */
	toHtml() { return argsToHtml(this.args) }
}

/**
 * console.trace() 产生的特化日志条目。
 * toString/toHtml 会在参数内容之后追加格式化的调用栈，
 * 以便还原出与原生 console.trace 相似的完整输出。
 */
export class TraceLogEntry extends LogEntry {
	/**
	 * @param {string} level - 日志级别（通常固定为 'trace'）。
	 * @param {any[]} args - trace 的业务参数。
	 * @param {ReturnType<typeof getStackInfo>} [stack] - 调用栈帧数组。
	 * @param {boolean} [supportsAnsi=false] - 宿主控制台是否支持 ANSI 序列；
	 *   为 true 时 toString() 会在栈帧中嵌入 OSC 8 超链接。
	 */
	constructor(level, args, stack, supportsAnsi = false) {
		super(level, args, stack)
		/** @type {boolean} 宿主控制台是否支持 ANSI 超链接序列 */
		this.supportsAnsi = supportsAnsi
	}
	/**
	 * 将业务参数文本与格式化栈文本拼接后输出。
	 * 当 `this.supportsAnsi`（来自宿主控制台配置）为 true 时，每一帧会附加
	 * OSC 8 超链接序列（`\x1b]8;;url\x07text\x1b]8;;\x07`），指向对应源文件的精确行列，
	 * 在 VS Code 终端、iTerm2、Windows Terminal 等现代终端中可直接点击跳转。
	 * @returns {string} 可能含超链接转义序列的 trace 输出。
	 */
	toString() {
		const label = super.toString()
		const stackText = this.stack.map(f => {
			if (this.supportsAnsi && f.filePath && f.line > 0) {
				// file:///path:line:col 格式被 VS Code 终端识别并可跳转到指定行列
				const url = `${pathToFileURL(f.filePath)}:${f.line}:${f.column}`
				return `\x1b]8;;${url}\x07${f.raw}\x1b]8;;\x07`
			}
			return f.raw
		}).join('\n')
		return (label ? label + '\n' : '') + stackText
	}
	/**
	 * 追加灰色栈信息块后的 HTML trace 输出。
	 * 每一帧若含有有效的 filePath 和行号，则包裹为 `<a href="file:///path:line:col">` 链接，
	 * 在 VS Code Webview、Electron 等支持 file:// 协议的环境中可直接点击跳转。
	 * @returns {string} 含可点击文件链接的 HTML trace 输出。
	 */
	toHtml() {
		const label = super.toHtml()
		const stackHtml = this.stack
			.map(f => {
				const raw = escapeHtml(f.raw)
				if (f.filePath && f.line > 0) {
					const url = escapeHtml(`${pathToFileURL(f.filePath)}:${f.line}:${f.column}`)
					return `<a href="${url}" style="color:inherit;text-decoration:none">${raw}</a>`
				}
				return raw
			})
			.join('<br/>\n')
		return (label ? label + '<br/>\n' : '') +
			`<span style="color:gray;font-size:0.9em">${stackHtml}</span>`
	}
}

/**
 * 获取当前执行点的调用栈信息，并按 skip_num 跳过前若干内部帧。
 * @param {number} [skip_num=0] - 额外跳过的栈帧数（不含 getStackInfo 自身）。
 * @returns {StackFrame[]} 解析后的栈帧数组；若运行时不提供 stack 则返回空数组。
 */
export function getStackInfo(skip_num = 0) {
	const error = new Error()
	if (!error.stack) return []
	const stackLines = error.stack.split('\n').slice(1 + skip_num).filter(line => line.trim())

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
