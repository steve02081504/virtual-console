const module = await import(globalThis.document ? './browser.mjs' : './node.mjs')

/**
 * @type {AsyncLocalStorage}
 */
export const { consoleAsyncStorage } = module
/**
 * @type {typeof VirtualConsole}
 */
export const { VirtualConsole } = module
/**
 * @type {VirtualConsole}
 */
export const { defaultConsole } = module
/**
 * @type {object}
 */
export const { globalConsoleAdditionalProperties } = module
/**
 * @type {function}
 */
export const { setGlobalConsoleReflect } = module
/**
 * @type {function}
 */
export const { getGlobalConsoleReflect } = module
/**
 * @type {VirtualConsole}
 */
export const { console } = module
