import { renderAnsi, renderHtml, renderPlain } from '../../format/render.mjs'
import { buildArgsSegments, ENTRY_TRAILING_NEWLINE } from '../../format/segments.mjs'
import { getExpansionScope } from '../snapshot/expansion.mjs'
import { DEFAULT_SNAPSHOT_DEPTH, serializeArgSnapshot } from '../snapshot/serialize.mjs'
import { parseErrorStack, resolvePrimaryCallsiteFromSegments } from '../stack.mjs'

import { methodNameToLevel } from './level.mjs'

/**
 *
 */
export { methodNameToLevel } from './level.mjs'

/**
 * 单条日志条目：`segments` 由 {@link LogEntry#toSegments} 按需构造；`stdout`/`stderr` 带 `text`。
 * `stack` 可惰性解析：构造时传入 `stackSource`（`Error`）+ `skipFrames`，首次读取 `stack` 时才解析。
 */
export class LogEntry {
	/**
	 * @type {import('../../shared.d.mts').StackFrame[] | undefined}
	 */
	#parsedStack

	/**
	 * @type {Error | undefined}
	 */
	#stackSource

	/**
	 * @type {number}
	 */
	#skipFrames = 0

	/**
	 * @param {object} options - 日志条目选项。
	 * @param {string} options.method - 日志方法名。
	 * @param {any[]} [options.args] - 日志参数；流为 `[text]`。
	 * @param {import('../../shared.d.mts').StackFrame[]} [options.stack] - 已解析调用栈（与 `stackSource` 二选一）。
	 * @param {Error} [options.stackSource] - 惰性栈来源；首次读 `stack` 时解析。
	 * @param {number} [options.skipFrames=0] - 解析 `stackSource` 时跳过的顶行数。
	 * @param {number} [options.timestamp] - 日志时间戳（默认 Date.now()）。
	 * @param {boolean} [options.supportsAnsi] - 是否支持 ANSI 序列。
	 */
	constructor({
		method,
		args = [],
		stack,
		stackSource,
		skipFrames = 0,
		timestamp = Date.now(),
		supportsAnsi = false,
	}) {
		this.level = methodNameToLevel(method)
		this.method = method
		this.timestamp = timestamp
		this.supportsAnsi = supportsAnsi
		this.args = args
		if (Array.isArray(stack))
			this.#parsedStack = stack
		else if (stackSource) {
			this.#stackSource = stackSource
			this.#skipFrames = skipFrames
		}
		else
			this.#parsedStack = []
	}

	/**
	 * 解析后的调用栈；惰性来源在首次读取时解析并缓存，随后丢弃 `Error` 引用。
	 * @returns {import('../../shared.d.mts').StackFrame[]} 栈帧数组。
	 */
	get stack() {
		if (this.#parsedStack) return this.#parsedStack
		this.#parsedStack = parseErrorStack(this.#stackSource, this.#skipFrames)
		this.#stackSource = undefined
		return this.#parsedStack
	}

	/**
	 * 参与格式化 / 透传展示的参数（`freshLine` 等可跳过 id）。
	 * @returns {any[]} 展示用参数数组。
	 */
	get displayArgs() {
		return this.args
	}

	/**
	 * 展示来源：优先片段中首个 Error 的栈帧，否则为捕获调用栈中第一条。
	 * @returns {import('../../shared.d.mts').StackFrame | null} 无路径帧时为 null。
	 */
	get primaryCallsite() {
		return resolvePrimaryCallsiteFromSegments(this.toSegments(), this.stack)
	}

	/**
	 * 终端 ANSI 串（`stdout`/`stderr` 为原始流文本）。
	 * @returns {string} `renderAnsi(toSegments())` 或流文本。
	 */
	toString() {
		return renderAnsi(this.toSegments(), { colorize: this.supportsAnsi })
	}

	/**
	 * 剥除转义与样式后的纯文本。
	 * @returns {string} `renderPlain(toSegments())`。
	 */
	toPlainText() {
		return renderPlain(this.toSegments())
	}

	/**
	 * 与 `toSegments` 同管线下的 HTML。
	 * @returns {string} `renderHtml(toSegments(), …)`。
	 */
	toHtml() {
		return renderHtml(this.toSegments(), { supportsAnsi: this.supportsAnsi })
	}

	/**
	 * 将捕获参数序列化为可 JSON 的快照树数组。
	 * @param {number} [maxDepth=DEFAULT_SNAPSHOT_DEPTH] - 各参数的递归深度上限。
	 * @returns {import('../../shared.d.mts').ArgSnapshot[]} 与展示参数个数相同的快照数组。
	 */
	serializeArgs(maxDepth = DEFAULT_SNAPSHOT_DEPTH) {
		return this.displayArgs.map(arg => serializeArgSnapshot(arg, { maxDepth }))
	}

	/**
	 * 结构化片段：`log`/`dir`/`trace` 等在末尾含 `{ kind: 'text', text: '\\n' }`；流不含。
	 * @returns {import('../../shared.d.mts').LogSegment[]} 可供 `renderPlain` / `renderAnsi` / `renderHtml` 消费。
	 */
	toSegments() {
		return [
			...buildArgsSegments(this.displayArgs, getExpansionScope(this), DEFAULT_SNAPSHOT_DEPTH),
			ENTRY_TRAILING_NEWLINE,
		]
	}

	/**
	 * JSON 传输视图（默认与 wire 载荷字段对齐，供子类重载扩展）。
	 * @returns {Record<string, unknown>} JSON 友好对象。
	 */
	toJSON() {
		return {
			method: this.method,
			timestamp: this.timestamp,
			segments: this.toSegments(),
			stack: this.stack,
		}
	}
}
