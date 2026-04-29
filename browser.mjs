import { FullProxy } from 'full-proxy'

import { LogEntry, TraceLogEntry, getStackInfo } from './util.mjs'

/**
 * 存储原始的浏览器 console 对象。
 */
const originalConsole = window.console

/**
 * 创建一个虚拟控制台，用于捕获输出，同时可以选择性地将输出传递给真实的控制台。
 */
export class VirtualConsole {
	/**
	 * 获取捕获的所有输出（纯文本）
	 * @returns {string} 按写入顺序拼接后的纯文本日志，每条之间以换行分隔。
	 */
	get outputs() { return this.outputEntries.join('\n') }
	/**
	 * 获取捕获的所有输出（HTML）
	 * @returns {string} 按写入顺序拼接后的 HTML 日志，可直接插入页面展示。
	 */
	get outputsHtml() { return this.outputEntries.map(entry => entry.toHtml()).join('<br/>\n') }
	/** @type {LogEntry[]} - 捕获的所有输出对象数组 */
	outputEntries = []

	/** @type {object} - 最终合并后的配置项 */
	options

	/** @type {Console} - 用于 realConsoleOutput 的底层控制台实例 */
	#base_console

	/** @private @type {string | null} - 用于 freshLine 功能，记录上一次 freshLine 的 ID */
	#loggedFreshLineId = null

	/** @type {number} - 忽略的堆栈帧数，用于在包装函数中跳过内部帧 */
	ignoreStackFrameNum = 0

	/**
	 * @param {object} [options={}] - 配置选项。
	 * @param {boolean} [options.realConsoleOutput=false] - 如果为 true，则在捕获输出的同时，也调用底层控制台进行实际输出。
	 * @param {boolean} [options.recordOutput=true] - 如果为 true，则捕获输出并保存在 outputs 属性中。
	 * @param {Console} [options.base_console=window.console] - 用于 realConsoleOutput 的底层控制台实例。
	 * @param {number} [options.maxLogEntries=Infinity] - 最多保留的日志条目数量。
	 * @param {function(logEntry): void} [options.on_log_entry=null] - 新增日志条目时的回调。
	 */
	constructor(options = {}) {
		options = { ...options }
		this.#base_console = options.base_console || consoleReflect()
		delete options.base_console

		this.options = {
			realConsoleOutput: false,
			recordOutput: true,
			maxLogEntries: Infinity,
			on_log_entry: null,
			...options,
		}

		const methods = ['log', 'info', 'warn', 'debug', 'error', 'table', 'dir', 'assert', 'count', 'countReset', 'time', 'timeLog', 'timeEnd', 'group', 'groupCollapsed', 'groupEnd', 'trace']
		for (const method of methods)
			if (this.#base_console[method] instanceof Function)
				/**
				 * 重写控制台方法
				 * @param {...any} args - 控制台方法的参数。
				 * @returns {void}
				 */
				this[method] = (...args) => {
					this.#loggedFreshLineId = null

					if (this.options.recordOutput) try {
						// +3: getStackInfo + #addEntry/#addTraceEntry + 此箭头函数自身，共 3 帧需跳过
						this.ignoreStackFrameNum += 3
						if (method === 'trace') this.#addTraceEntry(args)
						else this.#addEntry(method, args)
					} finally {
						this.ignoreStackFrameNum -= 3
					}

					if (this.options.realConsoleOutput)
						this.#base_console[method](...args)
				}

		for (const method of ['freshLine', 'clear', 'write_as'])
			this[method] = this[method].bind(this)
	}

	/**
	 * 创建日志条目并追加到 outputEntries，自动维护上限并触发回调。
	 * stack 缺省时使用 this.ignoreStackFrameNum 自动采集。
	 * @param {string} level - 日志级别，例如 log/warn/error。
	 * @param {any[]} args - 与 console 方法收到的原始参数一致。
	 * @param {import('./util.mjs').StackFrame[] | undefined} [stack] - 可选的预采集调用栈；未传时按当前 skip 配置自动采集。
	 * @returns {LogEntry} 已写入缓冲区的日志条目对象。
	 */
	#addEntry(level, args, stack) {
		return this.#pushEntry(new LogEntry(level, args, stack ?? getStackInfo(this.ignoreStackFrameNum)))
	}

	/**
	 * 创建 TraceLogEntry 并追加，用于 console.trace()。
	 * 将宿主控制台的 supportsAnsi 传入条目，以便 toString() 按实际输出能力决定是否启用超链接序列。
	 * @param {any[]} args - trace 的业务参数（不包含栈文本）。
	 * @returns {TraceLogEntry} 已写入缓冲区的 trace 条目；其 toString/toHtml 会附加栈信息。
	 */
	#addTraceEntry(args) {
		return this.#pushEntry(new TraceLogEntry('trace', args, getStackInfo(this.ignoreStackFrameNum), this.options.supportsAnsi))
	}

	/**
	 * 将已构建的条目推入 outputEntries，维护上限并触发回调。
	 * @template {LogEntry} T
	 * @param {T} entry - 已构造完成的日志条目实例。
	 * @returns {T} 原样返回该条目，便于调用侧继续链式使用或断言。
	 */
	#pushEntry(entry) {
		this.outputEntries.push(entry)
		if (this.outputEntries.length > this.options.maxLogEntries) this.outputEntries.shift()
		this.options.on_log_entry?.(entry)
		return entry
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
		if (fn) return consoleReflectRun(this, fn)
		else consoleReflectSet(this)
	}


	/**
	 * 在终端中打印一行。
	 * [浏览器限制] 由于浏览器控制台不支持 ANSI 光标移动，
	 * 此方法无法像在 Node.js 终端中那样覆盖上一行。
	 * 它目前等同于 console.log。
	 * @param {string} id - 用于标识行的唯一ID (在浏览器中未使用)。
	 * @param {...any} args - 要打印的内容。
	 */
	freshLine(id, ...args) {
		// 在浏览器中无法移动光标，等同于 log
		try {
			this.ignoreStackFrameNum++ // freshLine 自身是额外一层，由 log wrapper 统一处理其余帧
			this.log(...args)
		} finally {
			this.ignoreStackFrameNum--
		}
		this.#loggedFreshLineId = id
	}

	/**
	 * 清空捕获的输出，并选择性地清空真实控制台。
	 * @returns {void}
	 */
	clear() {
		this.#loggedFreshLineId = null
		this.outputEntries.length = 0
		if (this.options.realConsoleOutput)
			this.#base_console.clear()
	}

	/**
	 * 将写入操作作为指定级别的日志记录，绕过调试器的捕获，但仍然计入输出。
	 * @param {string} level - 日志级别。
	 * @param {...any} args - 要记录的内容。
	 * @returns {void}
	 */
	write_as(level, ...args) {
		if (this.options.recordOutput) try {
			this.ignoreStackFrameNum += 3 // getStackInfo + #addEntry + write_as 自身
			if (level === 'trace') this.#addTraceEntry(args)
			else this.#addEntry(level, args)
		} finally {
			this.ignoreStackFrameNum -= 3
		}
		if (this.options.realConsoleOutput && this.#base_console instanceof VirtualConsole)
			this.#base_console.write_as(level, ...args)
	}
}

/**
 * 默认的全局虚拟控制台实例。
 */
export const defaultConsole = new VirtualConsole({
	base_console: originalConsole,
	recordOutput: false,
	realConsoleOutput: true,
})

/**
 * 全局控制台的附加属性。
 */
export const globalConsoleAdditionalProperties = {}

// 模拟 AsyncLocalStorage 的上下文存储
let currentAsyncConsole = null

/** @type {() => VirtualConsole} */
let consoleReflect = () => currentAsyncConsole ?? defaultConsole

/** @type {(value: VirtualConsole) => void} */
let consoleReflectSet = (v) => {
	currentAsyncConsole = v
}

/**
 * @template T - fn 函数的返回类型
 * @type {(value: VirtualConsole, fn: () => T | Promise<T>) => Promise<T>}
 */
let consoleReflectRun = async (v, fn) => {
	const previousConsole = currentAsyncConsole
	currentAsyncConsole = v
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
 * 设置全局控制台反射逻辑
 * @template T - fn 函数的返回类型
 * @param {(console: Console) => Console} Reflect 将 console 参数映射到新的 console 对象的函数。
 * @param {(console: Console) => void} ReflectSet 设置当前 console 对象的函数。
 * @param {(console: Console, fn: () => T) => Promise<T>} ReflectRun  在新的异步上下文中执行函数的函数。
 * @returns {void}
 */
export function setGlobalConsoleReflect(Reflect, ReflectSet, ReflectRun) {
	/**
	 * 从默认控制台获取当前控制台对象。
	 * @returns {Console} 当前控制台对象。
	 */
	consoleReflect = () => Reflect(defaultConsole)
	consoleReflectSet = ReflectSet
	consoleReflectRun = ReflectRun
}
/**
 * 获取全局控制台反射逻辑。
 * @returns {object} 包含 Reflect、ReflectSet 和 ReflectRun 函数的对象。
 */
export function getGlobalConsoleReflect() {
	return {
		Reflect: consoleReflect,
		ReflectSet: consoleReflectSet,
		ReflectRun: consoleReflectRun
	}
}

/**
 * 代理对象的基础对象，避免重复的内存分配。
 * @type {object}
 */
const proxyBase = {
	...originalConsole,
}
/**
 * 导出一个代理对象作为全局 console，它将所有操作委托给当前的活动控制台。
 * 这与原始 Node.js 版本的实现完全相同。
 */
export const console = globalThis.console = new FullProxy(() => Object.assign(proxyBase, globalConsoleAdditionalProperties, consoleReflect()), {
	/**
	 * 设置属性时的处理逻辑。
	 * @param {object} target - 目标对象。
	 * @param {string | symbol} property - 要设置的属性名。
	 * @param {any} value - 要设置的属性值。
	 * @returns {boolean} 指示属性是否成功设置的布尔值。
	 */
	set: (target, property, value) => {
		target = consoleReflect()
		if (property in target) return Reflect.set(target, property, value)
		globalConsoleAdditionalProperties[property] = value
		return true
	}
})
