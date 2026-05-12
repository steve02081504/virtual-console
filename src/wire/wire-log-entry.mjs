import supportsAnsiDefault from 'supports-ansi'

import { methodNameToLevel } from '../core/entries.mjs'
import { resolvePrimaryCallsiteFromSegments } from '../core/snapshot.mjs'
import { renderAnsi, renderHtml, renderPlain } from '../format/render.mjs'

import {
	applyExpandedSnapshotsInSegments,
	collectTruncatedRefsWithDepthFromSegments,
} from './expand-wire-segments.mjs'

/**
 * @typedef {object} WireLogEntryPayload
 * @property {string} [level]
 * @property {string} [method]
 * @property {number} [timestamp]
 * @property {string} [id]
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
 * 注意：展开逻辑会就地更新 `segments` 引用中的 `truncated` 节点，以便后续渲染复用已展开结果。
 */
export class WireLogEntry {
	/** @type {(Promise<import('../shared.d.mts').LogSegment[]> & { targetDepth?: number }) | null} */
	#expandPromise = null

	/**
	 * @param {WireLogEntryPayload | Record<string, unknown>} payload - 线路 JSON 单条载荷。
	 * @param {WireContext} wire - 展开与 ANSI 开关。
	 */
	constructor(payload, wire) {
		this.level = methodNameToLevel(payload.method)
		this.method = payload.method
		this.timestamp = payload.timestamp
		this.stack = payload.stack
		this.segments = payload.segments
		this.wire = wire
		this.supportsAnsi = wire.supportsAnsi ?? supportsAnsiDefault
	}

	/** @returns {import('../shared.d.mts').StackFrame | null} 展示来源：优先片段中首个 Error 的栈帧，否则为捕获调用栈中第一条。 */
	get primaryCallsite() {
		return resolvePrimaryCallsiteFromSegments(this.segments, this.stack)
	}

	/**
	 * 等待全部 `truncated.ref` 展开后返回终端 ANSI 串；无片段时返回空串。
	 * @param {WireRenderOptions} [options] - 渲染选项。
	 * @returns {Promise<string>} 异步解析得到的 ANSI 正文。
	 */
	async renderString(options) {
		return this.#renderWithNormalizedOptions(options, renderAnsi, (normalizedOptions) => ({
			colorize: this.supportsAnsi,
			...normalizedOptions,
		}))
	}

	/**
	 * 展开后返回纯文本（剥除 ANSI/OSC）；无片段时返回空串。
	 * @param {WireRenderOptions} [options] - 渲染选项。
	 * @returns {Promise<string>} 异步解析得到的纯文本。
	 */
	async renderPlain(options) {
		return this.#renderWithNormalizedOptions(options, renderPlain, normalizedOptions => normalizedOptions)
	}

	/**
	 * 展开后返回 HTML。
	 * @param {WireRenderOptions} [options] - 渲染选项。
	 * @returns {Promise<string>} 异步解析得到的 HTML 字符串。
	 */
	async renderHtml(options) {
		return this.#renderWithNormalizedOptions(options, renderHtml, (normalizedOptions) => ({
			supportsAnsi: this.supportsAnsi,
			...normalizedOptions,
		}))
	}

	/**
	 * 统一处理 render* 的展开、空分支与选项归一化。
	 * @param {WireRenderOptions | undefined} options - 外部渲染选项。
	 * @param {(segments: import('../shared.d.mts').LogSegment[], options: Record<string, unknown>) => string} renderer - 目标渲染函数。
	 * @param {(normalizedOptions: { indent: string, maxDepth: number }) => Record<string, unknown>} mapOptions - 渲染器选项映射器。
	 * @returns {Promise<string>} 渲染后的文本。
	 */
	async #renderWithNormalizedOptions(options, renderer, mapOptions) {
		const normalizedOptions = this.#normalizeRenderOptions(options)
		const segments = await this.#ensureExpanded(normalizedOptions.maxDepth)
		if (segments.length === 0)
			return ''
		return renderer(segments, mapOptions(normalizedOptions))
	}

	/**
	 * @param {WireRenderOptions | undefined} options - 外部渲染选项。
	 * @returns {{ indent: string, maxDepth: number }} 归一化后的渲染选项。
	 */
	#normalizeRenderOptions(options) {
		return {
			indent: options?.indent ?? '\t',
			maxDepth: options?.maxDepth ?? Infinity,
		}
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
			level: this.level,
			method: this.method,
			timestamp: this.timestamp,
			stack: this.stack,
			segments: this.segments,
		}
	}
}

/**
 * `freshLine` 的 wire 条目：在基础字段上追加 id。
 */
export class FreshLineWireLogEntry extends WireLogEntry {
	/**
	 * @param {WireLogEntryPayload | Record<string, unknown>} payload - 线路 JSON 单条载荷。
	 * @param {WireContext} wire - 展开与 ANSI 开关。
	 */
	constructor(payload, wire) {
		super(payload, wire)
		this.id = String(payload.id ?? '')
	}

	/**
	 * @returns {Record<string, unknown>} JSON 友好对象。
	 */
	toJSON() {
		return {
			...super.toJSON(),
			id: this.id,
		}
	}
}

/** `console.dir` 的 wire 条目。 */
export class DirWireLogEntry extends WireLogEntry { }

/** `console.trace` 的 wire 条目。 */
export class TraceWireLogEntry extends WireLogEntry { }

/** `stdout` / `stderr` 的 wire 条目。 */
export class StreamWireLogEntry extends WireLogEntry { }

const methodToConstructorMap = {
	dir: DirWireLogEntry,
	trace: TraceWireLogEntry,
	stdout: StreamWireLogEntry,
	stderr: StreamWireLogEntry,
	freshLine: FreshLineWireLogEntry,
}

/**
 * @param {unknown} method - 线路条目 method。
 * @returns {typeof WireLogEntry} 对应条目构造器。
 */
function methodToConstructor(method) {
	return methodToConstructorMap[method] || WireLogEntry
}

/**
 * 根据 JSON 载荷中的 `method` 自动分派 wire 条目子类。
 * @param {unknown} json - 线路 JSON 载荷或已有实例。
 * @param {WireContext} wire - 必填连接上下文。
 * @returns {WireLogEntry} 对应的 wire 条目实例。
 */
export function createWireLogEntryFromJson(json, wire) {
	return new (methodToConstructor(json?.method))(json, wire)
}
