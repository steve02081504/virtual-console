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
	resolveValueRenderOptions,
	snapshotToTraceFrames,
} from './snapshot-display.mjs'

/**
 * @typedef {object} RenderHtmlOptions
 * @property {string} [traceStackWrapperStyle] - 包裹 trace 栈块的 `style` 属性值。
 * @property {string} [traceStackLinkStyle] - trace 栈内链接的 `style`。
 * @property {boolean} [omitPrintfCss=false] - 为 `true` 时忽略 `css` 片段的 `span` 包裹。
 * @property {boolean} [supportsAnsi=true] - 是否按条目能力为 `value` 生成着色 ANSI 再转 HTML。
 * @property {(frame: import('../shared.d.mts').StackFrame) => string | undefined} [resolveTraceFrameHref] -
 *   若返回非空字符串则用作该帧 `<a href>`；未提供或返回假值时回退到内置 `file:` URL 逻辑。
 */

/**
 * @typedef {object} RenderAnsiOptions
 * @property {boolean} [colorize=true] - 为 `false` 时用 {@link stripTerminalDecorations} 剥着色与 OSC8。
 * @property {boolean} [omitPrintfCss=false] - 为 `true` 时不把 `%c` 样式映射为 ANSI 真彩色。
 */

/**
 * @param {import('../shared.d.mts').LogSegment} segment - `kind: 'trace'`。
 * @param {RenderHtmlOptions} renderContext - HTML 选项。
 * @returns {string} 栈块 HTML。
 */
function traceStackHtml(segment, renderContext) {
	const traceStackWrapperStyle = renderContext.traceStackWrapperStyle ?? 'color:gray;font-size:0.9em'
	const traceStackLinkStyle = renderContext.traceStackLinkStyle ?? 'color:inherit;text-decoration:none'
	const frames = snapshotToTraceFrames(/** @type {{ snapshot: import('../shared.d.mts').ArgSnapshot }} */ segment.snapshot)
	const stackHtml = frames
		.map(frame => {
			const raw = escapeHtml(frame.raw)
			const resolvedHref = renderContext.resolveTraceFrameHref?.(frame)
			if (resolvedHref)
				return `<a href="${escapeHtml(resolvedHref)}" style="${escapeHtml(traceStackLinkStyle)}">${raw}</a>`
			if (frame.filePath && frame.line > 0) {
				const url = escapeHtml(`${pathToFileURL(frame.filePath)}:${frame.line}:${frame.column}`)
				return `<a href="${url}" style="${escapeHtml(traceStackLinkStyle)}">${raw}</a>`
			}
			return raw
		})
		.join('<br/>\n')
	return `<span style="${escapeHtml(traceStackWrapperStyle)}">${stackHtml}</span>`
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
			const opts = resolveValueRenderOptions(segment, supportsAnsi)
			const ansiInner = formatSnapshotAnsi(segment.snapshot, {
				depth: opts.depth,
				colorize: opts.colorize,
			})
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
 * @returns {string} 去装饰后的纯文本，`trim` 后返回。
 */
export function renderPlain(segments) {
	if (!segments?.length) return ''
	const parts = []
	for (const segment of segments) {
		if (segment.kind === 'css') continue
		if (segment.kind === 'text')
			parts.push(stripTerminalDecorations(segment.text))
		else if (segment.kind === 'value') {
			const opts = resolveValueRenderOptions(segment, true)
			parts.push(formatSnapshotPlain(segment.snapshot, { depth: opts.depth }))
		}
		else if (segment.kind === 'trace')
			parts.push(snapshotToTraceFrames(segment.snapshot).map(f => f.raw).join('\n'))
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
			const opts = resolveValueRenderOptions(segment, baseColorize)
			const inner = formatSnapshotAnsi(segment.snapshot, {
				depth: opts.depth,
				colorize: opts.colorize,
			})
			parts.push(wrapPrintfStyle(inner))
		}
		else if (segment.kind === 'trace') {
			const frames = snapshotToTraceFrames(segment.snapshot)
			const inner = frames.map(frame =>
				baseColorize ? traceStackFrameAnsi(frame) : frame.raw).join('\n')
			parts.push(wrapPrintfStyle(inner))
		}
	}
	return parts.join('')
}
