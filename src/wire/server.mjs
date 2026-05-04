/**
 * 与任意 WebSocket 复用的日志线路消息（纯函数，不创建连接）。
 */
import { expandSnapshotRef } from '../core/snapshot.mjs'

import { logWirePayloadTypes, makeClearedPayload } from './protocol.mjs'
import { serializeLogEntryForWire } from './serialize-log-entry.mjs'

/** WebSocket.OPEN（浏览器与 `ws` 包一致） */
const WS_OPEN = 1

/**
 * 构造单条追加下行消息（`vc_log_append`）。
 * @param {import('../core/entries.mjs').LogEntry} entry - 刚写入缓冲区的日志条目。
 * @param {number} index - 当前条目在缓冲中的下标（通常 `outputEntries.length - 1`）。
 * @returns {{ type: string, entry: ReturnType<typeof serializeLogEntryForWire> }} 可 `JSON.stringify` 后广播的对象。
 */
export function makeAppendPayload(entry, index) {
	return { type: logWirePayloadTypes.APPEND, entry: serializeLogEntryForWire(entry, index) }
}

/**
 * 构造初始全量快照下行消息（`vc_log_snapshot`）。
 * @param {import('../core/entries.mjs').LogEntry[]} entries - 当前缓冲中的全部条目。
 * @param {Record<string, unknown>} [extra] - 与 `type`/`entries` 并列的扩展字段（如 `canOpenEditor`）。
 * @returns {object} 可 `JSON.stringify` 的首包负载。
 */
export function makeSnapshotPayload(entries, extra = {}) {
	return {
		type: logWirePayloadTypes.SNAPSHOT,
		entries: entries.map((entry, index) => serializeLogEntryForWire(entry, index)),
		...extra,
	}
}

/**
 * 展开成功的服务端应答载荷。
 * @param {string} ref - 与请求中相同的展开标识。
 * @param {import('../shared.d.mts').ArgSnapshot} snapshot - 深层序列化后的参数快照。
 * @returns {{ type: string, ref: string, ok: true, snapshot: import('../shared.d.mts').ArgSnapshot }} `ok: true` 分支。
 */
export function makeExpandResponse(ref, snapshot) {
	return { type: logWirePayloadTypes.EXPAND_RESULT, ref, ok: true, snapshot }
}

/**
 * 展开失败的服务端应答载荷。
 * @param {string} ref - 与请求中相同的展开标识。
 * @param {string} error - 简短错误说明（将字符串化）。
 * @returns {{ type: string, ref: string, ok: false, error: string }} `ok: false` 分支。
 */
export function makeExpandErrorResponse(ref, error) {
	return { type: logWirePayloadTypes.EXPAND_RESULT, ref, ok: false, error: String(error) }
}

/**
 * 从客户端上行文本解析展开请求（仅校验 `type` 与 `ref`）。
 * @param {unknown} parsed - `JSON.parse` 结果。
 * @returns {{ ref: string } | null} 合法请求返回 ref；否则 `null`。
 */
export function parseClientExpandMessage(parsed) {
	const message = /** @type {Record<string, unknown>} */ parsed
	if (message.type !== logWirePayloadTypes.EXPAND_REQUEST) return null
	return { ref: message.ref }
}

/**
 * 从客户端上行文本解析清空请求（仅校验 `type`）。
 * @param {unknown} parsed - `JSON.parse` 结果。
 * @returns {{}|null} 合法请求返回空对象；否则 `null`。
 */
export function parseClientClearMessage(parsed) {
	const message = /** @type {Record<string, unknown>} */ parsed
	if (message.type !== logWirePayloadTypes.CLEAR_REQUEST) return null
	return {}
}

/**
 * 处理客户端发来的展开请求，返回应 `ws.send(JSON.stringify(...))` 的应答对象。
 * @param {unknown} parsed - 客户端 JSON 负载。
 * @param {{ expandSnapshotRef?: typeof expandSnapshotRef }} [handlers] - 可注入自定义展开实现（默认 `expandSnapshotRef`）。
 * @returns {ReturnType<typeof makeExpandResponse> | ReturnType<typeof makeExpandErrorResponse> | null} 非展开消息返回 `null`。
 */
export function handleClientWireMessage(parsed, handlers = {}) {
	const expandFn = handlers.expandSnapshotRef ?? expandSnapshotRef
	const req = parseClientExpandMessage(parsed)
	if (!req) return null
	const expandResult = expandFn(req.ref)
	if (expandResult.ok) return makeExpandResponse(req.ref, /** @type {import('../shared.d.mts').ArgSnapshot} */ expandResult.snapshot)
	return makeExpandErrorResponse(req.ref, expandResult.error || 'expand_failed')
}

/**
 * 为 `VirtualConsole`（或兼容对象）创建可挂到 `express-ws` 等框架的 WebSocket 回调。
 * 首次调用时注册一条 `addLogEntryListener`，向当前所有已连接客户端广播 `vc_log_append`。
 *
 * @param {{
 *   outputEntries: import('../core/entries.mjs').LogEntry[]
 *   addLogEntryListener: (fn: (entry: import('../core/entries.mjs').LogEntry) => void) => void
 *   addClearListener: (fn: () => void) => void
 *   clear: () => void
 * }} virtualConsole - 带缓冲与监听器的宿主控制台（通常为 `VirtualConsole`）。
 * @param {{ getMetadata?: (req: unknown) => Record<string, unknown> }} [options] - 可选：随快照下发的业务元数据（如权限开关）。
 * @returns {(ws: { readyState: number, send: (data: string) => void, on: (ev: string, fn: (...args: unknown[]) => void) => void, close?: (code?: number, reason?: string) => void }, req?: unknown) => void) & {
 *   broadcastJson: (payload: object) => void,
 *   forEachClient: (fn: (ws: unknown) => void) => void,
 *   closeAllWithFinalJson: (payload: object) => Promise<void>,
 * }} 供挂载的 `(ws, req) => void`，并附带 `broadcastJson` / `forEachClient` / `closeAllWithFinalJson` 控制面。
 */
export function createLogWireWebSocketHandler(virtualConsole, {
	getMetadata = () => ({}),
} = {}) {
	const clients = new Set()
	virtualConsole.addLogEntryListener((entry) => {
		const payload = JSON.stringify(makeAppendPayload(entry, virtualConsole.outputEntries.length - 1))
		for (const ws of clients)
			if (ws.readyState === WS_OPEN)
				ws.send(payload)
	})
	virtualConsole.addClearListener(() => {
		const payload = JSON.stringify(makeClearedPayload())
		for (const ws of clients)
			if (ws.readyState === WS_OPEN)
				ws.send(payload)
	})
	const handler = (ws, req) => {
		clients.add(ws)
		ws.send(JSON.stringify(makeSnapshotPayload(virtualConsole.outputEntries, getMetadata(req))))
		ws.on('message', (raw) => {
			let parsed
			try {
				parsed = JSON.parse(String(raw))
			}
			catch {
				return
			}
			const wireReply = handleClientWireMessage(parsed)
			if (wireReply)
				ws.send(JSON.stringify(wireReply))
			else if (parseClientClearMessage(parsed))
				virtualConsole.clear()
		})
		ws.on('close', () => {
			clients.delete(ws)
		})
	}

	/**
	 * 向所有当前连接且处于 OPEN 的客户端发送同一 JSON 正文（不经缓冲区），用于宿主自定义扩展帧。
	 * @param {object} payload - 可 `JSON.stringify` 的对象。
	 * @returns {void}
	 */
	handler.broadcastJson = (payload) => {
		const text = JSON.stringify(payload)
		for (const ws of clients) {
			if (ws.readyState !== WS_OPEN)
				continue
			try {
				ws.send(text)
			}
			catch {
				/* ignore send failure */
			}
		}
	}

	/**
	 * 遍历当前仍登记的客户端套接字（可能非 OPEN）；用于宿主自定义广播或计量。
	 * @param {(ws: { readyState: number, send: (data: string) => void, on: (ev: string, fn: (...args: unknown[]) => void) => void, close: (code?: number, reason?: string) => void }) => void} fn - 同步回调。
	 * @returns {void}
	 */
	handler.forEachClient = (fn) => {
		for (const ws of clients)
			fn(ws)
	}

	/**
	 * 向每个仍处于 OPEN 的连接发送最终 JSON，随后 `close()`，并等待全部触发 `close`（已关闭的套接字会立刻计入完成）。
	 * @param {object} payload - 可 `JSON.stringify` 的对象。
	 * @returns {Promise<void>} 全部 `close` 回调结算后兑现。
	 */
	handler.closeAllWithFinalJson = async (payload) => {
		const text = JSON.stringify(payload)
		/** @type {Promise<void>[]} */
		const closeWaits = []
		for (const ws of [...clients]) {
			try {
				if (ws.readyState === WS_OPEN)
					ws.send(text)
				closeWaits.push(new Promise((resolve) => {
					if (ws.readyState !== WS_OPEN)
						resolve()
					else
						ws.once('close', resolve)
				}))
				if (ws.readyState === WS_OPEN)
					ws.close()
			}
			catch {
				/* ignore */
			}
		}
		await Promise.allSettled(closeWaits)
	}

	return handler
}
