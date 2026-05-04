import { pathToFileURL } from '../core/stack.mjs'

import {
	escapeHtml,
	stripTerminalDecorations,
	terminalChunkToHtml,
} from './ansi.mjs'
import { osc8AnsiHyperlink, traceStackFrameOsc8Ansi } from './osc8_ansi.mjs'

/**
 * @param {import('../shared.d.mts').ArgSnapshot} snap - 参数快照对象。
 * @returns {string} `JSON.stringify` 失败时返回空串，否则为快照 JSON 文本。
 */
function snapshotToPlainSearchText(snap) {
	try {
		return JSON.stringify(snap)
	}
	catch {
		return ''
	}
}

/**
 * @typedef {object} RenderHtmlOptions
 * @property {string} [traceStackWrapperStyle] - 包裹 trace 栈块的 `style` 属性值。
 * @property {string} [traceStackLinkStyle] - trace 栈内链接的 `style`。
 * @property {boolean} [omitPrintfCss=false] - 为 `true` 时忽略 `%c` 产生的 `text`/`value` 上的 `css` 样式包裹。
 * @property {(frame: import('../shared.d.mts').StackFrame) => string | undefined} [resolveTraceFrameHref] -
 *   若返回非空字符串则用作该帧 `<a href>`；未提供或返回假值时回退到内置 `file:` URL 逻辑。
 * @property {boolean} [trimRenderedHtml=false] - 为 `true` 时对聚合 HTML 首尾 `trim`（与旧版 `LogEntry#toHtml` 对齐）。
 * @property {boolean} [newlinesToBr=false] - 为 `true` 时将输出中的 `\n` 替换为 `<br/>\n`。
 */

/**
 * @typedef {object} RenderAnsiOptions
 * @property {boolean} [osc8Links=true] - `link` 与 `traceStack` 是否输出 OSC 8 超链接。
 * @property {boolean} [colorize=true] - 为 `false` 时剥除 `value`/`values`/`ansi` 等中的 CSI 着色，且不与 `osc8Links` 组合输出 OSC 8。
 */

/**
 * 单段渲染上下文（可扩展）。
 * @typedef {object} SegmentRenderContext
 * @property {'plain' | 'html' | 'ansi'} target
 * @property {RenderHtmlOptions} [html]
 * @property {RenderAnsiOptions} [ansi]
 */

/**
 * 可插拔：按 `kind` 注册自定义渲染器；返回 `null` 则回退内置。
 * @typedef {(segment: import('../shared.d.mts').LogSegment, renderContext: SegmentRenderContext) => string | null | undefined} SegmentRendererFn
 */

/**
 * 内置片段渲染注册表 + 聚合输出。
 */
export class RendererRegistry {
	/**
	 * @private @type {Map<string, SegmentRendererFn>}
	 */
	#custom = new Map()

	/**
	 * @param {string} kind - 与 `LogSegment.kind` 一致。
	 * @param {SegmentRendererFn} fn - 返回该段字符串；`null`/`undefined` 走默认。
	 * @returns {void}
	 */
	register(kind, fn) {
		this.#custom.set(kind, fn)
	}

	/**
	 * @param {string} kind - 先前注册过的 `LogSegment.kind`。
	 * @returns {void}
	 */
	unregister(kind) {
		this.#custom.delete(kind)
	}

	/**
	 * @param {string} kind - `LogSegment.kind`。
	 * @param {SegmentRendererFn} fn - 自定义渲染函数。
	 * @returns {() => void} 调用即对本 `kind` 执行 {@link RendererRegistry#unregister}。
	 */
	registerDisposable(kind, fn) {
		this.register(kind, fn)
		return () => this.unregister(kind)
	}

	/**
	 * @param {import('../shared.d.mts').LogSegment} segment - 当前片段。
	 * @param {SegmentRenderContext} renderContext - 目标为 plain/html/ansi 及选项。
	 * @param {(segment: import('../shared.d.mts').LogSegment, renderContext: SegmentRenderContext) => string} builtin - 内置回退。
	 * @returns {string} 拼接用片段字符串（可能为空）。
	 */
	renderSegment(segment, renderContext, builtin) {
		const segmentKind = /** @type {{ kind?: string }} */ segment.kind
		const custom = segmentKind ? this.#custom.get(segmentKind) : undefined
		if (custom) {
			const out = custom(/** @type {import('../shared.d.mts').LogSegment} */ segment, renderContext)
			if (out != null) return out
		}
		return builtin(/** @type {import('../shared.d.mts').LogSegment} */ segment, renderContext)
	}
}

/**
 * @param {import('../shared.d.mts').LogSegment} segment - 任意 `kind` 的片段。
 * @param {SegmentRenderContext} renderContext - plain 目标（当前实现未读扩展字段）。
 * @returns {string} 无样式纯文本。
 */
function builtinPlain(/** @type {import('../shared.d.mts').LogSegment} */ segment, renderContext) {
	switch (segment.kind) {
		case 'text':
			return stripTerminalDecorations(segment.text)
		case 'value':
			return segment.ansiText != null ? stripTerminalDecorations(segment.ansiText) : snapshotToPlainSearchText(segment.snapshot)
		case 'values': {
			const bits = (segment.items || []).map(item =>
				item.ansiText != null ? stripTerminalDecorations(item.ansiText) : snapshotToPlainSearchText(item.snapshot))
			return bits.join(' ')
		}
		case 'ansi':
			return stripTerminalDecorations(segment.text)
		case 'link':
			return stripTerminalDecorations(segment.label)
		case 'dir':
			return snapshotToPlainSearchText(segment.snapshot)
		case 'traceStack':
			return (segment.frames || []).map(frame => frame.raw).join('\n')
		default:
			return ''
	}
}

/**
 * `value`/`values` 项：快照或 ansi 源 → HTML 内层文本。
 * @param {{ snapshot: import('../shared.d.mts').ArgSnapshot; ansiText?: string }} item - 片段项。
 * @returns {string} 经 {@link terminalChunkToHtml} 后的 HTML。
 */
function valueItemToHtmlInner(item) {
	let raw = item.ansiText
	if (raw == null)
		try {
			raw = JSON.stringify(item.snapshot, null, '\t')
		}
		catch {
			raw = String(item.snapshot)
		}

	return terminalChunkToHtml(raw)
}

/**
 * @param {import('../shared.d.mts').LogSegment} segment - 任意 `kind` 的片段。
 * @param {SegmentRenderContext} renderContext - 含 `html.traceStack*` 样式覆盖。
 * @returns {string} 已转义 HTML 片段。
 */
function builtinHtml(/** @type {import('../shared.d.mts').LogSegment} */ segment, renderContext) {
	const traceStackWrapperStyle = renderContext.html?.traceStackWrapperStyle ?? 'color:gray;font-size:0.9em'
	const traceStackLinkStyle = renderContext.html?.traceStackLinkStyle ?? 'color:inherit;text-decoration:none'
	const omitPrintfCss = renderContext.html?.omitPrintfCss === true
	switch (segment.kind) {
		case 'text': {
			const inner = terminalChunkToHtml(segment.text)
			if (omitPrintfCss || !segment.css) return inner
			return `<span style="${escapeHtml(segment.css)}">${inner}</span>`
		}
		case 'value': {
			let raw = segment.ansiText
			if (raw == null)
				try {
					raw = JSON.stringify(segment.snapshot, null, '\t')
				}
				catch {
					raw = String(segment.snapshot)
				}

			const inner = terminalChunkToHtml(raw)
			if (omitPrintfCss || !segment.css) return inner
			return `<span style="${escapeHtml(segment.css)}">${inner}</span>`
		}
		case 'values': {
			const bits = (segment.items || []).map(item => valueItemToHtmlInner(item))
			return bits.join(' ')
		}
		case 'ansi':
			return terminalChunkToHtml(segment.text)
		case 'link': {
			const labelHtml = terminalChunkToHtml(segment.label)
			return `<a href="${escapeHtml(segment.href)}" target="_blank" rel="noopener noreferrer" style="color:inherit">${labelHtml}</a>`
		}
		case 'dir': {
			let json
			try {
				json = JSON.stringify(segment.snapshot, null, '\t')
			}
			catch {
				json = String(segment.snapshot)
			}
			return terminalChunkToHtml(json).replaceAll('\n', '<br/>\n')
		}
		case 'traceStack': {
			const stackHtml = (segment.frames || [])
				.map(frame => {
					const raw = escapeHtml(frame.raw)
					const resolvedHref = renderContext.html?.resolveTraceFrameHref?.(frame)
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
		default:
			return ''
	}
}

/**
 * @param {import('../shared.d.mts').LogSegment} segment - 任意 `kind` 的片段。
 * @param {SegmentRenderContext} renderContext - 含 `ansi.osc8Links`。
 * @returns {string} 终端 ANSI 片段。
 */
function builtinAnsi(/** @type {import('../shared.d.mts').LogSegment} */ segment, renderContext) {
	const colorize = renderContext.ansi?.colorize !== false
	const osc8Links = renderContext.ansi?.osc8Links !== false
	const osc8 = osc8Links && colorize
	switch (segment.kind) {
		case 'text':
			return stripTerminalDecorations(segment.text)
		case 'value': {
			if (!colorize)
				return segment.ansiText != null
					? stripTerminalDecorations(String(segment.ansiText))
					: stripTerminalDecorations(snapshotToPlainSearchText(segment.snapshot))
			return segment.ansiText != null ? String(segment.ansiText) : stripTerminalDecorations(snapshotToPlainSearchText(segment.snapshot))
		}
		case 'values': {
			const bits = (segment.items || []).map(item => {
				if (!colorize)
					return item.ansiText != null
						? stripTerminalDecorations(String(item.ansiText))
						: stripTerminalDecorations(snapshotToPlainSearchText(item.snapshot))
				return item.ansiText != null ? String(item.ansiText) : stripTerminalDecorations(snapshotToPlainSearchText(item.snapshot))
			})
			return bits.join(' ')
		}
		case 'ansi':
			return colorize ? String(segment.text || '') : stripTerminalDecorations(String(segment.text || ''))
		case 'link':
			if (osc8 && segment.href)
				return osc8AnsiHyperlink(segment.href, segment.label || '')
			return stripTerminalDecorations(segment.label)
		case 'dir': {
			let json
			try {
				json = JSON.stringify(segment.snapshot, null, '\t')
			}
			catch {
				json = String(segment.snapshot)
			}
			return json
		}
		case 'traceStack': {
			const frames = segment.frames || []
			return frames.map(frame => osc8 ? traceStackFrameOsc8Ansi(frame) : frame.raw).join('\n')
		}
		default:
			return ''
	}
}

/**
 * 将 `LogSegment[]` 转为纯文本 / HTML / 终端 ANSI 串的可配置引擎。
 */
export class RenderEngine {
	/**
	 * @param {{ registry?: RendererRegistry }} [options] - 可选注入共享 {@link RendererRegistry}。
	 */
	constructor(options = {}) {
		/**
		 * @type {RendererRegistry}
		 */
		this.registry = options.registry ?? new RendererRegistry()
	}

	/**
	 * @param {import('../shared.d.mts').LogSegment[]} segments - `LogEntry#toSegments()` 产物。
	 * @param {RenderHtmlOptions} [htmlOptions] - trace 栈与链接样式。
	 * @returns {string} 拼接后的 HTML（段间按需插入 `<br/>`）。
	 */
	renderHtml(segments, htmlOptions = {}) {
		if (!segments?.length) return ''
		const renderContext = /** @type {SegmentRenderContext} */ { target: 'html', html: htmlOptions }
		const parts = []
		for (const segment of segments) {
			const piece = this.registry.renderSegment(
				/** @type {import('../shared.d.mts').LogSegment} */ segment,
				renderContext,
				builtinHtml,
			)
			if (!piece) continue
			if (segment.kind === 'traceStack' && parts.length)
				parts.push('<br/>\n')
			parts.push(piece)
		}
		let out = parts.join('')
		if (htmlOptions.trimRenderedHtml === true)
			out = out.trim()
		if (htmlOptions.newlinesToBr === true)
			out = out.replaceAll('\n', '<br/>\n')
		return out
	}

	/**
	 * @param {import('../shared.d.mts').LogSegment[]} segments - 片段数组。
	 * @returns {string} 去装饰后的纯文本，`trim` 后返回。
	 */
	renderPlain(segments) {
		if (!segments?.length) return ''
		const renderContext = /** @type {SegmentRenderContext} */ { target: 'plain' }
		const parts = []
		for (const segment of segments) {
			const piece = this.registry.renderSegment(
				/** @type {import('../shared.d.mts').LogSegment} */ segment,
				renderContext,
				builtinPlain,
			)
			if (piece) parts.push(piece)
		}
		return parts.join('').trim()
	}

	/**
	 * @param {import('../shared.d.mts').LogSegment[]} segments - 片段数组。
	 * @param {RenderAnsiOptions} [ansiOptions] - OSC 8 链接开关等。
	 * @returns {string} 终端 ANSI 拼接串。
	 */
	renderAnsi(segments, ansiOptions = {}) {
		if (!segments?.length) return ''
		const renderContext = /** @type {SegmentRenderContext} */ { target: 'ansi', ansi: ansiOptions }
		const parts = []
		for (const segment of segments) {
			const piece = this.registry.renderSegment(
				/** @type {import('../shared.d.mts').LogSegment} */ segment,
				renderContext,
				builtinAnsi,
			)
			if (piece) parts.push(piece)
		}
		return parts.join('')
	}
}

/** 默认全局引擎（无自定义注册时可直接使用）。 */
export const defaultRenderEngine = new RenderEngine()
