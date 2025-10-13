import { AsyncLocalStorage } from 'node:async_hooks'
import { Console } from 'node:console'
import process from 'node:process'
import { Writable } from 'node:stream'

import ansiEscapes from 'ansi-escapes'
import { FullProxy } from 'full-proxy'
import supportsAnsi from 'supports-ansi'

export const consoleAsyncStorage = new AsyncLocalStorage()
const cleanupRegistry = new FinalizationRegistry(cleanupToken => {
	const { stream, listener } = cleanupToken
	stream.off?.('resize', listener)
})

/**
 * 创建一个虚拟控制台，用于捕获输出，同时可以选择性地将输出传递给真实的控制台。
 *
 * @extends {Console}
 */
export class VirtualConsole extends Console {
	/**
	 * 在新的Async上下文中执行fn，并将fn上下文的控制台替换为此对象。
	 * @template T
	 * @overload
	 * @param {() => T} fn - 在新的Async上下文中执行的函数。
	 * @returns {Promise<T>} 返回 fn 函数的 Promise 结果。
	 */
	/**
	 * 将当前Async上下文中的控制台替换为此对象。
	 * @overload
	 * @returns {void}
	 */
	/**
	 * 若提供fn，则在新的Async上下文中执行fn，并将fn上下文的控制台替换为此对象。
	 * 否则，将当前Async上下文中的控制台替换为此对象。
	 * @param {(() => T) | undefined} [fn]
	 * @returns {Promise<T> | void}
	 */
	hookAsyncContext(fn) {
		if (fn) return consoleReflectRun(this, fn)
		else consoleReflectSet(this)
	}
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
	 * @param {function(Error): void} [options.error_handler=null] - 一个专门处理单个 Error 对象的错误处理器。
	 * @param {Console} [options.base_console=console] - 用于 realConsoleOutput 的底层控制台实例。
	 */
	constructor(options = {}) {
		super(new Writable({ write: () => { } }), new Writable({ write: () => { } }))

		this.base_console = options.base_console || consoleReflect()
		delete options.base_console
		this.options = {
			realConsoleOutput: false,
			recordOutput: true,
			supportsAnsi: this.#base_console.options?.supportsAnsi || supportsAnsi,
			error_handler: null,
			...options,
		}
		this.freshLine = this.freshLine.bind(this)
		this.clear = this.clear.bind(this)
		for (const method of ['log', 'info', 'warn', 'debug', 'error']) {
			if (!this[method]) continue
			const originalMethod = this[method]
			this[method] = (...args) => {
				if (method == 'error' && this.options.error_handler && args.length === 1 && args[0] instanceof Error) return this.options.error_handler(args[0])
				if (!this.options.realConsoleOutput || this.options.recordOutput) return originalMethod.apply(this, args)
				this.#loggedFreshLineId = null
				return this.#base_console[method](...args)
			}
		}
	}

	get base_console() {
		return this.#base_console
	}

	set base_console(value) {
		this.#base_console = value

		const createVirtualStream = (targetStream) => {
			const virtualStream = new Writable({
				write: (chunk, encoding, callback) => {
					this.#loggedFreshLineId = null

					if (this.options.recordOutput)
						this.outputs += chunk.toString()
					if (this.options.realConsoleOutput)
						targetStream.write(chunk, encoding, callback)
					else
						callback()
				},
			})

			if (targetStream.isTTY) {
				Object.defineProperties(virtualStream, {
					isTTY: { value: true, configurable: true, writable: false, enumerable: true },
					columns: { get: () => targetStream.columns, configurable: true, enumerable: true },
					rows: { get: () => targetStream.rows, configurable: true, enumerable: true },
					getColorDepth: { get: () => targetStream.getColorDepth.bind(targetStream), configurable: true, enumerable: true },
					hasColors: { get: () => targetStream.hasColors.bind(targetStream), configurable: true, enumerable: true },
				})

				const virtualStreamRef = new WeakRef(virtualStream)

				const resizeListener = () => {
					virtualStreamRef.deref()?.emit('resize')
				}

				targetStream.on?.('resize', resizeListener)

				cleanupRegistry.register(this, {
					stream: targetStream,
					listener: resizeListener,
				}, this)
			}

			return virtualStream
		}

		this._stdout = createVirtualStream(this.#base_console?._stdout || process.stdout)
		this._stderr = createVirtualStream(this.#base_console?._stderr || process.stderr)
	}

	/**
	 * 在终端中打印一行，如果前一次调用也是具有相同ID的freshLine，
	 * 则会覆盖上一行而不是打印新行。
	 * @param {string} id - 用于标识可覆盖行的唯一ID。
	 * @param {...any} args - 要打印的内容。
	 */
	freshLine(id, ...args) {
		if (this.options.supportsAnsi && this.#loggedFreshLineId === id)
			this._stdout.write(ansiEscapes.cursorUp(1) + ansiEscapes.eraseLine)

		this.log(...args)
		this.#loggedFreshLineId = id
	}

	clear() {
		this.#loggedFreshLineId = null
		this.outputs = ''
		if (this.options.realConsoleOutput)
			this.#base_console.clear()
	}
}

const originalConsole = globalThis.console
export const defaultConsole = new VirtualConsole({ base_console: originalConsole, recordOutput: false, realConsoleOutput: true })
export const globalConsoleAdditionalProperties = {}
/** @type {() => VirtualConsole} */
let consoleReflect = () => consoleAsyncStorage.getStore() ?? defaultConsole
/** @type {(value: VirtualConsole) => void} */
let consoleReflectSet = (v) => consoleAsyncStorage.enterWith(v)
/** @type {(value: VirtualConsole, fn: () => T) => Promise<T>} */
let consoleReflectRun = (v, fn) => consoleAsyncStorage.run(v, fn)
/**
 * 设置全局控制台反射逻辑
 * @template T
 * @param {(console: Console) => Console} Reflect
 * @param {(value: Console) => void} ReflectSet
 * @param {(value: Console, fn: () => T) => Promise<T>} ReflectRun
 */
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
export const console = globalThis.console = new FullProxy(() => Object.assign({}, globalConsoleAdditionalProperties, consoleReflect()), {
	set: (target, property, value) => {
		target = consoleReflect()
		if (property in target) return Reflect.set(target, property, value)
		globalConsoleAdditionalProperties[property] = value
		return true
	}
})
