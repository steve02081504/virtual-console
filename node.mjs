import { AsyncLocalStorage } from 'node:async_hooks'
import { Buffer } from 'node:buffer'
import { Console } from 'node:console'
import process from 'node:process'
import { Writable } from 'node:stream'

import ansiEscapes from 'ansi-escapes'
import { FullProxy } from 'full-proxy'
import supportsAnsi from 'supports-ansi'

import { newLogEntry, StreamLogEntry } from './src/core/entries.mjs'
import { getLogEntryArgs, unregisterExpandRefsForEntry } from './src/core/snapshot.mjs'
import { getStackInfo, trimLeadingRuntimeInternalFrames } from './src/core/stack.mjs'

/**
 * 重导出：日志条目工厂、`serializeLogEntryForWire` 与各特化条目类。
 */
export {
	newLogEntry,
	LogEntry,
	StreamLogEntry,
	DirLogEntry,
	TraceLogEntry,
	serializeLogEntryForWire,
} from './src/core/entries.mjs'

/**
 * 重导出：调用栈解析与 Node 运行时内部帧修剪。
 */
export {
	getStackInfo,
	trimLeadingRuntimeInternalFrames,
} from './src/core/stack.mjs'

/**
 * 重导出：参数快照序列化、惰性展开 ref、默认深度与条目参数存取。
 */
export {
	serializeArgSnapshot,
	expandSnapshotRef,
	DEFAULT_SNAPSHOT_DEPTH,
	unregisterExpandRefsForEntry,
	getLogEntryArgs,
} from './src/core/snapshot.mjs'

/**
 * 重导出：终端 ANSI/OSC 剥离、窗口标题序列处理与 HTML 转义。
 */
export {
	stripTerminalDecorations,
	stripOscTitleSequences,
	terminalChunkToHtml,
	coerceString,
	escapeHtml,
} from './src/format/ansi.mjs'

/**
 * 重导出：printf/流文本 → `LogSegment`、片段互转与聚合 HTML。
 */
export {
	argsToSegments,
	streamToSegments,
	segmentsToPlainText,
	segmentsToHtml,
	streamTextToHtml,
	argsToHtml,
} from './src/format/segments.mjs'

/**
 * 未被代理的标准输出/错误输出流。
 * @type {NodeJS.WritableStream}
 */
const { stdout, stderr } = process

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
	 * 包装真实 `stdout`/`stderr` Writable：写入时合并或新建流式 `LogEntry`，并可透传到底层流。
	 * @param {NodeJS.WritableStream} targetStream - 目标流。
	 * @param {string} streamName - 流名称。
	 * @param {object} context - 虚拟控制台上下文。
	 * @param {() => void} context.onWrite - 写入时的回调函数，用于重置 lastFreshLineId。
	 * @param {object} context.options - 虚拟控制台的配置选项。
	 * @param {boolean} context.options.recordOutput - 是否记录输出。
	 * @param {boolean} context.options.realConsoleOutput - 是否输出到真实控制台。
	 * @param {{ outputs: string }} context.state - 虚拟控制台的状态对象，包含 outputs 属性。
	 */
	constructor(targetStream, streamName, context) {
		super({
			/**
			 * 写入数据到虚拟流。
			 * @param {Buffer | string} chunk - 要写入的数据块。
			 * @param {string} encoding - 编码格式。
			 * @param {() => void} callback - 写入完成的回调函数。
			 */
			write: (chunk, encoding, callback) => {
				context.onWrite(chunk, encoding, streamName)

				if (context.options.recordOutput) try {
					context.state.stackFrameSkipCount++
					const text = chunk instanceof Buffer ? chunk.toString(encoding === 'buffer' ? 'utf8' : encoding) : String(chunk)
					const lastEntry = context.state.outputEntries[context.state.outputEntries.length - 1]
					if (lastEntry?.method === streamName && lastEntry instanceof StreamLogEntry) {
						lastEntry.streamText += text
						const arr = getLogEntryArgs(lastEntry)
						if (arr.length) arr[0] = lastEntry.streamText
					}
					else
						context.addEntry(streamName, [text], trimLeadingRuntimeInternalFrames(getStackInfo(context.state.stackFrameSkipCount)))
				} finally { context.state.stackFrameSkipCount-- }
				if (context.options.realConsoleOutput)
					targetStream.write(chunk, encoding, callback)
				else callback()
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

	/**
	 * 底层真实可写流（透传 TTY 能力）。
	 * @private @type {NodeJS.WritableStream}
	 */
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

	/**
	 * 获取底层目标流。
	 * @returns {NodeJS.WritableStream} 底层目标流。
	 */
	get targetStream() {
		return this.#targetStream
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
		if (fn) return runWithActiveConsole(this, fn)
		else setActiveConsole(this)
	}

	/**
	 * 采集调用栈时额外跳过的帧数；初始为 `0`。
	 * 在自定义包装函数中调用 `console.*` 时，在调用前 `+1`，`finally` 中 `-1`，
	 * 以确保 `entry.stack` 指向真正的调用方而非包装层。
	 */
	stackFrameSkipCount = 0
	/**
	 * 所有捕获输出拼接成的纯文本字符串（条目间以换行分隔）。
	 * @returns {string} 聚合文本。
	 */
	get outputs() { return this.outputEntries.join('\n') }
	/**
	 * 所有捕获输出拼接成的 HTML 字符串（可直接渲染）。
	 * @returns {string} 聚合 HTML。
	 */
	get outputsHtml() { return this.outputEntries.map(entry => entry.toHtml()).join('<br/>\n') }
	/**
	 * 结构化日志条目数组。
	 * @type {import('./src/core/entries.mjs').LogEntry[]}
	 */
	outputEntries = []

	/**
	 * 日志条目监听器集合。
	 * @private @type {Set<(entry: import('./src/core/entries.mjs').LogEntry) => void>}
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
	#base_console

	/**
	 * 包装后的标准输出流。
	 * @private @type {VirtualStream}
	 */
	#virtualStdout

	/**
	 * 包装后的标准错误流。
	 * @private @type {VirtualStream}
	 */
	#virtualStderr

	/**
	 * `freshLine` 上次使用的 id，用于 ANSI 覆盖同一行。
	 * @private @type {string | null}
	 */
	#lastFreshLineId = null

	/**
	 * 供 `VirtualStream` 写入路径共享的状态与回调。
	 * @private @type {object}
	 */
	#streamContext

	/**
	 * 创建 Node 侧虚拟控制台，并挂接 `AsyncLocalStorage` 隔离与虚拟标准流。
	 * @param {object} [options={}] - 配置选项。
	 * @param {boolean} [options.realConsoleOutput=false] - 为 true 时，捕获输出的同时也将其透传给底层控制台进行实际输出。
	 * @param {boolean} [options.recordOutput=true] - 为 false 时不记录任何条目（透传仍按配置执行）。
	 * @param {boolean} [options.supportsAnsi] - 为 true 时启用 ANSI：`freshLine` 可在 TTY 上覆盖行，`trace` 栈可含 OSC 8 超链接。未指定时自动检测；`base_console` 为 `VirtualConsole` 时继承其设置。
	 * @param {Console} [options.base_console] - `realConsoleOutput` 的透传目标。未指定时使用当前上下文的活动控制台。
	 * @param {number} [options.maxLogEntries=Infinity] - 最多保留的条目数，超出后自动丢弃最旧的条目。
	 */
	constructor(options = {}) {
		super(new Writable({ /** 啥也不干  */ write: () => { } }), new Writable({ /** 啥也不干  */ write: () => { } }))
		for (const property of ['_stdout', '_stderr'])
			delete this[property] // 因为父类的实例属性会遮蔽子类的getter/setter，所以需要删除这些字段

		const base_console = options.base_console ?? getActiveConsole()
		delete options.base_console
		this.options = {
			realConsoleOutput: false,
			recordOutput: true,
			supportsAnsi: base_console.options?.supportsAnsi ?? supportsAnsi,
			maxLogEntries: Infinity,
			...options,
		}
		this.#streamContext = {
			/**
			 * 写入发生前的回调函数，用于设置一些东西。
			 * @param {Buffer | string} chunk - 要写入的数据块。
			 * @param {string} encoding - 编码格式。
			 * @param {string} stream_name - 流名称。
			 * @returns {void}
			 */
			onWrite: (chunk, encoding, stream_name) => {
				this.#lastFreshLineId = null
			},
			/**
			 * 在流写入路径中补录一条结构化日志。
			 * @param {string} method - 目标级别，通常为 stdout/stderr。
			 * @param {any[]} args - 日志参数数组，按 LogEntry 约定存储。
			 * @param {import('./src/shared.d.mts').StackFrame[] | undefined} [stack] - 可选预采集栈；未传时由 #addEntry 自动采集。
			 * @returns {import('./src/core/entries.mjs').LogEntry} 已写入缓冲区的日志条目。
			 */
			addEntry: (method, args, stack) => this.#addEntry(method, args, stack),
			options: this.options,
			state: this
		}
		this.base_console = base_console
		for (const method of ['freshLine', 'clear', 'write_as'])
			this[method] = this[method].bind(this)
		for (const method of ['log', 'info', 'warn', 'debug', 'error', 'trace', 'dir']) {
			if (!this[method]) continue
			const originalMethod = this[method]
			/**
			 * 将控制台方法重写为捕获输出并根据配置决定是否传递给底层控制台。
			 * @param {...any} args - 控制台方法的参数。
			 * @returns {void}
			 */
			this[method] = (...args) => {
				const record = this.options.recordOutput
				try {
					if (record) {
						this.#addEntry(method, args)
						this.options.recordOutput = false // 避免stream写入时被重复记录
					}
					if (!this.options.realConsoleOutput) return originalMethod.apply(this, args)
					this.#lastFreshLineId = null
					try {
						if (this.#base_console instanceof VirtualConsole) this.#base_console.stackFrameSkipCount++
						return this.#base_console[method](...args)
					} finally {
						if (this.#base_console instanceof VirtualConsole) this.#base_console.stackFrameSkipCount--
					}
				} finally {
					if (record) this.options.recordOutput = true
				}
			}
		}
	}

	/**
	 * 创建新的日志条目。
	 * @param {string} method - 日志级别，例如 log/warn/error/stdout/stderr。
	 * @param {any[]} [args = []] - 与 console/stream 路径一致的原始参数数组。
	 * @param {import('./src/shared.d.mts').StackFrame[] | undefined} [stack] - 可选预采集调用栈；未传时按当前 skip 配置自动采集。
	 * @returns {import('./src/core/entries.mjs').LogEntry} 新的日志条目对象。
	 */
	#newLogEntry(method, args = [], stack = getStackInfo(this.stackFrameSkipCount + 2)) { // +2: #newLogEntry + caller 自身
		return newLogEntry({ method, args, stack, supportsAnsi: this.options.supportsAnsi })
	}

	/**
	 * 创建日志条目并追加到 outputEntries，自动维护上限并触发回调。
	 * @param {string} method - 日志级别，例如 log/warn/error/stdout/stderr。
	 * @param {any[]} [args = []] - 与 console/stream 路径一致的原始参数数组。
	 * @param {import('./src/shared.d.mts').StackFrame[] | undefined} [stack] - 可选预采集调用栈；未传时按当前 skip 配置自动采集。
	 * @returns {import('./src/core/entries.mjs').LogEntry} 已写入缓冲区的日志条目对象。
	 */
	#addEntry(method, args = [], stack = getStackInfo(this.stackFrameSkipCount + 2)) { // +2: #addEntry + caller 自身
		return this.#pushEntry(this.#newLogEntry(method, args, stack))
	}

	/**
	 * 将已构建的条目推入 outputEntries，维护上限并触发回调。
	 * @template {import('./src/core/entries.mjs').LogEntry} T
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
	 * @param {(entry: import('./src/core/entries.mjs').LogEntry) => void} fn - 每条结构化日志写入缓冲后同步调用；勿假设异步顺序。
	 * @returns {void}
	 */
	addLogEntryListener(fn) {
		if (fn instanceof Function) this.#logEntryListeners.add(fn)
	}

	/**
	 * 取消先前通过 {@link addLogEntryListener} 注册的回调（引用相等时才生效）。
	 * @param {(entry: import('./src/core/entries.mjs').LogEntry) => void} fn - 与注册时传入的函数同一引用。
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
		if (fn instanceof Function) this.#clearListeners.add(fn)
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
	 * 获取标准输出流。
	 * @returns {VirtualStream} 标准输出流。
	 */
	get _stdout() {
		return this.#virtualStdout
	}

	/**
	 * 设置标准输出流，自动将其包装为 VirtualStream。
	 * @param {NodeJS.WritableStream | VirtualStream} value - 要设置的流。
	 * @returns {void}
	 */
	set _stdout(value) {
		const context = this.#streamContext
		const targetStream = value?.targetStream || value || stdout
		this.#virtualStdout = new VirtualStream(targetStream, 'stdout', context)
	}

	/**
	 * 获取标准错误流。
	 * @returns {VirtualStream} 标准错误流。
	 */
	get _stderr() {
		return this.#virtualStderr
	}

	/**
	 * 设置标准错误流，自动将其包装为 VirtualStream。
	 * @param {NodeJS.WritableStream | VirtualStream} value - 要设置的流。
	 * @returns {void}
	 */
	set _stderr(value) {
		const context = this.#streamContext
		const targetStream = value?.targetStream || value || stderr
		this.#virtualStderr = new VirtualStream(targetStream, 'stderr', context)
	}

	/**
	 * 设置用于 realConsoleOutput 的底层控制台实例。
	 * @param {Console} value - 底层控制台实例。
	 * @returns {void}
	 */
	set base_console(value) {
		this.#base_console = value || globalThis.console
		this._stdout = this.#base_console?._stdout
		this._stderr = this.#base_console?._stderr
	}

	/**
	 * 获取用于 realConsoleOutput 的底层控制台实例。
	 * @returns {Console} 底层控制台实例。
	 */
	get base_console() {
		return this.#base_console
	}

	/**
	 * 打印一行进度信息。若前一次调用传入了相同的 `id`，则覆盖上一行而不是新增一行
	 * （需要 ANSI 支持；在不支持 ANSI 的环境中等同于普通 `log`）。
	 * @param {string} id - 标识可覆盖行的唯一键。
	 * @param {...any} args - 要打印的内容。
	 */
	freshLine(id, ...args) {
		if (this.options.supportsAnsi && this.#lastFreshLineId === id)
			this._stdout.write(ansiEscapes.cursorUp(1) + ansiEscapes.eraseLine)

		try {
			this.stackFrameSkipCount++ // freshLine 自身是额外一层，由 log wrapper 统一处理其余帧
			this.log(...args)
		} finally {
			this.stackFrameSkipCount--
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
		for (const e of this.outputEntries)
			unregisterExpandRefsForEntry(e)
		this.outputEntries.length = 0
		if (this.options.realConsoleOutput)
			this.#base_console.clear()
		for (const listener of this.#clearListeners) try {
			listener()
		} catch { }
	}

	/**
	 * 以指定级别记录日志，不经由 `console.*` 方法路由。
	 * 适合注入自定义级别的条目或在不触发其他副作用的情况下录入数据。
	 * 若 `realConsoleOutput` 为 true，warn/error/trace/stderr 类级别写入 stderr，其余写入 stdout。
	 * @param {string} method - 日志方法名。
	 * @param {...any} args - 要记录的内容。
	 * @returns {void}
	 */
	write_as(method, ...args) {
		const entry = this.#newLogEntry(method, args)
		if (this.options.recordOutput) this.#pushEntry(entry)
		if (this.options.realConsoleOutput)
			if (this.#base_console instanceof VirtualConsole) this.#base_console.write_as(method, ...args)
			else {
				const content = entry.toString()
				const prevRecord = this.options.recordOutput
				this.options.recordOutput = false
				try {
					if (['warn', 'error', 'trace', 'stderr'].includes(method)) return this._stderr.write(content)
					else return this._stdout.write(content)
				} finally {
					this.options.recordOutput = prevRecord
				}
			}
	}
}

const originalConsole = globalThis.console
/**
 * 始终在线的兜底控制台：不记录任何条目，直接将所有输出透传到原始全局 `console`。
 */
export const defaultConsole = new VirtualConsole({ base_console: originalConsole, recordOutput: false, realConsoleOutput: true })
/**
 * 合并到全局 `console` 代理上的附加属性对象。
 * 对 `globalThis.console` 写入未知属性时，值存储在这里，以便跨异步上下文共享自定义扩展字段。
 */
export const globalConsoleAdditionalProperties = {}
/**
 * 从 `consoleAsyncStorage` 读取当前活动控制台（无存储时回退 {@link defaultConsole}）。
 * @type {() => VirtualConsole}
 */
let getActiveConsole = () => consoleAsyncStorage.getStore() ?? defaultConsole
/**
 * 将当前异步上下文绑定到指定控制台实例（`enterWith`，无自动还原）。
 * @type {(value: VirtualConsole) => void}
 */
let setActiveConsole = (value) => consoleAsyncStorage.enterWith(value)
/**
 * 在 `consoleAsyncStorage.run` 包裹的上下文中执行回调。
 * @template T - fn 函数的返回类型
 * @type {(value: VirtualConsole, fn: () => T) => Promise<T>}
 */
let runWithActiveConsole = (value, fn) => consoleAsyncStorage.run(value, fn)
/**
 * 替换全局 `console` 代理的上下文路由逻辑。
 * @template T
 * @param {(defaultConsole: VirtualConsole) => VirtualConsole} resolveWithFallback 给定兜底值，返回当前应激活的控制台。
 * @param {(value: VirtualConsole) => void} setActive 将指定实例设为当前上下文的活动控制台。
 * @param {(value: VirtualConsole, callback: () => T) => Promise<T>} runInContext 在以指定实例为活动控制台的新上下文中执行回调。
 * @returns {void}
 */
export function setGlobalConsoleResolver(resolveWithFallback, setActive, runInContext) {
	/**
	 * 当前异步/全局上下文中应接收 `console` 调用的实例
	 * @returns {VirtualConsole} 当前异步上下文中应接收 `console` 调用的实例
	 */
	getActiveConsole = () => resolveWithFallback(defaultConsole)
	setActiveConsole = setActive
	runWithActiveConsole = runInContext
}
/**
 * 读取当前的全局 `console` 代理路由逻辑。
 * @returns {{ getActiveConsole: () => VirtualConsole, setActiveConsole: (value: VirtualConsole) => void, runWithActiveConsole: <T>(value: VirtualConsole, fn: () => T) => Promise<T> }} 当前生效的三段回调，可与 {@link setGlobalConsoleResolver} 配合替换或观测。
 */
export function getGlobalConsoleResolver() {
	return {
		getActiveConsole,
		setActiveConsole,
		runWithActiveConsole,
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
 * 全局控制台实例。
 */
export const console = globalThis.console = new FullProxy(() => Object.assign(proxyBase, globalConsoleAdditionalProperties, getActiveConsole()), {
	/**
	 * 设置属性时的处理逻辑。
	 * @param {object} target - 目标对象。
	 * @param {string | symbol} property - 要设置的属性名。
	 * @param {any} value - 要设置的属性值。
	 * @returns {any} 属性值。
	 */
	set: (target, property, value) => {
		target = getActiveConsole()
		if (property in target) return Reflect.set(target, property, value)
		globalConsoleAdditionalProperties[property] = value
		return true
	}
})
/**
 * 重定向 process.stdout 到当前全局控制台的 stdout。
 */
Object.defineProperty(process, 'stdout', {
	/**
	 * 返回当前异步上下文绑定的虚拟 stdout。
	 * @returns {VirtualStream} 当前上下文中的虚拟标准输出流。
	 */
	get: () => getActiveConsole()._stdout,
	configurable: true,
})
/**
 * 重定向 process.stderr 到当前全局控制台的 stderr。
 */
Object.defineProperty(process, 'stderr', {
	/**
	 * 返回当前异步上下文绑定的虚拟 stderr。
	 * @returns {VirtualStream} 当前上下文中的虚拟标准错误流。
	 */
	get: () => getActiveConsole()._stderr,
	configurable: true,
})
