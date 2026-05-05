import type { ArgSnapshot } from '../shared.d.mts'

export declare function makeAppendPayload(entry: unknown, index: number): {
	type: string
	entry: Record<string, unknown>
}

export declare function makeSnapshotPayload(entries: unknown[]): Record<string, unknown>

export declare function makeExpandResponse(ref: string, snapshot: ArgSnapshot): Record<string, unknown>

export declare function makeExpandErrorResponse(ref: string, error: string): Record<string, unknown>

export declare function parseClientExpandMessage(parsed: unknown): { ref: string } | null

export declare function parseClientClearMessage(parsed: unknown): Record<string, never> | null

export declare function handleClientWireMessage(
	parsed: unknown,
	handlers?: { expandSnapshotRef?: (ref: string) => { ok: boolean; snapshot?: ArgSnapshot; error?: string } }
): Record<string, unknown> | null

/** `express-ws` 等挂载用的回调，以及群发 / 遍历当前连接的扩展方法。 */
export type LogWireWebSocketHandler = ((
	ws: {
		readyState: number
		send: (data: string) => void
		on: (ev: string, fn: (...args: unknown[]) => void) => void
		close?: (code?: number, reason?: string) => void
	},
	req?: unknown
) => void) & {
	broadcastJson: (payload: object) => void
	forEachClient: (fn: (ws: {
		readyState: number
		send: (data: string) => void
		on: (ev: string, fn: (...args: unknown[]) => void) => void
		close?: (code?: number, reason?: string) => void
	}) => void) => void
	closeAllWithFinalJson: (payload: object) => Promise<void>
}

export type LogWireServerClientMessageEvent = {
	ws: unknown
	req: unknown
	message: Record<string, unknown>
	clientCount: number
}

export type LogWireServerClientMessageHandler = (
	event: LogWireServerClientMessageEvent
) => object | null | void | Promise<object | null | void>

export declare function createLogWireWebSocketHandler(
	virtualConsole: {
		outputEntries: unknown[]
		addLogEntryListener: (fn: (entry: unknown) => void) => void
		addClearListener: (fn: () => void) => void
		clear: () => void
	},
	wireOptions?: {
		onClientConnected?: (event: { ws: unknown; req: unknown; clientCount: number }) => void
		onClientDisconnected?: (event: { ws: unknown; reason: 'close' | 'error'; clientCount: number }) => void
		onClientMessage?: LogWireServerClientMessageHandler
		clientMessageHandlers?: Record<string, LogWireServerClientMessageHandler>
	}
): LogWireWebSocketHandler
