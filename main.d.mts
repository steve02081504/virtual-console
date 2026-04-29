/**
 * 通用入口类型定义，适用于不区分平台的打包器。
 * 在 Node.js 环境中建议直接使用 `@steve02081504/virtual-console/node`；
 * 在浏览器环境中建议直接使用 `@steve02081504/virtual-console/browser`。
 */

export type { CommonLogEntryLevel, BrowserLogEntryLevel, NodeLogEntryLevel, StackFrame } from './shared.d.mts'

export type { LogEntry, VirtualConsoleOptions, ConsoleReflect } from './node.d.mts'

export {
	VirtualConsole,
	defaultConsole,
	globalConsoleAdditionalProperties,
	console,
	setGlobalConsoleReflect,
	getGlobalConsoleReflect,
} from './node.d.mts'

import type { AsyncLocalStorage } from 'node:async_hooks'
import type { VirtualConsole } from './node.d.mts'

/**
 * 全局异步存储，用于管理控制台上下文。
 * Node.js 环境下为 AsyncLocalStorage 实例；浏览器环境下为 undefined。
 */
export declare const consoleAsyncStorage: AsyncLocalStorage<VirtualConsole> | undefined

declare global {
	var console: VirtualConsole
}
