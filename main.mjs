const module = await import(globalThis.document ? './browser.mjs' : './node.mjs')

/**
 *
 */
export const consoleAsyncStorage = module.consoleAsyncStorage
/**
 *
 */
export const VirtualConsole = module.VirtualConsole
/**
 *
 */
export const defaultConsole = module.defaultConsole
/**
 *
 */
export const globalConsoleAdditionalProperties = module.globalConsoleAdditionalProperties
/**
 *
 */
export const setGlobalConsoleReflect = module.setGlobalConsoleReflect
/**
 *
 */
export const getGlobalConsoleReflect = module.getGlobalConsoleReflect
/**
 *
 */
export const console = module.console
