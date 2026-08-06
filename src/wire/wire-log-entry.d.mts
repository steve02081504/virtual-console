import type { LogSegment, StackFrame } from '../shared.d.mts'

/** 线路 JSON 单条载荷（字段均可缺省；渲染前通常需有 `segments`）。 */
export interface WireLogEntryPayload {
	level?: string
	method?: string
	timestamp?: number
	id?: string | number
	segments?: LogSegment[]
	stack?: StackFrame[]
}

/** 展开与 ANSI 开关上下文。 */
export interface WireContext {
	requestExpand: (ref: string, maxDepth?: number) => Promise<unknown>
	supportsAnsi?: boolean
}

/** `render*` 选项。 */
export interface WireRenderOptions {
	indent?: string
	maxDepth?: number
}

/**
 * 线路 JSON 载荷包装：仅 wire 侧提供异步 `render*`；展开 `truncated` 后与进程内 {@link LogEntry} 的 `toString` / `toPlainText` / `toHtml` 对齐（由 `segments` 渲染；无片段则空串）。
 */
export declare class WireLogEntry {
	readonly level: string | undefined
	readonly method: string | undefined
	readonly timestamp: number | undefined
	/** 调用栈帧数组（载荷未带时为 `undefined`） */
	readonly stack: StackFrame[] | undefined
	/** 是否启用 ANSI 颜色渲染 */
	supportsAnsi: boolean
	/** 日志片段数组（展开时会就地替换 truncated 占位；载荷未带时为 `undefined`） */
	segments: LogSegment[] | undefined
	/** 展示来源：优先片段中首个 Error 的栈帧，否则为捕获调用栈中第一条 */
	readonly primaryCallsite: StackFrame | null
	constructor(payload: WireLogEntryPayload | Record<string, unknown>, wire: WireContext)
	/** 展开后终端 ANSI 串 */
	renderString(options?: WireRenderOptions): Promise<string>
	/** 展开后纯文本 */
	renderPlain(options?: WireRenderOptions): Promise<string>
	/** 展开后 HTML */
	renderHtml(options?: WireRenderOptions): Promise<string>
	toJSON(): Record<string, unknown>
}

export declare class FreshLineWireLogEntry extends WireLogEntry {
	readonly method: 'freshLine'
	readonly id: string
}

export declare class DirWireLogEntry extends WireLogEntry {
	readonly method: 'dir'
}

export declare class TraceWireLogEntry extends WireLogEntry {
	readonly method: 'trace'
}

export declare class StreamWireLogEntry extends WireLogEntry {
	readonly method: 'stdout' | 'stderr'
}

export declare function createWireLogEntryFromJson(
	json: unknown,
	wire: WireContext
): WireLogEntry | FreshLineWireLogEntry | DirWireLogEntry | TraceWireLogEntry | StreamWireLogEntry
