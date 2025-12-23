import { AsyncLocalStorage } from 'node:async_hooks'
import { Console } from 'node:console'
import process from 'node:process'
import { Writable } from 'node:stream'

import ansiEscapes from 'ansi-escapes'
import { FullProxy } from 'full-proxy'
import supportsAnsi from 'supports-ansi'

import { argsToHtml } from './util.mjs'

/**
 * 全局异步存储，用于管理控制台上下文。
 */
export const consoleAsyncStorage = new AsyncLocalStorage()

/**
 * WeakMap 用于存储每个流对应的 resize 监听器信息。
 * @type {WeakMap<Writable, { listener: () => void, virtualStreams: Set<WeakRef<Writable>> }>}
 */
const streamResizeListeners = new WeakMap()

/**
 * FinalizationRegistry 用于清理虚拟流引用。
 */
const virtualStreamCleanupRegistry = new FinalizationRegistry(({ stream, virtualStreamRef }) => {
	const listenerInfo = streamResizeListeners.get(stream)
	if (!listenerInfo) return
	listenerInfo.virtualStreams.delete(virtualStreamRef)
	if (listenerInfo.virtualStreams.size) return
	stream.off?.('resize', listenerInfo.listener)
	streamResizeListeners.delete(stream)
})

/**
 * 获取或创建一个流对应的监听器信息。
 * @param {Writable} stream - 目标流。
 * @returns {{ listener: () => void, virtualStreams: Set<WeakRef<Writable>> }} 监听器信息。
 */
function getListenerInfo(stream) {
	const existing = streamResizeListeners.get(stream)
	if (existing) return existing
	const listenerInfo = {
		/**
		 * 统一的 resize 监听器，会通知所有使用该流的虚拟流。
		 * @returns {void}
		 */
		listener: () => {
			for (const ref of listenerInfo.virtualStreams) {
				const virtualStream = ref.deref()
				if (virtualStream) try { virtualStream.emit?.('resize') } catch (error) { console.error(error) }
				else listenerInfo.virtualStreams.delete(ref)
			}
			if (listenerInfo.virtualStreams.size) return
			stream.off?.('resize', listenerInfo.listener)
			streamResizeListeners.delete(stream)
		},
		virtualStreams: new Set()
	}
	stream.on?.('resize', listenerInfo.listener)

	streamResizeListeners.set(stream, listenerInfo)
	return listenerInfo
}

/**
 * 虚拟流类，用于创建虚拟控制台流。
 * @augments {Writable}
 */
class VirtualStream extends Writable {
	/**
	 * @param {NodeJS.WritableStream} targetStream - 目标流。
	 * @param {object} context - 虚拟控制台上下文。
	 * @param {() => void} context.onWrite - 写入时的回调函数，用于重置 loggedFreshLineId。
	 * @param {object} context.options - 虚拟控制台的配置选项。
	 * @param {boolean} context.options.recordOutput - 是否记录输出。
	 * @param {boolean} context.options.realConsoleOutput - 是否输出到真实控制台。
	 * @param {{ outputs: string }} context.state - 虚拟控制台的状态对象，包含 outputs 属性。
	 */
	constructor(targetStream, context) {
		super({
			/**
			 * 写入数据到虚拟流。
			 * @param {Buffer | string} chunk - 要写入的数据块。
			 * @param {string} encoding - 编码格式。
			 * @param {() => void} callback - 写入完成的回调函数。
			 */
			write: (chunk, encoding, callback) => {
				context.onWrite()

				if (context.options.recordOutput)
					context.state.outputs += chunk.toString()
				if (context.options.realConsoleOutput)
					targetStream.write(chunk, encoding, callback)
				else
					callback()
			},
		})

		this.#targetStream = targetStream

		if (targetStream.isTTY) {
			const virtualStreamRef = new WeakRef(this)
			const listenerInfo = getListenerInfo(targetStream)
			listenerInfo.virtualStreams.add(virtualStreamRef)
			virtualStreamCleanupRegistry.register(this, {
				stream: targetStream,
				virtualStreamRef
			})
		}
	}

	/** @private @type {NodeJS.WritableStream} - 目标流 */
	#targetStream

	/**
	 * 判断目标流是否为 TTY
	 * @returns {boolean} 是否为 TTY
	 */
	get isTTY() {
		return this.#targetStream?.isTTY ?? false
	}

	/**
	 * 获取目标流的列数
	 * @returns {number} 列数
	 */
	get columns() {
		return this.#targetStream.columns
	}

	/**
	 * 获取目标流的行数
	 * @returns {number} 行数
	 */
	get rows() {
		return this.#targetStream.rows
	}

	/**
	 * 获取目标流的颜色深度
	 * @returns {number} 颜色深度
	 */
	getColorDepth() {
		return this.#targetStream.getColorDepth()
	}

	/**
	 * 判断目标流是否支持颜色
	 * @returns {boolean} 是否支持颜色
	 */
	hasColors() {
		return this.#targetStream.hasColors()
	}
}

/**
 * 创建一个虚拟控制台，用于捕获输出，同时可以选择性地将输出传递给真实的控制台。
 * @augments {Console}
 */
export class VirtualConsole extends Console {
	/**
	 * 在新的异步上下文中执行fn，并将该上下文的控制台替换为此对象。
	 * 这是通过 Node.js 的 AsyncLocalStorage 实现的。
	 * @template T
	 * @overload
	 * @param {() => T | Promise<T>} fn - 在新的异步上下文中执行的函数。
	 * @returns {Promise<T>} 返回 fn 函数的 Promise 结果。
	 */
	/**
	 * 将当前“异步上下文”中的控制台替换为此对象。
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
	/** @type {string} - 捕获的所有输出 */
	outputs = ''
	/** @type {string} - 捕获的所有输出 (HTML) */
	outputsHtml = ''

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
	 * @param {boolean} [options.supportsAnsi] - 如果为 true, 则启用 ANSI 转义序列支持。
	 * @param {function(Error): void} [options.error_handler=null] - 一个专门处理单个 Error 对象的错误处理器。
	 * @param {Console} [options.base_console=console] - 用于 realConsoleOutput 的底层控制台实例。
	 */
	constructor(options = {}) {
		super(new Writable({ /** 啥也不干  */ write: () => { } }), new Writable({ /** 啥也不干  */ write: () => { } }))

		const base_console = options.base_console || consoleReflect()
		delete options.base_console
		this.options = {
			realConsoleOutput: false,
			recordOutput: true,
			supportsAnsi: base_console.options?.supportsAnsi || supportsAnsi,
			error_handler: null,
			...options,
		}
		this.base_console = base_console
		this.freshLine = this.freshLine.bind(this)
		this.clear = this.clear.bind(this)
		for (const method of ['log', 'info', 'warn', 'debug', 'error']) {
			if (!this[method]) continue
			const originalMethod = this[method]
			/**
			 * 将控制台方法重写为捕获输出并根据配置决定是否传递给底层控制台。
			 * @param {...any} args - 控制台方法的参数。
			 * @returns {void}
			 */
			this[method] = (...args) => {
				if (method == 'error' && this.options.error_handler && args.length === 1 && args[0] instanceof Error) return this.options.error_handler(args[0])
				if (this.options.recordOutput) this.outputsHtml += argsToHtml(args) + '<br/>\n'
				if (!this.options.realConsoleOutput || this.options.recordOutput) return originalMethod.apply(this, args)
				this.#loggedFreshLineId = null
				return this.#base_console[method](...args)
			}
		}
	}

	/**
	 * 获取用于 realConsoleOutput 的底层控制台实例。
	 * @returns {Console} 底层控制台实例。
	 */
	get base_console() {
		return this.#base_console
	}

	/**
	 * 设置用于 realConsoleOutput 的底层控制台实例。
	 * @param {Console} value - 底层控制台实例。
	 * @returns {void}
	 */
	set base_console(value) {
		this.#base_console = value

		const context = {
			/**
			 * 写入完成时的回调函数，用于重置 loggedFreshLineId。
			 * @returns {void}
			 */
			onWrite: () => {
				this.#loggedFreshLineId = null
			},
			options: this.options,
			state: this
		}

		this._stdout = new VirtualStream(this.#base_console?._stdout || process.stdout, context)
		this._stderr = new VirtualStream(this.#base_console?._stderr || process.stderr, context)
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

	/**
	 * 清空捕获的输出，并选择性地清空真实控制台。
	 * @returns {void}
	 */
	clear() {
		this.#loggedFreshLineId = null
		this.outputs = ''
		this.outputsHtml = ''
		if (this.options.realConsoleOutput)
			this.#base_console.clear()
	}
}

const originalConsole = globalThis.console
/**
 * 默认的虚拟控制台实例。
 */
export const defaultConsole = new VirtualConsole({ base_console: originalConsole, recordOutput: false, realConsoleOutput: true })
/**
 * 全局控制台的附加属性。
 */
export const globalConsoleAdditionalProperties = {}
/** @type {() => VirtualConsole} */
let consoleReflect = () => consoleAsyncStorage.getStore() ?? defaultConsole
/** @type {(value: VirtualConsole) => void} */
let consoleReflectSet = (v) => consoleAsyncStorage.enterWith(v)
/**
 * @template T - fn 函数的返回类型
 * @type {(value: VirtualConsole, fn: () => T) => Promise<T>}
 */
let consoleReflectRun = (v, fn) => consoleAsyncStorage.run(v, fn)
/**
 * 设置全局控制台反射逻辑
 * @template T - fn 函数的返回类型
 * @param {(console: Console) => Console} Reflect 从默认控制台映射到新的控制台对象的函数。
 * @param {(value: Console) => void} ReflectSet 设置当前控制台对象的函数。
 * @param {(value: Console, fn: () => T) => Promise<T>} ReflectRun 在新的异步上下文中执行函数的函数。
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
 * 获取全局控制台反射逻辑
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
 * 全局控制台实例。
 */
export const console = globalThis.console = new FullProxy(() => Object.assign({}, globalConsoleAdditionalProperties, consoleReflect()), {
	/**
	 * 设置属性时的处理逻辑。
	 * @param {object} target - 目标对象。
	 * @param {string | symbol} property - 要设置的属性名。
	 * @param {any} value - 要设置的属性值。
	 * @returns {any} 属性值。
	 */
	set: (target, property, value) => {
		target = consoleReflect()
		if (property in target) return Reflect.set(target, property, value)
		globalConsoleAdditionalProperties[property] = value
		return true
	}
})
