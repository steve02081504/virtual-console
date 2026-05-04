/**
 * 浏览器 / Node.js 18+：连接任意 WebSocket URL 或复用已有 `WebSocket`，按 logWire 协议处理下行文本帧。
 * 仅依赖 `./protocol.mjs`，可通过 esm.sh 单独打包轻量入口。
 */
import {
	dispatchLogWireMessage,
	makeClearRequest,
	makeExpandRequest,
} from './protocol.mjs'

/**
 * 浏览器 / Node 客户端侧处理 logWire 下行帧的回调集合。
 * @typedef {object} LogWireClientHandlers
 * @property {function({ entries: unknown, metadata: Record<string, unknown>, raw: object }): void} [onSnapshot]
 * @property {function({ entry: unknown, raw: object }): void} [onAppend]
 * @property {function({ raw: object }): void} [onClear]
 * @property {Record<string, function(object): void>} [extensionHandlers]
 * @property {function(object): void} [onUnknown]
 * @property {function(Error, unknown): void} [onParseError]
 * @property {function(Event): void} [onOpen]
 * @property {function(CloseEvent): void} [onClose]
 * @property {function(Event): void} [onError]
 */

/**
 * 打开 WebSocket 并在其上绑定 {@link attachLogWireWebSocket}。
 * @param {string | URL} url - `wss://` 或 `ws://` 端点。
 * @param {LogWireClientHandlers & { protocols?: string|string[] }} [options] - 帧解析回调；可选 `protocols` 传给浏览器 `WebSocket` 构造函数。
 * @returns {{ ws: WebSocket, close: (code?: number, reason?: string) => void, requestExpand: (ref: string) => Promise<unknown>, requestClear: () => boolean, sendJson: (obj: object) => boolean, detach: () => void }} 连接句柄与控制方法。
 */
export function connectLogWire(url, options = {}) {
	const { protocols, ...handlers } = options
	const ws = new WebSocket(url, protocols)
	return attachLogWireWebSocket(ws, handlers)
}

/**
 * 在已有 WebSocket 上绑定协议分发（适用于共享连接、或自定义握手后再传入）。
 * @param {WebSocket} ws - 已处于或即将处于 OPEN 的套接字。
 * @param {LogWireClientHandlers} [handlers] - 各类下行消息的回调；未提供的类型将被忽略。
 * @returns {{ ws: WebSocket, close: (code?: number, reason?: string) => void, requestExpand: (ref: string) => Promise<unknown>, requestClear: () => boolean, sendJson: (obj: object) => boolean, detach: () => void }} 同一引用上的便捷封装。
 */
export function attachLogWireWebSocket(ws, handlers = {}) {
	const {
		onSnapshot,
		onAppend,
		onClear,
		onUnknown,
		extensionHandlers,
		onParseError,
		onOpen,
		onClose,
		onError,
	} = handlers

	/**
	 * `requestExpand` 挂起的 Promise，按 ref 兑现或拒绝。
	 * @type {Map<string, { resolve: (v: unknown) => void, reject: (e?: Error) => void }>}
	 */
	const pendingExpands = new Map()

	/**
	 * 文本帧 → JSON → {@link dispatchLogWireMessage}；解析失败时调用 `onParseError`。
	 * @param {MessageEvent} ev - 浏览器 `message` 事件。
	 * @returns {void}
	 */
	const listener = (/** @type {MessageEvent} */ ev) => {
		try {
			const parsed = JSON.parse(ev.data)
			dispatchLogWireMessage(parsed, {
				onSnapshot,
				onAppend,
				onClear,
				extensionHandlers,
				/**
				 * 兑现 {@link pendingExpands} 中的 `requestExpand` Promise。
				 * @param {{ ref: string, ok: boolean, snapshot?: unknown, error?: string, raw: object }} payload - 服务端 `vc_expand_result` 载荷。
				 */
				onExpandResult: (payload) => {
					const { ref, ok, snapshot, error } = payload
					if (ref) {
						const pending = pendingExpands.get(ref)
						if (pending) {
							pendingExpands.delete(ref)
							if (ok && snapshot != null)
								pending.resolve(snapshot)
							else
								pending.reject(new Error(error != null ? String(error) : 'expand_failed'))
						}
					}
				},
				onUnknown,
			})
		}
		catch (e) {
			onParseError?.(e, ev.data)
		}
	}

	ws.addEventListener('message', listener)
	if (onOpen) ws.addEventListener('open', onOpen)
	if (onClose) ws.addEventListener('close', onClose)
	if (onError) ws.addEventListener('error', onError)

	return {
		ws,
		/**
		 * 关闭底层 WebSocket。
		 * @param {number} [code] - 关闭码（见 RFC6455）。
		 * @param {string} [reason] - 关闭原因（UTF-8）。
		 * @returns {void}
		 */
		close: (code, reason) => ws.close(code, reason),
		/**
		 * 发送展开请求并等待同 ref 的应答（由内部 `pendingExpands` 兑现）。
		 * @param {string} ref - 与快照中 `truncated.ref` 一致。
		 * @returns {Promise<unknown>} resolve 为快照对象；失败 reject。
		 */
		requestExpand: (ref) => {
			return new Promise((resolve, reject) => {
				if (ws.readyState !== WebSocket.OPEN) {
					reject(new Error('websocket_not_open'))
					return
				}
				pendingExpands.set(ref, { resolve, reject })
				ws.send(JSON.stringify(makeExpandRequest(ref)))
			})
		},
		/**
		 * 发送清空请求（宿主应调用 `VirtualConsole#clear()`）；未连接时返回 `false`。
		 * @returns {boolean} 是否已成功入队发送。
		 */
		requestClear: () => {
			if (ws.readyState !== WebSocket.OPEN) return false
			ws.send(JSON.stringify(makeClearRequest()))
			return true
		},
		/**
		 * 发送任意 JSON 对象（自行保证与服务端约定一致）。
		 * @param {object} obj - 可序列化的负载。
		 * @returns {boolean} 是否已发送。
		 */
		sendJson: (obj) => {
			if (ws.readyState !== WebSocket.OPEN) return false
			ws.send(JSON.stringify(obj))
			return true
		},
		/**
		 * 移除所有事件监听并拒绝挂起的 `requestExpand`。
		 * @returns {void}
		 */
		detach: () => {
			for (const { reject } of pendingExpands.values())
				reject(new Error('log_wire_detached'))
			pendingExpands.clear()
			ws.removeEventListener('message', listener)
			if (onOpen) ws.removeEventListener('open', onOpen)
			if (onClose) ws.removeEventListener('close', onClose)
			if (onError) ws.removeEventListener('error', onError)
		},
	}
}
