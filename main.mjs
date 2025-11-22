const module = await import(globalThis.document ? './browser.mjs' : './node.mjs')

/**
 * @type {AsyncLocalStorage}
 */
export const consoleAsyncStorage = module.consoleAsyncStorage
/**
 * @type {typeof VirtualConsole}
 */
export const VirtualConsole = module.VirtualConsole
/**
 * @type {VirtualConsole}
 */
export const defaultConsole = module.defaultConsole
/**
 * @type {object}
 */
export const globalConsoleAdditionalProperties = module.globalConsoleAdditionalProperties
/**
 * @type {function}
 */
export const setGlobalConsoleReflect = module.setGlobalConsoleReflect
/**
 * @type {function}
 */
export const getGlobalConsoleReflect = module.getGlobalConsoleReflect
/**
 * @type {VirtualConsole}
 */
export const console = module.console
