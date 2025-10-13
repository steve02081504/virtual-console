import { FullProxy } from 'full-proxy'

/**
 * 存储原始的浏览器 console 对象。
 */
const originalConsole = window.console

/**
 * 格式化 console 参数为字符串。
 * @param {any[]} args - console 方法接收的参数数组。
 * @returns {string} 格式化后的单行字符串。
 */
function formatArgs(args) {
	return args.map(arg => {
		if (Object(arg) instanceof String) return arg
		if (arg instanceof Error && arg.stack) return arg.stack
		try {
			return JSON.stringify(arg, null, '\t')
		} 
		catch {
			return String(arg)
		}
	}).join(' ')
}

/**
 * 创建一个虚拟控制台，用于捕获输出，同时可以选择性地将输出传递给真实的浏览器控制台。
 */
export class VirtualConsole {
	/** @type {string} - 捕获的所有输出 */
	outputs = ''

	/** @type {object} - 最终合并后的配置项 */
	options

	/** @type {Console} - 用于 realConsoleOutput 的底层控制台实例 */
	#base_console

	/** @private @type {string | null} - 用于 freshLine 功能，记录上一次 freshLine 的 ID */
	#loggedFreshLineId = null

	/**
	 * @param {object} [options={}] - 配置选项。
	 * @param {boolean} [options.realConsoleOutput=false] - 如果为 true，则在捕获输出的同时，也调用底层控制台进行实际输出。
	 * @param {boolean} [options.recordOutput=true] - 如果为 true，则捕获输出并保存在 outputs 属性中。
	 * @param {Console} [options.base_console=window.console] - 用于 realConsoleOutput 的底层控制台实例。
	 */
	constructor(options = {}) {
		this.#base_console = options.base_console || originalConsole
		delete options.base_console

		this.options = {
			realConsoleOutput: false,
			recordOutput: true,
			...options,
		}

		const methods = ['log', 'info', 'warn', 'debug', 'error', 'table', 'dir', 'assert', 'count', 'countReset', 'time', 'timeLog', 'timeEnd', 'group', 'groupCollapsed', 'groupEnd']
		for (const method of methods) 
			if (typeof this.#base_console[method] === 'function') 
				this[method] = (...args) => {
					this.#loggedFreshLineId = null // 任何常规输出都会中断 freshLine 序列
					
					if (this.options.recordOutput)
						this.outputs += formatArgs(args) + '\n'
					
					// 实际输出
					if (this.options.realConsoleOutput)
						this.#base_console[method](...args)
				}
			
		

		this.freshLine = this.freshLine.bind(this)
		this.clear = this.clear.bind(this)
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
	 * @param {(() => T | Promise<T>) | undefined} [fn]
	 * @returns {Promise<T> | void}
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
		// 在浏览器中，我们无法移动光标，所以这基本上就是一个 log
		// 我们仍然可以模拟逻辑，以防未来浏览器支持类似功能
		// 注意：我们不像原生版本那样清除上一行，因为做不到
		this.log(...args)
		this.#loggedFreshLineId = id
	}

	/**
	 * 清空捕获的输出，并可以选择性地清空真实控制台。
	 */
	clear() {
		this.#loggedFreshLineId = null
		this.outputs = ''
		if (this.options.realConsoleOutput) 
			this.#base_console.clear()
		
	}
}

export const defaultConsole = new VirtualConsole({
	base_console: originalConsole,
	recordOutput: false,
	realConsoleOutput: true,
})

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
 * @template T
 * @type {(value: VirtualConsole, fn: () => T | Promise<T>) => Promise<T>} 
 */
let consoleReflectRun = async (v, fn) => {
	const previousConsole = currentAsyncConsole
	currentAsyncConsole = v
	try {
		const result = fn()
		return await Promise.resolve(result)
	} finally {
		currentAsyncConsole = previousConsole
	}
}

// 暴露设置和获取反射逻辑的函数，以完全匹配原始API
export function setGlobalConsoleReflect(Reflect, ReflectSet, ReflectRun) {
	consoleReflect = () => Reflect(defaultConsole)
	consoleReflectSet = ReflectSet
	consoleReflectRun = ReflectRun
}
export function getGlobalConsoleReflect() {
	return {
		Reflect: consoleReflect,
		ReflectSet: consoleReflectSet,
		ReflectRun: consoleReflectRun
	}
}

/**
 * 导出一个代理对象作为全局 console，它将所有操作委托给当前的活动控制台。
 * 这与原始 Node.js 版本的实现完全相同。
 */
export const console = globalThis.console = new FullProxy(() => Object.assign({}, globalConsoleAdditionalProperties, consoleReflect()), {
	set: (target, property, value) => {
		target = consoleReflect()
		if (property in target) return Reflect.set(target, property, value)
		globalConsoleAdditionalProperties[property] = value
		return true
	}
})