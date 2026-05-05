/**
 * 通用入口类型定义，适用于不区分平台的打包器或同构代码。
 *
 * 若需要与运行环境完全对齐的类型（如 Node 的 `stdout`/`stderr` 级别，或浏览器的上下文隔离说明），
 * 建议使用平台专属入口：
 * - Node.js：`@steve02081504/virtual-console/node`
 * - 浏览器：`@steve02081504/virtual-console/browser`
 *
 * `consoleAsyncStorage` 在浏览器产物中为 `undefined`，请在使用前判断。
 */

export type {
	CapturedLogLevel,
	WriteAsLevelArg,
	StackFrame,
} from './src/shared.d.mts'

export type { LogEntry, VirtualConsoleOptions, GlobalConsoleRouting, VirtualStream } from './node.d.mts'

export {
	VirtualConsole,
	defaultConsole,
	globalConsoleAdditionalProperties,
	console,
	setGlobalConsoleResolver,
	getGlobalConsoleResolver,
} from './node.d.mts'

import type { AsyncLocalStorage } from 'node:async_hooks'
import type { VirtualConsole } from './node.d.mts'

/**
 * 驱动 `hookAsyncContext` 隔离的 `AsyncLocalStorage` 实例。
 * Node.js 环境下有效；浏览器产物中为 `undefined`。
 */
export declare const consoleAsyncStorage: AsyncLocalStorage<VirtualConsole> | undefined

declare global {
	var console: VirtualConsole
}
