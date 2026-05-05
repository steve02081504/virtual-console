import type { WireLogEntry } from './wire-log-entry.mjs'

export { WireLogEntry } from './wire-log-entry.mjs'

export type LogWireClientHandlers = {
	/** 未指定时使用 `supports-ansi` 包的环境检测结果。 */
	supportsAnsi?: boolean
	onSnapshot?: (entries: WireLogEntry[]) => void | Promise<void>
	onAppend?: (entry: WireLogEntry) => void | Promise<void>
	onClear?: () => void | Promise<void>
	onUnknown?: (raw: object) => void | Promise<void>
	extensionHandlers?: Record<string, (raw: object) => void | Promise<void>>
	/** JSON 解析失败，或 `dispatchLogWireMessage` 异步分发中回调抛错、reject */
	onParseError?: (error: Error, rawData: unknown) => void
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
	requestExpand: (ref: string) => Promise<unknown>
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
	requestExpand: (ref: string) => Promise<unknown>
	requestClear: () => boolean
	sendJson: (obj: object) => boolean
	detach: () => void
}
