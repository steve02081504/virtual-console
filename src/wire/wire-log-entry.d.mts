import type { LogSegment } from '../shared.d.mts'

/**
 * 线路 JSON 载荷包装：仅 wire 侧提供异步 `render*`；展开 `truncated` 后与进程内 {@link LogEntry} 的 `toString` / `toPlainText` / `toHtml` 对齐（由 `segments` 渲染；无片段则空串）。
 */
export declare class WireLogEntry {
	readonly id: number | undefined
	readonly level: string | undefined
	readonly method: string | undefined
	readonly timestamp: number | undefined
	/** 当前（已展开则已展开）片段 */
	get segments(): LogSegment[]
	constructor(payload: Record<string, unknown>, wire: {
		requestExpand: (ref: string) => Promise<unknown>
		supportsAnsi?: boolean
	})
	/** 展开后终端 ANSI 串 */
	renderString(): Promise<string>
	/** 展开后纯文本 */
	renderPlain(): Promise<string>
	/** 展开后 HTML */
	renderHtml(): Promise<string>
	toJSON(): Record<string, unknown>
	static from(value: unknown, wire: {
		requestExpand: (ref: string) => Promise<unknown>
		supportsAnsi?: boolean
	}): WireLogEntry
}
