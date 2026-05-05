/**
 * 从 `serializeArgSnapshot` 产出的带 `kind` 标签树生成 plain / ANSI 展示文本。
 */

import { DEFAULT_SNAPSHOT_DEPTH } from '../core/snapshot.mjs'
import { parseStackTraceLine, stackFrameToOsc8Href } from '../core/stack.mjs'

import { ansiHyperlink, stripTerminalDecorations } from './ansi.mjs'

/**
 * @typedef {object} FormatSnapshotOptions
 * @property {number} [depth=Infinity] - 对象展开最大深度（超过则输出 `[Object]` 风格占位）。
 * @property {string} [indent='\t'] - 多行结构的缩进单元。
 * @property {boolean} [colorize=true] - ANSI 路径是否着色；plain 路径忽略。
 */

/**
 * @param {import('../shared.d.mts').ArgSnapshot} snap - 任意快照子树。
 * @param {FormatSnapshotOptions} [options] - 格式选项。
 * @returns {string} 无 ANSI、可搜索的纯文本。
 */
export function formatSnapshotPlain(snap, options = {}) {
	return formatSnapshotInner(snap, { ...options, colorize: false })
}

/**
 * @param {import('../shared.d.mts').ArgSnapshot} snap - 任意快照子树。
 * @param {FormatSnapshotOptions} [options] - 格式选项。
 * @returns {string} 终端 ANSI 文本；`colorize: false` 时剥离 CSI，等价纯文本。
 */
export function formatSnapshotAnsi(snap, options = {}) {
	const raw = formatSnapshotInner(snap, { depth: Infinity, colorize: true, ...options })
	if (options.colorize === false)
		return stripTerminalDecorations(raw)
	return raw
}

/**
 * @param {import('../shared.d.mts').ArgSnapshot | undefined} dirSnap - `dirOptions` 序列化快照。
 * @param {{ depth: number; colorize: boolean }} fallback - 默认值。
 * @returns {{ depth: number; colorize: boolean }} 合并后的 `depth` / `colors`（着色）选项。
 */
export function parseDirOptionsSnapshot(dirSnap, fallback = { depth: DEFAULT_SNAPSHOT_DEPTH, colorize: true }) {
	if (!dirSnap || typeof dirSnap !== 'object') return { ...fallback }
	const out = { ...fallback }
	const entries = /** @type {{ entries?: Array<{ key: string; value: unknown }> }} */ dirSnap.entries
	if (!Array.isArray(entries)) return out
	for (const entry of entries) {
		if (!entry || typeof entry !== 'object') continue
		const { key, value } = /** @type {{ key: string; value: { kind?: string; value?: unknown } }} */ entry
		if (key === 'depth' && value && typeof value === 'object' && /** @type {{ kind?: string }} */ value.kind === 'number')
			out.depth = /** @type {{ value: number }} */ value.value
		if (key === 'colors' && value && typeof value === 'object' && /** @type {{ kind?: string }} */ value.kind === 'boolean')
			out.colorize = /** @type {{ value: boolean }} */ value.value
	}
	return out
}

/**
 * @param {{ dirOptions?: import('../shared.d.mts').ArgSnapshot }} segment - `kind: 'value'` 片段。
 * @param {boolean} supportsAnsi - 条目级 ANSI 开关。
 * @returns {{ depth: number; colorize: boolean }} `formatSnapshot*` 使用的深度与是否着色。
 */
export function resolveValueRenderOptions(segment, supportsAnsi) {
	if (segment.dirOptions != null) {
		const parsed = parseDirOptionsSnapshot(segment.dirOptions, {
			depth: DEFAULT_SNAPSHOT_DEPTH,
			colorize: supportsAnsi,
		})
		return {
			depth: parsed.depth,
			colorize: supportsAnsi && parsed.colorize,
		}
	}
	return { depth: Infinity, colorize: supportsAnsi }
}

/**
 * @param {import('../shared.d.mts').ArgSnapshot} snap - `trace` 段载荷（一般为栈数组快照）。
 * @returns {import('../shared.d.mts').StackFrame[]} 结构化栈帧，供 HTML/ANSI 栈块渲染。
 */
export function snapshotToTraceFrames(snap) {
	if (!snap || typeof snap !== 'object' || snap.kind !== 'array')
		return []
	const items = /** @type {unknown[]} */ snap.items || []
	const frames = []
	for (const item of items) {
		const f = taggedSnapshotToStackFrame(item)
		if (f) frames.push(f)
	}
	return frames
}

/**
 * @param {unknown} obj - 单帧快照节点。
 * @returns {import('../shared.d.mts').StackFrame | null} 合法帧对象；结构不符时为 null。
 */
function taggedSnapshotToStackFrame(obj) {
	if (!obj || typeof obj !== 'object') return null
	const kind = /** @type {{ kind?: string }} */ obj.kind
	if (kind !== 'object' && kind !== 'Object')
		return null
	const entries = /** @type {{ entries?: Array<{ key: string; value: unknown }> }} */ obj.entries
	if (!Array.isArray(entries)) return null
	/** @type {import('../shared.d.mts').StackFrame} */
	const frame = {
		functionName: '',
		filePath: '',
		line: 0,
		column: 0,
		raw: '',
	}
	for (const ent of entries) {
		if (!ent || typeof ent !== 'object') continue
		const { key, value: val } = ent
		if (key === 'functionName') frame.functionName = String(unwrapTaggedLeaf(val))
		else if (key === 'filePath') frame.filePath = String(unwrapTaggedLeaf(val))
		else if (key === 'line') frame.line = Number(unwrapTaggedLeaf(val)) || 0
		else if (key === 'column') frame.column = Number(unwrapTaggedLeaf(val)) || 0
		else if (key === 'raw') frame.raw = String(unwrapTaggedLeaf(val))
	}
	return frame
}

/**
 * @param {unknown} taggedLeaf - 可能是已打 `kind` 的叶子节点，或原始值。
 * @returns {unknown} 解包后的原始叶子值。
 */
function unwrapTaggedLeaf(taggedLeaf) {
	if (taggedLeaf == null || typeof taggedLeaf !== 'object') return taggedLeaf
	const n = /** @type {{ kind?: string; value?: unknown }} */ taggedLeaf
	if (n.kind === 'string' || n.kind === 'number' || n.kind === 'boolean') return n.value
	return taggedLeaf
}

/**
 * 选择需要转义最少的引号字符，尽量贴近 util.inspect 的字符串字面量风格。
 * @param {string} str - 原始字符串。
 * @returns {"'" | '"' | '`'} 冲突最少的引号字符。
 */
function pickBestQuote(str) {
	const singleCount = (str.match(/'/g) || []).length
	const doubleCount = (str.match(/"/g) || []).length
	const backtickCount = (str.match(/`/g) || []).length
	if (singleCount <= doubleCount && singleCount <= backtickCount) return '\''
	if (doubleCount <= singleCount && doubleCount <= backtickCount) return '"'
	return '`'
}

/**
 * 把 JS 字符串转为 inspect 风格字面量（自动选引号，控制字符不直出）。
 * @param {unknown} raw - 原始值。
 * @returns {string} 带转义的 inspect 风格字面量。
 */
function quoteSingleJsString(raw) {
	const value = String(raw)
	const quote = pickBestQuote(value)
	let out = ''
	for (let i = 0; i < value.length; i += 1) {
		const ch = value[i]
		if (ch === '\\') {
			out += '\\\\'
			continue
		}
		if (ch === quote) {
			out += `\\${quote}`
			continue
		}
		if (quote === '`' && ch === '$' && value[i + 1] === '{') {
			out += '\\${'
			i += 1
			continue
		}
		if (ch === '\r') out += '\\r'
		else if (ch === '\n') out += '\\n'
		else if (ch === '\t') out += '\\t'
		else if (ch === '\b') out += '\\b'
		else if (ch === '\f') out += '\\f'
		else if (ch === '\v') out += '\\v'
		else if (ch === '\0') out += '\\0'
		else out += ch
	}
	return `${quote}${out}${quote}`
}

/**
 * Error 首行：`Name` 高亮，存在 `message` 时用红色显示消息文本。
 * 无栈时整段「类型 + `: ` + message」包在一对 `[]` 内，如 `[ReferenceError: exit is not defined]`。
 * @param {string} name - 错误名。
 * @param {string} msg - message。
 * @param {{ reset: string; yellow: string; red: string; grey?: string }} colors - 着色片段。
 * @param {boolean} [bracketName=false] - 为 true 时输出 `[Name: msg]`（无 msg 时 `[Name]`）。
 * @returns {string} 一行 ANSI 标题（可选括号包裹）。
 */
function formatErrorHeaderAnsi(name, msg, colors, bracketName = false) {
	const bold = '\x1b[1m'
	const grey = colors.grey || ''
	if (bracketName) {
		if (msg)
			return `${bold}${grey}[${colors.yellow}${name}${grey}: ${colors.red}${msg}${grey}]${colors.reset}`
		return `${bold}${grey}[${colors.yellow}${name}${grey}]${colors.reset}`
	}
	if (msg)
		return `${bold}${colors.yellow}${name}${colors.reset}: ${colors.red}${msg}${colors.reset}`
	return `${bold}${colors.yellow}${name}${colors.reset}`
}

/**
 * 从 Error 快照单帧反序列化（与 {@link parseStackTraceLine} 同构）。
 * @param {unknown} item - 一帧的 JSON 对象。
 * @returns {import('../shared.d.mts').StackFrame} 帧字段齐全；无效输入时为空帧。
 */
function stackFrameFromErrorSnapshot(item) {
	if (!item || typeof item !== 'object')
		return { functionName: '', filePath: '', line: 0, column: 0, raw: '' }

	const o = /** @type {Record<string, unknown>} */ item
	return {
		functionName: String(o.functionName ?? ''),
		filePath: String(o.filePath ?? ''),
		line: Number(o.line) || 0,
		column: Number(o.column) || 0,
		raw: String(o.raw ?? ''),
	}
}

/**
 * 从快照取解析后的栈帧（`stack` 为帧对象数组，与序列化管线一致）。
 * @param {Record<string, unknown>} node - `kind: 'Error'` 节点。
 * @returns {import('../shared.d.mts').StackFrame[]} 解析后的栈帧列表。
 */
function getErrorStackFramesFromSnapshot(node) {
	if (Array.isArray(node.stack) && node.stack.length) {
		const first = node.stack[0]
		if (first && typeof first === 'object')
			return node.stack.map(item => stackFrameFromErrorSnapshot(item))
	}
	return []
}

/**
 * 用 `name` / `message` 与解析帧拼展示用多行文本（不依赖原始 `error.stack` 字符串）。
 * 若首帧 `raw` 与标题行同文（如 SyntaxError 栈内重复出现首行），去掉该帧避免重复。
 * @param {string} head - 与首行展示一致的纯文本（`name: msg` 或 `name`）。
 * @param {import('../shared.d.mts').StackFrame[]} frames - 解析帧。
 * @returns {import('../shared.d.mts').StackFrame[]} 去掉与 `head` 重复 raw 后的帧。
 */
function dedupeFramesMatchingHead(head, frames) {
	const h = head.trim()
	return frames.filter(frame => frame.raw == null || frame.raw.trim() !== h)
}

/**
 * 组装 Error 展示用正文：标题行 + 栈 `raw` 行（已去重）。
 * @param {string} name - 错误名。
 * @param {string} msg - message。
 * @param {import('../shared.d.mts').StackFrame[]} frames - 解析帧。
 * @returns {string} 纯文本多行栈体。
 */
function buildErrorStackBodyText(name, msg, frames) {
	const headLinePlain = msg ? `${name}: ${msg}` : name
	const rest = dedupeFramesMatchingHead(headLinePlain, frames)
	const noStackLines = !frames.length || !rest.length
	const head = noStackLines
		? msg ? `[${name}: ${msg}]` : `[${name}]`
		: headLinePlain
	if (noStackLines) return head
	return `${headLinePlain}\n${rest.map(f => f.raw).join('\n')}`
}

/**
 * enumerable 字段包一层 `{}`（与 inspect 中带自有属性的 Error 形似）。
 * 栈帧后若有 enumerable：` …最后一行 at …` + 空格 + `{`，否则换行后 `{`。
 * @param {string} extra - `\\n  key: …` 或空。
 * @param {{ openAfterStack?: boolean }} [opts] - 接在最后一行栈帧后时用空格再接 `{`。
 * @returns {string} 带 `{}` 包裹的 enumerable 块或空串。
 */
function wrapErrorEntriesPlain(extra, opts = {}) {
	const inner = extra.replace(/^\n+/, '').trimEnd()
	if (!inner) return ''
	const open = opts.openAfterStack ? ' {' : '\n{'
	return `${open}\n${inner}\n}`
}

/**
 * @param {string} extra - 已格式化的 enumerable（可含 ANSI）。
 * @param {{ reset: string; grey: string }} colors - 括号用灰色。
 * @param {{ openAfterStack?: boolean }} [opts] - 与 {@link wrapErrorEntriesPlain} 一致。
 * @returns {string} ANSI 版 `{}` 包裹块或空串。
 */
function wrapErrorEntriesAnsi(extra, colors, opts = {}) {
	const inner = extra.replace(/^\n+/, '').trimEnd()
	if (!inner) return ''
	const open = opts.openAfterStack
		? ` ${colors.grey}{${colors.reset}`
		: `\n${colors.grey}{${colors.reset}`
	return `${open}\n${inner}\n${colors.grey}}${colors.reset}`
}

/**
 * 路径后的 `:line:col` 与收尾括号等着色。
 * @param {string} tail - 路径结束后的子串（含 `:line:col` 及后续）。
 * @param {{ reset: string; dim: string; yellow: string; magenta: string }} colors - 着色片段。
 * @param {string} baseAnsi - 行号前使用的复位/弱色前缀（与 `at` 后段一致）。
 * @returns {string} 行号列号等着色后的尾部。
 */
function ansiColorLocationTail(tail, colors, baseAnsi) {
	const match = tail.match(/^(:)(\d+)(:)(\d+)([\S\s]*)$/)
	if (!match)
		return `${colors.yellow}${tail}`
	return `${baseAnsi}${match[1]}${colors.magenta}${match[2]}${baseAnsi}${match[3]}${colors.magenta}${match[4]}${baseAnsi}${match[5]}${colors.reset}`
}

/**
 * 行首 `\\s*at\\s+`：`at` 用灰色，两侧用 low。
 * @param {string} lineStart - 从行首到函数名/路径前的片段（含 `at`）。
 * @param {{ reset: string; grey: string }} colors - 着色片段。
 * @param {string} low - 底色。
 * @returns {string} 灰显 `at` 关键词后的行首片段。
 */
function ansiPaintAtPrefix(lineStart, colors, low) {
	const match = /^(\s*)(at)(\s+)/.exec(lineStart)
	if (!match) return `${low}${lineStart}`
	return `${low}${match[1]}${colors.grey}${match[2]}${low}${match[3]}`
}

/**
 * 单行栈：`parsedFrame` 优先；底色用默认前景（不用 dim）；`at` 仅淡灰、函数青、路径黄、行号洋红。
 * 无 OSC8 时仍做分段着色，仅不包超链接。
 * OSC8 仅包住去掉行首空白后的正文，缩进空格在链接外（仍为默认前景着色）。
 * @param {string} line - 原始一行。
 * @param {{ reset: string; yellow: string; cyan: string; grey: string; magenta: string }} colors - 着色片段。
 * @param {import('../shared.d.mts').StackFrame | undefined} parsedFrame - 可选。
 * @returns {string} 着色后的单行栈文本（可含 OSC8 包裹）。
 */
function formatErrorStackLineAnsi(line, colors, parsedFrame) {
	const baseAnsi = colors.reset
	const { reset } = colors
	const leadingSpaces = line.match(/^\s*/)[0]
	const contentLine = line.slice(leadingSpaces.length)
	const indentOut = leadingSpaces ? `${baseAnsi}${leadingSpaces}${reset}` : ''

	const frame = parsedFrame ?? parseStackTraceLine(line)
	const href = stackFrameToOsc8Href(frame)
	const { filePath } = frame
	const canPaintPath = Boolean(filePath && frame.line > 0)

	/**
	 * 无有效路径时仅对 `at` 前缀做淡灰处理（不含行首缩进；缩进由调用方前缀）。
	 * @returns {string} `contentLine` 上的基础着色结果。
	 */
	const paintPlainLine = () => {
		const atMatch = /^(\s*)(at)(\s+)/.exec(contentLine)
		if (atMatch)
			return `${baseAnsi}${atMatch[1]}${colors.grey}${atMatch[2]}${baseAnsi}${atMatch[3]}${contentLine.slice(atMatch[0].length)}${reset}`
		return `${baseAnsi}${contentLine}${reset}`
	}

	if (!canPaintPath)
		return indentOut + paintPlainLine()

	const pathIndex = contentLine.lastIndexOf(filePath)
	if (pathIndex < 0) {
		const plain = paintPlainLine()
		return indentOut + (href ? ansiHyperlink(href, plain) : plain)
	}

	const head = contentLine.slice(0, pathIndex)
	const tail = contentLine.slice(pathIndex + filePath.length)
	const coloredTail = ansiColorLocationTail(tail, colors, baseAnsi)
	const atMatch = /^\s*at\s+/.exec(head)
	if (atMatch) {
		const fnStart = atMatch.index + atMatch[0].length
		const fnEnd = head.indexOf(' (', fnStart)
		if (fnEnd > fnStart) {
			const preAtThroughSpaces = head.slice(0, fnStart)
			const fn = head.slice(fnStart, fnEnd)
			const mid = head.slice(fnEnd)
			const paintedPre = ansiPaintAtPrefix(preAtThroughSpaces, colors, baseAnsi)
			const visible = `${paintedPre}${colors.cyan}${fn}${baseAnsi}${mid}${colors.yellow}${filePath}${coloredTail}`
			return indentOut + (href ? ansiHyperlink(href, visible) : visible)
		}
	}
	const headMatch = /^(\s*)(at)(\s+)([\S\s]*)$/.exec(head)
	const paintedHead = headMatch
		? `${baseAnsi}${headMatch[1]}${colors.grey}${headMatch[2]}${baseAnsi}${headMatch[3]}${headMatch[4]}`
		: `${baseAnsi}${head}`
	const visible = `${paintedHead}${colors.yellow}${filePath}${coloredTail}`
	return indentOut + (href ? ansiHyperlink(href, visible) : visible)
}

/**
 * 快照：`stack` 为帧数组；首行始终由 `name`/`message` 着色生成，栈行用解析帧着色。
 * @param {string} name - 错误名。
 * @param {string} msg - message。
 * @param {import('../shared.d.mts').StackFrame[]} frames - 解析帧。
 * @param {string} extraRendered - 附加字段。
 * @param {{ reset: string; dim: string; yellow: string; red: string; cyan: string }} colors - 着色片段。
 * @returns {string} 含标题、栈行与 enumerable 块的整段 ANSI。
 */
function formatErrorSnapshotAnsiFromFrames(name, msg, frames, extraRendered, colors) {
	const wrappedNoStack = wrapErrorEntriesAnsi(extraRendered, colors, { openAfterStack: false })
	const headText = msg ? `${name}: ${msg}` : name
	const restFrames = dedupeFramesMatchingHead(headText, frames)
	const bracketHeader = !frames.length || !restFrames.length
	const headerLine = formatErrorHeaderAnsi(name, msg, colors, bracketHeader)
	if (!frames.length)
		return `${headerLine}${wrappedNoStack}`
	if (!restFrames.length)
		return `${headerLine}${wrappedNoStack}`
	const wrappedExtra = wrapErrorEntriesAnsi(extraRendered, colors, { openAfterStack: true })
	const rest = restFrames.map(frame =>
		formatErrorStackLineAnsi(frame.raw, colors, frame)).join('\n')
	return `${headerLine}\n${rest}${wrappedExtra}`
}

/**
 * @param {unknown} snap - 任意快照。
 * @param {FormatSnapshotOptions} options - 格式选项（含 `depth`、`colorize`）。
 * @returns {string} 单棵快照树对应的展示文本。
 */
function formatSnapshotInner(snap, options) {
	const colorize = options.colorize !== false
	const depthLimit = options.depth ?? Infinity
	const indentUnit = typeof options.indent === 'string' ? options.indent : '\t'
	const colors = colorize ? {
		reset: '\x1b[0m',
		green: '\x1b[32m',
		yellow: '\x1b[33m',
		cyan: '\x1b[36m',
		grey: '\x1b[90m',
		magenta: '\x1b[35m',
		red: '\x1b[31m',
		dim: '\x1b[2m',
	}
		: {
			reset: '',
			green: '',
			yellow: '',
			cyan: '',
			grey: '',
			magenta: '',
			red: '',
			dim: '',
		}

	/**
	 * @param {unknown} snapshotNode - 快照树上的节点（或兜底的非对象原语）。
	 * @param {number} objectDepth - 对象深度。
	 * @returns {string} 该节点在 plain/ANSI 下的展示串（不含 `&lt;ref *N&gt;` 前缀；外层 `formatNode` 负责前缀）。
	 */
	function formatNodeImpl(snapshotNode, objectDepth) {
		/**
		 * 装箱对象自有属性：`[Number: 0] { x: 1 }` 中的 `{ … }`。
		 * @param {Array<{ key: string; value: unknown }>} entries - 自有枚举属性。
		 * @returns {string} 自有枚举属性展示串。
		 */
		function formatOwnEntriesTail(entries) {
			if (!Array.isArray(entries) || !entries.length) return ''
			if (objectDepth >= depthLimit) return ''
			const compactLines = entries.map(entry => {
				if (!entry || typeof entry !== 'object') return '?'
				const { key, value: val } = /** @type {{ key: string; value: unknown }} */ entry
				let keyStr = key
				if (!/^[$A-Z_a-z][\w$]*$/.test(keyStr))
					keyStr = `'${keyStr.replaceAll('\'', '\\\'').replaceAll('\n', '\\n')}'`
				return `${keyStr}: ${formatNode(val, objectDepth + 1)}`
			})
			const compactInner = compactLines.join(', ')
			if (!compactInner.includes('\n') && compactInner.length <= 120)
				return ` { ${compactInner} }`
			const spaces = indentUnit.repeat(objectDepth + 1)
			const nextIndent = indentUnit.repeat(objectDepth)
			const lines = entries.map(entry => {
				if (!entry || typeof entry !== 'object') return `${spaces}?`
				const { key, value: val } = /** @type {{ key: string; value: unknown }} */ entry
				let keyStr = key
				if (!/^[$A-Z_a-z][\w$]*$/.test(keyStr))
					keyStr = `'${keyStr.replaceAll('\'', '\\\'').replaceAll('\n', '\\n')}'`
				return `${spaces}${keyStr}: ${formatNode(val, objectDepth + 1)}`
			})
			return ` {\n${lines.join(',\n')}\n${nextIndent}}`
		}

		if (snapshotNode == null || typeof snapshotNode !== 'object')
			return colors.grey + String(snapshotNode) + colors.reset

		const node = /** @type {Record<string, unknown>} */ snapshotNode

		if (node.kind === 'truncated') {
			const rawLabel = String(node.label ?? 'Object')
			const bracketed = rawLabel.startsWith('[') && rawLabel.endsWith(']')
				? rawLabel
				: `[${rawLabel}]`
			return `${colors.cyan}${bracketed}${colors.reset}`
		}

		if (node.kind === 'null')
			return `${colors.reset}null${colors.reset}`

		if (node.kind === 'string')
			return `${colors.green}${quoteSingleJsString(node.value)}${colors.reset}`

		if (node.kind === 'number')
			return `${colors.yellow}${node.value}${colors.reset}`

		if (node.kind === 'boolean')
			return `${colors.yellow}${node.value}${colors.reset}`

		if (node.kind === 'undefined')
			return `${colors.grey}undefined${colors.reset}`

		if (node.kind === 'bigint')
			return `${colors.yellow}${node.value}n${colors.reset}`

		if (node.kind === 'symbol')
			return `${colors.green}${node.value}${colors.reset}`

		if (node.kind === 'function') {
			const n = String(node.value ?? '(anonymous)')
			if (node.isClass === true)
				return `${colors.cyan}[class ${n}]${colors.reset}`
			if (n === '(anonymous)')
				return `${colors.cyan}[Function (anonymous)]${colors.reset}`
			return `${colors.cyan}[Function: ${n}]${colors.reset}`
		}

		if (node.kind === 'unknown')
			return `${colors.grey}${node.value}${colors.reset}`

		if (node.kind === 'circular') {
			const circularRefIndex = /** @type {{ refId?: number; value?: unknown }} */ node.refId
			const text = typeof circularRefIndex === 'number'
				? `[Circular *${circularRefIndex}]`
				: String(/** @type {{ value?: unknown }} */ node.value ?? '[Circular]')
			return `${colors.cyan}${text}${colors.reset}`
		}

		if (node.kind === 'Date')
			return `${colors.magenta}${node.value}${colors.reset}`

		if (node.kind === 'RegExp')
			return `${colors.red}${node.value}${colors.reset}`

		if (node.kind === 'Number' && typeof node.boxedText === 'string') {
			const inner = `Number: ${node.boxedText}`
			const head = colorize ? `${colors.yellow}[${inner}]${colors.reset}` : `[${inner}]`
			return head + formatOwnEntriesTail(/** @type {Array<{ key: string; value: unknown }>} */ node.entries)
		}

		if (node.kind === 'Boolean' && typeof node.boxedText === 'string') {
			const inner = `Boolean: ${node.boxedText}`
			const head = colorize ? `${colors.yellow}[${inner}]${colors.reset}` : `[${inner}]`
			return head + formatOwnEntriesTail(/** @type {Array<{ key: string; value: unknown }>} */ node.entries)
		}

		if (node.kind === 'String' && typeof node.boxedString === 'string') {
			const inner = `String: ${quoteSingleJsString(node.boxedString)}`
			const head = colorize ? `${colors.yellow}[${inner}]${colors.reset}` : `[${inner}]`
			return head + formatOwnEntriesTail(/** @type {Array<{ key: string; value: unknown }>} */ node.entries)
		}

		if (node.kind === 'Error') {
			const name = String(node.name ?? 'Error')
			const msg = String(node.message ?? '')
			const extra = Array.isArray(node.entries) && node.entries.length
				? '\n' + node.entries.map(entry => {
					if (!entry || typeof entry !== 'object') return ''
					const { key, value: val } = /** @type {{ key: string; value: unknown }} */ entry
					return `  ${key}: ${formatNode(val, objectDepth)}`
				}).filter(Boolean).join('\n')
				: ''
			const frames = getErrorStackFramesFromSnapshot(node)
			const headLinePlain = msg ? `${name}: ${msg}` : name
			const bodyText = buildErrorStackBodyText(name, msg, frames)
			const openAfterStack = dedupeFramesMatchingHead(headLinePlain, frames).length > 0
			if (!colorize)
				return bodyText + wrapErrorEntriesPlain(extra, { openAfterStack })
			return formatErrorSnapshotAnsiFromFrames(name, msg, frames, extra, colors)
		}

		if (node.kind === 'Map') {
			if (objectDepth >= depthLimit)
				return `${colors.cyan}[Map]${colors.reset}`
			const items = /** @type {Array<{ key: unknown; value: unknown }>} */ node.items || []
			if (!items.length) return `${colors.cyan}Map(0) {}${colors.reset}`
			const lines = items.map(({ key, value: val }) => {
				const ks = formatNode(key, objectDepth + 1)
				const vs = formatNode(val, objectDepth + 1)
				return `${indentUnit}${ks} => ${vs}`
			})
			return `${colors.cyan}Map(${items.length}) ${colors.reset}{\n${lines.join(',\n')}\n}`
		}

		if (node.kind === 'Set') {
			if (objectDepth >= depthLimit)
				return `${colors.cyan}[Set]${colors.reset}`
			const items = /** @type {unknown[]} */ node.items || []
			if (!items.length) return `${colors.cyan}Set(0) {}${colors.reset}`
			const lines = items.map(el => `${indentUnit}${formatNode(el, objectDepth + 1)}`)
			return `${colors.cyan}Set(${items.length}) ${colors.reset}{\n${lines.join(',\n')}\n}`
		}

		if (node.kind === 'array') {
			if (objectDepth >= depthLimit)
				return `${colors.cyan}[Array]${colors.reset}`
			const items = /** @type {unknown[]} */ node.items || []
			if (!items.length) return '[]'
			const rendered = items.map(el => formatNode(el, objectDepth + 1))
			const compactInner = rendered.join(', ')
			if (!compactInner.includes('\n') && compactInner.length <= 80)
				return `[ ${compactInner} ]`
			const spaces = indentUnit.repeat(objectDepth + 1)
			const inner = rendered.map(el => `${spaces}${el}`).join(',\n')
			const openIndent = indentUnit.repeat(objectDepth)
			return `[\n${inner}\n${openIndent}]`
		}

		// 泛型对象：kind + entries
		if (Array.isArray(node.entries)) {
			if (objectDepth >= depthLimit)
				return `${colors.cyan}[${String(node.kind ?? 'Object')}]${colors.reset}`
			const entries = /** @type {Array<{ key: string; value: unknown }>} */ node.entries
			if (!entries.length) {
				const kind = String(node.kind ?? 'Object')
				return `${kind === 'object' || kind === 'Object' ? '' : kind + ' '}{}`
			}
			const isArrayLike = node.kind === 'array'
			const open = isArrayLike ? '[' : '{'
			const close = isArrayLike ? ']' : '}'
			const spaces = indentUnit.repeat(objectDepth + 1)
			const nextIndent = indentUnit.repeat(objectDepth)
			const lines = entries.map(entry => {
				if (!entry || typeof entry !== 'object') return `${spaces}?`
				const { key, value: val } = /** @type {{ key: string; value: unknown }} */ entry
				if (isArrayLike) return `${spaces}${formatNode(val, objectDepth + 1)}`
				let keyStr = key
				if (!/^[$A-Z_a-z][\w$]*$/.test(keyStr))
					keyStr = `'${keyStr.replaceAll('\'', '\\\'').replaceAll('\n', '\\n')}'`
				return `${spaces}${keyStr}: ${formatNode(val, objectDepth + 1)}`
			})
			const compactLines = entries.map(entry => {
				if (!entry || typeof entry !== 'object') return '?'
				const { key, value: val } = /** @type {{ key: string; value: unknown }} */ entry
				if (isArrayLike) return formatNode(val, objectDepth + 1)
				let keyStr = key
				if (!/^[$A-Z_a-z][\w$]*$/.test(keyStr))
					keyStr = `'${keyStr.replaceAll('\'', '\\\'').replaceAll('\n', '\\n')}'`
				return `${keyStr}: ${formatNode(val, objectDepth + 1)}`
			})
			const compactInner = compactLines.join(', ')
			const compactPrefix = node.kind && node.kind !== 'object' && node.kind !== 'Object' ? `${node.kind} ` : ''
			if (!compactInner.includes('\n') && compactInner.length <= 80)
				return `${compactPrefix}${open} ${compactInner} ${close}`
			const prefix = node.kind && node.kind !== 'object' && node.kind !== 'Object' ? `${node.kind} ` : ''
			return `${prefix}${open}\n${lines.join(',\n')}\n${nextIndent}${close}`
		}

		try {
			return JSON.stringify(node)
		}
		catch {
			return String(node)
		}
	}

	/**
	 * @param {unknown} snapshotNode - 快照树上的节点（或兜底的非对象原语）。
	 * @param {number} objectDepth - 对象深度。
	 * @returns {string} 与 `util.inspect` 一致的 `&lt;ref *N&gt;` 前缀 + 正文。
	 */
	const formatNode = (snapshotNode, objectDepth) => {
		const raw = formatNodeImpl(snapshotNode, objectDepth)
		if (snapshotNode !== null && typeof snapshotNode === 'object' && typeof /** @type {{ inspectRefId?: number }} */ snapshotNode.inspectRefId === 'number') {
			const inspectRefIndex = /** @type {{ inspectRefId: number }} */ snapshotNode.inspectRefId
			const refPrefix = colorize
				? `${colors.cyan}<ref *${inspectRefIndex}> ${colors.reset}`
				: `<ref *${inspectRefIndex}> `
			return refPrefix + raw
		}
		return raw
	}

	return formatNode(snap, 0)
}
