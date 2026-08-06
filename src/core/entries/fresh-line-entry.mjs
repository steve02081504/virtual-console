import { LogEntry } from './log-entry.mjs'

/**
 * `console.freshLine` 条目：首个参数为行 id，不进入日志格式化。
 */
export class FreshLineLogEntry extends LogEntry {
	/**
	 * @param {object} options - 日志条目选项。
	 * @param {'freshLine'} options.method - 方法名。
	 * @param {any[]} [options.args] - 原始参数，首项应为 id。
	 * @param {import('../../shared.d.mts').StackFrame[]} [options.stack] - 已解析调用栈。
	 * @param {Error} [options.stackSource] - 惰性栈来源。
	 * @param {number} [options.skipFrames] - 解析 `stackSource` 时跳过的顶行数。
	 * @param {number} [options.timestamp] - 日志时间戳（默认 Date.now()）。
	 * @param {boolean} [options.supportsAnsi] - 是否支持 ANSI 序列。
	 */
	constructor(options) {
		super(options)
		this.id = String(options.args?.[0] ?? '')
	}

	/**
	 * 跳过首个 id 参数。
	 * @returns {any[]} 除 id 外的参数。
	 */
	get displayArgs() {
		return this.args.slice(1)
	}

	/**
	 * freshLine 的 JSON 传输视图：在基类字段上追加 id。
	 * @returns {Record<string, unknown>} JSON 友好对象。
	 */
	toJSON() {
		return {
			...super.toJSON(),
			id: this.id,
		}
	}
}
