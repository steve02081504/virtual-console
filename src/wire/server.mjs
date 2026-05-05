/**
 * 与任意 WebSocket 复用的日志线路消息（纯函数，不创建连接）。
 */
import { expandSnapshotRef } from '../core/snapshot.mjs'

import { logWirePayloadTypes } from './protocol.mjs'
import { serializeLogEntryForWire } from './serialize-log-entry.mjs'

/** WebSocket.OPEN（浏览器与 `ws` 包一致） */
const WS_OPEN = 1

/**
 * @param {Set<{ readyState: number, send: (data: string) => void }>} clients - 当前客户端集合。
 * @param {string} text - 已 `JSON.stringify` 的帧正文。
 * @returns {void}
 */
function broadcastToOpen(clients, text) {
	for (const ws of clients)
		if (ws.readyState === WS_OPEN)
			ws.send(text)
}

/**
 * 处理客户端发来的展开请求，返回应 `ws.send(JSON.stringify(...))` 的应答对象。
 * @param {unknown} parsed - 客户端 JSON 负载。
 * @param {{ expandSnapshotRef?: typeof expandSnapshotRef }} [handlers] - 可注入自定义展开实现（默认 `expandSnapshotRef`）。
 * @returns {{ type: string, ref: string, ok: boolean, snapshot?: import('../shared.d.mts').ArgSnapshot, error?: string } | null} 非展开消息返回 `null`。
 */
export function handleClientWireMessage(parsed, handlers = {}) {
	const expandFn = handlers.expandSnapshotRef ?? expandSnapshotRef
	const message = /** @type {Record<string, unknown>} */ parsed
	if (message.type !== logWirePayloadTypes.EXPAND_REQUEST)
		return null
	const { ref } = message
	if (typeof ref !== 'string')
		return null
	const expandResult = expandFn(ref)
	if (expandResult.ok)
		return {
			type: logWirePayloadTypes.EXPAND_RESULT,
			ref,
			ok: true,
			snapshot: /** @type {import('../shared.d.mts').ArgSnapshot} */ expandResult.snapshot,
		}
	return {
		type: logWirePayloadTypes.EXPAND_RESULT,
		ref,
		ok: false,
		error: String(expandResult.error || 'expand_failed'),
	}
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
 * @param {{
 *   onClientConnected?: (event: { ws: unknown, req: unknown, clientCount: number }) => void | Promise<void>
 *   onClientDisconnected?: (event: { ws: unknown, reason: 'close' | 'error', clientCount: number }) => void | Promise<void>
 *   onClientMessage?: (event: { ws: unknown, req: unknown, message: Record<string, unknown>, clientCount: number }) => object | null | void | Promise<object | null | void>
 *   clientMessageHandlers?: Record<string, (event: { ws: unknown, req: unknown, message: Record<string, unknown>, clientCount: number }) => object | null | void | Promise<object | null | void>>
 * }} [wireOptions] - 连接生命周期钩子与自定义上行消息处理器（仅处理非内置 `expand/clear` 请求）。
 * @returns {(ws: { readyState: number, send: (data: string) => void, on: (ev: string, fn: (...args: unknown[]) => void) => void, close?: (code?: number, reason?: string) => void }, req?: unknown) => void) & {
 *   broadcastJson: (payload: object) => void,
 *   forEachClient: (fn: (ws: unknown) => void) => void,
 *   closeAllWithFinalJson: (payload: object) => Promise<void>,
 * }} 供挂载的 `(ws, req) => void`，并附带 `broadcastJson` / `forEachClient` / `closeAllWithFinalJson` 控制面。
 */
export function createLogWireWebSocketHandler(virtualConsole, wireOptions = {}) {
	const {
		onClientConnected,
		onClientDisconnected,
		onClientMessage,
		clientMessageHandlers = {},
	} = wireOptions
	const clients = new Set()
	virtualConsole.addLogEntryListener((entry) => {
		const payload = JSON.stringify({
			type: logWirePayloadTypes.APPEND,
			entry: serializeLogEntryForWire(entry),
		})
		broadcastToOpen(clients, payload)
	})
	virtualConsole.addClearListener(() => {
		broadcastToOpen(clients, JSON.stringify({ type: logWirePayloadTypes.CLEARED }))
	})
	/**
	 * @param {{ readyState: number, send: (data: string) => void, on: (ev: string, fn: (...args: unknown[]) => void) => void, close?: (code?: number, reason?: string) => void }} ws - WebSocket 兼容连接。
	 * @param {unknown} [req] - 升级请求（若有）。
	 */
	const handler = async (ws, req) => {
		/**
		 * 发送 JSON 回包（当自定义消息处理器返回对象时使用）。
		 * @param {object | null | void} maybePayload - 可能的回包对象。
		 * @returns {void}
		 */
		function sendCustomReply(maybePayload) {
			if (maybePayload) try {
				ws.send(JSON.stringify(maybePayload))
			}
			catch {
				/* ignore send failure */
			}
		}

		/**
		 * 分发自定义上行消息；先命中 `clientMessageHandlers[type]`，再走 `onClientMessage` 兜底。
		 * 两者若返回对象都会作为 JSON 回包发回当前连接。
		 * @param {Record<string, unknown>} message - 客户端上行 JSON。
		 * @returns {Promise<void>}
		 */
		async function dispatchCustomClientMessage(message) {
			const event = { ws, req, message, clientCount: clients.size }
			const messageType = message.type
			if (clientMessageHandlers[messageType])
				return sendCustomReply(await clientMessageHandlers[messageType](event))
			sendCustomReply(await onClientMessage?.(event))
		}

		clients.add(ws)
		ws.send(JSON.stringify({
			type: logWirePayloadTypes.SNAPSHOT,
			entries: virtualConsole.outputEntries.map(entry => serializeLogEntryForWire(entry)),
		}))
		onClientConnected?.({
			ws,
			req,
			clientCount: clients.size,
		})
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
			else {
				const message = /** @type {Record<string, unknown>} */ parsed
				if (message.type === logWirePayloadTypes.CLEAR_REQUEST)
					virtualConsole.clear()
				else dispatchCustomClientMessage(message)
			}
		})
		ws.on('error', () => {
			if (clients.delete(ws))
				onClientDisconnected?.({
					ws,
					reason: 'error',
					clientCount: clients.size,
				})
		})
		ws.on('close', () => {
			if (clients.delete(ws))
				onClientDisconnected?.({
					ws,
					reason: 'close',
					clientCount: clients.size,
				})
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
		for (const ws of [...clients])
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

		await Promise.allSettled(closeWaits)
	}

	return handler
}
