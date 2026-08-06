const mod = await import(globalThis.document ? './browser.mjs' : './node.mjs')

/**
 * 按运行时（Node / 浏览器）再导出公共 API。
 */
export const {
	consoleAsyncStorage,
	VirtualConsole,
	defaultConsole,
	setGlobalConsoleResolver,
	getGlobalConsoleResolver,
	console,
} = mod
