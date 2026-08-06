/**
 * 浏览器和 Node.js 两端共用的类型定义。
 * 请通过 `@steve02081504/virtual-console` 或 `@steve02081504/virtual-console/node` 导入，
 * 不要直接引用此文件。
 */

/**
 * 所有环境下都会产生的日志级别（来自被代理的 console 方法）
 */
export type EntryLevel = 'log' | 'info' | 'warn' | 'error' | 'debug'

/**
 * 捕获条目上 {@link LogEntry#level} 的语义值：`methodNameToLevel` 归一化后的结果。
 * `console.trace` / `writeAs('trace')` → `debug`；Node `stdout`/`stderr` → `log` / `error`；其余字符串透传。
 */
export type CapturedLogLevel = EntryLevel | (string & {})

/**
 * `writeAs(level, …)` 等方法可用的逻辑方法名（传入 `methodNameToLevel` 之前）。
 * 与 {@link CapturedLogLevel} 不同：此处可出现 `stdout`、`stderr`、`trace` 等键名。
 */
export type WriteAsLevelArg =
	| EntryLevel
	| 'dir'
	| 'trace'
	| 'stdout'
	| 'stderr'
	| 'freshLine'
	| (string & {})

/**
 * 调用栈帧信息（Node.js 和浏览器均支持；file:// URL 在 Node.js 中自动解析为绝对路径）
 */
export interface StackFrame {
	/** 函数名称 */
	functionName: string
	/** 文件路径 */
	filePath: string
	/** 行号 */
	line: number
	/** 列号 */
	column: number
	/** 原始栈帧字符串 */
	raw: string
}

/** 惰性展开占位（`ref` 由宿主进程内注册；空字符串表示不可展开） */
export interface ArgSnapshotTruncated {
	kind: 'truncated'
	ref: string
	label?: string
}

/**
 * `serializeArgSnapshot` / `toSegments` 产生的 JSON 可传输快照（含 `truncated`）。
 * - `kind: 'Error'` — **`name`**、**`message`**、**`stack`**（由 `parseErrorStack(error)` 得到的帧数组，平铺字段与 {@link StackFrame} 一致；**不**存原始 `error.stack` 字符串）；另有 **`entries`** 承载其它自有枚举属性。
 * - `kind: 'Date'` — **`value`** 为 `Date#getTime()` 毫秒数（无效 Date 为 **`NaN`**）。经 `JSON.stringify` 往返后无效日期的 `NaN` 变为 **`null`**；渲染时格式化为与 Node `util.inspect` 一致的 ISO 字符串或 **`Invalid Date`**（**不**在快照里存 ISO 字符串）。
 */
export type ArgSnapshot = Record<string, unknown> | ArgSnapshotTruncated

/** `console.dir` 第二参数的 JSON 可传输子集（与 Node `util.inspect` 选项名对齐）。 */
export interface DirOptionsPayload {
	/** 对象展开深度 */
	depth?: number
	/** 是否着色（对应渲染管线中的 `colorize`） */
	colors?: boolean
}

/**
 * 结构化日志片段：仅 `text` / `css` / `value` / `trace` 四类（可 JSON 传输）。
 * - `text`：原始终端字节串（可含 CSI/OSC8）；换行用 `\n` 字符表达。
 * - `css`：`%c` 样式串；`renderAnsi` 映射颜色（真彩色）、粗/斜/划/删、`opacity`/`lighter`/半透明色等（含 SGR dim）；HTML 侧用 `span` 作用域。
 * - `value`：`ArgSnapshot` 树，渲染时格式化为 plain/ANSI/HTML（不再预烘焙 `ansiText`）。
 * - `trace`：已解析的 {@link StackFrame} 数组（与 `LogEntry#stack` 同源，不再嵌套 ArgSnapshot）。
 */
export type LogSegment =
	| { kind: 'text'; text: string }
	| { kind: 'css'; css: string }
	| { kind: 'value'; snapshot: ArgSnapshot; dirOptions?: DirOptionsPayload }
	| { kind: 'trace'; stack: StackFrame[] }

/** `newLogEntry` / `LogEntry` 构造选项（`stack` 与 `stackSource` 二选一）。 */
export interface LogEntryInit {
	method: string
	args?: unknown[]
	stack?: StackFrame[]
	stackSource?: Error
	skipFrames?: number
	timestamp?: number
	supportsAnsi?: boolean
}

/** 惰性展开作用域：同 entry 多次序列化复用 target→ref。 */
export interface ExpansionScope {
	allocRef(target: object): string
}

/**
 * 单条日志条目：`segments` 由 {@link LogEntry#toSegments} 按需构造；`stdout`/`stderr` 带 `text`。
 * `stack` 可惰性解析：构造时传入 `stackSource`（`Error`）+ `skipFrames`，首次读取 `stack` 时才解析。
 */
export declare class LogEntry {
	/** 经 `methodNameToLevel` 归一化后的语义级别 */
	level: CapturedLogLevel
	/** 对应的 console / 流方法名（如 `log`、`trace`、Node 下 `stdout`） */
	method: string
	/** 原始参数数组（`stdout` / `stderr` 条目为单元素文本数组） */
	readonly args: unknown[]
	/** 参与格式化 / 透传展示的参数（`freshLine` 跳过 id） */
	readonly displayArgs: unknown[]
	/** `freshLine` 主 id（非 freshLine 条目无此字段） */
	readonly id?: string
	/** 调用栈帧数组（两端均支持；惰性来源在首次读取时解析） */
	readonly stack: StackFrame[]
	/** 日志记录时的 Unix 时间戳（毫秒） */
	timestamp: number
	/** 展示来源：优先片段中首个 Error 的栈帧，否则为捕获调用栈中第一条 */
	readonly primaryCallsite: StackFrame | null
	/** 宿主是否允许 ANSI（影响 `value`/`trace` 等着色与 OSC8） */
	supportsAnsi: boolean
	/** Node `stdout`/`stderr`：合并后的原始流文本；非流条目无此字段 */
	text?: string
	constructor(options: LogEntryInit)
	/** 终端 ANSI 串（流条目为原始合并文本） */
	toString(): string
	/** 无 ANSI 的纯文本 */
	toPlainText(): string
	/** 由 `toSegments` 渲染的 HTML */
	toHtml(): string
	/** 参数快照，深度默认与内置序列化一致 */
	serializeArgs(maxDepth?: number): ArgSnapshot[]
	/** 结构化片段，便于前端按需映射 DOM */
	toSegments(): LogSegment[]
	/** JSON 传输视图（默认与 wire 载荷字段对齐） */
	toJSON(): Record<string, unknown>
}

/** `console.freshLine` 条目：首个参数为行 id，不进入日志格式化。 */
export declare class FreshLineLogEntry extends LogEntry {
	readonly method: 'freshLine'
	readonly id: string
	constructor(options: LogEntryInit & { method: 'freshLine' })
}

/** `console.dir` 条目：携带单个 value 段及可选 dirOptions。 */
export declare class DirLogEntry extends LogEntry {
	readonly method: 'dir'
	constructor(options: LogEntryInit & { method: 'dir' })
}

/** `console.trace` 条目：普通参数片段 + trace 快照片段。 */
export declare class TraceLogEntry extends LogEntry {
	readonly method: 'trace'
	constructor(options: LogEntryInit & { method: 'trace' })
}

/** `stdout` / `stderr` 流日志条目：原样透传文本，不追加换行片段。 */
export declare class StreamLogEntry extends LogEntry {
	readonly method: 'stdout' | 'stderr'
	text: string
	constructor(options: LogEntryInit & { method: 'stdout' | 'stderr' })
}

/** 按宿主环境细分的日志条目（覆盖 `level` 联合） */
export type BaseLogEntry<L extends string = string> = Omit<LogEntry, 'level'> & {
	level: L
}

/**
 * 虚拟控制台配置选项基础接口
 */
export interface BaseVirtualConsoleOptions<VC = unknown, L extends string = EntryLevel> {
	/** 如果为 true，则在捕获输出的同时，也调用底层控制台进行实际输出。默认 false */
	realConsoleOutput?: boolean
	/**
	 * 若为 true，则捕获输出并写入 `outputEntries`（及聚合的 `outputs` / `outputsHtml`）；
	 * 为 false 时不追加条目（`realConsoleOutput` 等旁路仍可按配置执行）。默认 true
	 */
	recordOutput?: boolean
	/**
	 * `realConsoleOutput` 的透传目标，以及构造时未指定时的 ANSI 继承来源。
	 * 未指定时由各平台在运行时解析（Node 使用当前上下文的活动控制台，浏览器同理）。
	 * 设为另一个 `VirtualConsole` 时，会自动继承其 `supportsAnsi` 设置。
	 */
	baseConsole?: VC | Console
	/** 最多保留的日志条目数量，超出后自动丢弃最旧的条目。默认 Infinity */
	maxLogEntries?: number
}

/**
 * `getGlobalConsoleResolver()` 返回的三元组：取当前活动控制台、绑定活动控制台、在指定控制台上下文中运行回调。
 */
export interface GlobalConsoleRouting<VC = unknown> {
	/** 返回当前 `AsyncLocalStorage` / 平台模拟上下文中应激活的 `VirtualConsole` */
	getActiveConsole: () => VC
	/** 将指定实例设为当前上下文的活动控制台 */
	setActiveConsole: (value: VC) => void
	/** 在以指定实例为活动控制台的新上下文中执行回调，返回回调结果的 Promise */
	runWithActiveConsole: <T>(value: VC, fn: () => T | Promise<T>) => Promise<T>
}

/** plain 渲染选项 */
export interface RenderPlainOptions {
	indent?: string
	maxDepth?: number
}

/** ANSI 渲染选项 */
export interface RenderAnsiOptions {
	colorize?: boolean
	omitPrintfCss?: boolean
	indent?: string
	maxDepth?: number
}

/** HTML 渲染选项 */
export interface RenderHtmlOptions {
	traceStackWrapperStyle?: string
	traceStackLinkStyle?: string
	omitPrintfCss?: boolean
	supportsAnsi?: boolean
	indent?: string
	maxDepth?: number
	resolveTraceFrameHref?: (frame: StackFrame) => string | undefined
}

/** 下列声明的实现分布在 Node / 浏览器入口 `.mjs`，此处集中声明以供平台 `.d.mts` 重导出。 */

export declare const DEFAULT_SNAPSHOT_DEPTH: number

export declare function serializeArgSnapshot(
	value: unknown,
	options?: { maxDepth?: number; expansionScope?: ExpansionScope | null }
): ArgSnapshot

export declare function createExpansionScope(entry: object): ExpansionScope

export declare function getExpansionScope(entry: object): ExpansionScope

export declare function expandSnapshotRef(
	ref: string,
	maxDepth?: number
): { ok: true; snapshot: ArgSnapshot } | { ok: false; error: string }

export declare function getStackInfo(leadingLinesToSkip?: number): StackFrame[]
export declare function parseErrorStack(error: unknown, skipNum?: number): StackFrame[]
export declare function trimLeadingRuntimeInternalFrames(frames: StackFrame[]): StackFrame[]
export declare function resolvePrimaryCallsiteFromSegments(
	segments: LogSegment[] | undefined,
	stack?: StackFrame[]
): StackFrame | null

export declare function newLogEntry(options: LogEntryInit & { method: 'freshLine' }): FreshLineLogEntry
export declare function newLogEntry(options: LogEntryInit & { method: 'dir' }): DirLogEntry
export declare function newLogEntry(options: LogEntryInit & { method: 'trace' }): TraceLogEntry
export declare function newLogEntry(options: LogEntryInit & { method: 'stdout' | 'stderr' }): StreamLogEntry
export declare function newLogEntry(options: LogEntryInit): LogEntry

export declare function renderPlain(segments: LogSegment[], options?: RenderPlainOptions): string
export declare function renderAnsi(segments: LogSegment[], options?: RenderAnsiOptions): string
export declare function renderHtml(segments: LogSegment[], options?: RenderHtmlOptions): string

export declare function stripTerminalDecorations(text: string): string
export declare function stripOscTitleSequences(text: string): string
export declare function escapeHtml(str: string): string
export declare function collectPrintfFormatParts(
	format: string,
	args: unknown[],
	startArgIndex?: number
): {
	parts: Array<
		| { kind: 'literal'; text: string }
		| { kind: 'arg'; spec: string; value: unknown }
		| { kind: 'missingSpec'; spec: string }
	>
	nextArgIndex: number
}

export declare function buildArgsSegments(
	args: unknown[],
	expansionScope?: ExpansionScope | null,
	snapshotDepth?: number
): LogSegment[]

/**
 * `isVirtualConsole` 收窄到的结构类型：Node 与浏览器两侧 `VirtualConsole` 的公共子集。
 */
export interface VirtualConsoleLike {
	outputEntries: LogEntry[]
	writeAs(level: WriteAsLevelArg, ...args: unknown[]): void
	block(): void
	unblock(): boolean
}

/**
 * 判断值是否为本库 VirtualConsole 实例。
 * Node 的 `Console[Symbol.hasInstance]` 会对任意 console 返回 true，不可靠；请用本函数。
 */
export declare function isVirtualConsole(value: unknown): value is VirtualConsoleLike
