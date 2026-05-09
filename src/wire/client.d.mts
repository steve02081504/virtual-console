import type {
	WireLogEntry,
	FreshLineWireLogEntry,
	DirWireLogEntry,
	TraceWireLogEntry,
	StreamWireLogEntry,
} from './wire-log-entry.mjs'

export { WireLogEntry } from './wire-log-entry.mjs'
export { createWireLogEntryFromJson } from './wire-log-entry.mjs'

export type AnyWireLogEntry =
	| WireLogEntry
	| FreshLineWireLogEntry
	| DirWireLogEntry
	| TraceWireLogEntry
	| StreamWireLogEntry

export type LogWireClientHandlers = {
	/** 未指定时使用 `supports-ansi` 包的环境检测结果。 */
	supportsAnsi?: boolean
	onSnapshot?: (entries: AnyWireLogEntry[]) => void | Promise<void>
	onAppend?: (entry: AnyWireLogEntry) => void | Promise<void>
	onClear?: () => void | Promise<void>
	onUnknown?: (raw: object) => void | Promise<void>
	extensionHandlers?: Record<string, (raw: object) => void | Promise<void>>
	/** 仅在 JSON 解析失败时调用。 */
	onParseError?: (error: Error, rawData: unknown) => void
	/** 协议分发或业务回调抛错时调用。 */
	onDispatchError?: (error: Error, payload: unknown) => void
	/** 致命错误兜底（未提供对应特化处理器时回退）。 */
	onFatal?: (error: Error, payload: unknown) => void
	onOpen?: (event: Event) => void
	onClose?: (event: CloseEvent) => void
	onError?: (event: Event) => void
}

export declare function connectLogWire(
	url: string | URL,
	options?: LogWireClientHandlers & { protocols?: string | string[] }
): {
	ws: WebSocket
	close: (code?: number, reason?: string) => void
	requestExpand: (ref: string, maxDepth?: number) => Promise<unknown>
	requestClear: () => boolean
	sendJson: (obj: object) => boolean
	detach: () => void
}

export declare function attachLogWire(
	ws: WebSocket,
	handlers?: LogWireClientHandlers
): {
	ws: WebSocket
	close: (code?: number, reason?: string) => void
	requestExpand: (ref: string, maxDepth?: number) => Promise<unknown>
	requestClear: () => boolean
	sendJson: (obj: object) => boolean
	detach: () => void
}
