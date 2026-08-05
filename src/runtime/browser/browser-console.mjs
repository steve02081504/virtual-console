import { createConsoleRouting, createGlobalConsoleProxy } from '../shared/console-routing.mjs'
import { VirtualConsoleMixin } from '../shared/virtual-console.mjs'

import { emitNative } from './native-output.mjs'

/**
 * 浏览器运行时：`VirtualConsole` 与全局 `console` 代理。
 */

const originalConsole = globalThis.console

let currentAsyncConsole = null

const routing = createConsoleRouting({
	/** @returns {VirtualConsole | null} 当前异步上下文控制台。 */
	getActiveConsole: () => currentAsyncConsole,
	/**
	 * 将后续 `console.*` 绑定到指定实例（模块级，非 `AsyncLocalStorage`）。
	 * @param {VirtualConsole | null} value - 活动控制台；`null` 恢复为仅走 `defaultConsole`。
	 * @returns {void}
	 */
	setActiveConsole: (value) => { currentAsyncConsole = value },
	/**
	 * 在 `callback` 执行期间将 `value` 设为活动控制台，结束后恢复先前绑定。
	 * @param {VirtualConsole} value - 本次上下文使用的控制台。
	 * @param {() => any} callback - 在绑定上下文中执行的回调。
	 * @returns {Promise<any>} `callback` 的返回值。
	 */
	runWithActiveConsole: async (value, callback) => {
		const previousConsole = currentAsyncConsole
		currentAsyncConsole = value
		try {
			return await Promise.resolve(callback())
		}
		finally {
			currentAsyncConsole = previousConsole
		}
	},
}, () => defaultConsole)

const browserPlatform = {
	routing,
	emitNative,
}

/**
 * 浏览器侧虚拟控制台。
 */
export class VirtualConsole extends VirtualConsoleMixin(Object, browserPlatform) {
	/**
	 * @param {object} [options={}] - 配置选项。
	 * @param {boolean} [options.realConsoleOutput=false] - 是否将捕获输出转发到 `baseConsole`。
	 * @param {boolean} [options.recordOutput=true] - 是否写入 `outputEntries`。
	 * @param {boolean} [options.supportsAnsi] - 是否保留 ANSI 转义；默认按 `globalThis.chrome` 推断。
	 * @param {Console} [options.baseConsole] - 透传目标；缺省时取当前活动控制台。
	 * @param {number} [options.maxLogEntries=Infinity] - `outputEntries` 上限，超出丢弃最旧条目。
	 */
	constructor(options = {}) {
		const baseConsole = options.baseConsole ?? routing.resolveActiveConsole()
		super({
			supportsAnsi: !!globalThis.chrome,
			...options,
			baseConsole,
		})
	}
}

/**
 * 始终在线的兜底控制台：不记录任何条目，直接将所有输出透传到原始全局 `console`。
 */
export const defaultConsole = new VirtualConsole({
	baseConsole: originalConsole,
	recordOutput: false,
	realConsoleOutput: true,
})

/**
 * 注入自定义活动控制台解析器（测试或宿主接管全局 `console` 路由）。
 * @type {typeof routing.setGlobalConsoleResolver}
 */
export const setGlobalConsoleResolver = routing.setGlobalConsoleResolver
/**
 * 读取当前生效的路由三元组（`getActiveConsole` / `setActiveConsole` / `runWithActiveConsole`）。
 * @type {typeof routing.getGlobalConsoleResolver}
 */
export const getGlobalConsoleResolver = routing.getGlobalConsoleResolver

/**
 * 全局控制台实例。
 */
export const console = globalThis.console = createGlobalConsoleProxy({
	getActiveConsole: routing.resolveActiveConsole,
	originalConsole,
})
