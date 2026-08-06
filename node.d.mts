import type { AsyncLocalStorage } from 'node:async_hooks'
import type { Console } from 'node:console'
import type { Writable } from 'node:stream'

import type { BaseVirtualConsoleOptions, GlobalConsoleRouting, LogEntry, WriteAsLevelArg } from './src/shared.d.mts'

export * from './src/shared.d.mts'
export { WireLogEntry } from './src/wire/wire-log-entry.mjs'

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
export interface VirtualConsoleOptions extends BaseVirtualConsoleOptions<VirtualConsole, import('./src/shared.d.mts').CapturedLogLevel> {
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
	/** 所有捕获输出拼接成的纯文本字符串 */
	readonly outputs: string
	/** 所有捕获输出拼接成的 HTML 字符串 */
	readonly outputsHtml: string
	/** 结构化日志条目数组（`block` 期间可暂时超出 `maxLogEntries`，`unblock` 后裁回） */
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
	/** 是否处于 `block` 状态（嵌套深度大于 0） */
	readonly blocked: boolean

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
	 * 进入 block：本地记录与监听照常，实际输出（含向 `baseConsole` 的转发）入队延后；可重入。
	 * block 期间 `outputEntries` 可不裁剪到 `maxLogEntries`。
	 */
	block(): void

	/**
	 * 退出一层 block；深度归零时按序重放待输出内容（含 `clear` 标记）并恢复长度限制。
	 * 深度已为 0 时调用是空操作：不抛错，`blocked` 保持 `false`。
	 * @returns {boolean} 深度归零时为 `true`。
	 */
	unblock(): boolean

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
	 * 若 `realConsoleOutput` 为 `true`，也会调用底层控制台的 `clear()`
	 * （`block` 期间将 clear 标记入队，`unblock` 时按序重放）。
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

declare global {
	var console: VirtualConsole
}
