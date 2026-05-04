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

export declare function snapshotMessageMetadata(message: Record<string, unknown>): Record<string, unknown>

export declare function dispatchLogWireMessage(
	parsed: unknown,
	handlers?: {
		onSnapshot?: (payload: {
			entries: unknown
			metadata: Record<string, unknown>
			raw: object
		}) => void
		onAppend?: (payload: { entry: unknown; raw: object }) => void
		onExpandResult?: (payload: {
			ref: string
			ok: boolean
			snapshot?: unknown
			error?: string
			raw: object
		}) => void
		onClear?: (payload: { raw: object }) => void
		onUnknown?: (raw: object) => void
		extensionHandlers?: Record<string, (raw: object) => void>
	}
): boolean
