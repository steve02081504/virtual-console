import type { AsyncLocalStorage } from 'node:async_hooks'
import type { Console } from 'node:console'
import type { Writable } from 'node:stream'

import type {
	NodeLogEntryLevel,
	BaseVirtualConsoleOptions,
	ConsoleReflect as BaseConsoleReflect,
	LogEntry as BaseLogEntry,
} from './shared.d.mts'

export type { NodeLogEntryLevel, BrowserLogEntryLevel, CommonLogEntryLevel, StackFrame } from './shared.d.mts'

/**
 * Node.js 环境下的单条日志条目
 */
export type LogEntry = BaseLogEntry<NodeLogEntryLevel>

/**
 * 虚拟流，包装 Node.js 可写流（仅 Node.js 环境）
 */
interface VirtualStream extends Writable {
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
	/** 如果为 true，则启用 ANSI 转义序列支持（影响 freshLine 行为） */
	supportsAnsi?: boolean
}

/**
 * 控制台反射逻辑
 */
export type ConsoleReflect = BaseConsoleReflect<VirtualConsole>

/**
 * 虚拟控制台，用于捕获输出，同时可以选择性地将输出传递给真实的控制台。
 * 基于 `AsyncLocalStorage` 实现真正的异步上下文隔离。
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
	/** 用于 realConsoleOutput 的底层控制台实例 */
	base_console: VirtualConsole | Console

	constructor(options?: VirtualConsoleOptions)

	/**
	 * 若提供 fn，则在新的异步上下文中执行 fn，并将 fn 上下文的控制台替换为此对象。
	 * 否则，将当前异步上下文中的控制台替换为此对象。
	 * @param fn 在新的异步上下文中执行的函数
	 * @returns 若提供 fn，则返回 fn 的 Promise 结果；否则返回 void
	 */
	hookAsyncContext<T>(fn?: () => T | Promise<T>): Promise<T> | void

	/**
	 * 在终端中打印一行，如果前一次调用也是具有相同 ID 的 freshLine，
	 * 则会覆盖上一行而不是打印新行（需要 ANSI 支持）。
	 * @param id 用于标识可覆盖行的唯一 ID
	 * @param args 要打印的内容
	 */
	freshLine(id: string, ...args: unknown[]): void

	/** 清空 outputEntries，并选择性地清空真实控制台 */
	clear(): void

	/**
	 * 将内容以指定级别写入 outputEntries，绕过正常的 console 方法链。
	 * 若 `realConsoleOutput` 为 true，则根据 level 写入对应的 stdout/stderr 流。
	 * @param level 日志级别
	 * @param args 要输出的内容
	 */
	write_as(level: NodeLogEntryLevel, ...args: unknown[]): void
}

/** 全局异步存储，用于管理控制台上下文 */
export const consoleAsyncStorage: AsyncLocalStorage<VirtualConsole>

/** 默认的虚拟控制台实例 */
export const defaultConsole: VirtualConsole

/** 全局控制台的附加属性 */
export const globalConsoleAdditionalProperties: Record<string, unknown>

/**
 * 设置全局控制台反射逻辑
 * @param Reflect 从默认控制台映射到当前控制台对象的函数
 * @param ReflectSet 设置当前控制台对象的函数
 * @param ReflectRun 在新的异步上下文中执行函数的函数
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
