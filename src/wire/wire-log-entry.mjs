import supportsAnsiDefault from 'supports-ansi'

import { renderAnsi, renderHtml, renderPlain } from '../format/render.mjs'

import {
	applyExpandedSnapshotsInSegments,
	collectTruncatedRefsFromSegments,
	cloneSegments,
} from './expand-wire-segments.mjs'

/**
 * @typedef {object} WireLogEntryPayload
 * @property {number} [id]
 * @property {string} [level]
 * @property {string} [method]
 * @property {number} [timestamp]
 * @property {import('../shared.d.mts').LogSegment[]} [segments]
 * @property {unknown} [callsite]
 */

/**
 * @typedef {object} WireContext
 * @property {(ref: string) => Promise<unknown>} requestExpand - 通过线路请求 `vc_expand_request` 并兑现快照。
 * @property {boolean} [supportsAnsi] - 未指定时使用全局 `supports-ansi` 检测结果。
 */

/**
 * 线路下行单条日志：`render*` 异步仅用于 wire；展开后与进程内 {@link LogEntry} 的 `toString` / `toPlainText` / `toHtml` 同管线。
 */
export class WireLogEntry {
	/** @type {Record<string, unknown>} */
	#payload

	/** @type {(ref: string) => Promise<unknown>} */
	#requestExpand

	/** @type {boolean} */
	#supportsAnsi

	/** @type {Promise<import('../shared.d.mts').LogSegment[]> | null} */
	#expandPromise = null

	/** @type {import('../shared.d.mts').LogSegment[] | null} */
	#expandedSegments = null

	/**
	 * @param {WireLogEntryPayload | Record<string, unknown>} payload - 线路 JSON 单条载荷。
	 * @param {WireContext} wire - 展开与 ANSI 开关。
	 */
	constructor(payload, wire) {
		this.#payload = { ...payload }
		this.#requestExpand = wire.requestExpand
		this.#supportsAnsi = wire.supportsAnsi ?? supportsAnsiDefault
	}

	/** @returns {number | undefined} 稳定条目 id（若对端提供）。 */
	get id() {
		return this.#payload.id
	}

	/** @returns {string | undefined} 语义级别。 */
	get level() {
		return this.#payload.level
	}

	/** @returns {string | undefined} 原始方法名。 */
	get method() {
		return this.#payload.method
	}

	/** @returns {number | undefined} 毫秒时间戳。 */
	get timestamp() {
		return this.#payload.timestamp
	}

	/**
	 * 当前（已展开则已展开）片段数组（只读视图：与内部存储同一引用，勿原地改）。
	 * @returns {import('../shared.d.mts').LogSegment[]} 用于渲染与展示的片段列表。
	 */
	get segments() {
		return this.#expandedSegments ?? this.#payload.segments ?? []
	}

	/**
	 * 等待全部 `truncated.ref` 展开后返回终端 ANSI 串；无片段时返回空串。
	 * @returns {Promise<string>} 异步解析得到的 ANSI 正文。
	 */
	renderString() {
		return this.#renderString()
	}

	/**
	 * 展开后返回纯文本（剥除 ANSI/OSC）；无片段时返回空串。
	 * @returns {Promise<string>} 异步解析得到的纯文本。
	 */
	renderPlain() {
		return this.#renderPlain()
	}

	/**
	 * 展开后返回 HTML。
	 * @returns {Promise<string>} 异步解析得到的 HTML 字符串。
	 */
	renderHtml() {
		return this.#renderHtml()
	}

	/** @returns {Promise<string>} 展开后 ANSI 串或空串。 */
	async #renderString() {
		const segments = await this.#ensureExpanded()
		if (segments.length > 0)
			return renderAnsi(segments, { colorize: this.#supportsAnsi })
		return ''
	}

	/** @returns {Promise<string>} 展开后纯文本或空串。 */
	async #renderPlain() {
		const segments = await this.#ensureExpanded()
		if (segments.length > 0)
			return renderPlain(segments)
		return ''
	}

	/** @returns {Promise<string>} 展开后 HTML 或空串。 */
	async #renderHtml() {
		const segments = await this.#ensureExpanded()
		if (segments.length > 0)
			return renderHtml(segments, { supportsAnsi: this.#supportsAnsi })
		return ''
	}

	/**
	 * @returns {Promise<import('../shared.d.mts').LogSegment[]>} 展开后的片段副本。
	 */
	async #ensureExpanded() {
		if (this.#expandedSegments)
			return this.#expandedSegments
		if (this.#expandPromise)
			return this.#expandPromise
		this.#expandPromise = this.#expandAllSegments().then((segs) => {
			this.#expandedSegments = segs
			this.#expandPromise = null
			return segs
		})
		return this.#expandPromise
	}

	/**
	 * @returns {Promise<import('../shared.d.mts').LogSegment[]>} 克隆并替换截断节点后的片段。
	 */
	async #expandAllSegments() {
		const cloned = cloneSegments(this.#payload.segments ?? [])
		const refs = collectTruncatedRefsFromSegments(cloned)
		if (refs.size === 0)
			return cloned

		const refToSnapshot = new Map()
		await Promise.all([...refs].map(async (ref) => {
			const snap = await this.#requestExpand(ref)
			refToSnapshot.set(ref, snap)
		}))
		applyExpandedSnapshotsInSegments(cloned, refToSnapshot)
		return cloned
	}

	/**
	 * 浅拷贝载荷（不含展开缓存）。
	 * @returns {Record<string, unknown>} JSON 友好对象。
	 */
	toJSON() {
		return { ...this.#payload }
	}

	/**
	 * @param {unknown} value - 线路载荷或已有实例。
	 * @param {WireContext} wire - 必填连接上下文。
	 * @returns {WireLogEntry} 包装实例。
	 */
	static from(value, wire) {
		return value instanceof WireLogEntry ? value : new WireLogEntry(value, wire)
	}
}
