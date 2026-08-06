const mod = await import(globalThis.document ? './browser.mjs' : './node.mjs')

/**
 *
 */
export const {
	consoleAsyncStorage,
	VirtualConsole,
	defaultConsole,
	setGlobalConsoleResolver,
	getGlobalConsoleResolver,
	console,
} = mod
