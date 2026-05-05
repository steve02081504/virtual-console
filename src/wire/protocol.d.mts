export declare const logWirePayloadTypes: Readonly<{
	SNAPSHOT: string
	APPEND: string
	EXPAND_REQUEST: string
	EXPAND_RESULT: string
	CLEAR_REQUEST: string
	CLEARED: string
}>

export declare function makeExpandRequest(ref: string): { type: string; ref: string }

export declare function makeClearRequest(): { type: string }

export declare function makeClearedPayload(): { type: string }

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
