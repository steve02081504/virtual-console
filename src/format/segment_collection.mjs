import { defaultRenderEngine, RenderEngine } from './render_engine.mjs'

/**
 * 不可变视图：包装 `LogSegment[]` 并提供面向对象的渲染入口。
 */
export class SegmentCollection {
	/**
	 * @type {readonly import('../shared.d.mts').LogSegment[]}
	 */
	#segments

	/**
	 * `withEngine` 绑定的引擎；未绑定时各方法通过参数或默认引擎解析。
	 * @type {import('./render_engine.mjs').RenderEngine | undefined}
	 */
	#boundEngine

	/**
	 * @param {import('../shared.d.mts').LogSegment[]} segments - `LogEntry#toSegments()` 或 wire `segments` 字段得到的片段数组。
	 * @param {import('./render_engine.mjs').RenderEngine} [boundEngine] - 可选固定渲染引擎（见 {@link SegmentCollection#withEngine}）。
	 */
	constructor(segments = [], boundEngine = undefined) {
		this.#segments = Object.freeze([...segments ?? []])
		this.#boundEngine = boundEngine
	}

	/**
	 * @param {{ toSegments: () => import('../shared.d.mts').LogSegment[] }} entry - 进程内 {@link LogEntry} 等。
	 * @returns {SegmentCollection} 由 `entry.toSegments()` 冻结副本构造的不可变集合。
	 */
	static fromLogEntry(entry) {
		return new SegmentCollection(entry.toSegments())
	}

	/**
	 * @param {import('../shared.d.mts').LogSegment[]} segmentsField - DTO 上的 `segments` 字段。
	 * @returns {SegmentCollection} 由 wire 载荷片段数组构造的不可变集合。
	 */
	static fromWireSegmentsField(segmentsField) {
		return new SegmentCollection(segmentsField)
	}

	/**
	 * @returns {import('../shared.d.mts').LogSegment[]} 片段浅拷贝（修改不影响内部冻结副本）。
	 */
	toSegmentsArray() {
		return [...this.#segments]
	}

	/**
	 * @returns {number} 片段条数。
	 */
	get length() {
		return this.#segments.length
	}

	/**
	 * @returns {IterableIterator<import('../shared.d.mts').LogSegment>} 按顺序遍历各 `LogSegment`。
	 */
	[Symbol.iterator]() {
		return this.#segments[Symbol.iterator]()
	}

	/**
	 * @param {{ engine?: import('./render_engine.mjs').RenderEngine }} [options] - 可选自定义引擎。
	 * @returns {string} 无样式的纯检索文本。
	 */
	toPlainText({ engine } = {}) {
		return (engine ?? this.#boundEngine ?? defaultRenderEngine).renderPlain(this.#segments)
	}

	/**
	 * @param {{ htmlOptions?: import('./render_engine.mjs').RenderHtmlOptions; engine?: import('./render_engine.mjs').RenderEngine }} [options] - HTML 选项与可选引擎。
	 * @returns {string} 已转义、可插入 DOM 的 HTML 拼接串。
	 */
	toHtml({ htmlOptions = {}, engine } = {}) {
		const renderEngine = engine ?? this.#boundEngine ?? defaultRenderEngine
		return renderEngine.renderHtml(this.#segments, htmlOptions)
	}

	/**
	 * @param {{ ansiOptions?: import('./render_engine.mjs').RenderAnsiOptions; engine?: import('./render_engine.mjs').RenderEngine }} [options] - ANSI 选项与可选引擎。
	 * @returns {string} 终端用 ANSI 文本。
	 */
	toAnsiText({ ansiOptions = {}, engine } = {}) {
		const renderEngine = engine ?? this.#boundEngine ?? defaultRenderEngine
		return renderEngine.renderAnsi(this.#segments, ansiOptions ?? {})
	}

	/**
	 * 使用自定义 {@link RenderEngine}（例如带 `registry.register` 的实例）。
	 * @param {RenderEngine} engine - 已注册自定义 `kind` 渲染器的引擎。
	 * @returns {SegmentCollection} 绑定该引擎的视图（后续 `toHtml` 等无需再传 `engine`）。
	 */
	withEngine(engine) {
		return new SegmentCollection([...this.#segments], engine)
	}
}
