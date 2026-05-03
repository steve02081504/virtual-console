import { circularToString, stripTerminalDecorations } from '../format/ansi.mjs'
import {
	argsToHtml,
	argsToSegments,
	formatArgs,
	segmentsToHtml,
	streamTextToHtml,
	streamToSegments,
} from '../format/segments.mjs'

import {
	DEFAULT_SNAPSHOT_DEPTH,
	getLogEntryArgs,
	makeExpandCtx,
	serializeArgSnapshot,
	setLogEntryArgs,
} from './snapshot.mjs'
import { getStackInfo, pathToFileURL } from './stack.mjs'

/**
 * 将 console 方法名转换为语义级别。
 * @param {string} methodName - console 方法名。
 * @returns {string} 语义级别。
 */
export function methodNameToLevel(methodName) {
	return {
		dir: 'log',
		trace: 'debug',
		stdout: 'log',
		stderr: 'error',
	}[methodName] ?? methodName
}

/**
 * 单条日志条目，包含级别、方法名、参数、调用栈和时间戳。
 * 在 Node.js 和浏览器中均可使用。
 * 调用栈由 VirtualConsole#addEntry 负责采集，此处默认为空数组。
 */
export class LogEntry {
	/**
	 * 构造一条通用日志条目（级别由 `methodNameToLevel` 推导）。
	 * @param {object} options - 日志条目选项。
	 * @param {string} options.method - 日志方法名。
	 * @param {any[]} options.args - 日志参数（WeakMap 存储）。
	 * @param {ReturnType<typeof getStackInfo>} options.stack - 调用栈。
	 * @param {number} options.timestamp - 日志时间戳（默认 Date.now()）。
	 * @param {boolean} options.supportsAnsi - 是否支持 ANSI 序列。
	 */
	constructor({ method, args = [], stack = [], timestamp = Date.now(), supportsAnsi = false }) {
		this.level = methodNameToLevel(method)
		/**
		 * 原始 console / 流方法名。
		 * @type {string}
		 */
		this.method = method
		setLogEntryArgs(this, args)
		/**
		 * 调用栈帧列表。
		 * @type {ReturnType<typeof getStackInfo>}
		 */
		this.stack = stack
		/**
		 * Unix 毫秒时间戳。
		 * @type {number}
		 */
		this.timestamp = timestamp
		/**
		 * 是否允许在 `toString`/`toSegments` 中输出 ANSI。
		 * @type {boolean}
		 */
		this.supportsAnsi = supportsAnsi
	}
	/**
	 * 第一条带 `filePath` 的栈帧，便于定位来源。
	 * @returns {import('../shared.d.mts').StackFrame | null} 首个含 `filePath` 的帧；栈为空或无路径时为 `null`。
	 */
	get primaryCallsite() {
		return this.stack?.find(f => f?.filePath) ?? null
	}
	/**
	 * 剥除 ANSI/OSC 后的纯文本（可用于展示、过滤、搜索；基于 `toString()`）。
	 * @returns {string} 无转义序列的可搜索文本。
	 */
	get plainText() { return stripTerminalDecorations(this.toString()) }
	/**
	 * Node.js `stdout`/`stderr` 捕获：按 `\\n` 拆分的逻辑行（不含完整终端仿真）。
	 * 非流式条目为 `undefined`。
	 * @returns {string[] | undefined} 流式条目返回各行字符串数组；其它级别为 `undefined`。
	 */
	get lines() {
		if (this.method !== 'stdout' && this.method !== 'stderr') return undefined
		const lineSource = 'streamText' in this && typeof this.streamText === 'string'
			? this.streamText
			: getLogEntryArgs(this)[0]
		return typeof lineSource === 'string' ? lineSource.split('\n') : []
	}
	/**
	 * 与原生 `console.*` 对齐的纯文本表示（含 `%` 格式化与样式）。
	 * @returns {string} 按 console 语义格式化后的纯文本日志内容。
	 */
	toString() { return formatArgs(getLogEntryArgs(this), { colorize: this.supportsAnsi }) }
	/**
	 * 与 `toString()` 对应的 HTML（剥离 OSC 窗口标题，OSC8→`<a>`）。
	 * @returns {string} 按 console 语义格式化后的 HTML（含剥标题 OSC、OSC8→链接；可直接插入 DOM）。
	 */
	toHtml() { return argsToHtml(getLogEntryArgs(this)) }
	/**
	 * 将各参数序列化为可 JSON 传输的快照树。
	 * @param {number} [maxDepth=DEFAULT_SNAPSHOT_DEPTH] - 参数快照最大深度（不产生可展开 ref）。
	 * @returns {object[]} 各参数的 JSON 化快照对象数组。
	 */
	serializeArgs(maxDepth = DEFAULT_SNAPSHOT_DEPTH) {
		return getLogEntryArgs(this).map(arg => serializeArgSnapshot(arg, new WeakSet(), 0, maxDepth, null))
	}
	/**
	 * printf / 多参数展开后的结构化片段，供前端映射 DOM。
	 * @returns {import('../shared.d.mts').LogSegment[]} 片段数组。
	 */
	toSegments() {
		return argsToSegments(getLogEntryArgs(this), { supportsAnsi: this.supportsAnsi, entry: this })
	}
}

/**
 * `process.stdout` / `process.stderr` 捕获：单参数为原始字节串，不按 printf 解析。
 */
export class StreamLogEntry extends LogEntry {
	/**
	 * 构造 stdout/stderr 捕获条目；首参为合并后的原始流文本。
	 * @param {object} options - 同 {@link LogEntry}，`args[0]` 为原始流字符串。
	 */
	constructor(options) {
		const text = String(options.args?.[0] ?? '')
		super({ ...options, args: [text] })
		/**
		 * 合并后的原始流字符串（不经 printf）。
		 * @type {string}
		 */
		this.streamText = text
	}
	/**
	 * 返回原始合并流文本。
	 * @returns {string} 原始合并流文本，不经 printf 解析。
	 */
	toString() { return this.streamText }
	/**
	 * 将流文本转为 HTML（ANSI / 链接片段）。
	 * @returns {string} 将流文本经 ANSI→HTML 转换后的片段拼接结果。
	 */
	toHtml() { return streamTextToHtml(this.streamText) }
	/**
	 * 单参数（整段流文本）的快照数组。
	 * @param {number} [maxDepth=DEFAULT_SNAPSHOT_DEPTH] - 单参数快照的最大递归深度。
	 * @returns {object[]} 仅含一个元素：流字符串的快照树。
	 */
	serializeArgs(maxDepth = DEFAULT_SNAPSHOT_DEPTH) {
		return [serializeArgSnapshot(this.streamText, new WeakSet(), 0, maxDepth, null)]
	}
	/**
	 * 将流文本拆成 `ansi` / `link` 等片段。
	 * @returns {import('../shared.d.mts').LogSegment[]} ANSI / OSC8 链接拆分后的片段列表。
	 */
	toSegments() { return streamToSegments(this.streamText) }
}

/**
 * console.dir() 产生的特化日志条目。
 * toString/toHtml 会在参数内容之后追加格式化后的对象内容。
 */
export class DirLogEntry extends LogEntry {
	/**
	 * 构造 `console.dir` 专用条目。
	 * @param {object} options - 构造选项，字段语义与 {@link LogEntry} 构造函数一致。
	 * @param {string} options.method - 应为 `"dir"`。
	 * @param {any[]} options.args - `console.dir` 的原始参数。
	 * @param {ReturnType<typeof getStackInfo>} [options.stack] - 调用栈。
	 * @param {number} [options.timestamp] - 记录时间戳。
	 * @param {boolean} [options.supportsAnsi] - 是否启用 ANSI。
	 */
	constructor(options) {
		super(options)
	}
	/**
	 * `circularToString` 风格的对象检视文本。
	 * @returns {string} `circularToString` 风格的对象检视文本（含颜色选项时可能含 ANSI）。
	 */
	toString() {
		const [subject, dirOpts] = getLogEntryArgs(this)
		return circularToString(subject, {
			depth: dirOpts?.depth ?? DEFAULT_SNAPSHOT_DEPTH,
			colorize: dirOpts?.colors ?? this.supportsAnsi
		})
	}
	/**
	 * 与 `toString()` 对应的 HTML（无 ANSI 着色路径下的对象检视）。
	 * @returns {string} 与 `toString()` 对应的 HTML（含 OSC 标题剔除、OSC8 链接化）。
	 */
	toHtml() {
		const [subject, dirOpts] = getLogEntryArgs(this)
		return streamTextToHtml(circularToString(subject, {
			depth: dirOpts?.depth ?? DEFAULT_SNAPSHOT_DEPTH,
			colorize: false,
		}))
	}
	/**
	 * 单段 `kind: 'dir'` 片段，含对象快照与可选 `dirOptions`。
	 * @returns {import('../shared.d.mts').LogSegment[]} 片段数组。
	 */
	toSegments() {
		const [subject, dirOpts] = getLogEntryArgs(this)
		const expandCtx = makeExpandCtx(this)
		return [{
			kind: 'dir',
			snapshot: serializeArgSnapshot(subject, new WeakSet(), 0, DEFAULT_SNAPSHOT_DEPTH, expandCtx),
			dirOptions: dirOpts !== undefined ? serializeArgSnapshot(dirOpts, new WeakSet(), 0, DEFAULT_SNAPSHOT_DEPTH, null) : undefined,
		}]
	}
}

/**
 * console.trace() 产生的特化日志条目。
 * toString/toHtml 会在参数内容之后追加格式化的调用栈，
 * 以便还原出与原生 console.trace 相似的完整输出。
 */
export class TraceLogEntry extends LogEntry {
	/**
	 * 构造 `console.trace` 专用条目。
	 * @param {object} options - 构造选项，字段语义与 {@link LogEntry} 构造函数一致。
	 * @param {string} options.method - 应为 `"trace"`。
	 * @param {any[]} options.args - `console.trace` 的原始参数。
	 * @param {ReturnType<typeof getStackInfo>} [options.stack] - 调用栈。
	 * @param {number} [options.timestamp] - 记录时间戳。
	 * @param {boolean} [options.supportsAnsi] - 是否启用 ANSI（控制 `toString()` 是否嵌入 OSC 8 链接）。
	 */
	constructor(options) {
		super(options)
	}
	/**
	 * 将业务参数文本与格式化栈文本拼接后输出。
	 * @returns {string} 可能含超链接转义序列的 trace 输出。
	 */
	toString() {
		const label = super.toString()
		const stackText = this.stack.map(frame => {
			if (this.supportsAnsi && frame.filePath && frame.line > 0) {
				const url = `${pathToFileURL(frame.filePath)}:${frame.line}:${frame.column}`
				return `\x1b]8;;${url}\x07${frame.raw}\x1b]8;;\x07`
			}
			return frame.raw
		}).join('\n')
		return (label ? label + '\n' : '') + stackText
	}
	/**
	 * 追加灰色栈信息块后的 HTML trace 输出。
	 * @returns {string} 含可点击文件链接的 HTML trace 输出。
	 */
	toHtml() {
		return segmentsToHtml(this.toSegments()).trim().replaceAll('\n', '<br/>\n')
	}
	/**
	 * 参数片段后接 `kind: 'traceStack'` 的栈帧列表。
	 * @returns {import('../shared.d.mts').LogSegment[]} 消息片段后接 `traceStack` 栈帧列表。
	 */
	toSegments() {
		return [
			...argsToSegments(getLogEntryArgs(this), { supportsAnsi: this.supportsAnsi, entry: this }),
			{
				kind: 'traceStack', frames: this.stack.map(frame => ({
					functionName: frame.functionName,
					filePath: frame.filePath,
					line: frame.line,
					column: frame.column,
					raw: frame.raw,
				}))
			},
		]
	}
}

/**
 * 根据 `method` 构造对应的 {@link LogEntry}（含 `dir` / `trace` 特化子类）。
 * @param {object} options - 日志条目构造选项。
 * @param {string} options.method - `console` 方法名或 Node 流级别（如 `stdout`）。
 * @param {any[]} options.args - 原始参数数组。
 * @param {ReturnType<typeof getStackInfo>} [options.stack] - 预采集调用栈。
 * @param {number} [options.timestamp] - Unix 毫秒时间戳。
 * @param {boolean} [options.supportsAnsi] - 是否允许 ANSI 序列。
 * @returns {LogEntry} `DirLogEntry`、`TraceLogEntry` 或普通 `LogEntry` 实例。
 */
export function newLogEntry(options) {
	switch (options.method) {
		case 'dir': return new DirLogEntry(options)
		case 'trace': return new TraceLogEntry(options)
		case 'stdout':
		case 'stderr':
			return new StreamLogEntry(options)
		default: return new LogEntry(options)
	}
}

/**
 * 线路/DTO 序列化（不含原始 `args`，仅 `segments` / `plainText` 等）。
 * @param {LogEntry} entry - 已捕获的单条日志实例。
 * @param {number} index - 列表序号（作为下行 JSON 中的稳定 `id`）。
 * @returns {object} 可 `JSON.stringify` 后经由 WebSocket 发送的扁平条目。
 */
export function serializeLogEntryForWire(entry, index) {
	const callsite = entry.primaryCallsite
	return {
		id: index,
		level: entry.level,
		method: entry.method,
		timestamp: entry.timestamp,
		plainText: entry.plainText,
		segments: entry.toSegments(),
		callsite: callsite ? {
			functionName: callsite.functionName,
			filePath: callsite.filePath,
			line: callsite.line,
			column: callsite.column,
			raw: callsite.raw,
		} : null,
	}
}
