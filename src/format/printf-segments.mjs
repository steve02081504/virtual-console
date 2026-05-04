import {
	DEFAULT_SNAPSHOT_DEPTH,
	serializeArgSnapshot,
} from '../core/snapshot.mjs'

import {
	circularToString,
	coerceString,
} from './ansi.mjs'

/** @typedef {{ kind: 'literal', text: string }} PrintfLiteralPart */
/** @typedef {{ kind: 'arg', spec: string, value: any }} PrintfArgPart */
/** @typedef {{ kind: 'missingSpec', spec: string }} PrintfMissingPart */

/**
 * 扫描 printf 风格首参 `format` 与 `args[1..]` 的对齐关系，产出统一 token 流（供 `formatArgs` / `buildArgsSegments` 消费）。
 * @param {string} format - 首参模板串。
 * @param {any[]} args - 完整实参数组（含 `args[0] === format`）。
 * @param {number} [startArgIndex=1] - 从第几个下标开始消费（通常为 `1`）。
 * @returns {{ parts: Array<PrintfLiteralPart | PrintfArgPart | PrintfMissingPart>; nextArgIndex: number }}
 *   `parts` 为从左到右的模板片段与占位解析结果；`nextArgIndex` 为已消费的最后一个实参的下一索引（尾部额外实参从此继续）。
 */
export function collectPrintfFormatParts(format, args, startArgIndex = 1) {
	const parts = /** @type {Array<PrintfLiteralPart | PrintfArgPart | PrintfMissingPart>} */ []
	let lastIndex = 0
	let argIndex = startArgIndex
	const regex = /%[%Ocdfijos]/g
	let match

	while ((match = regex.exec(format)) !== null) {
		const before = format.slice(lastIndex, match.index)
		if (before)
			parts.push({ kind: 'literal', text: before })
		lastIndex = regex.lastIndex

		const spec = match[0]
		if (spec === '%%') {
			parts.push({ kind: 'literal', text: '%' })
			continue
		}

		if (argIndex >= args.length) {
			parts.push({ kind: 'missingSpec', spec })
			continue
		}

		const value = args[argIndex++]
		parts.push({ kind: 'arg', spec, value })
	}

	const tail = format.slice(lastIndex)
	if (tail)
		parts.push({ kind: 'literal', text: tail })

	return { parts, nextArgIndex: argIndex }
}

/**
 * 与旧版 `argToHtml` 对齐：在套 `terminalChunkToHtml` 之前的 ANSI/纯文本源串（Error.stack / JSON / circularToString）。
 * @param {any} arg - 单个 console 参数。
 * @returns {string} 用于驱动 HTML 高亮的「伪 ANSI」源文本。
 */
function argToAnsiSourceForHtml(arg) {
	if (arg instanceof Error && arg.stack) return arg.stack
	if ((arg === null || arg instanceof Object) && !(arg instanceof Function))
		try { return JSON.stringify(arg, null, '\t') }
		catch { /* fall through */ }

	return circularToString(arg)
}

/**
 * 非 printf 模板路径下，将单个实参格式化为 `formatArgs` 用字符串。
 * @param {any} arg - 单个 console 实参（含 Error、`Object`、`String` 包装对象等）。
 * @returns {string} 供拼接输出的单行文本（Error 优先用 stack，对象优先 JSON，失败则 `coerceString`）。
 */
function formatArgAsPlainString(arg) {
	if (Object(arg) instanceof String) return /** @type {any} */ arg
	if (arg instanceof Error && arg.stack) return arg.stack
	try {
		return JSON.stringify(arg, null, '\t')
	}
	catch {
		return coerceString(arg)
	}
}

/**
 * printf 模板段：`kind === 'arg'` 时在「片段管线」与「纯文本管线」间共享的分支。
 * @param {string} spec - 如 `%s`（已排除 `%%`）。
 * @param {any} value - 绑定实参。
 * @param {object} segmentSink - `buildArgsSegments` 侧可变状态。
 * @param {object} stringSink - `formatArgs` 侧可变状态。
 * @param {object} stringSink.options - `circularToString` 选项。
 * @returns {void}
 */
function dispatchPrintfSpecifier(spec, value, segmentSink, stringSink) {
	switch (spec) {
		case '%c':
			segmentSink.styleCss = coerceString(value)
			break
		case '%s':
			segmentSink.pushText(coerceString(value))
			stringSink.output += coerceString(value)
			break
		case '%d':
		case '%i': {
			let n
			try { n = String(parseInt(value)) }
			catch { n = 'NaN' }
			segmentSink.pushText(n)
			stringSink.output += n
			break
		}
		case '%f': {
			let n
			try { n = String(parseFloat(value)) }
			catch { n = 'NaN' }
			segmentSink.pushText(n)
			stringSink.output += n
			break
		}
		case '%o':
		case '%O': {
			segmentSink.segments.push({
				kind: 'value',
				snapshot: serializeArgSnapshot(value, new WeakSet(), 0, segmentSink.maxDepth, segmentSink.expansionScope),
				css: segmentSink.styleCss || undefined,
				ansiText: circularToString(value, { depth: Infinity, colorize: true }),
			})
			stringSink.output += circularToString(value, stringSink.circularOptions)
			break
		}
		case '%j':
			try {
				const jsonText = JSON.stringify(value, null, '\t')
				segmentSink.pushText(jsonText)
				stringSink.output += jsonText
			}
			catch {
				const fallback = coerceString(value)
				segmentSink.pushText(fallback)
				stringSink.output += fallback
			}
			break
		default:
			break
	}
}

/**
 * `formatArgs` 专用：模板尾部追加单个实参（与 `buildArgsSegments` 尾段语义对齐）。
 * @param {any} arg - 尾部实参。
 * @param {{ output: string }} sink - 累积输出。
 * @returns {void}
 */
function appendTrailingArgPlainString(arg, sink) {
	if (arg instanceof Error && arg.stack) sink.output += arg.stack
	else if ((arg === null || arg instanceof Object) && !(arg instanceof Function))
		try { sink.output += JSON.stringify(arg, null, '\t') }
		catch { sink.output += coerceString(arg) }

	else sink.output += coerceString(arg)
}

/**
 * 将 printf 实参转为结构化片段（含快照树）；`expansionScope` / `snapshotDepth` 仅影响快照序列化，与终端/HTML 表现无关（表现由 {@link RenderEngine} 选项控制）。
 * @param {any[]} args - `console.*` 收到的原始参数数组。
 * @param {object | null} [expansionScope=null] - 惰性展开上下文（如 {@link createExpansionScope} 返回值）；无宿主条目时为 `null`。
 * @param {number} [snapshotDepth] - 快照递归深度上限；默认 {@link DEFAULT_SNAPSHOT_DEPTH}。
 * @returns {import('../shared.d.mts').LogSegment[]} 有序片段。
 */
export function buildArgsSegments(args, expansionScope = null, snapshotDepth = DEFAULT_SNAPSHOT_DEPTH) {
	if (!args.length) return []
	const maxDepth = snapshotDepth
	const format = args[0]
	if (format?.constructor !== String)
		return [{
			kind: 'values', items: args.map(arg => ({
				kind: 'value',
				snapshot: serializeArgSnapshot(arg, new WeakSet(), 0, maxDepth, expansionScope),
				ansiText: argToAnsiSourceForHtml(arg),
			}))
		}]

	const segments = /** @type {import('../shared.d.mts').LogSegment[]} */ []
	const { parts, nextArgIndex } = collectPrintfFormatParts(format, args, 1)
	let styleCss = ''

	/**
	 * 追加字面文本段（可选挂上当前 `%c` 的 `styleCss`）。
	 * @param {string} text - 要写入的文本。
	 */
	function pushText(text) {
		if (!text) return
		segments.push(styleCss ? { kind: 'text', text, css: styleCss } : { kind: 'text', text })
	}

	const noopString = { output: '', circularOptions: {} }
	for (const part of parts) {
		if (part.kind === 'literal') {
			pushText(part.text)
			continue
		}
		if (part.kind === 'missingSpec') {
			pushText(part.spec)
			continue
		}

		const segmentSink = {
			segments,
			maxDepth,
			expansionScope,
			/**
			 * @returns {string} 当前 `%c` 累积的 CSS 串。
			 */
			get styleCss() { return styleCss },
			/**
			 * @param {string} v - 新的 `%c` 样式。
			 * @returns {void}
			 */
			set styleCss(v) { styleCss = v },
			pushText,
		}
		dispatchPrintfSpecifier(part.spec, part.value, segmentSink, noopString)
	}

	for (let argIndex = nextArgIndex; argIndex < args.length; argIndex++) {
		const arg = args[argIndex]
		if (segments.length) segments.push({ kind: 'text', text: ' ' })
		segments.push({
			kind: 'value',
			snapshot: serializeArgSnapshot(arg, new WeakSet(), 0, maxDepth, expansionScope),
			ansiText: argToAnsiSourceForHtml(arg),
		})
	}

	return segments
}

/**
 * 格式化 console 参数为字符串。
 * @param {any[]} args - console 方法接收的参数数组。
 * @param {object} [options] - 用于格式化对象的选项。
 * @param {boolean} [options.colorize = true] - 是否支持 ANSI 序列。
 * @param {number} [options.depth = Infinity] - 最大递归深度。
 * @returns {string} 格式化后的单行字符串。
 */
export function formatArgs(args, options = {}) {
	if (args.length === 0) return ''
	const circularOptions = options
	const format = args[0]
	if (format?.constructor !== String)
		return args.map(arg => formatArgAsPlainString(arg)).join(' ')

	const { parts, nextArgIndex } = collectPrintfFormatParts(format, args, 1)
	const stringSink = { output: '', circularOptions }

	const noopSegment = {
		segments: [],
		maxDepth: DEFAULT_SNAPSHOT_DEPTH,
		expansionScope: null,
		styleCss: '',
		/**
		 * 空实现：纯字符串 `formatArgs` 路径不写入 segment，仅累加 `stringSink.output`。
		 */
		pushText() { },
	}

	for (const part of parts) {
		if (part.kind === 'literal') {
			stringSink.output += part.text
			continue
		}
		if (part.kind === 'missingSpec') {
			stringSink.output += part.spec
			continue
		}

		dispatchPrintfSpecifier(part.spec, part.value, noopSegment, stringSink)
	}

	for (let argIndex = nextArgIndex; argIndex < args.length; argIndex++) {
		const arg = args[argIndex]
		if (stringSink.output) stringSink.output += ' '
		appendTrailingArgPlainString(arg, stringSink)
	}

	return stringSink.output
}
