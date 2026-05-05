/**
 * 浏览器与 Node 入口共用的公共符号（核心 + 格式化 + wire 条目视图）。
 */

/**
 * 日志条目类型与工厂：`LogEntry` / `newLogEntry`。
 */
export {
	newLogEntry,
	LogEntry,
} from '../core/entries.mjs'

/**
 * 调用栈解析与裁剪：提取帧信息、去除运行时内部帧。
 */
export {
	getStackInfo,
	parseErrorStack,
	trimLeadingRuntimeInternalFrames,
} from '../core/stack.mjs'

/**
 * 参数快照序列化、惰性展开、`ExpansionScope` 与条目参数访问。
 */
export {
	serializeArgSnapshot,
	expandSnapshotRef,
	DEFAULT_SNAPSHOT_DEPTH,
	getLogEntryArgs,
	createExpansionScope,
} from '../core/snapshot.mjs'

/**
 * ANSI / OSC 处理：剥装饰与标题序列、终端块转 HTML、字符串化与 HTML 转义。
 */
export {
	stripTerminalDecorations,
	stripOscTitleSequences,
	escapeHtml,
} from '../format/ansi.mjs'

/**
 * 片段管线：`printf` 风格参数 → `LogSegment[]`，以及流式文本分片。
 */
export {
	buildArgsSegments,
	collectPrintfFormatParts,
} from '../format/segments.mjs'

/**
 * 按目标（纯文本 / HTML / ANSI）渲染 `LogSegment[]`。
 */
export {
	renderPlain,
	renderAnsi,
	renderHtml,
} from '../format/render.mjs'

/**
 * 线路传输用的弱类型日志条目视图（由 JSON 载荷构造）。
 */
export { WireLogEntry } from '../wire/wire-log-entry.mjs'
