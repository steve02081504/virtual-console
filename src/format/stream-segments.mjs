import { stripOscTitleSequences } from './ansi.mjs'

/**
 * 将标准流原始字符串拆成链接 / ANSI 文本片段。
 * @param {string} text - `stdout`/`stderr` 合并后的原始字节串。
 * @returns {import('../shared.d.mts').LogSegment[]} `ansi` 与 `link` 片段交替。
 */
export function streamToSegments(text) {
	const rawText = String(text || '')
	const strippedFirst = stripOscTitleSequences(rawText)
	const segments = /** @type {import('../shared.d.mts').LogSegment[]} */ []
	let pos = 0
	const osc8LinkRegex = /\u001B]8;;([^\u0007\u001B]*)(?:\u0007|\u001B\\)([\S\s]*?)\u001B]8;;(?:\u0007|\u001B\\)/g
	let match
	while ((match = osc8LinkRegex.exec(strippedFirst)) !== null) {
		if (match.index > pos) {
			const chunk = strippedFirst.slice(pos, match.index)
			if (chunk) segments.push({ kind: 'ansi', text: chunk })
		}
		segments.push({ kind: 'link', href: match[1] || '', label: match[2] || '' })
		pos = osc8LinkRegex.lastIndex
	}
	if (pos < strippedFirst.length) {
		const chunk = strippedFirst.slice(pos)
		if (chunk) segments.push({ kind: 'ansi', text: chunk })
	}
	if (!segments.length)
		segments.push({ kind: 'ansi', text: strippedFirst })
	return segments
}
