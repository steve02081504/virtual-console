import type { LogSegment, StackFrame } from '../shared.d.mts'

/**
 * 线路 JSON 载荷包装：仅 wire 侧提供异步 `render*`；展开 `truncated` 后与进程内 {@link LogEntry} 的 `toString` / `toPlainText` / `toHtml` 对齐（由 `segments` 渲染；无片段则空串）。
 */
export declare class WireLogEntry {
	readonly level: string | undefined
	readonly method: string | undefined
	readonly timestamp: number | undefined
	/** 调用栈帧数组 */
	readonly stack: StackFrame[]
	/** 是否启用 ANSI 颜色渲染 */
	supportsAnsi: boolean
	/** 日志片段数组（展开时会就地替换 truncated 占位） */
	segments: LogSegment[]
	/** 第一条带路径的栈帧，便于展示来源 */
	readonly primaryCallsite: StackFrame | null
	constructor(payload: Record<string, unknown>, wire: {
		requestExpand: (ref: string, maxDepth?: number) => Promise<unknown>
		supportsAnsi?: boolean
	})
	/** 展开后终端 ANSI 串 */
	renderString(options?: { indent?: string; maxDepth?: number }): Promise<string>
	/** 展开后纯文本 */
	renderPlain(options?: { indent?: string; maxDepth?: number }): Promise<string>
	/** 展开后 HTML */
	renderHtml(options?: { indent?: string; maxDepth?: number }): Promise<string>
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
	wire: {
		requestExpand: (ref: string, maxDepth?: number) => Promise<unknown>
		supportsAnsi?: boolean
	}
): WireLogEntry | FreshLineWireLogEntry | DirWireLogEntry | TraceWireLogEntry | StreamWireLogEntry
