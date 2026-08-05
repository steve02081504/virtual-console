/**
 * Node / 浏览器共用的 VirtualConsole 管线：
 * `#dispatch` →（裸跳 | 无栈条目直出 | `#capture` → `#ingest` → `#emit`）。
 *
 * 跨实例访问私有方法要求同一运行时只实例化一次本 mixin（Node / 浏览器入口各自一份）。
 */

import { newLogEntry } from '../../core/entries/index.mjs'

import {
	BOUND_INSTANCE_METHODS,
	CONSOLE_CALL_STACK_SKIP,
	PASSTHROUGH_CONSOLE_METHODS,
	PLATFORM_EMITTED_METHODS,
	RECORDABLE_CONSOLE_METHODS,
	STREAM_WRITE_STACK_SKIP,
} from './console-methods.mjs'

/** 区分 VirtualConsole 与原生 Console：Node 的 `Console[Symbol.hasInstance]` 会对任意 console 返回 true。 */
export const VIRTUAL_CONSOLE_BRAND = Symbol('virtualConsole')

/**
 * 判断值是否为经 {@link VIRTUAL_CONSOLE_BRAND} 标记的本库 VirtualConsole 实例。
 * @param {unknown} value - 待检测对象。
 * @returns {boolean} 为本库 VirtualConsole 时为 `true`。
 */
export function isVirtualConsole(value) {
	return value?.[VIRTUAL_CONSOLE_BRAND] === true
}

/**
 * @typedef {object} VirtualConsolePlatform
 * @property {{ runWithActiveConsole: Function, setActiveConsole: Function, resolveActiveConsole: Function }} routing - 活动控制台路由。
 * @property {(entry: import('../../core/entries/log-entry.mjs').LogEntry, options: { baseConsole: object, supportsAnsi: boolean, lastFreshLineId: string | null }) => void} emitNative - 原生输出。
 * @property {(streamName: 'stdout' | 'stderr', onWrite: Function) => object} [createStream] - Node 虚拟流工厂。
 * @property {(streamName: 'stdout' | 'stderr', chunk: any, encoding: string, callback: Function) => void} [writeNativeChunk] - Node 原生流写入。
 */

/**
 * @param {typeof Object} [Base=Object] - 基类（Node 传入 `Console`）。
 * @param {VirtualConsolePlatform} platform - 平台描述符（闭包捕获；每运行时一份）。
 * @returns {typeof Object} VirtualConsole 混合类。
 */
export function VirtualConsoleMixin(Base = Object, platform) {
	return class VirtualConsoleBase extends Base {
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
		 * @type {import('../../core/entries/log-entry.mjs').LogEntry[]}
		 */
		outputEntries = []

		/**
		 * 日志条目监听器集合。
		 * @type {Set<(entry: import('../../core/entries/log-entry.mjs').LogEntry) => void>}
		 */
		#logEntryListeners = new Set()

		/**
		 * 缓冲清空后触发的监听器。
		 * @type {Set<() => void>}
		 */
		#clearListeners = new Set()

		/**
		 * `block()` 嵌套深度；大于 0 时暂缓实际输出。
		 * @type {number}
		 */
		#blockDepth = 0

		/**
		 * block 期间延后的输出回调。
		 * @type {(() => void)[]}
		 */
		#pendingOutput = []

		/**
		 * `freshLine` 上次使用的 id，用于 ANSI 覆盖同一行。
		 * @type {string | null}
		 */
		#lastFreshLineId = null

		/**
		 * @type {object | undefined}
		 */
		#virtualStdout

		/**
		 * @type {object | undefined}
		 */
		#virtualStderr

		/**
		 * 最终合并后的配置项。
		 * @type {object}
		 */
		options

		/**
		 * `realConsoleOutput` 的透传目标。
		 * @type {object}
		 */
		#baseConsole

		/**
		 * 采集调用栈时额外跳过的帧数；初始为 `0`。
		 * 以**被调用的那个 console**为准，下游透传层的值不参与。
		 * @type {number}
		 */
		stackFrameSkipCount = 0

		/**
		 * @param {object} [options={}] - 须含已解析的 `baseConsole`。
		 * @param {...any} baseArgs - 传给 `Base` 构造函数的参数。
		 */
		constructor(options = {}, ...baseArgs) {
			super(...baseArgs)
			this[VIRTUAL_CONSOLE_BRAND] = true
			const { baseConsole, ...rest } = options
			this.#baseConsole = baseConsole
			this.options = {
				realConsoleOutput: false,
				recordOutput: true,
				supportsAnsi: false,
				maxLogEntries: Infinity,
				...rest,
			}

			for (const method of BOUND_INSTANCE_METHODS)
				this[method] = this[method].bind(this)

			for (const method of RECORDABLE_CONSOLE_METHODS)
				/**
				 * 按需捕获 `method` 调用并走管线。
				 * @param {...any} args - 原生日志方法参数。
				 * @returns {void}
				 */
				this[method] = (...args) => this.#dispatch(method, args)

			for (const method of PASSTHROUGH_CONSOLE_METHODS) {
				if (Base.prototype[method] instanceof Function) continue
				if (!(this.#baseConsole[method] instanceof Function)) continue
				/**
				 * 在 `realConsoleOutput` 开启时透传到 `baseConsole`。
				 * @param {...any} args - 原生日志方法参数。
				 * @returns {void}
				 */
				this[method] = (...args) => {
					if (!this.options.realConsoleOutput) return
					this.#baseConsole[method](...args)
				}
			}
		}

		/**
		 * @returns {object} 透传目标控制台。
		 */
		get baseConsole() {
			return this.#baseConsole
		}

		/**
		 * @param {object} value - 新的透传目标。
		 * @returns {void}
		 */
		set baseConsole(value) {
			this.#baseConsole = value
		}

		/**
		 * 是否处于 block 状态（嵌套深度大于 0）。
		 * @returns {boolean} `block` 嵌套深度大于 0 时为 `true`。
		 */
		get blocked() {
			return this.#blockDepth > 0
		}

		/**
		 * 本层是否需要构造带栈的 LogEntry（记录，或 block 期间延后输出需冻结当时栈/时间戳）。
		 * @returns {boolean} `recordOutput` 或 `blocked && realConsoleOutput` 时为 `true`。
		 */
		get #needsEntry() {
			return this.options.recordOutput || (this.blocked && this.options.realConsoleOutput)
		}

		/** @returns {object} 捕获并可选转发的标准输出虚拟流。 */
		get _stdout() {
			return this.#virtualStdout ??= platform.createStream(
				'stdout',
				(chunk, encoding, callback) => this.#ingestChunk('stdout', chunk, encoding, callback),
			)
		}

		/** @returns {object} 捕获并可选转发的标准错误虚拟流。 */
		get _stderr() {
			return this.#virtualStderr ??= platform.createStream(
				'stderr',
				(chunk, encoding, callback) => this.#ingestChunk('stderr', chunk, encoding, callback),
			)
		}

		/**
		 * 进入 block：记录与监听照常，实际输出入队延后；可重入。
		 * @returns {void}
		 */
		block() {
			this.#blockDepth++
		}

		/**
		 * 退出一层 block；深度归零时按序执行待输出回调并恢复长度限制。
		 * 深度已为 0 时再调用为未定义行为：实现上幂等（空重放 + 裁剪）。
		 * @returns {void}
		 */
		unblock() {
			if (this.#blockDepth && --this.#blockDepth) return
			for (const callback of this.#pendingOutput.splice(0))
				callback()
			this.#trimEntries()
		}

		/**
		 * block 期间将输出回调入队；否则立即执行。
		 * @param {() => void} callback - 输出回调。
		 * @returns {void}
		 */
		#defer(callback) {
			if (this.blocked) this.#pendingOutput.push(callback)
			else callback()
		}

		/**
		 * 入口分发：需要时捕获带栈条目；否则裸跳到下一层或无栈条目直出。
		 * @param {string} method - 方法名。
		 * @param {any[]} args - 原始参数。
		 * @param {number} [skipFrames] - 采栈时跳过的顶行数（含常量偏移）。
		 * @returns {void}
		 */
		#dispatch(method, args, skipFrames = this.stackFrameSkipCount + CONSOLE_CALL_STACK_SKIP) {
			if (!this.#needsEntry) {
				if (!this.options.realConsoleOutput) return
				if (isVirtualConsole(this.#baseConsole))
					return this.#baseConsole.#dispatch(method, args, skipFrames + 1)
				if (PLATFORM_EMITTED_METHODS.includes(method) || this.#baseConsole[method] instanceof Function)
					return this.#emit(newLogEntry({ method, args, supportsAnsi: this.options.supportsAnsi }))
			}
			this.#ingest(this.#capture(method, args, skipFrames))
		}

		/**
		 * 构造带惰性栈的日志条目（持有 Error，读时解析）。
		 * @param {string} method - 方法名。
		 * @param {any[]} args - 原始参数。
		 * @param {number} skipFrames - 解析时跳过的顶行数。
		 * @returns {import('../../core/entries/log-entry.mjs').LogEntry} 含 `stackSource`、尚未解析栈的条目。
		 */
		#capture(method, args, skipFrames) {
			return newLogEntry({
				method,
				args,
				stackSource: new Error(),
				skipFrames,
				supportsAnsi: this.options.supportsAnsi,
			})
		}

		/**
		 * 记录一条已构造的条目（push → 非 block 时 trim → 通知监听器）。
		 * @param {import('../../core/entries/log-entry.mjs').LogEntry} entry - 日志条目。
		 * @returns {void}
		 */
		#record(entry) {
			if (!this.options.recordOutput) return
			this.outputEntries.push(entry)
			if (!this.blocked) this.#trimEntries()
			for (const listener of this.#logEntryListeners) try {
				listener(entry)
			} catch { /* 监听器异常不影响管线 */ }
		}

		/**
		 * 在 `realConsoleOutput` 开启时输出条目（经 `#defer`）。
		 * @param {import('../../core/entries/log-entry.mjs').LogEntry} entry - 日志条目。
		 * @returns {void}
		 */
		#output(entry) {
			if (this.options.realConsoleOutput)
				this.#defer(() => this.#emit(entry))
		}

		/**
		 * 记录并输出一条已构造的条目。
		 * @param {import('../../core/entries/log-entry.mjs').LogEntry} entry - 日志条目。
		 * @returns {void}
		 */
		#ingest(entry) {
			this.#record(entry)
			this.#output(entry)
		}

		/**
		 * 超出 `maxLogEntries` 时丢弃最旧条目。
		 * @returns {void}
		 */
		#trimEntries() {
			while (this.outputEntries.length > this.options.maxLogEntries)
				this.outputEntries.shift()
		}

		/**
		 * 将条目输出到 `baseConsole`（VC 则共享同一 entry 继续 ingest；否则原生输出）。
		 * @param {import('../../core/entries/log-entry.mjs').LogEntry} entry - 待输出条目。
		 * @returns {void}
		 */
		#emit(entry) {
			if (isVirtualConsole(this.#baseConsole))
				return this.#baseConsole.#ingest(entry)
			const lastFreshLineId = this.#lastFreshLineId
			this.#lastFreshLineId = entry.id ?? null
			platform.emitNative(entry, {
				baseConsole: this.#baseConsole,
				supportsAnsi: this.options.supportsAnsi,
				lastFreshLineId,
			})
		}

		/**
		 * 流写入：需要时才解码/捕获；否则透传原始 chunk。
		 * @param {'stdout' | 'stderr'} streamName - 来源流名。
		 * @param {any} chunk - 写入的数据块。
		 * @param {string} encoding - 编码名。
		 * @param {(error?: Error | null) => void} callback - 写入完成回调。
		 * @param {number} [skipFrames] - 采栈时跳过的顶行数。
		 * @returns {void}
		 */
		#ingestChunk(
			streamName,
			chunk,
			encoding,
			callback,
			skipFrames = this.stackFrameSkipCount + STREAM_WRITE_STACK_SKIP,
		) {
			this.#lastFreshLineId = null
			if (!this.#needsEntry) {
				if (!this.options.realConsoleOutput) return callback()
				if (isVirtualConsole(this.#baseConsole))
					return this.#baseConsole.#ingestChunk(streamName, chunk, encoding, callback, skipFrames + 1)
				return platform.writeNativeChunk(streamName, chunk, encoding, callback)
			}
			const text = chunk.toString(encoding === 'buffer' ? 'utf8' : encoding)
			const entry = this.#capture(streamName, [text], skipFrames)
			this.#record(entry)
			if (!this.options.realConsoleOutput) return callback()
			if (this.blocked) {
				this.#pendingOutput.push(() => this.#emit(entry))
				return callback()
			}
			if (isVirtualConsole(this.#baseConsole)) {
				this.#baseConsole.#ingest(entry)
				return callback()
			}
			return platform.writeNativeChunk(streamName, chunk, encoding, callback)
		}

		/**
		 * 在新的异步上下文中执行 callback，或将当前上下文绑到此实例。
		 * @template T
		 * @param {(() => T | Promise<T>) | undefined} [callback] - 回调；省略时仅设置活动控制台。
		 * @returns {Promise<T> | void} 有 `callback` 时返回其 Promise/结果，否则为 `void`。
		 */
		hookAsyncContext(callback) {
			if (callback) return platform.routing.runWithActiveConsole(this, callback)
			platform.routing.setActiveConsole(this)
		}

		/**
		 * @param {(entry: import('../../core/entries/log-entry.mjs').LogEntry) => void} listener - 新条目回调。
		 * @returns {void}
		 */
		addLogEntryListener(listener) {
			this.#logEntryListeners.add(listener)
		}

		/**
		 * @param {(entry: import('../../core/entries/log-entry.mjs').LogEntry) => void} listener - 待移除的回调。
		 * @returns {void}
		 */
		removeLogEntryListener(listener) {
			this.#logEntryListeners.delete(listener)
		}

		/**
		 * @param {() => void} listener - `clear()` 触发时的回调。
		 * @returns {void}
		 */
		addClearListener(listener) {
			this.#clearListeners.add(listener)
		}

		/**
		 * @param {() => void} listener - 待移除的 `clear` 回调。
		 * @returns {void}
		 */
		removeClearListener(listener) {
			this.#clearListeners.delete(listener)
		}

		/**
		 * @param {string} id - 可覆盖行 id。
		 * @param {...any} args - 打印内容。
		 * @returns {void}
		 */
		freshLine(id, ...args) {
			this.#dispatch('freshLine', [id, ...args])
		}

		/**
		 * @returns {void}
		 */
		clear() {
			this.outputEntries.length = 0
			this.#lastFreshLineId = null
			if (this.options.realConsoleOutput)
				this.#defer(() => this.#baseConsole.clear())
			for (const listener of this.#clearListeners) try {
				listener()
			} catch { /* 监听器异常不影响管线 */ }
		}

		/**
		 * @param {string} method - 日志方法名。
		 * @param {...any} args - 内容。
		 * @returns {void}
		 */
		writeAs(method, ...args) {
			this.#dispatch(method, args)
		}
	}
}
