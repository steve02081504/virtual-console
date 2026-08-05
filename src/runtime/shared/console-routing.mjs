/**
 * 全局 `console` 代理工厂与活动控制台路由槽位。
 */

import { FullProxy } from 'full-proxy'

/**
 * 合并到全局 `console` 代理上的附加属性对象。
 * 对 `globalThis.console` 写入未知属性时，值会存储在这里，
 * 以便在不同异步上下文间共享自定义扩展字段。
 */
export const globalConsoleAdditionalProperties = {}

/**
 * @typedef {object} CreateGlobalConsoleProxyOptions
 * @property {() => object} getActiveConsole - 解析当前活动控制台实例。
 * @property {object} originalConsole - 原生全局 `console` 快照。
 */

/**
 * 构造与 Node / 浏览器两侧一致的全局 `console` FullProxy。
 * @param {CreateGlobalConsoleProxyOptions} options - 活动控制台解析与原始 `console` 快照。
 * @returns {object} `globalThis.console` 代理对象。
 */
export function createGlobalConsoleProxy({ getActiveConsole, originalConsole }) {
	return new FullProxy(() => Object.assign({}, originalConsole, globalConsoleAdditionalProperties, getActiveConsole()), {
		/**
		 * @param {object} target - Proxy 目标（此处会被替换为活动控制台）。
		 * @param {string | symbol} property - 读取的属性键。
		 * @param {object} receiver - 接收者。
		 * @returns {unknown} 属性值。
		 */
		get: (target, property, receiver) => {
			target = getActiveConsole()
			if (Reflect.has(target, property))
				return Reflect.get(target, property, target)
			if (property in globalConsoleAdditionalProperties)
				return globalConsoleAdditionalProperties[property]
			return Reflect.get(originalConsole, property, receiver)
		},
		/**
		 * @param {object} target - Proxy 目标。
		 * @param {string | symbol} property - 写入的属性键。
		 * @param {any} value - 新值。
		 * @returns {boolean} 是否设置成功。
		 */
		set: (target, property, value) => {
			target = getActiveConsole()
			if (property in target) return Reflect.set(target, property, value)
			globalConsoleAdditionalProperties[property] = value
			return true
		},
	})
}

/**
 * 创建可替换的活动控制台路由槽；`resolveActiveConsole` 对代理保持稳定引用。
 * @template T
 * @param {{
 *   getActiveConsole: () => T | null | undefined
 *   setActiveConsole: (value: T) => void
 *   runWithActiveConsole: (value: T, callback: () => any) => any
 * }} initial - 平台初始路由三元组（可返回空，由 `getDefaultConsole` 兜底）。
 * @param {() => T} getDefaultConsole - 兜底控制台。
 * @returns {{
 *   resolveActiveConsole: () => T
 *   get setActiveConsole(): (value: T) => void
 *   get runWithActiveConsole(): (value: T, callback: () => any) => any
 *   setGlobalConsoleResolver: (resolveWithFallback: (defaultConsole: T) => T, setActive: (value: T) => void, runInContext: (value: T, callback: () => any) => any) => void
 *   getGlobalConsoleResolver: () => { getActiveConsole: () => T, setActiveConsole: (value: T) => void, runWithActiveConsole: (value: T, callback: () => any) => any }
 * }} 活动控制台路由 API。
 */
export function createConsoleRouting(initial, getDefaultConsole) {
	const routing = { ...initial }
	return {
		/** @returns {T} 当前活动控制台实例（无则兜底）。 */
		resolveActiveConsole: () => routing.getActiveConsole() ?? getDefaultConsole(),
		/** @returns {(value: T) => void} 设置活动控制台的函数。 */
		get setActiveConsole() { return routing.setActiveConsole },
		/** @returns {(value: T, callback: () => any) => any} 在指定控制台上下文中执行回调的函数。 */
		get runWithActiveConsole() { return routing.runWithActiveConsole },
		/**
		 * 替换默认路由实现（宿主注入自定义解析与上下文切换）。
		 * @param {(defaultConsole: T) => T} resolveWithFallback - 解析活动控制台，可回退到 `defaultConsole`。
		 * @param {(value: T) => void} setActive - 设置活动控制台。
		 * @param {(value: T, callback: () => any) => any} runInContext - 在指定控制台上下文中执行回调。
		 * @returns {void}
		 */
		setGlobalConsoleResolver(resolveWithFallback, setActive, runInContext) {
			/** @returns {T} 经宿主解析后的活动控制台。 */
			routing.getActiveConsole = () => resolveWithFallback(getDefaultConsole())
			routing.setActiveConsole = setActive
			routing.runWithActiveConsole = runInContext
		},
		/**
		 * 返回当前生效的路由三元组快照。
		 * @returns {{ getActiveConsole: () => T, setActiveConsole: (value: T) => void, runWithActiveConsole: (value: T, callback: () => any) => any }} 可解构的路由 API 对象。
		 */
		getGlobalConsoleResolver() {
			return {
				/** @returns {T} 当前活动控制台实例。 */
				getActiveConsole: () => routing.getActiveConsole() ?? getDefaultConsole(),
				setActiveConsole: routing.setActiveConsole,
				runWithActiveConsole: routing.runWithActiveConsole,
			}
		},
	}
}
