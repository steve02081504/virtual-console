import { newLogEntry } from '../../core/entries.mjs'
import { unregisterExpandRefsForEntry } from '../../core/snapshot.mjs'
import { getStackInfo } from '../../core/stack.mjs'
import {
	createGlobalConsoleProxy,
	PASSTHROUGH_CONSOLE_METHODS,
	RECORDABLE_CONSOLE_METHODS,
	VIRTUAL_CONSOLE_ENTRY_STACK_SKIP,
} from '../common.mjs'

/**
 * 浏览器运行时：`VirtualConsole` 与全局 `console` 代理（与 {@link ../node/node-console.mjs} 对称）。
 */

/**
 * 存储原始的浏览器 console 对象。
 */
const originalConsole = window.console

/**
 * 创建一个虚拟控制台，用于捕获输出，同时可以选择性地将输出传递给真实的控制台。
 */
export class VirtualConsole {
	/**
	 * 所有捕获输出拼接成的纯文本字符串。
	 * @returns {string} 聚合文本。
	 */
	get outputs() { return this.outputEntries.join('') }
	/**
	 * 所有捕获输出拼接成的 HTML 字符串。
	 * @returns {string} 聚合 HTML。
	 */
	get outputsHtml() {
		return this.outputEntries.map(entry => entry.toHtml()).join('')
	}
	/**
	 * 结构化日志条目数组。
	 * @type {import('../../core/entries.mjs').LogEntry[]}
	 */
	outputEntries = []

	/**
	 * 日志条目监听器集合。
	 * @private @type {Set<(entry: import('../../core/entries.mjs').LogEntry) => void>}
	 */
	#logEntryListeners = new Set()
	/**
	 * 缓冲清空后触发的监听器（无参数）。
	 * @private @type {Set<() => void>}
	 */
	#clearListeners = new Set()

	/**
	 * 最终合并后的配置项（日志监听请用 {@link addLogEntryListener} / {@link removeLogEntryListener}）。
	 * @type {object}
	 */
	options

	/**
	 * `realConsoleOutput` 的透传目标控制台实例。
	 * @type {Console}
	 */
	#baseConsole

	/**
	 * `freshLine` 上次使用的 id（与 Node 行为对齐；浏览器侧不改变光标但重置语义一致）。
	 * @private @type {string | null}
	 */
	#lastFreshLineId = null

	/**
	 * 采集调用栈时额外跳过的帧数；初始为 `0`。
	 * 在自定义包装函数中调用 `console.*` 时，在调用前 `+1`，`finally` 中 `-1`，
	 * 以确保 `entry.stack` 指向真正的调用方而非包装层。
	 */
	stackFrameSkipCount = 0

	/**
	 * 创建浏览器侧虚拟控制台实例。
	 * @param {object} [options={}] - 配置选项。
	 * @param {boolean} [options.realConsoleOutput=false] - 如果为 true，则在捕获输出的同时，也调用底层控制台进行实际输出。
	 * @param {boolean} [options.recordOutput=true] - 如果为 true，则捕获输出并保存在 outputs 属性中。
	 * @param {boolean} [options.supportsAnsi=!!globalThis.chrome] - 如果为 true，则启用 ANSI 转义序列支持。
	 * @param {Console} [options.baseConsole=window.console] - 用于 realConsoleOutput 的底层控制台实例。
	 * @param {number} [options.maxLogEntries=Infinity] - 最多保留的日志条目数量。
	 */
	constructor(options = {}) {
		options = { ...options }
		this.#baseConsole = options.baseConsole || getActiveConsole()
		delete options.baseConsole

		this.options = {
			realConsoleOutput: false,
			recordOutput: true,
			supportsAnsi: !!globalThis.chrome,
			maxLogEntries: Infinity,
			...options,
		}

		for (const method of [
			'freshLine', 'clear', 'writeAs',
			'addLogEntryListener', 'removeLogEntryListener',
			'addClearListener', 'removeClearListener'
		])
			this[method] = this[method].bind(this)

		const methodSpecs = [
			...RECORDABLE_CONSOLE_METHODS.map(m => /** @type {const} */[m, true]),
			...PASSTHROUGH_CONSOLE_METHODS.map(m => /** @type {const} */[m, false]),
		]
		for (const [method, shouldRecord] of methodSpecs) {
			if (!(this.#baseConsole[method] instanceof Function)) continue
			/**
			 * 重写控制台方法
			 * @param {...any} args - 控制台方法的参数。
			 * @returns {void}
			 */
			this[method] = (...args) => {
				if (shouldRecord && this.options.recordOutput) this.#addEntry(method, args)

				if (this.options.realConsoleOutput) try {
					if (this.#baseConsole instanceof VirtualConsole) this.#baseConsole.stackFrameSkipCount++
					this.#baseConsole[method](...args)
				} finally {
					if (this.#baseConsole instanceof VirtualConsole) this.#baseConsole.stackFrameSkipCount--
				}
			}
		}
	}

	/**
	 * 创建新的日志条目。
	 * @param {string} method - 日志方法名（如 log、warn、trace）。
	 * @param {any[]} args - 与 console 方法收到的原始参数一致。
	 * @param {import('../../shared.d.mts').StackFrame[] | undefined} [stack] - 可选的预采集调用栈；未传时按当前 skip 配置自动采集。
	 * @returns {import('../../core/entries.mjs').LogEntry} 新的日志条目对象。
	 */
	#newLogEntry(method, args = [], stack = getStackInfo(this.stackFrameSkipCount + VIRTUAL_CONSOLE_ENTRY_STACK_SKIP)) {
		return newLogEntry({ method, args, stack, supportsAnsi: this.options.supportsAnsi })
	}

	/**
	 * 创建日志条目并追加到 outputEntries，自动维护上限并触发回调。
	 * @param {string} method - 日志方法名（如 log、warn、trace）。
	 * @param {any[]} args - 与 console 方法收到的原始参数一致。
	 * @param {import('../../shared.d.mts').StackFrame[] | undefined} [stack] - 可选的预采集调用栈；未传时按当前 skip 配置自动采集。
	 * @returns {import('../../core/entries.mjs').LogEntry} 已写入缓冲区的日志条目对象。
	 */
	#addEntry(method, args = [], stack = getStackInfo(this.stackFrameSkipCount + VIRTUAL_CONSOLE_ENTRY_STACK_SKIP)) {
		return this.#pushEntry(this.#newLogEntry(method, args, stack))
	}

	/**
	 * 将已构建的条目推入 outputEntries，维护上限并触发回调。
	 * @template {import('../../core/entries.mjs').LogEntry} T
	 * @param {T} entry - 已构造完成的日志条目实例。
	 * @returns {T} 原样返回该条目，便于调用侧继续链式使用或断言。
	 */
	#pushEntry(entry) {
		this.outputEntries.push(entry)
		if (this.outputEntries.length > this.options.maxLogEntries) {
			const removed = this.outputEntries.shift()
			if (removed) unregisterExpandRefsForEntry(removed)
		}
		for (const listener of this.#logEntryListeners) try {
			listener(entry)
		} catch { }

		return entry
	}

	/**
	 * 注册新日志条目回调（可多路订阅）。
	 * @param {(entry: import('../../core/entries.mjs').LogEntry) => void} fn - 每条结构化日志写入缓冲后同步调用；勿假设异步顺序。
	 * @returns {void}
	 */
	addLogEntryListener(fn) {
		this.#logEntryListeners.add(fn)
	}

	/**
	 * 取消先前通过 {@link addLogEntryListener} 注册的回调（引用相等时才生效）。
	 * @param {(entry: import('../../core/entries.mjs').LogEntry) => void} fn - 与注册时传入的函数同一引用。
	 * @returns {void}
	 */
	removeLogEntryListener(fn) {
		this.#logEntryListeners.delete(fn)
	}

	/**
	 * 注册缓冲清空回调（`clear()` 在清空条目并可选调用底层 `clear()` 之后同步调用）。
	 * @param {() => void} fn - 回调。
	 * @returns {void}
	 */
	addClearListener(fn) {
		this.#clearListeners.add(fn)
	}

	/**
	 * 取消先前通过 {@link addClearListener} 注册的回调。
	 * @param {() => void} fn - 与注册时同一引用。
	 * @returns {void}
	 */
	removeClearListener(fn) {
		this.#clearListeners.delete(fn)
	}

	/**
	 * 在新的异步上下文中执行fn，并将该上下文的控制台替换为此对象。
	 * 这是对 Node.js 中 AsyncLocalStorage.run 的浏览器模拟。
	 * @template T
	 * @overload
	 * @param {() => T | Promise<T>} fn - 在新的异步上下文中执行的函数。
	 * @returns {Promise<T>} 返回 fn 函数的 Promise 结果。
	 */
	/**
	 * 将当前“异步上下文”中的控制台替换为此对象。
	 * [浏览器限制] 这在浏览器中是全局性的，会影响所有后续代码，直到被再次更改。
	 * @overload
	 * @returns {void}
	 */
	/**
	 * 若提供fn，则在新的异步上下文中执行fn，并将fn上下文的控制台替换为此对象。
	 * 否则，将当前异步上下文中的控制台替换为此对象。
	 * @template T - fn 函数的返回类型。
	 * @param {(() => T | Promise<T>) | undefined} [fn] - 在新的异步上下文中执行的函数。
	 * @returns {Promise<T> | void} 若提供fn，则返回 fn 函数的 Promise 结果；否则返回void。
	 */
	hookAsyncContext(fn) {
		if (fn) return runWithActiveConsole(this, fn)
		else setActiveConsole(this)
	}

	/**
	 * 打印一行信息。
	 * > **浏览器限制：** 无法覆盖上一行，行为等同于普通 `log`，`id` 参数被忽略。
	 * @param {string} id - 标识可覆盖行的唯一键（浏览器中不生效）。
	 * @param {...any} args - 要打印的内容。
	 */
	freshLine(id, ...args) {
		this.#addEntry('freshLine', [id, ...args])
		const previousRecordOutput = this.options.recordOutput
		try {
			this.options.recordOutput = false
			this.stackFrameSkipCount++ // freshLine 自身是额外一层，由 log wrapper 统一处理其余帧
			if (this.#baseConsole instanceof VirtualConsole) this.#baseConsole.freshLine(id, ...args)
			else this.log(...args) // 在浏览器中无法移动光标，等同于 log
		} finally {
			this.stackFrameSkipCount--
			this.options.recordOutput = previousRecordOutput
		}
		this.#lastFreshLineId = id
	}

	/**
	 * 清空 `outputEntries` 并重置 `freshLine` 状态。
	 * 若 `realConsoleOutput` 为 true，也会调用底层控制台的 `clear()`。
	 * 清空完成后会同步调用 {@link addClearListener} 注册的回调。
	 * @returns {void}
	 */
	clear() {
		this.#lastFreshLineId = null
		for (const entry of this.outputEntries)
			unregisterExpandRefsForEntry(entry)
		this.outputEntries.length = 0
		if (this.options.realConsoleOutput)
			this.#baseConsole.clear()
		for (const listener of this.#clearListeners) try {
			listener()
		} catch { }
	}

	/**
	 * 以指定级别记录日志，不经由 `console.*` 方法路由。
	 * 适合注入自定义级别的条目或在不触发其他副作用的情况下录入数据。
	 * @param {string} method - 日志方法名。
	 * @param {...any} args - 要记录的内容。
	 * @returns {void}
	 */
	writeAs(method, ...args) {
		if (this.options.recordOutput) this.#addEntry(method, args)
		if (this.options.realConsoleOutput && this.#baseConsole instanceof VirtualConsole)
			this.#baseConsole.writeAs(method, ...args)
	}
}

/**
 * 始终在线的兜底控制台：不记录任何条目，直接将所有输出透传到原始 `window.console`。
 */
export const defaultConsole = new VirtualConsole({
	baseConsole: originalConsole,
	recordOutput: false,
	realConsoleOutput: true,
})

/**
 * 合并到全局 `console` 代理上的附加属性对象。
 * 对 `globalThis.console` 写入未知属性时，值存储在这里，以便跨上下文共享自定义扩展字段。
 */
export const globalConsoleAdditionalProperties = {}

// 模拟 AsyncLocalStorage 的上下文存储
let currentAsyncConsole = null

/**
 * 解析当前应激活的 `VirtualConsole`（默认兜底 {@link defaultConsole}）。
 * @type {() => VirtualConsole}
 */
let getActiveConsole = () => currentAsyncConsole ?? defaultConsole

/**
 * 将当前上下文的活动控制台设为指定实例。
 * @type {(value: VirtualConsole) => void}
 */
let setActiveConsole = (value) => {
	currentAsyncConsole = value
}

/**
 * 在暂时绑定活动控制台为 `value` 的上下文中执行 `fn`。
 * @template T - fn 函数的返回类型
 * @type {(value: VirtualConsole, fn: () => T | Promise<T>) => Promise<T>}
 */
let runWithActiveConsole = async (value, fn) => {
	const previousConsole = currentAsyncConsole
	currentAsyncConsole = value
	try {
		const result = fn()
		return await Promise.resolve(result)
	}
	finally {
		currentAsyncConsole = previousConsole
	}
}

// 暴露设置和获取反射逻辑的函数，以完全匹配原始API
/**
 * 替换全局 `console` 代理的上下文路由逻辑。
 * @template T
 * @param {(defaultConsole: VirtualConsole) => VirtualConsole} resolveWithFallback 给定兜底值，返回当前应激活的控制台。
 * @param {(value: VirtualConsole) => void} setActive 将指定实例设为当前上下文的活动控制台。
 * @param {(value: VirtualConsole, callback: () => T | Promise<T>) => Promise<T>} runInContext 在以指定实例为活动控制台的新上下文中执行回调。
 * @returns {void}
 */
export function setGlobalConsoleResolver(resolveWithFallback, setActive, runInContext) {
	/**
	 * 当前异步/全局上下文中应接收 `console` 调用的实例
	 * @returns {VirtualConsole} 当前异步/全局上下文中应接收 `console` 调用的实例
	 */
	getActiveConsole = () => resolveWithFallback(defaultConsole)
	setActiveConsole = setActive
	runWithActiveConsole = runInContext
}
/**
 * 读取当前的全局 `console` 代理路由逻辑。
 * @returns {{ getActiveConsole: () => VirtualConsole, setActiveConsole: (value: VirtualConsole) => void, runWithActiveConsole: <T>(value: VirtualConsole, fn: () => T | Promise<T>) => Promise<T> }} 当前生效的三段回调，可与 {@link setGlobalConsoleResolver} 配合替换或观测。
 */
export function getGlobalConsoleResolver() {
	return {
		getActiveConsole,
		setActiveConsole,
		runWithActiveConsole,
	}
}

/**
 * 全局控制台实例。
 */
export const console = globalThis.console = createGlobalConsoleProxy({
	getActiveConsole,
	originalConsole,
	globalConsoleAdditionalProperties,
})
