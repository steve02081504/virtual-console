export declare const logWirePayloadTypes: Readonly<{
	SNAPSHOT: 'vc_log_snapshot'
	APPEND: 'vc_log_append'
	EXPAND_REQUEST: 'vc_expand_request'
	EXPAND_RESULT: 'vc_expand_result'
	CLEAR_REQUEST: 'vc_clear_request'
	CLEARED: 'vc_log_cleared'
}>

/** WebSocket.OPEN（浏览器与 `ws` 一致） */
export declare const WS_OPEN: 1

export declare function dispatchLogWireMessage(
	parsed: unknown,
	handlers?: {
		onSnapshot?: (entries: unknown[]) => void | Promise<void>
		onAppend?: (entry: unknown) => void | Promise<void>
		onExpandResult?: (payload: {
			ref: string
			ok: boolean
			snapshot?: unknown
			error?: string
			raw: object
		}) => void | Promise<void>
		onClear?: () => void | Promise<void>
		onUnknown?: (raw: object) => void | Promise<void>
		extensionHandlers?: Record<string, (raw: object) => void | Promise<void>>
	}
): Promise<boolean>
