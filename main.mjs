const mod = await import(globalThis.document ? './browser.mjs' : './node.mjs')

/**
 * 同构入口重导出的 `AsyncLocalStorage`（仅 Node 有值，浏览器为 `undefined`）。
 * @type {AsyncLocalStorage}
 */
export const { consoleAsyncStorage } = mod
/**
 * 虚拟控制台类构造器，与平台实现一致。
 * @type {typeof VirtualConsole}
 */
export const { VirtualConsole } = mod
/**
 * 不记录条目的兜底控制台，透传真实全局 `console`。
 * @type {VirtualConsole}
 */
export const { defaultConsole } = mod
/**
 * 挂到全局 `console` 代理上的用户自定义扩展字段容器。
 * @type {object}
 */
export const { globalConsoleAdditionalProperties } = mod
/**
 * 替换全局 `console` 路由解析逻辑（`setGlobalConsoleResolver`）。
 * @type {function}
 */
export const { setGlobalConsoleResolver } = mod
/**
 * 读取当前全局 `console` 路由三元组（`getGlobalConsoleResolver`）。
 * @type {function}
 */
export const { getGlobalConsoleResolver } = mod
/**
 * 全局 `console` 代理实例。
 * @type {VirtualConsole}
 */
export const { console } = mod
