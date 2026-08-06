import type { BaseVirtualConsoleOptions, GlobalConsoleRouting, LogEntry, WriteAsLevelArg } from './src/shared.d.mts'

export * from './src/shared.d.mts'
export { WireLogEntry } from './src/wire/wire-log-entry.mjs'

/**
 * 浏览器环境虚拟控制台配置选项
 */
export interface VirtualConsoleOptions extends BaseVirtualConsoleOptions<VirtualConsole, import('./src/shared.d.mts').CapturedLogLevel> {
	/**
	 * 为 `true` 时，`trace` 栈文本使用 ANSI 相关格式化（`toString()` / `toHtml()`）。
	 * 运行时默认 `!!globalThis.chrome`，可显式覆盖。
	 */
	supportsAnsi?: boolean
}

/**
 * 虚拟控制台，用于捕获 `console.*` 的输出，同时可选择性地透传到真实控制台。
 *
 * > **浏览器上下文隔离说明：** `hookAsyncContext` 基于全局变量栈实现，
 * > 能在同步代码和 `await` 链中可靠传播，但 `setTimeout`、`setInterval`
 * > 等独立触发的宏任务回调不会继承调用时的上下文。
 */
export class VirtualConsole {
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
	 * 传入函数时，使用 save/restore 机制在函数内将 `console` 绑定到此实例，
	 * 返回函数结果的 Promise。
	 * 注意：由函数内部派生的宏任务（如裸 `setTimeout`）不会继承此上下文。
	 * @param callback 要在隔离上下文中执行的函数
	 */
	hookAsyncContext<T>(callback: () => T | Promise<T>): Promise<T>
	/**
	 * 不传参数时，将模块级变量设置为此实例（全局生效，影响所有后续代码，谨慎使用）。
	 */
	hookAsyncContext(): void

	/**
	 * 打印一行信息。
	 * > **浏览器限制：** 无法覆盖上一行，行为等同于普通 `log`，`id` 参数被忽略。
	 * @param id 标识可覆盖行的唯一键（浏览器中不生效）
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
	 * @param level 日志级别（可使用任意字符串）
	 * @param args 要记录的内容
	 */
	writeAs(level: WriteAsLevelArg, ...args: unknown[]): void
}

export interface VirtualConsole extends Console { }

/**
 * 始终在线的兜底控制台：不记录任何条目，直接将所有输出透传到原始 `window.console`。
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

/** 全局 `console` 代理对象——所有调用委托给当前上下文中激活的 `VirtualConsole` */
export const console: VirtualConsole

declare global {
	var console: VirtualConsole
}
