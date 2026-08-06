/**
 * 浏览器运行时对外入口：虚拟控制台与全局 `console` 代理。
 */
export {
	VirtualConsole,
	defaultConsole,
	setGlobalConsoleResolver,
	getGlobalConsoleResolver,
	console,
} from './browser-console.mjs'
