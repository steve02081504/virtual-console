export type LogWireClientHandlers = {
	onSnapshot?: (payload: {
		entries: unknown
		metadata: Record<string, unknown>
		raw: object
	}) => void
	onAppend?: (payload: { entry: unknown; raw: object }) => void
	onClear?: (payload: { raw: object }) => void
	onUnknown?: (raw: object) => void
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

export declare function attachLogWireWebSocket(
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

