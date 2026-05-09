import { pathToFileURL } from '../core/stack.mjs'

import {
	escapeHtml,
	stripTerminalDecorations,
	terminalChunkToHtml,
	traceStackFrameAnsi,
} from './ansi.mjs'
import { cssStyleStringToAnsiPrefix } from './css-to-ansi.mjs'
import {
	formatSnapshotAnsi,
	formatSnapshotPlain,
	resolveValueRenderOptions
} from './snapshot-display.mjs'

/**
 * @typedef {object} RenderHtmlOptions
 * @property {string} [traceStackWrapperStyle] - 包裹 trace 栈块的 `style` 属性值。
 * @property {string} [traceStackLinkStyle] - trace 栈内链接的 `style`。
 * @property {boolean} [omitPrintfCss=false] - 为 `true` 时忽略 `css` 片段的 `span` 包裹。
 * @property {boolean} [supportsAnsi=true] - 是否按条目能力为 `value` 生成着色 ANSI 再转 HTML。
 * @property {string} [indent='\t'] - 多行结构缩进单元。
 * @property {number} [maxDepth=Infinity] - 值快照最大展开深度（与 `dirOptions.depth` 取较小值）。
 * @property {(frame: import('../shared.d.mts').StackFrame) => string | undefined} [resolveTraceFrameHref] -
 *   若返回非空字符串则用作该帧 `<a href>`；未提供或返回假值时回退到内置 `file:` URL 逻辑。
 */

/**
 * @typedef {object} RenderPlainOptions
 * @property {string} [indent='\t'] - 多行结构缩进单元。
 * @property {number} [maxDepth=Infinity] - 值快照最大展开深度（与 `dirOptions.depth` 取较小值）。
 */

/**
 * @typedef {object} RenderAnsiOptions
 * @property {boolean} [colorize=true] - 为 `false` 时用 {@link stripTerminalDecorations} 剥着色与 OSC8。
 * @property {boolean} [omitPrintfCss=false] - 为 `true` 时不把 `%c` 样式映射为 ANSI 真彩色。
 * @property {string} [indent='\t'] - 多行结构缩进单元。
 * @property {number} [maxDepth=Infinity] - 值快照最大展开深度（与 `dirOptions.depth` 取较小值）。
 */

/**
 * @param {import('../shared.d.mts').LogSegment} segment - `kind: 'trace'`。
 * @param {RenderHtmlOptions} renderContext - HTML 选项。
 * @returns {string} 栈块 HTML。
 */
function traceStackHtml(segment, renderContext) {
	const traceStackWrapperStyle = renderContext.traceStackWrapperStyle ?? 'color:gray;font-size:0.9em'
	const traceStackLinkStyle = renderContext.traceStackLinkStyle ?? 'color:inherit;text-decoration:none'
	const stackHtml = segment.stack.map(frame => {
		const raw = escapeHtml(frame.raw)
		const resolvedHref = renderContext.resolveTraceFrameHref?.(frame)
		if (resolvedHref)
			return `<a href="${escapeHtml(resolvedHref)}" style="${escapeHtml(traceStackLinkStyle)}">${raw}</a>`
		if (frame.filePath && frame.line > 0) {
			const url = escapeHtml(`${pathToFileURL(frame.filePath)}:${frame.line}:${frame.column}`)
			return `<a href="${url}" style="${escapeHtml(traceStackLinkStyle)}">${raw}</a>`
		}
		return raw
	}).join('<br/>\n')
	return `<span style="${escapeHtml(traceStackWrapperStyle)}">${stackHtml}</span>`
}

/**
 * 统一计算 `value` 片段的 plain 或 ANSI 文本。
 * @param {import('../shared.d.mts').LogSegment} segment - `kind: 'value'` 片段。
 * @param {{ indent: string, maxDepth: number, defaultColorize?: boolean }} options - 统一渲染参数。
 * @param {'ansi' | 'plain'} mode - 目标格式。
 * @returns {string} 格式化结果。
 */
function renderValueSegment(segment, options, mode) {
	const resolveColorize = mode === 'ansi' ? options.defaultColorize : true
	const opts = resolveValueRenderOptions(segment, resolveColorize)
	const depth = Math.min(opts.depth, options.maxDepth)
	const base = { depth, indent: options.indent }
	if (mode === 'ansi')
		return formatSnapshotAnsi(segment.snapshot, { ...base, colorize: opts.colorize })
	return formatSnapshotPlain(segment.snapshot, base)
}

/**
 * 将 trace 快照转为逐帧原始文本。
 * @param {import('../shared.d.mts').LogSegment} segment - `kind: 'trace'` 片段。
 * @returns {string} `\n` 拼接的帧文本。
 */
function renderTraceRaw(segment) {
	return segment.stack.map(frame => frame.raw).join('\n')
}

/**
 * @param {import('../shared.d.mts').LogSegment[]} segments - `LogEntry#toSegments()` 产物。
 * @param {RenderHtmlOptions} [htmlOptions] - trace 栈与链接样式、`css` 开关。
 * @returns {string} 拼接后的 HTML。
 */
export function renderHtml(segments, htmlOptions = {}) {
	if (!segments?.length) return ''
	const omitPrintfCss = htmlOptions.omitPrintfCss === true
	const supportsAnsi = htmlOptions.supportsAnsi !== false
	const indent = htmlOptions.indent ?? '\t'
	const maxDepth = htmlOptions.maxDepth ?? Infinity
	let spanOpen = false
	const parts = []
	/**
	 * 若存在由 `css` 片段打开且尚未闭合的 `span`，则追加 `</span>` 并清除打开状态。
	 * @returns {void}
	 */
	const closeSpan = () => {
		if (spanOpen) {
			parts.push('</span>')
			spanOpen = false
		}
	}

	for (const segment of segments) {
		if (segment.kind === 'css') {
			closeSpan()
			if (!omitPrintfCss && segment.css) {
				parts.push(`<span style="${escapeHtml(segment.css)}">`)
				spanOpen = true
			}
			continue
		}

		if (segment.kind === 'trace' && parts.length)
			parts.push('<br/>\n')

		if (segment.kind === 'text')
			parts.push(terminalChunkToHtml(segment.text))

		else if (segment.kind === 'value') {
			const ansiInner = renderValueSegment(segment, { indent, maxDepth, defaultColorize: supportsAnsi }, 'ansi')
			parts.push(terminalChunkToHtml(ansiInner))
		}

		else if (segment.kind === 'trace')
			parts.push(traceStackHtml(segment, htmlOptions))
	}

	closeSpan()
	return parts.join('')
}

/**
 * @param {import('../shared.d.mts').LogSegment[]} segments - 片段数组。
 * @param {RenderPlainOptions} [plainOptions] - plain 渲染选项。
 * @returns {string} 去装饰后的纯文本，`trim` 后返回。
 */
export function renderPlain(segments, plainOptions = {}) {
	if (!segments?.length) return ''
	const indent = plainOptions.indent ?? '\t'
	const maxDepth = plainOptions.maxDepth ?? Infinity
	const parts = []
	for (const segment of segments) {
		if (segment.kind === 'css') continue
		if (segment.kind === 'text')
			parts.push(stripTerminalDecorations(segment.text))
		else if (segment.kind === 'value')
			parts.push(renderValueSegment(segment, { indent, maxDepth }, 'plain'))
		else if (segment.kind === 'trace')
			parts.push(renderTraceRaw(segment))
	}
	return parts.join('')
}

/**
 * @param {import('../shared.d.mts').LogSegment[]} segments - 片段数组。
 * @param {RenderAnsiOptions} [ansiOptions] - 终端 ANSI 选项。
 * @returns {string} 终端 ANSI 拼接串。
 */
export function renderAnsi(segments, ansiOptions = {}) {
	if (!segments?.length) return ''
	const baseColorize = ansiOptions.colorize !== false
	const omitPrintfCss = ansiOptions.omitPrintfCss === true
	const indent = ansiOptions.indent ?? '\t'
	const maxDepth = ansiOptions.maxDepth ?? Infinity
	/** @type {string} 当前 `%c` 映射得到的 ANSI 前缀（无重置后缀） */
	let printfStylePrefix = ''
	/**
	 * 为正文包裹当前 printf 样式前缀并在末尾复位 SGR。
	 * @param {string} inner - 片段内文本或格式化后的值。
	 * @returns {string} 带样式的 ANSI 片段。
	 */
	const wrapPrintfStyle = inner => {
		if (!baseColorize) return stripTerminalDecorations(inner)
		if (!printfStylePrefix) return inner
		return `${printfStylePrefix}${inner}\x1b[0m`
	}
	const parts = []
	for (const segment of segments) {
		if (segment.kind === 'css') {
			printfStylePrefix = baseColorize && !omitPrintfCss
				? cssStyleStringToAnsiPrefix(segment.css)
				: ''
			continue
		}
		if (segment.kind === 'text') {
			const t = String(segment.text ?? '')
			parts.push(wrapPrintfStyle(t))
		}
		else if (segment.kind === 'value') {
			const inner = renderValueSegment(segment, { indent, maxDepth, defaultColorize: baseColorize }, 'ansi')
			parts.push(wrapPrintfStyle(inner))
		}
		else if (segment.kind === 'trace') {
			const inner = baseColorize
				? segment.stack.map(traceStackFrameAnsi).join('\n')
				: renderTraceRaw(segment)
			parts.push(wrapPrintfStyle(inner))
		}
	}
	return parts.join('')
}
