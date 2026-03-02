import type { AsyncLocalStorage } from 'node:async_hooks'
import type { Console } from 'node:console'
import type { Writable } from 'node:stream'

/**
 * 虚拟控制台配置选项
 */
export interface VirtualConsoleOptions {
	/** 如果为 true，则在捕获输出的同时，也调用底层控制台进行实际输出 */
	realConsoleOutput?: boolean
	/** 如果为 true，则捕获输出并保存在 outputs 属性中 */
	recordOutput?: boolean
	/** 如果为 true，则启用 ANSI 转义序列支持 */
	supportsAnsi?: boolean
	/** 专门处理单个 Error 对象的错误处理器 */
	error_handler?: ((error: Error) => void) | null
	/** 用于 realConsoleOutput 的底层控制台实例 */
	base_console?: Console
}

/**
 * 控制台反射逻辑
 */
export interface ConsoleReflect {
	/** 从默认控制台获取当前控制台对象 */
	Reflect: () => Console
	/** 设置当前控制台对象的函数 */
	ReflectSet: (value: VirtualConsole) => void
	/** 在新的异步上下文中执行函数的函数 */
	ReflectRun: <T>(value: VirtualConsole, fn: () => T | Promise<T>) => Promise<T>
}

/**
 * 虚拟流，包装 Node.js 可写流
 */
interface VirtualStream extends Writable {
	/** 是否为 TTY */
	readonly isTTY: boolean
	/** 列数 */
	readonly columns: number
	/** 行数 */
	readonly rows: number
	/** 获取底层目标流 */
	readonly targetStream: NodeJS.WritableStream
	/** 获取颜色深度 */
	getColorDepth(): number
	/** 判断是否支持颜色 */
	hasColors(): boolean
}

/**
 * 虚拟控制台，用于捕获输出，同时可以选择性地将输出传递给真实的控制台
 */
export class VirtualConsole extends Console {
	/** 捕获的所有输出 */
	outputs: string
	/** 捕获的所有输出 (HTML) */
	outputsHtml: string
	/** 最终合并后的配置项 */
	options: Required<Omit<VirtualConsoleOptions, 'base_console'>> & {
		base_console?: Console
	}
	/** 用于 realConsoleOutput 的底层控制台实例 */
	base_console: Console

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
	 * 则会覆盖上一行而不是打印新行。
	 * @param id 用于标识可覆盖行的唯一 ID
	 * @param args 要打印的内容
	 */
	freshLine(id: string, ...args: unknown[]): void

	/** 清空捕获的输出，并选择性地清空真实控制台 */
	clear(): void
}

/** 全局异步存储，用于管理控制台上下文 */
export const consoleAsyncStorage: AsyncLocalStorage<VirtualConsole>

/** 默认的虚拟控制台实例 */
export const defaultConsole: VirtualConsole

/** 全局控制台的附加属性 */
export const globalConsoleAdditionalProperties: Record<string, unknown>

/**
 * 设置全局控制台反射逻辑
 * @param Reflect 从默认控制台映射到新的控制台对象的函数
 * @param ReflectSet 设置当前控制台对象的函数
 * @param ReflectRun 在新的异步上下文中执行函数的函数
 */
export function setGlobalConsoleReflect(
	Reflect: (defaultConsole: VirtualConsole) => Console,
	ReflectSet: (value: VirtualConsole) => void,
	ReflectRun: <T>(value: VirtualConsole, fn: () => T | Promise<T>) => Promise<T>
): void

/** 获取全局控制台反射逻辑 */
export function getGlobalConsoleReflect(): ConsoleReflect

/** 全局控制台实例（代理对象，委托给当前活动的虚拟控制台） */
export const console: Console
