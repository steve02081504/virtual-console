import type { AsyncLocalStorage } from 'node:async_hooks'
import type { Console } from 'node:console'
import type { Writable } from 'node:stream'

import type {
	NodeLogEntryLevel,
	BaseVirtualConsoleOptions,
	LogEntry as BaseLogEntry,
	WriteAsLevelArg,
} from './src/shared.d.mts'

export type {
	NodeLogEntryLevel,
	BrowserLogEntryLevel,
	CommonLogEntryLevel,
	CapturedLogLevel,
	WriteAsLevelArg,
	StackFrame,
	TraceLogEntry,
	DirLogEntry,
	StreamLogEntry,
	ArgSnapshot,
	LogSegment,
	GlobalConsoleRouting,
} from './src/shared.d.mts'

/** Node.js 环境下的单条日志条目（级别包含 `stdout` / `stderr`） */
export type LogEntry = BaseLogEntry<NodeLogEntryLevel>

/**
 * 虚拟可写流，代理真实的 `stdout` / `stderr`。
 * 写入操作会被捕获为 `LogEntry`（级别为 `stdout` 或 `stderr`），
 * 同时可选地转发到原始流。TTY 属性（列宽、颜色深度等）直接透传自目标流。
 */
export interface VirtualStream extends Writable {
	readonly isTTY: boolean
	readonly columns: number
	readonly rows: number
	readonly targetStream: NodeJS.WritableStream
	getColorDepth(): number
	hasColors(): boolean
}

/**
 * Node.js 环境虚拟控制台配置选项
 */
export interface VirtualConsoleOptions extends BaseVirtualConsoleOptions<VirtualConsole, NodeLogEntryLevel> {
	/**
	 * 为 `true` 时启用 ANSI：`freshLine` 在 TTY 上可覆盖同行、`trace` 栈文本可含 OSC 8 等。
	 * 未指定时由 `supports-ansi` 检测；若 `baseConsole` 为 `VirtualConsole` 则继承其 `options.supportsAnsi`。
	 */
	supportsAnsi?: boolean
}

/**
 * 虚拟控制台，用于捕获 `console.*`、`process.stdout`、`process.stderr` 的输出。
 * 基于 `AsyncLocalStorage` 实现真正的异步上下文隔离：并发任务各自拥有独立的日志缓冲区。
 */
export class VirtualConsole extends Console {
	/** 所有捕获输出拼接成的纯文本字符串（条目间以换行分隔） */
	readonly outputs: string
	/** 所有捕获输出拼接成的 HTML 字符串（可直接渲染） */
	readonly outputsHtml: string
	/** 结构化日志条目数组 */
	outputEntries: LogEntry[]
	/** 最终合并后的配置项（日志监听请用 {@link addLogEntryListener} / {@link removeLogEntryListener}） */
	options: Required<Omit<VirtualConsoleOptions, 'baseConsole'>> & {
		baseConsole?: VirtualConsole | Console
	}
	/** `realConsoleOutput` 的透传目标控制台实例 */
	baseConsole: VirtualConsole | Console
	/**
	 * 采集调用栈时额外跳过的帧数；初始为 `0`。
	 * 在自定义包装函数中调用 `console.*` 时，在调用前 `+1`，`finally` 中 `-1`，
	 * 以确保 `entry.stack` 指向真正的调用方而非包装层。
	 */
	stackFrameSkipCount: number

	/**
	 * 与 Node `console` 实例相同的 `_stdout` / `_stderr` 表面（`Console` 基类内部会读此二字段；实现上委托给内部私有流）。
	 * 不要与「用下划线表示私有字段」混为一谈：此处是 Node 运行时的公开契约名。
	 */
	_stdout: VirtualStream
	_stderr: VirtualStream

	constructor(options?: VirtualConsoleOptions)

	/** 注册新日志条目回调（可多路订阅） */
	addLogEntryListener(fn: (entry: LogEntry) => void): void

	/** 移除由 {@link addLogEntryListener} 注册的回调 */
	removeLogEntryListener(fn: (entry: LogEntry) => void): void

	/** 注册缓冲清空回调（在 {@link clear} 清空条目之后同步调用） */
	addClearListener(fn: () => void): void

	/** 移除由 {@link addClearListener} 注册的回调 */
	removeClearListener(fn: () => void): void

	/**
	 * 传入函数时，在新的异步上下文中执行该函数，`console` 在函数内指向此实例，
	 * 返回函数结果的 Promise。
	 * @param callback 要在隔离上下文中执行的函数
	 */
	hookAsyncContext<T>(callback: () => T | Promise<T>): Promise<T>
	/**
	 * 不传参数时，通过 `AsyncLocalStorage.enterWith` 将当前异步上下文的活动控制台替换为此实例。
	 * 无自动还原，请谨慎使用。
	 */
	hookAsyncContext(): void

	/**
	 * 打印一行进度信息。若前一次调用传入了相同的 `id`，则覆盖上一行而不是新增一行
	 * （需要 ANSI 支持；在不支持 ANSI 的环境中等同于普通 `log`）。
	 * @param id 标识可覆盖行的唯一键
	 * @param args 要打印的内容
	 */
	freshLine(id: string, ...args: unknown[]): void

	/**
	 * 清空 `outputEntries` 并重置 `freshLine` 状态。
	 * 若 `realConsoleOutput` 为 `true`，也会调用底层控制台的 `clear()`。
	 * 清空完成后同步调用 {@link addClearListener} 注册的回调。
	 */
	clear(): void

	/**
	 * 以指定级别记录日志，不经由 `console.*` 方法路由。
	 * 适合注入自定义级别的条目或在不触发其他副作用的情况下录入数据。
	 * 若 `realConsoleOutput` 为 `true`，warn/error/trace/stderr 类级别写入 stderr，其余写入 stdout。
	 * @param level 日志级别（可使用任意字符串）
	 * @param args 要记录的内容
	 */
	writeAs(level: WriteAsLevelArg, ...args: unknown[]): void
}

/** 驱动 `hookAsyncContext` 隔离的 `AsyncLocalStorage` 实例 */
export const consoleAsyncStorage: AsyncLocalStorage<VirtualConsole>

/**
 * 始终在线的兜底控制台：不记录任何条目，直接将所有输出透传到原始全局 `console`。
 * 是所有自定义 VirtualConsole 的最终 `baseConsole` 来源。
 */
export const defaultConsole: VirtualConsole

/**
 * 合并到全局 `console` 代理上的附加属性对象。
 * 对 `globalThis.console` 写入未知属性时，值会存储在这里，
 * 以便在不同异步上下文间共享自定义扩展字段。
 */
export const globalConsoleAdditionalProperties: Record<string, unknown>

/**
 * 替换全局 `console` 代理的上下文路由逻辑。
 * @param resolveWithFallback 给定 `defaultConsole` 作为兜底，返回当前应激活的 `VirtualConsole`
 * @param setActive 将指定实例设为当前上下文的活动控制台
 * @param runInContext 在以指定实例为活动控制台的新上下文中执行回调，返回其 Promise 结果
 */
export function setGlobalConsoleResolver(
	resolveWithFallback: (defaultConsole: VirtualConsole) => VirtualConsole,
	setActive: (value: VirtualConsole) => void,
	runInContext: <T>(value: VirtualConsole, callback: () => T | Promise<T>) => Promise<T>
): void

/** 读取当前的全局 `console` 代理路由逻辑 */
export function getGlobalConsoleResolver(): GlobalConsoleRouting<VirtualConsole>

/** 全局 `console` 代理对象——所有调用委托给当前异步上下文中激活的 `VirtualConsole` */
export const console: VirtualConsole

export declare const DEFAULT_SNAPSHOT_DEPTH: number

export declare function serializeArgSnapshot(
	value: unknown,
	seen?: WeakSet<object>,
	depth?: number,
	maxDepth?: number,
	expansionScope?: unknown
): import('./src/shared.d.mts').ArgSnapshot

export declare function createExpansionScope(entry: object): {
	allocRef(target: object): string
}

export declare function expandSnapshotRef(
	ref: string,
	maxDepth?: number
): { ok: true; snapshot: import('./src/shared.d.mts').ArgSnapshot } | { ok: false; error: string }

export declare function unregisterExpandRefsForEntry(entry: object): void

export declare function getLogEntryArgs(entry: object): unknown[]

export declare function stripTerminalDecorations(text: string): string
export declare function stripOscTitleSequences(text: string): string
export declare function terminalChunkToHtml(chunk: string): string
export declare function coerceString(arg: unknown): string
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

export declare function formatArgs(
	args: unknown[],
	options?: { colorize?: boolean; depth?: number }
): string

export declare function buildArgsSegments(
	args: unknown[],
	expansionScope?: object | null,
	snapshotDepth?: number
): import('./src/shared.d.mts').LogSegment[]
export declare function streamToSegments(text: string): import('./src/shared.d.mts').LogSegment[]

declare global {
	var console: VirtualConsole
}
