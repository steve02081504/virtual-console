import { trimLeadingRuntimeInternalFrames } from '../stack.mjs'

import { LogEntry } from './log-entry.mjs'

/**
 * `stdout` / `stderr` 流日志条目：原样透传文本，不追加换行片段。
 * `stack` 在基类惰性解析之上再裁掉栈顶 Node/Deno 运行时内部帧。
 */
export class StreamLogEntry extends LogEntry {
	/**
	 * @type {import('../../shared.d.mts').StackFrame[] | undefined}
	 */
	#trimmedStack

	/**
	 * @param {object} options - 日志条目选项。
	 * @param {'stdout' | 'stderr'} options.method - 流方法名。
	 * @param {any[]} [options.args] - 原始流参数。
	 * @param {import('../../shared.d.mts').StackFrame[]} [options.stack] - 已解析调用栈。
	 * @param {Error} [options.stackSource] - 惰性栈来源。
	 * @param {number} [options.skipFrames] - 解析 `stackSource` 时跳过的顶行数。
	 * @param {number} [options.timestamp] - 日志时间戳（默认 Date.now()）。
	 * @param {boolean} [options.supportsAnsi] - 是否支持 ANSI 序列。
	 */
	constructor({ method, args = [], ...rest }) {
		const text = String(args[0] ?? '')
		super({ method, args: [text], ...rest })
		this.text = text
	}

	/**
	 * @returns {import('../../shared.d.mts').StackFrame[]} 裁掉运行时内部帧后的栈。
	 */
	get stack() {
		return this.#trimmedStack ??= trimLeadingRuntimeInternalFrames(super.stack)
	}

	/** @returns {string} 原始流文本（不追加换行）。 */
	toString() {
		return this.text
	}

	/**
	 * @returns {import('../../shared.d.mts').LogSegment[]} 流文本片段。
	 */
	toSegments() {
		return [{ kind: 'text', text: this.text }]
	}
}
