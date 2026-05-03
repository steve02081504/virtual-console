import type { ArgSnapshot } from '../shared.d.mts'

export declare function makeAppendPayload(entry: unknown, index: number): {
	type: string
	entry: Record<string, unknown>
}

export declare function makeSnapshotPayload(entries: unknown[], extra?: Record<string, unknown>): Record<string, unknown>

export declare function makeExpandResponse(ref: string, snapshot: ArgSnapshot): Record<string, unknown>

export declare function makeExpandErrorResponse(ref: string, error: string): Record<string, unknown>

export declare function parseClientExpandMessage(parsed: unknown): { ref: string } | null

export declare function parseClientClearMessage(parsed: unknown): Record<string, never> | null

export declare function handleClientWireMessage(
	parsed: unknown,
	handlers?: { expandSnapshotRef?: (ref: string) => { ok: boolean; snapshot?: ArgSnapshot; error?: string } }
): Record<string, unknown> | null

export declare function createLogWireWebSocketHandler(
	virtualConsole: {
		outputEntries: unknown[]
		addLogEntryListener: (fn: (entry: unknown) => void) => void
		addClearListener: (fn: () => void) => void
		clear: () => void
	},
	opts?: { getMetadata?: (req: unknown) => Record<string, unknown> }
): (ws: {
	readyState: number
	send: (data: string) => void
	on: (ev: string, fn: (...args: unknown[]) => void) => void
}, req?: unknown) => void
