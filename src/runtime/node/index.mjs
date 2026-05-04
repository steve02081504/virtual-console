/**
 * Node 运行时对外入口：虚拟控制台、`AsyncLocalStorage` 隔离的全局 `console` 代理与相关 API。
 */
export {
	consoleAsyncStorage,
	VirtualConsole,
	defaultConsole,
	globalConsoleAdditionalProperties,
	setGlobalConsoleResolver,
	getGlobalConsoleResolver,
	console,
} from './node-console.mjs'
