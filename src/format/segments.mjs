import {
	DEFAULT_SNAPSHOT_DEPTH,
	makeExpandCtx,
	serializeArgSnapshot,
} from '../core/snapshot.mjs'
import { pathToFileURL } from '../core/stack.mjs'

import {
	circularToString,
	coerceString,
	escapeHtml,
	stripOscTitleSequences,
	stripTerminalDecorations,
	terminalChunkToHtml,
} from './ansi.mjs'

/**
 * 快照 → 单行级纯文本（用于过滤；与 `formatArgs` 里 `%o` 的展示不完全等同）。
 * @param {import('../shared.d.mts').ArgSnapshot} snap - 参数快照子树。
 * @returns {string} `JSON.stringify` 结果或空串（循环等异常时）。
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
 * 将 printf 风格参数转为结构化片段（供前端按需映射 DOM）。
 * @param {any[]} args - `console.*` 收到的原始参数数组。
 * @param {object} [options] - 格式化与快照选项。
 * @param {boolean} [options.supportsAnsi=false] - 是否允许 `%c` 样式与彩色 `%o`。
 * @param {import('../core/entries.mjs').LogEntry | null} [options.entry] - 若提供则为快照分配惰性展开 ref。
 * @param {number} [options.snapshotDepth] - 覆盖默认 `DEFAULT_SNAPSHOT_DEPTH`。
 * @param {number} [options.depth] - 传给 `circularToString` 的递归深度上限。
 * @returns {import('../shared.d.mts').LogSegment[]} 有序片段：文本、`value`、`values` 等。
 */
export function argsToSegments(args, options = {}) {
	if (!args.length) return []
	const entry = options.entry ?? null
	const maxDepth = options.snapshotDepth ?? DEFAULT_SNAPSHOT_DEPTH
	const expandCtx = entry ? makeExpandCtx(entry) : null
	const format = args[0]
	if (format?.constructor !== String)
		return [{
			kind: 'values', items: args.map(arg => ({
				kind: 'value',
				snapshot: serializeArgSnapshot(arg, new WeakSet(), 0, maxDepth, expandCtx),
				ansiText: argToAnsiSourceForHtml(arg),
			}))
		}]

	/**
	 * 按 `format` 与实参逐步累加的片段缓冲。
	 * @type {import('../shared.d.mts').LogSegment[]}
	 */
	const segments = []
	let argIndex = 1
	let lastIndex = 0
	let activeCss = ''
	const regex = /%[%Ocdfijos]/g
	let match

	while ((match = regex.exec(format)) !== null) {
		const before = format.slice(lastIndex, match.index)
		if (before)
			segments.push(activeCss ? { kind: 'text', text: before, css: activeCss } : { kind: 'text', text: before })
		lastIndex = regex.lastIndex

		if (match[0] === '%%') {
			segments.push(activeCss ? { kind: 'text', text: '%', css: activeCss } : { kind: 'text', text: '%' })
			continue
		}

		if (argIndex >= args.length) {
			segments.push(activeCss ? { kind: 'text', text: match[0], css: activeCss } : { kind: 'text', text: match[0] })
			continue
		}

		const arg = args[argIndex++]
		switch (match[0]) {
			case '%c':
				activeCss = coerceString(arg)
				break
			case '%s':
				segments.push(activeCss ? { kind: 'text', text: coerceString(arg), css: activeCss } : { kind: 'text', text: coerceString(arg) })
				break
			case '%d':
			case '%i': {
				let n
				try { n = String(parseInt(arg)) }
				catch { n = 'NaN' }
				segments.push(activeCss ? { kind: 'text', text: n, css: activeCss } : { kind: 'text', text: n })
				break
			}
			case '%f': {
				let n
				try { n = String(parseFloat(arg)) }
				catch { n = 'NaN' }
				segments.push(activeCss ? { kind: 'text', text: n, css: activeCss } : { kind: 'text', text: n })
				break
			}
			case '%o':
			case '%O':
				segments.push({
					kind: 'value',
					snapshot: serializeArgSnapshot(arg, new WeakSet(), 0, maxDepth, expandCtx),
					css: activeCss || undefined,
					ansiText: circularToString(arg, { depth: options.depth ?? Infinity, colorize: true }),
				})
				break
			case '%j':
				try {
					const jsonText = JSON.stringify(arg, null, '\t')
					segments.push(activeCss ? { kind: 'text', text: jsonText, css: activeCss } : { kind: 'text', text: jsonText })
				}
				catch {
					const fallback = coerceString(arg)
					segments.push(activeCss ? { kind: 'text', text: fallback, css: activeCss } : { kind: 'text', text: fallback })
				}
				break
		}
	}

	const tail = format.slice(lastIndex)
	if (tail)
		segments.push(activeCss ? { kind: 'text', text: tail, css: activeCss } : { kind: 'text', text: tail })

	while (argIndex < args.length) {
		const arg = args[argIndex++]
		if (segments.length) segments.push({ kind: 'text', text: ' ' })
		segments.push({
			kind: 'value',
			snapshot: serializeArgSnapshot(arg, new WeakSet(), 0, maxDepth, expandCtx),
			ansiText: argToAnsiSourceForHtml(arg),
		})
	}

	return segments
}

/**
 * 将标准流原始字符串拆成链接 / ANSI 文本片段。
 * @param {string} text - `stdout`/`stderr` 合并后的原始字节串。
 * @returns {import('../shared.d.mts').LogSegment[]} `ansi` 与 `link` 片段交替。
 */
export function streamToSegments(text) {
	const rawText = String(text || '')
	const strippedFirst = stripOscTitleSequences(rawText)
	/**
	 * 自剥离 OSC 标题后的流文本解析出的片段缓冲。
	 * @type {import('../shared.d.mts').LogSegment[]}
	 */
	const segments = []
	let pos = 0
	const re = /\u001B]8;;([^\u0007\u001B]*)(?:\u0007|\u001B\\)([\S\s]*?)\u001B]8;;(?:\u0007|\u001B\\)/g
	let m
	while ((m = re.exec(strippedFirst)) !== null) {
		if (m.index > pos) {
			const chunk = strippedFirst.slice(pos, m.index)
			if (chunk) segments.push({ kind: 'ansi', text: chunk })
		}
		segments.push({ kind: 'link', href: m[1] || '', label: m[2] || '' })
		pos = re.lastIndex
	}
	if (pos < strippedFirst.length) {
		const chunk = strippedFirst.slice(pos)
		if (chunk) segments.push({ kind: 'ansi', text: chunk })
	}
	if (!segments.length)
		segments.push({ kind: 'ansi', text: strippedFirst })
	return segments
}

/**
 * 由 {@link LogSegment} 列表生成纯文本（与 `plainText` / 过滤字段对齐的实用投影）。
 * @param {import('../shared.d.mts').LogSegment[]} segments - `toSegments()` 产物。
 * @returns {string} 剥样式后的可搜索单行或多行文本。
 */
export function segmentsToPlainText(segments) {
	if (!segments?.length) return ''
	const parts = []
	for (const seg of segments)
		switch (seg.kind) {
			case 'text':
				parts.push(stripTerminalDecorations(seg.text))
				break
			case 'value':
				parts.push(seg.ansiText != null ? stripTerminalDecorations(seg.ansiText) : snapshotToPlainSearchText(seg.snapshot))
				break
			case 'values': {
				const bits = (seg.items || []).map(item =>
					item.ansiText != null ? stripTerminalDecorations(item.ansiText) : snapshotToPlainSearchText(item.snapshot))
				parts.push(bits.join(' '))
				break
			}
			case 'ansi':
				parts.push(stripTerminalDecorations(seg.text))
				break
			case 'link':
				parts.push(stripTerminalDecorations(seg.label))
				break
			case 'dir':
				parts.push(snapshotToPlainSearchText(seg.snapshot))
				break
			case 'traceStack':
				parts.push((seg.frames || []).map(frame => frame.raw).join('\n'))
				break
		}

	return parts.join('').trim()
}

/**
 * 由 {@link LogSegment} 列表生成 HTML（单一路径：`argsToHtml` / 流式 / trace 均以此为核心）。
 * @param {import('../shared.d.mts').LogSegment[]} segments - `toSegments()` 产物。
 * @returns {string} 已转义、可插入容器的 HTML 片段拼接。
 */
export function segmentsToHtml(segments) {
	if (!segments?.length) return ''
	const parts = []
	for (const seg of segments)
		switch (seg.kind) {
			case 'text': {
				const inner = terminalChunkToHtml(seg.text)
				parts.push(seg.css ? `<span style="${escapeHtml(seg.css)}">${inner}</span>` : inner)
				break
			}
			case 'value': {
				let raw = seg.ansiText
				if (raw == null)
					try {
						raw = JSON.stringify(seg.snapshot, null, '\t')
					}
					catch {
						raw = String(seg.snapshot)
					}

				const inner = terminalChunkToHtml(raw)
				parts.push(seg.css ? `<span style="${escapeHtml(seg.css)}">${inner}</span>` : inner)
				break
			}
			case 'values': {
				const bits = (seg.items || []).map(item => {
					let raw = item.ansiText
					if (raw == null) try {
						raw = JSON.stringify(item.snapshot, null, '\t')
					}
					catch {
						raw = String(item.snapshot)
					}

					return terminalChunkToHtml(raw)
				})
				parts.push(bits.join(' '))
				break
			}
			case 'ansi':
				parts.push(terminalChunkToHtml(seg.text))
				break
			case 'link': {
				const labelHtml = terminalChunkToHtml(seg.label)
				parts.push(`<a href="${escapeHtml(seg.href)}" target="_blank" rel="noopener noreferrer" style="color:inherit">${labelHtml}</a>`)
				break
			}
			case 'dir': {
				let json
				try {
					json = JSON.stringify(seg.snapshot, null, '\t')
				}
				catch {
					json = String(seg.snapshot)
				}
				parts.push(terminalChunkToHtml(json).replaceAll('\n', '<br/>\n'))
				break
			}
			case 'traceStack': {
				const stackHtml = (seg.frames || [])
					.map(frame => {
						const raw = escapeHtml(frame.raw)
						if (frame.filePath && frame.line > 0) {
							const url = escapeHtml(`${pathToFileURL(frame.filePath)}:${frame.line}:${frame.column}`)
							return `<a href="${url}" style="color:inherit;text-decoration:none">${raw}</a>`
						}
						return raw
					})
					.join('<br/>\n')
				const prefix = parts.length ? '<br/>\n' : ''
				parts.push(`${prefix}<span style="color:gray;font-size:0.9em">${stackHtml}</span>`)
				break
			}
		}

	return parts.join('')
}

/**
 * 标准流整段文本 → HTML（先 `streamToSegments` 再 {@link segmentsToHtml}）。
 * @param {string} text - 原始输出。
 * @returns {string} 含 `<br/>` 换行的 HTML 串。
 */
export function streamTextToHtml(text) {
	return segmentsToHtml(streamToSegments(text)).replaceAll('\n', '<br/>\n')
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
	const format = args[0]
	if (format?.constructor !== String)
		return args.map(arg => {
			if (Object(arg) instanceof String) return arg
			if (arg instanceof Error && arg.stack) return arg.stack
			try {
				return JSON.stringify(arg, null, '\t')
			}
			catch {
				return coerceString(arg)
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
				output += coerceString(arg)
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
				output += circularToString(arg, options)
				break
			case '%j':
				try { output += JSON.stringify(arg, null, '\t') }
				catch { output += coerceString(arg) }
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
			catch { output += coerceString(arg) }

		else output += coerceString(arg)
	}

	return output
}

/**
 * 将 console 参数格式化为 HTML 字符串。
 * @param {any[]} args - console 方法接收的参数数组。
 * @returns {string} 格式化后的 HTML 字符串。
 */
export function argsToHtml(args) {
	return segmentsToHtml(argsToSegments(args)).trim().replaceAll('\n', '<br/>\n')
}
