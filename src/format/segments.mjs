/**
 * 解析 `%` 格式串、将参数转为 `LogSegment[]`、单行格式化（与 Node `util.format` / `console.log` 对齐）。
 */

import {
	DEFAULT_SNAPSHOT_DEPTH,
	serializeArgSnapshot,
} from '../core/snapshot.mjs'

import {
	coerceString,
} from './ansi.mjs'

/** @typedef {{ kind: 'literal', text: string }} PrintfLiteralPart */
/** @typedef {{ kind: 'arg', spec: string, value: any }} PrintfArgPart */
/** @typedef {{ kind: 'missingSpec', spec: string }} PrintfMissingPart */

/**
 * @typedef {object} PrintfSegmentBuildContext
 * @property {import('../shared.d.mts').LogSegment[]} segments
 * @property {number} maxDepth
 * @property {object | null} expansionScope
 * @property {(text: string) => void} pushText
 */

/**
 * 扫描 printf 风格首参 `format` 与 `args[1..]` 的对齐关系，产出统一 token 流（供 `buildArgsSegments` / `renderPlain` 消费）。
 * @param {string} format - 首参模板串。
 * @param {any[]} args - 完整实参数组（含 `args[0] === format`）。
 * @param {number} [startArgIndex=1] - 从第几个下标开始消费（通常为 `1`）。
 * @returns {{ parts: Array<PrintfLiteralPart | PrintfArgPart | PrintfMissingPart>; nextArgIndex: number }}
 *   `parts` 为从左到右的模板片段与占位解析结果；`nextArgIndex` 为已消费的最后一个实参的下一索引（尾部额外实参从此继续）。
 */
export function collectPrintfFormatParts(format, args, startArgIndex = 1) {
	const parts = /** @type {Array<PrintfLiteralPart | PrintfArgPart | PrintfMissingPart>} */[]
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
 * 按单个 printf 说明符将实参折叠进 `buildContext`（推入 `text` / `value` / `css` 等片段）。
 * @param {string} spec - 如 `%s`（已排除 `%%`）。
 * @param {any} value - 绑定实参。
 * @param {PrintfSegmentBuildContext} buildContext - `buildArgsSegments` 侧可变状态。
 * @returns {void}
 */
function applyPrintfSpecifier(spec, value, buildContext) {
	const { segments, maxDepth, expansionScope, pushText } = buildContext
	switch (spec) {
		case '%c':
			segments.push({ kind: 'css', css: coerceString(value) })
			break
		case '%s':
			pushText(coerceString(value))
			break
		case '%d':
		case '%i': {
			let n
			try { n = String(parseInt(value)) }
			catch { n = 'NaN' }
			pushText(n)
			break
		}
		case '%f': {
			let n
			try { n = String(parseFloat(value)) }
			catch { n = 'NaN' }
			pushText(n)
			break
		}
		case '%o':
		case '%O': {
			const snap = serializeArgSnapshot(value, { maxDepth, expansionScope })
			segments.push({ kind: 'value', snapshot: snap })
			break
		}
		case '%j':
			try {
				const jsonText = JSON.stringify(value, null, '\t')
				pushText(jsonText)
			}
			catch {
				pushText(coerceString(value))
			}
			break
		default:
			break
	}
}

/**
 * 将 printf 实参转为结构化片段（含快照树）；`expansionScope` / `snapshotDepth` 仅影响快照序列化。
 * @param {any[]} args - `console.*` 收到的原始参数数组。
 * @param {object | null} [expansionScope=null] - 惰性展开上下文（如 {@link createExpansionScope} 返回值）；无宿主条目时为 `null`。
 * @param {number} [snapshotDepth] - 快照递归深度上限；默认 {@link DEFAULT_SNAPSHOT_DEPTH}。
 * @returns {import('../shared.d.mts').LogSegment[]} 有序片段。
 */
export function buildArgsSegments(args, expansionScope = null, snapshotDepth = DEFAULT_SNAPSHOT_DEPTH) {
	if (!args.length) return []
	const maxDepth = snapshotDepth
	const format = args[0]
	if (format?.constructor !== String) {
		const segments = /** @type {import('../shared.d.mts').LogSegment[]} */[]
		for (let i = 0; i < args.length; i++) {
			if (i) segments.push({ kind: 'text', text: ' ' })
			segments.push({
				kind: 'value',
				snapshot: serializeArgSnapshot(args[i], { maxDepth, expansionScope }),
			})
		}
		return segments
	}

	// 与 Node `console.log` / `util.format` 一致：`util.format` 只有单个字符串参数时原样返回，不解析 `%`。
	if (args.length === 1)
		return [{ kind: 'text', text: String(format) }]

	const segments = /** @type {import('../shared.d.mts').LogSegment[]} */[]
	const { parts, nextArgIndex } = collectPrintfFormatParts(format, args, 1)

	/**
	 * 追加字面文本段。
	 * @param {string} text - 要写入的文本。
	 */
	function pushText(text) {
		if (!text) return
		segments.push({ kind: 'text', text })
	}

	const segmentBuildContext = { segments, maxDepth, expansionScope, pushText }

	for (const part of parts) {
		if (part.kind === 'literal') {
			pushText(part.text)
			continue
		}
		if (part.kind === 'missingSpec') {
			pushText(part.spec)
			continue
		}

		applyPrintfSpecifier(part.spec, part.value, segmentBuildContext)
	}

	for (let argIndex = nextArgIndex; argIndex < args.length; argIndex++) {
		const arg = args[argIndex]
		if (segments.length) segments.push({ kind: 'text', text: ' ' })
		const t = typeof arg
		if ((t === 'object' && arg !== null) || t === 'function')
			segments.push({
				kind: 'value',
				snapshot: serializeArgSnapshot(arg, { maxDepth, expansionScope }),
			})
		else
			pushText(coerceString(arg))
	}

	return segments
}
