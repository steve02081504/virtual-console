/**
 * Node / 浏览器共用的全局 `console` 代理工厂与 VirtualConsole 方法分组常量。
 */

import { FullProxy } from 'full-proxy'

/**
 * @typedef {object} CreateGlobalConsoleProxyOptions
 * @property {() => object} getActiveConsole - 解析当前活动控制台实例。
 * @property {object} originalConsole - 原生全局 `console` 快照。
 * @property {object} globalConsoleAdditionalProperties - 自定义扩展字段存储。
 */

/**
 * 构造与 Node / 浏览器两侧一致的全局 `console` FullProxy。
 * @param {CreateGlobalConsoleProxyOptions} options - 活动控制台解析与原始 `console` 快照。
 * @returns {object} `globalThis.console` 代理对象。
 */
export function createGlobalConsoleProxy({ getActiveConsole, originalConsole, globalConsoleAdditionalProperties }) {
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

/** `#newLogEntry` / `#addEntry` 相对调用点的栈顶行丢弃量（含原 `getStackInfo` 隐式 +1） */
export const VIRTUAL_CONSOLE_ENTRY_STACK_SKIP = 3

/** 与 Node `console.log` 等对齐、需要缓冲记录的一组方法。 */
export const RECORDABLE_CONSOLE_METHODS = ['log', 'info', 'warn', 'debug', 'error', 'trace', 'dir']

/** 浏览器侧额外透传、不写入 `outputEntries` 的一组（Node 亦补齐同形 API）。 */
export const PASSTHROUGH_CONSOLE_METHODS = [
	'table', 'assert', 'count', 'countReset', 'time', 'timeLog', 'timeEnd',
	'group', 'groupCollapsed', 'groupEnd',
]
