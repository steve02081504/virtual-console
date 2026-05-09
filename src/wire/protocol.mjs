/**
 * 日志线路 JSON 协议（常量与浏览器侧解析；无 Node/util 依赖）。
 */

/**
 * 各 WebSocket JSON 消息的 `type` 字段取值（`Object.freeze`，运行时勿修改）。
 * @readonly
 */
export const logWirePayloadTypes = Object.freeze({
	SNAPSHOT: 'vc_log_snapshot',
	APPEND: 'vc_log_append',
	EXPAND_REQUEST: 'vc_expand_request',
	EXPAND_RESULT: 'vc_expand_result',
	CLEAR_REQUEST: 'vc_clear_request',
	CLEARED: 'vc_log_cleared',
})

/** WebSocket.OPEN（浏览器与 ws 一致） */
export const WS_OPEN = 1

/**
 * 将服务端/同频道下行消息分发给回调。
 * @param {unknown} parsed - `JSON.parse` 得到的根对象。
 * @param {object} [handlers] - 按 `type` 分发的可选回调集。
 * @param {function(unknown[]): void | Promise<void>} [handlers.onSnapshot] - `vc_log_snapshot`：全量 `entries` 数组。
 * @param {function(unknown): void | Promise<void>} [handlers.onAppend] - `vc_log_append`：单条 `entry` 载荷。
 * @param {function({ ref: string, ok: boolean, snapshot?: unknown, error?: string, raw: object }): void | Promise<void>} [handlers.onExpandResult] - `vc_expand_result`：惰性展开结果。
 * @param {function(): void | Promise<void>} [handlers.onClear] - `vc_log_cleared`：宿主缓冲已清空。
 * @param {function(object): void | Promise<void>} [handlers.onUnknown] - 未命中内置与 `extensionHandlers` 时的兜底。
 * @param {Record<string, (raw: object) => void | Promise<void>>} [handlers.extensionHandlers] - 按自定义 `type` 字符串路由。
 * @returns {Promise<boolean>} 若识别并分发任一已知 `type` 则为 `true`，否则 `false`。
 */
export async function dispatchLogWireMessage(parsed, handlers = {}) {
	const message = /** @type {Record<string, unknown>} */ parsed
	const messageType = String(message.type)
	const {
		onSnapshot,
		onAppend,
		onExpandResult,
		onClear,
		onUnknown,
		extensionHandlers = {},
	} = handlers

	if (messageType === logWirePayloadTypes.SNAPSHOT) {
		const rawEntries = message.entries
		await onSnapshot?.(Array.isArray(rawEntries) ? rawEntries : [])
		return true
	}
	if (messageType === logWirePayloadTypes.APPEND) {
		await onAppend?.(message.entry)
		return true
	}
	if (messageType === logWirePayloadTypes.EXPAND_RESULT) {
		await onExpandResult?.({
			ref: /** @type {string} */ message.ref,
			ok: Boolean(message.ok),
			snapshot: message.snapshot,
			error: message.error !== undefined ? String(message.error) : undefined,
			raw: /** @type {object} */ parsed,
		})
		return true
	}
	if (messageType === logWirePayloadTypes.CLEARED) {
		await onClear?.()
		return true
	}
	if (extensionHandlers[messageType]) {
		await extensionHandlers[messageType](/** @type {object} */ parsed)
		return true
	}
	await onUnknown?.(/** @type {object} */ parsed)
	return false
}
