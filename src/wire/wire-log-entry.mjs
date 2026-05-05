import supportsAnsiDefault from 'supports-ansi'

import { renderAnsi, renderHtml, renderPlain } from '../format/render.mjs'

import {
	applyExpandedSnapshotsInSegments,
	collectTruncatedRefsWithDepthFromSegments,
} from './expand-wire-segments.mjs'

/**
 * @typedef {object} WireLogEntryPayload
 * @property {number} [id]
 * @property {string} [level]
 * @property {string} [method]
 * @property {number} [timestamp]
 * @property {import('../shared.d.mts').LogSegment[]} [segments]
 * @property {import('../shared.d.mts').StackFrame[]} [stack]
 */

/**
 * @typedef {object} WireContext
 * @property {(ref: string, maxDepth?: number) => Promise<unknown>} requestExpand - 通过线路请求 `vc_expand_request` 并兑现快照。
 * @property {boolean} [supportsAnsi] - 未指定时使用全局 `supports-ansi` 检测结果。
 */

/**
 * @typedef {object} WireRenderOptions
 * @property {string} [indent='\t'] - 多行结构缩进单元。
 * @property {number} [maxDepth=Infinity] - 值快照最大展开深度。
 */

/**
 * 线路下行单条日志：`render*` 异步仅用于 wire；展开后与进程内 {@link LogEntry} 的 `toString` / `toPlainText` / `toHtml` 同管线。
 */
export class WireLogEntry {
	/** @type {(Promise<import('../shared.d.mts').LogSegment[]> & { targetDepth?: number }) | null} */
	#expandPromise = null

	/**
	 * @param {WireLogEntryPayload | Record<string, unknown>} payload - 线路 JSON 单条载荷。
	 * @param {WireContext} wire - 展开与 ANSI 开关。
	 */
	constructor(payload, wire) {
		this.id = payload.id
		this.level = payload.level
		this.method = payload.method
		this.timestamp = payload.timestamp
		this.stack = payload.stack
		this.segments = payload.segments
		this.wire = wire
		this.supportsAnsi = wire.supportsAnsi ?? supportsAnsiDefault
	}

	/** @returns {import('../shared.d.mts').StackFrame | null} 第一条带路径的栈帧。 */
	get primaryCallsite() {
		return this.stack.find((frame) => frame?.filePath) ?? null
	}

	/**
	 * 等待全部 `truncated.ref` 展开后返回终端 ANSI 串；无片段时返回空串。
	 * @param {WireRenderOptions} [options] - 渲染选项。
	 * @returns {Promise<string>} 异步解析得到的 ANSI 正文。
	 */
	async renderString(options) {
		const segments = await this.#ensureExpanded(options?.maxDepth)
		if (segments.length > 0)
			return renderAnsi(segments, {
				colorize: this.supportsAnsi,
				indent: options?.indent ?? '\t',
				maxDepth: options?.maxDepth ?? Infinity,
			})

		return ''
	}

	/**
	 * 展开后返回纯文本（剥除 ANSI/OSC）；无片段时返回空串。
	 * @param {WireRenderOptions} [options] - 渲染选项。
	 * @returns {Promise<string>} 异步解析得到的纯文本。
	 */
	async renderPlain(options) {
		const segments = await this.#ensureExpanded(options?.maxDepth)
		if (segments.length > 0)
			return renderPlain(segments, {
				indent: options?.indent ?? '\t',
				maxDepth: options?.maxDepth ?? Infinity,
			})

		return ''
	}

	/**
	 * 展开后返回 HTML。
	 * @param {WireRenderOptions} [options] - 渲染选项。
	 * @returns {Promise<string>} 异步解析得到的 HTML 字符串。
	 */
	async renderHtml(options) {
		const segments = await this.#ensureExpanded(options?.maxDepth)
		if (segments.length > 0)
			return renderHtml(segments, {
				supportsAnsi: this.supportsAnsi,
				indent: options?.indent ?? '\t',
				maxDepth: options?.maxDepth ?? Infinity,
			})

		return ''
	}

	/**
	 * @param {number} [maxDepth] - 目标展开深度；未提供时表示尽可能展开。
	 * @returns {Promise<import('../shared.d.mts').LogSegment[]>} 展开后的片段副本。
	 */
	async #ensureExpanded(maxDepth) {
		const targetDepth = Number.isFinite(maxDepth)
			? Math.max(0, Math.floor(maxDepth))
			: Infinity

		if ((this.#expandPromise?.targetDepth ?? 0) >= targetDepth)
			return this.#expandPromise

		const pending = this.#expandPromise
		/** @type {Promise<import('../shared.d.mts').LogSegment[]> & { targetDepth?: number }} */
		const promise = this.#expandPromise = (async () => {
			if (pending) await pending
			return this.#expandAllSegments(targetDepth)
		})().finally(() => {
			if (this.#expandPromise === promise)
				this.#expandPromise = null
		})
		promise.targetDepth = targetDepth
		return promise
	}

	/**
	 * @param {number} targetDepth - 本轮展开目标深度。
	 * @returns {Promise<import('../shared.d.mts').LogSegment[]>} 克隆并替换截断节点后的片段。
	 */
	async #expandAllSegments(targetDepth) {
		const refsToDepth = collectTruncatedRefsWithDepthFromSegments(this.segments)
		if (refsToDepth.size === 0)
			return this.segments

		const refToSnapshot = new Map()
		await Promise.all([...refsToDepth.entries()].map(async ([ref, truncatedDepth]) => {
			const requestedDepth = Number.isFinite(targetDepth)
				? Math.max(0, targetDepth - truncatedDepth)
				: undefined
			if (requestedDepth === 0) return
			const snap = await this.wire.requestExpand(ref, requestedDepth)
			refToSnapshot.set(ref, snap)
		}))
		if (refToSnapshot.size === 0)
			return this.segments
		applyExpandedSnapshotsInSegments(this.segments, refToSnapshot)
		return this.segments
	}

	/**
	 * 浅拷贝载荷（不含展开缓存）。
	 * @returns {Record<string, unknown>} JSON 友好对象。
	 */
	toJSON() {
		return {
			id: this.id,
			level: this.level,
			method: this.method,
			timestamp: this.timestamp,
			stack: this.stack,
			segments: this.segments,
		}
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
