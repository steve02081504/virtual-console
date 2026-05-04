import { SegmentCollection } from '../format/segment_collection.mjs'

/**
 * @typedef {object} WireLogEntryPayload
 * @property {number} [id]
 * @property {string} [level]
 * @property {string} [method]
 * @property {number} [timestamp]
 * @property {string} [plainText]
 * @property {import('../shared.d.mts').LogSegment[]} [segments]
 * @property {unknown} [callsite]
 */

/**
 * 线路下行单条日志载荷的面向对象包装（与进程内 {@link LogEntry} 镜像字段，无原始 `args`）。
 */
export class WireLogEntry {
	/** @type {Record<string, unknown>} */
	#payload

	/**
	 * @param {WireLogEntryPayload | Record<string, unknown>} payload - 线路或裸对象；会浅拷贝存为内部载荷。
	 */
	constructor(payload) {
		this.#payload = { ...payload }
	}

	/** @returns {number | undefined} 稳定条目 id（若对端提供）。 */
	get id() {
		return /** @type {number | undefined} */ this.#payload.id
	}

	/** @returns {string | undefined} 语义级别（如 log/warn/error）。 */
	get level() {
		return /** @type {string | undefined} */ this.#payload.level
	}

	/** @returns {string | undefined} 原始 console 方法名（如 log、trace）。 */
	get method() {
		return /** @type {string | undefined} */ this.#payload.method
	}

	/** @returns {number | undefined} 毫秒时间戳。 */
	get timestamp() {
		return /** @type {number | undefined} */ this.#payload.timestamp
	}

	/**
	 * 结构化片段集合视图。
	 * @returns {SegmentCollection} 基于载荷 `segments` 字段（缺省为空数组）。
	 */
	get segmentCollection() {
		return SegmentCollection.fromWireSegmentsField(this.#payload.segments)
	}

	/**
	 * 与 `plainText` 字段对齐的可搜索文本（无字段时由片段推导）。
	 * @returns {string} 纯文本检索串。
	 */
	toPlainText() {
		return this.#payload.plainText || this.segmentCollection.toPlainText({})
	}

	/**
	 * 默认字符串化：同 {@link WireLogEntry#toPlainText}。
	 * @returns {string} 与 {@link WireLogEntry#toPlainText} 相同。
	 */
	toString() {
		return this.toPlainText()
	}

	/**
	 * @param {{ htmlOptions?: import('../format/render_engine.mjs').RenderHtmlOptions }} [options] - trace 栈与链接样式。
	 * @returns {string} HTML 片段串。
	 */
	toHtml({ htmlOptions = {} } = {}) {
		return this.segmentCollection.toHtml({ htmlOptions })
	}

	/**
	 * @param {{ ansiOptions?: import('../format/render_engine.mjs').RenderAnsiOptions }} [options] - 终端 ANSI/OSC 8 选项。
	 * @returns {string} 终端可打印串。
	 */
	toAnsiText({ ansiOptions = {} } = {}) {
		return this.segmentCollection.toAnsiText({ ansiOptions })
	}

	/**
	 * 浅拷贝原始载荷（用于序列化或透传）。
	 * @returns {Record<string, unknown>} 内部载荷的浅克隆。
	 */
	toJSON() {
		return { ...this.#payload }
	}

	/**
	 * 从任意对象构造；非法时抛出。
	 * @param {unknown} value - 线路 payload 或已有 `WireLogEntry`。
	 * @returns {WireLogEntry} 规范包装实例。
	 */
	static from(value) {
		if (value instanceof WireLogEntry) return value
		return new WireLogEntry(/** @type {Record<string, unknown>} */ value)
	}
}
