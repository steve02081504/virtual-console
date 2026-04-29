import type {
	BrowserLogEntryLevel,
	BaseVirtualConsoleOptions,
	ConsoleReflect as BaseConsoleReflect,
	LogEntry as BaseLogEntry,
} from './shared.d.mts'

export type { BrowserLogEntryLevel, CommonLogEntryLevel, StackFrame } from './shared.d.mts'

/**
 * 浏览器环境下的单条日志条目（含 stack 调用栈）
 */
export type LogEntry = BaseLogEntry<BrowserLogEntryLevel>

/**
 * 浏览器环境虚拟控制台配置选项
 */
export interface VirtualConsoleOptions extends BaseVirtualConsoleOptions<VirtualConsole, BrowserLogEntryLevel> {}

/**
 * 控制台反射逻辑
 */
export type ConsoleReflect = BaseConsoleReflect<VirtualConsole>

/**
 * 虚拟控制台，用于捕获输出，同时可以选择性地将输出传递给真实的控制台。
 *
 * > **浏览器限制：** `hookAsyncContext` 依赖全局变量栈，仅在同步或简单 await
 * > 场景下可靠传播；detached 的 `setTimeout` 等宏任务回调不会继承上下文。
 */
export class VirtualConsole extends Console {
	/** 捕获的所有输出（纯文本，由 outputEntries 聚合） */
	readonly outputs: string
	/** 捕获的所有输出（HTML，由 outputEntries 聚合） */
	readonly outputsHtml: string
	/** 结构化日志条目数组 */
	outputEntries: LogEntry[]
	/** 最终合并后的配置项 */
	options: Required<Omit<VirtualConsoleOptions, 'base_console'>> & {
		base_console?: VirtualConsole | Console
	}

	/**
	 * 采集调用栈时额外跳过的帧数。
	 * 在包装 console 方法时，每增加一层调用就 +1，调用完成后 -1，
	 * 以确保 `.stack` 指向真正的调用方而非库内部。
	 */
	ignoreStackFrameNum: number

	constructor(options?: VirtualConsoleOptions)

	/**
	 * 若提供 fn，则在新的上下文中执行 fn，并将 fn 上下文的控制台替换为此对象。
	 * 否则，将当前上下文中的控制台替换为此对象。
	 * @param fn 在新的上下文中执行的函数
	 * @returns 若提供 fn，则返回 fn 的 Promise 结果；否则返回 void
	 */
	hookAsyncContext<T>(fn?: () => T | Promise<T>): Promise<T> | void

	/**
	 * 打印一行。
	 * > **浏览器限制：** 无法覆盖上一行，等同于 log。
	 * @param id 行的唯一 ID（浏览器中未使用）
	 * @param args 要打印的内容
	 */
	freshLine(id: string, ...args: unknown[]): void

	/** 清空 outputEntries，并选择性地清空真实控制台 */
	clear(): void

	/**
	 * 将内容以指定级别写入 outputEntries，不经由 base_console 输出（除非 realConsoleOutput 为 true）。
	 * @param level 日志级别
	 * @param args 要记录的内容
	 */
	write_as(level: BrowserLogEntryLevel, ...args: unknown[]): void
}

/** 默认的虚拟控制台实例 */
export const defaultConsole: VirtualConsole

/** 全局控制台的附加属性 */
export const globalConsoleAdditionalProperties: Record<string, unknown>

/**
 * 设置全局控制台反射逻辑
 * @param Reflect 从默认控制台映射到当前控制台对象的函数
 * @param ReflectSet 设置当前控制台对象的函数
 * @param ReflectRun 在新的上下文中执行函数的函数
 */
export function setGlobalConsoleReflect(
	Reflect: (defaultConsole: VirtualConsole) => VirtualConsole,
	ReflectSet: (value: VirtualConsole) => void,
	ReflectRun: <T>(value: VirtualConsole, fn: () => T | Promise<T>) => Promise<T>
): void

/** 获取全局控制台反射逻辑 */
export function getGlobalConsoleReflect(): ConsoleReflect

/** 全局控制台实例（代理对象，委托给当前活动的虚拟控制台） */
export const console: VirtualConsole

declare global {
	var console: VirtualConsole
}
