/**
 * 浏览器 / Node.js 18+：连接任意 WebSocket URL 或复用已有 `WebSocket`，按 logWire 协议处理下行文本帧。
 * 仅依赖 `./protocol.mjs`，可通过 esm.sh 单独打包轻量入口。
 */
import supportsAnsi from 'supports-ansi'

import {
	dispatchLogWireMessage,
	logWirePayloadTypes,
	WS_OPEN,
} from './protocol.mjs'
import { createWireLogEntryFromJson, WireLogEntry } from './wire-log-entry.mjs'

/**
 * 从 `./wire-log-entry.mjs` 再导出 `WireLogEntry`和`createWireLogEntryFromJson`，便于仅依赖本文件的打包入口直接使用。
 */
export { WireLogEntry, createWireLogEntryFromJson }

const defaultSupportsAnsi = supportsAnsi
/**
 * 浏览器 / Node 客户端侧处理 logWire 下行帧的回调集合。
 * @typedef {object} LogWireClientHandlers
 * @property {function(Array<ReturnType<typeof createWireLogEntryFromJson>>): void | Promise<void>} [onSnapshot]
 * @property {function(ReturnType<typeof createWireLogEntryFromJson>): void | Promise<void>} [onAppend]
 * @property {function(): void | Promise<void>} [onClear]
 * @property {Record<string, function(object): void>} [extensionHandlers]
 * @property {function(object): void} [onUnknown]
 * @property {function(Error, unknown): void} [onParseError] - `JSON.parse` 失败时调用。
 * @property {function(Error, unknown): void} [onDispatchError] - 协议分发或业务回调抛错时调用。
 * @property {function(Error, unknown): void} [onFatal] - 致命错误且未提供对应特化处理器时的兜底。
 * @property {function(Event): void} [onOpen]
 * @property {function(CloseEvent): void} [onClose]
 * @property {function(Event): void} [onError]
 */

/**
 * 打开 WebSocket 并在其上绑定 {@link attachLogWire}。
 * @param {string | URL} url - `wss://` 或 `ws://` 端点。
 * @param {LogWireClientHandlers & { protocols?: string|string[] }} [options] - 帧解析回调；可选 `protocols` 传给浏览器 `WebSocket` 构造函数。
 * @returns {{ ws: WebSocket, close: (code?: number, reason?: string) => void, requestExpand: (ref: string, maxDepth?: number) => Promise<unknown>, requestClear: () => boolean, sendJson: (obj: object) => boolean, detach: () => void }} 连接句柄与控制方法。
 */
export function connectLogWire(url, options = {}) {
	const { protocols, ...handlers } = options
	const ws = new WebSocket(url, protocols)
	return attachLogWire(ws, handlers)
}

/**
 * 在已有 WebSocket 上绑定协议分发（适用于共享连接、或自定义握手后再传入）。
 * @param {WebSocket} ws - 已处于或即将处于 OPEN 的套接字。
 * @param {LogWireClientHandlers} [handlers] - 各类下行消息的回调；未提供的类型将被忽略。
 * @returns {{ ws: WebSocket, close: (code?: number, reason?: string) => void, requestExpand: (ref: string, maxDepth?: number) => Promise<unknown>, requestClear: () => boolean, sendJson: (obj: object) => boolean, detach: () => void }} 同一引用上的便捷封装。
 */
export function attachLogWire(ws, {
	onSnapshot,
	onAppend,
	onClear,
	onUnknown,
	extensionHandlers,
	onParseError,
	onDispatchError,
	onOpen,
	onClose,
	onError,
	onFatal,
	supportsAnsi = defaultSupportsAnsi,
} = {}) {
	onParseError ??= onFatal
	onDispatchError ??= onFatal
	/**
	 * `requestExpand` 挂起的 Promise，按 ref 兑现或拒绝。
	 * @type {Map<string, { promise: Promise<unknown>, resolve: (v: unknown) => void, reject: (e?: Error) => void }>}
	 */
	const pendingExpands = new Map()

	/**
	 * 拒绝并清理所有挂起的展开请求。
	 * @param {string} errorMessage - 统一错误消息。
	 * @returns {void}
	 */
	function rejectAllPendingExpands(errorMessage) {
		for (const { reject } of pendingExpands.values())
			reject(new Error(errorMessage))
		pendingExpands.clear()
	}

	/**
	 * @param {unknown} raw - 服务端下发的单条 JSON 载荷。
	 * @returns {ReturnType<typeof createWireLogEntryFromJson>} 绑定当前连接的异步条目。
	 */
	function wrapWireEntry(raw) {
		return createWireLogEntryFromJson(raw, {
			requestExpand,
			supportsAnsi,
		})
	}

	/**
	 * @param {unknown[]} entries - 快照中的序列化条目。
	 * @returns {Promise<void>}
	 */
	async function dispatchSnapshot(entries) {
		await onSnapshot?.(entries.map((e) => wrapWireEntry(e)))
	}

	/**
	 * @param {unknown} entry - `vc_log_append` 单条序列化载荷。
	 * @returns {Promise<void>}
	 */
	async function dispatchAppend(entry) {
		await onAppend?.(wrapWireEntry(entry))
	}

	/**
	 * 在连接可用时发送 JSON 帧；未连接或发送异常返回 false。
	 * @param {object} payload - 可 JSON 序列化对象。
	 * @returns {boolean} `true` 表示发送成功，`false` 表示连接未就绪或发送失败。
	 */
	function safeSendJson(payload) {
		if (ws.readyState !== WS_OPEN)
			return false
		try {
			ws.send(JSON.stringify(payload))
			return true
		}
		catch {
			return false
		}
	}

	/**
	 * 发送展开请求并等待同 ref 的应答（由内部 `pendingExpands` 兑现）。
	 * @param {string} ref - 与快照中 `truncated.ref` 一致。
	 * @param {number} [maxDepth] - 期望展开的最大深度；无效值将被忽略。
	 * @returns {Promise<unknown>} resolve 为快照对象；失败 reject。
	 */
	function requestExpand(ref, maxDepth) {
		const existing = pendingExpands.get(ref)
		if (existing)
			return existing.promise
		/** @type {(v: unknown) => void} */
		let resolvePending
		/** @type {(e?: Error) => void} */
		let rejectPending
		const promise = new Promise((resolve, reject) => {
			resolvePending = resolve
			rejectPending = reject
		})
		pendingExpands.set(ref, { promise, resolve: resolvePending, reject: rejectPending })
		const sent = safeSendJson({
			type: logWirePayloadTypes.EXPAND_REQUEST,
			ref,
			maxDepth,
		})
		if (!sent) {
			pendingExpands.delete(ref)
			rejectPending(new Error('log_wire_send_failed'))
		}
		return promise
	}

	/**
	 * 文本帧 → JSON → `await` {@link dispatchLogWireMessage}（异步回调会等完成）。
	 * @param {MessageEvent} ev - 浏览器 `message` 事件。
	 * @returns {Promise<void>}
	 */
	const listener = async (/** @type {MessageEvent} */ ev) => {
		let parsed
		try {
			parsed = JSON.parse(ev.data)
		}
		catch (error) {
			onParseError?.(error, ev.data)
			return
		}
		try {
			await dispatchLogWireMessage(parsed, {
				onSnapshot: dispatchSnapshot,
				onAppend: dispatchAppend,
				onClear,
				extensionHandlers,
				/**
				 * 兑现 {@link pendingExpands} 中的 `requestExpand` Promise。
				 * @param {{ ref: string, ok: boolean, snapshot?: unknown, error?: string, raw: object }} payload - 服务端 `vc_expand_result` 载荷。
				 */
				onExpandResult: (payload) => {
					const { ref, ok, snapshot, error } = payload
					const pending = pendingExpands.get(ref)
					pendingExpands.delete(ref)
					if (!pending)
						return
					if (ok && snapshot != null)
						pending.resolve(snapshot)
					else
						pending.reject(new Error(error != null ? String(error) : 'expand_failed'))
				},
				onUnknown,
			})
		}
		catch (error) {
			onDispatchError?.(error, parsed)
		}
	}

	/**
	 * 底层连接关闭时结束全部挂起展开请求。
	 * @param {CloseEvent} ev - 关闭事件。
	 * @returns {void}
	 */
	const closeListener = (ev) => {
		rejectAllPendingExpands('log_wire_closed')
		onClose?.(ev)
	}
	/**
	 * 底层连接错误时结束全部挂起展开请求。
	 * @param {Event} ev - 错误事件。
	 * @returns {void}
	 */
	const errorListener = (ev) => {
		rejectAllPendingExpands('log_wire_error')
		onError?.(ev)
	}

	ws.addEventListener('message', listener)
	if (onOpen) ws.addEventListener('open', onOpen)
	ws.addEventListener('close', closeListener)
	ws.addEventListener('error', errorListener)

	return {
		ws,
		/**
		 * 关闭底层 WebSocket。
		 * @param {number} [code] - 关闭码（见 RFC6455）。
		 * @param {string} [reason] - 关闭原因（UTF-8）。
		 * @returns {void}
		 */
		close: (code, reason) => ws.close(code, reason),
		requestExpand,
		/**
		 * 发送清空请求（宿主应调用 `VirtualConsole#clear()`）；未连接时返回 `false`。
		 * @returns {boolean} 是否已成功入队发送。
		 */
		requestClear: () => {
			return safeSendJson({ type: logWirePayloadTypes.CLEAR_REQUEST })
		},
		/**
		 * 发送任意 JSON 对象（自行保证与服务端约定一致）。
		 * @param {object} obj - 可序列化的负载。
		 * @returns {boolean} 是否已发送。
		 */
		sendJson: (obj) => {
			return safeSendJson(obj)
		},
		/**
		 * 移除所有事件监听并拒绝挂起的 `requestExpand`。
		 * @returns {void}
		 */
		detach: () => {
			rejectAllPendingExpands('log_wire_detached')
			ws.removeEventListener('message', listener)
			if (onOpen) ws.removeEventListener('open', onOpen)
			ws.removeEventListener('close', closeListener)
			ws.removeEventListener('error', errorListener)
		},
	}
}
