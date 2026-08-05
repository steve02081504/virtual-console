const mod = await import(globalThis.document ? './browser.mjs' : './node.mjs')

/**
 *
 */
export const {
	consoleAsyncStorage,
	VirtualConsole,
	defaultConsole,
	globalConsoleAdditionalProperties,
	setGlobalConsoleResolver,
	getGlobalConsoleResolver,
	console,
} = mod
