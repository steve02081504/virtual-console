/**
 * 浏览器和 Node.js 两端共用的类型定义。
 * 请通过 `@steve02081504/virtual-console` 或 `@steve02081504/virtual-console/node` 导入，
 * 不要直接引用此文件。
 */

/**
 * 所有环境下都会产生的日志级别（来自被代理的 console 方法）
 */
export type CommonLogEntryLevel =
	| 'log' | 'info' | 'warn' | 'error' | 'debug'
	| 'table' | 'dir' | 'assert'
	| 'count' | 'countReset'
	| 'time' | 'timeLog' | 'timeEnd'
	| 'group' | 'groupCollapsed' | 'groupEnd'
	| 'trace'

/**
 * 浏览器环境下的日志级别
 * 包含所有被代理的 console 方法名，以及通过 write_as 写入的自定义级别。
 */
export type BrowserLogEntryLevel = CommonLogEntryLevel | (string & {})

/**
 * Node.js 环境下的日志级别
 * 除浏览器级别外，还包含来自 process.stdout / process.stderr 直接写入的 'stdout' 和 'stderr'。
 */
export type NodeLogEntryLevel = BrowserLogEntryLevel | 'stdout' | 'stderr'

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

/**
 * 单条日志条目接口
 */
export interface LogEntry<Level extends string = CommonLogEntryLevel> {
	/** 日志级别 */
	level: Level
	/** 原始日志参数 */
	args: unknown[]
	/** 调用栈帧数组（两端均支持） */
	stack: StackFrame[]
	/** 日志记录时的 Unix 时间戳（毫秒） */
	timestamp: number
	/** 将日志条目转换为纯文本字符串 */
	toString(): string
	/** 将日志条目转换为 HTML 字符串 */
	toHtml(): string
}

/**
 * console.trace() 产生的特化日志条目。
 * toString/toHtml 会在参数内容后追加格式化的调用栈文本。
 * supportsAnsi 来自创建该条目的宿主控制台，决定 toString() 是否嵌入 OSC 8 超链接序列。
 */
export interface TraceLogEntry<Level extends string = CommonLogEntryLevel> extends LogEntry<Level> {
	/** 宿主控制台是否支持 ANSI 超链接序列（由创建时的 VirtualConsoleOptions.supportsAnsi 决定） */
	supportsAnsi: boolean
}

/**
 * 虚拟控制台配置选项基础接口
 */
export interface BaseVirtualConsoleOptions<VC = unknown, Level extends string = CommonLogEntryLevel> {
	/** 如果为 true，则在捕获输出的同时，也调用底层控制台进行实际输出 */
	realConsoleOutput?: boolean
	/** 如果为 true，则捕获输出并保存在 outputEntries 中 */
	recordOutput?: boolean
	/** 用于 realConsoleOutput 的底层控制台实例 */
	base_console?: VC | Console
	/** 最多保留的日志条目数量，超出后自动丢弃最旧的条目。默认 Infinity */
	maxLogEntries?: number
	/** 每次新增日志条目时的回调函数 */
	on_log_entry?: ((entry: LogEntry<Level>) => void) | null
}

/**
 * 控制台反射逻辑接口（泛型，供各平台实例化）
 */
export interface ConsoleReflect<VC = unknown> {
	/** 从默认控制台获取当前上下文的控制台对象 */
	Reflect: () => VC
	/** 设置当前上下文的控制台对象 */
	ReflectSet: (value: VC) => void
	/** 在新的上下文中执行函数 */
	ReflectRun: <T>(value: VC, fn: () => T | Promise<T>) => Promise<T>
}
