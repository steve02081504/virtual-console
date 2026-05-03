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
 * `console.trace` / `write_as('trace')` → `debug`；Node `stdout`/`stderr` → `log` / `error`；其余字符串透传。
 */
export type CapturedLogLevel = EntryLevel | (string & {})

/**
 * `write_as(level, …)` 等方法可用的逻辑方法名（传入 `methodNameToLevel` 之前）。
 * 与 {@link CapturedLogLevel} 不同：此处可出现 `stdout`、`stderr`、`trace` 等键名。
 */
export type WriteAsLevelArg =
	| EntryLevel
	| 'dir'
	| 'trace'
	| 'stdout'
	| 'stderr'
	| (string & {})

/** 等同于 {@link CapturedLogLevel}（保留原名供兼容导入） */
export type CommonLogEntryLevel = CapturedLogLevel

/** 浏览器侧条目语义级别上界 */
export type BrowserLogEntryLevel = CapturedLogLevel

/** Node 侧条目语义级别上界（条目上不会出现字面 `stdout`/`stderr`——流条目映射为 `log`/`error`） */
export type NodeLogEntryLevel = CapturedLogLevel

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

/** `serializeArgSnapshot` / `toSegments` 产生的 JSON 可传输快照（含 `truncated`） */
export type ArgSnapshot = Record<string, unknown> | ArgSnapshotTruncated

/**
 * 结构化日志片段（与 `LogEntry#toSegments()` 一致，可 JSON 传输）
 */
export type LogSegment =
	| { kind: 'text'; text: string; css?: string }
	| { kind: 'value'; snapshot: ArgSnapshot; css?: string; ansiText?: string }
	| { kind: 'values'; items: Array<{ kind: 'value'; snapshot: ArgSnapshot; ansiText?: string }> }
	| { kind: 'ansi'; text: string }
	| { kind: 'link'; href: string; label: string }
	| { kind: 'dir'; snapshot: ArgSnapshot; dirOptions?: ArgSnapshot }
	| {
		kind: 'traceStack'
		frames: Array<{
			functionName: string
			filePath: string
			line: number
			column: number
			raw: string
		}>
	}

/** 单条日志条目接口 */
export interface LogEntry {
	/** 经 `methodNameToLevel` 归一化后的语义级别 */
	level: CapturedLogLevel
	/** 对应的 console / 流方法名（如 `log`、`trace`、Node 下 `stdout`） */
	method: string
	/** 调用栈帧数组（两端均支持） */
	stack: StackFrame[]
	/** 日志记录时的 Unix 时间戳（毫秒） */
	timestamp: number
	/** 第一条带路径的栈帧，便于展示来源 */
	readonly primaryCallsite: StackFrame | null
	/** 剥除 ANSI/OSC 后的纯文本（展示、过滤、搜索均可用） */
	readonly plainText: string
	/** Node `stdout`/`stderr`：按 `\\n` 拆分的逻辑行 */
	readonly lines?: string[]
	/** 将日志条目转换为纯文本字符串 */
	toString(): string
	/** 将日志条目转为 HTML（剥 OSC 窗口标题，OSC8→`a[href]`，与 `plainText` 对应） */
	toHtml(): string
	/** 参数快照，深度默认与内置序列化一致 */
	serializeArgs(maxDepth?: number): ArgSnapshot[]
	/** 结构化片段，便于前端按需映射 DOM */
	toSegments(): LogSegment[]
}

/** 按宿主环境细分的日志条目（覆盖 `level` 联合） */
export type BaseLogEntry<L extends string = string> = Omit<LogEntry, 'level'> & {
	level: L
}

/**
 * console.trace() 产生的特化日志条目。
 * toString/toHtml 会在参数内容后追加格式化的调用栈文本。
 * supportsAnsi 来自创建该条目的宿主控制台，决定 toString() 是否嵌入 OSC 8 超链接序列。
 */
export interface TraceLogEntry extends Omit<LogEntry, 'level' | 'method'> {
	level: 'debug'
	method: 'trace'
	/** 宿主控制台是否支持 ANSI 超链接序列（由创建时的 VirtualConsoleOptions.supportsAnsi 决定） */
	supportsAnsi: boolean
}

/** `console.dir()` 产生的特化日志条目（语义级别为 `log`，方法名为 `dir`） */
export interface DirLogEntry extends Omit<LogEntry, 'level' | 'method'> {
	level: 'log'
	method: 'dir'
}

/** `stdout`/`stderr` 捕获条目：合并后的原始文本（不经 printf 解析） */
export interface StreamLogEntry extends Omit<LogEntry, 'level' | 'method'> {
	level: 'log' | 'error'
	method: 'stdout' | 'stderr'
	/** 合并后的流文本 */
	streamText: string
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
	base_console?: VC | Console
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
