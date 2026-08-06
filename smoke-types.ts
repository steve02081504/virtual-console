import {
	VirtualConsole,
	newLogEntry,
	serializeArgSnapshot,
	renderPlain,
	renderAnsi,
	renderHtml,
	WireLogEntry,
	isVirtualConsole,
	FreshLineLogEntry,
	StreamLogEntry,
	DEFAULT_SNAPSHOT_DEPTH,
	expandSnapshotRef,
	type LogEntry,
	type LogSegment,
	type ExpansionScope,
} from '@steve02081504/virtual-console/node'
import {
	VirtualConsole as BrowserVC,
	isVirtualConsole as isBrowserVC,
	type LogEntry as BrowserLogEntry,
} from '@steve02081504/virtual-console/browser'
import {
	VirtualConsole as MainVC,
	consoleAsyncStorage,
} from '@steve02081504/virtual-console'
import {
	logWirePayloadTypes,
	WS_OPEN,
	dispatchLogWireMessage,
} from '@steve02081504/virtual-console/wire/protocol'
import {
	attachLogWire,
	createWireLogEntryFromJson,
	type AnyWireLogEntry,
} from '@steve02081504/virtual-console/wire/client'
import { createLogWireWebSocketHandler } from '@steve02081504/virtual-console/wire/server'

const vc = new VirtualConsole({ recordOutput: true })
vc.baseConsole = vc
const entry: LogEntry = newLogEntry({ method: 'log', args: ['hi'], stack: [] })
const fresh = newLogEntry({ method: 'freshLine', args: ['id', 'x'], stack: [] })
const stream = newLogEntry({ method: 'stdout', args: ['out'], stack: [] })
const _freshId: string = fresh.id
const _streamText: string = stream.text
const snap = serializeArgSnapshot({ a: 1 }, { maxDepth: DEFAULT_SNAPSHOT_DEPTH })
const segs: LogSegment[] = entry.toSegments()
void renderPlain(segs)
void renderAnsi(segs, { colorize: true })
void renderHtml(segs, { supportsAnsi: true })
void isVirtualConsole(vc)
void expandSnapshotRef('ref')
void (fresh instanceof FreshLineLogEntry)
void (stream instanceof StreamLogEntry)

const bvc = new BrowserVC()
void isBrowserVC(bvc)
const _be: BrowserLogEntry[] = bvc.outputEntries
void bvc.baseConsole

const _main: MainVC = new MainVC()
const _als = consoleAsyncStorage

void logWirePayloadTypes.SNAPSHOT
const _open: 1 = WS_OPEN
void dispatchLogWireMessage({ type: 'vc_log_cleared' }, { onClear: () => {} })

const wireEntry = createWireLogEntryFromJson(
	{ method: 'log', segments: [{ kind: 'text', text: 'x' }] },
	{ requestExpand: async () => ({}) },
)
const _any: AnyWireLogEntry = wireEntry
void wireEntry.renderPlain()
void (WireLogEntry)

const fakeWs = {
	readyState: WS_OPEN,
	send(_data: string) {},
	addEventListener(_ev: string, _fn: (...args: unknown[]) => void) {},
	removeEventListener(_ev: string, _fn: (...args: unknown[]) => void) {},
	close(_code?: number, _reason?: string) {},
} as unknown as WebSocket
void attachLogWire(fakeWs, {
	onAppend: async (e) => { void e.renderString() },
})

void createLogWireWebSocketHandler(vc)
void (null as ExpansionScope | null)
