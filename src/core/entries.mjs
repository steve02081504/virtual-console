import { stripOscTitleSequences } from '../format/ansi.mjs'
import { renderAnsi, renderHtml as renderHtmlFromSegments, renderPlain as renderPlainFromSegments } from '../format/render.mjs'
import { buildArgsSegments } from '../format/segments.mjs'

import {
	DEFAULT_SNAPSHOT_DEPTH,
	createExpansionScope,
	getLogEntryArgs,
	serializeArgSnapshot,
	setLogEntryArgs,
} from './snapshot.mjs'
import { getStackInfo } from './stack.mjs'

let nextLogEntryId = 0

/**
 * 将 console 方法名转换为语义级别。
 * @param {string} methodName - console 方法名。
 * @returns {string} 语义级别。
 */
export function methodNameToLevel(methodName) {
	return {
		dir: 'log',
		trace: 'debug',
		stdout: 'log',
		stderr: 'error',
	}[methodName] ?? methodName
}

/**
 * 单条日志条目：`segments` 由 {@link LogEntry#toSegments} 按需构造；`stdout`/`stderr` 带 `streamText`。
 */
export class LogEntry {
	/**
	 * @param {object} options - 日志条目选项。
	 * @param {string} options.method - 日志方法名。
	 * @param {any[]} options.args - 日志参数（WeakMap 存储）；流为 `[streamText]`。
	 * @param {ReturnType<typeof getStackInfo>} options.stack - 调用栈。
	 * @param {number} options.timestamp - 日志时间戳（默认 Date.now()）。
	 * @param {boolean} options.supportsAnsi - 是否支持 ANSI 序列。
	 */
	constructor({ method, args = [], stack = [], timestamp = Date.now(), supportsAnsi = false }) {
		this.id = ++nextLogEntryId
		this.level = methodNameToLevel(method)
		this.method = method
		this.stack = stack
		this.timestamp = timestamp
		this.supportsAnsi = supportsAnsi

		if (method === 'stdout' || method === 'stderr') {
			const text = String(args?.[0] ?? '')
			this.streamText = text
			setLogEntryArgs(this, [text])
		}
		else setLogEntryArgs(this, args)
	}
	/**
	 * 第一条带源路径的栈帧，便于展示调用来源。
	 * @returns {import('../shared.d.mts').StackFrame | null} 无路径帧时为 null。
	 */
	get primaryCallsite() {
		return this.stack?.find(frame => frame?.filePath) ?? null
	}
	/**
	 * 终端 ANSI 串（`stdout`/`stderr` 为原始流文本）。
	 * @returns {string} `renderAnsi(toSegments())` 或流文本。
	 */
	toString() {
		if (this.method === 'stdout' || this.method === 'stderr')
			return this.streamText ?? ''
		return renderAnsi(this.toSegments(), { colorize: this.supportsAnsi })
	}
	/**
	 * 剥除转义与样式后的纯文本。
	 * @returns {string} `renderPlain(toSegments())`。
	 */
	toPlainText() {
		return renderPlainFromSegments(this.toSegments())
	}
	/**
	 * 与 `toSegments` 同管线下的 HTML。
	 * @returns {string} `renderHtml(toSegments(), …)`。
	 */
	toHtml() {
		return renderHtmlFromSegments(this.toSegments(), { supportsAnsi: this.supportsAnsi })
	}
	/**
	 * 将捕获参数序列化为可 JSON 的快照树数组。
	 * @param {number} [maxDepth=DEFAULT_SNAPSHOT_DEPTH] - 各参数的递归深度上限。
	 * @returns {import('../shared.d.mts').ArgSnapshot[]} 与参数个数相同的快照数组。
	 */
	serializeArgs(maxDepth = DEFAULT_SNAPSHOT_DEPTH) {
		return getLogEntryArgs(this).map(arg =>
			serializeArgSnapshot(arg, { maxDepth }))
	}
	/**
	 * 结构化片段：`log`/`dir`/`trace` 等在末尾含 `{ kind: 'text', text: '\\n' }`；流不含。
	 * @returns {import('../shared.d.mts').LogSegment[]} 可供 `renderPlain` / `renderAnsi` / `renderHtml` 消费。
	 */
	toSegments() {
		const expansionScope = createExpansionScope(this)
		const maxDepth = DEFAULT_SNAPSHOT_DEPTH

		if (this.method === 'stdout' || this.method === 'stderr') {
			const strippedFirst = stripOscTitleSequences(String(this.streamText ?? ''))
			if (!strippedFirst.length) return []
			return [{ kind: 'text', text: strippedFirst }]
		}

		if (this.method === 'dir') {
			const [subject, dirOptions] = getLogEntryArgs(this)
			const segs = /** @type {import('../shared.d.mts').LogSegment[]} */[{
				kind: 'value',
				snapshot: serializeArgSnapshot(subject, { maxDepth, expansionScope }),
				...dirOptions !== undefined
					? { dirOptions: serializeArgSnapshot(dirOptions, { maxDepth }) }
					: {},
			}]
			return [...segs, { kind: 'text', text: '\n' }]
		}

		if (this.method === 'trace') {
			const segs = [
				...buildArgsSegments(getLogEntryArgs(this), expansionScope, maxDepth),
				{
					kind: 'trace',
					snapshot: serializeArgSnapshot(this.stack, { maxDepth }),
				},
			]
			return [...segs, { kind: 'text', text: '\n' }]
		}

		return [...buildArgsSegments(getLogEntryArgs(this), expansionScope, maxDepth), { kind: 'text', text: '\n' }]
	}
}

/**
 * @param {object} options - 见 {@link LogEntry} 构造函数。
 * @returns {LogEntry} 新分配的日志条目实例。
 */
export function newLogEntry(options) {
	return new LogEntry(options)
}
