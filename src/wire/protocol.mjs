/**
 * 日志线路 JSON 协议常量与浏览器侧解析（无 Node/util 依赖，便于 esm.sh 轻量导入）。
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

/**
 * 客户端发往服务端的展开请求体（JSON 序列化后 `ws.send`）。
 * @param {string} ref - 快照里 `truncated.ref`，须在宿主进程仍注册。
 * @returns {{ type: string, ref: string }} 固定 `type` 为 {@link logWirePayloadTypes.EXPAND_REQUEST} 的载荷。
 */
export function makeExpandRequest(ref) {
	return { type: logWirePayloadTypes.EXPAND_REQUEST, ref }
}

/**
 * 客户端发往服务端的清空请求（宿主应对应调用 `VirtualConsole#clear()`）。
 * @returns {{ type: string }} 固定 `type` 为 {@link logWirePayloadTypes.CLEAR_REQUEST}。
 */
export function makeClearRequest() {
	return { type: logWirePayloadTypes.CLEAR_REQUEST }
}

/**
 * 服务端在缓冲已清空后广播的下行消息。
 * @returns {{ type: string }} 固定 `type` 为 {@link logWirePayloadTypes.CLEARED}。
 */
export function makeClearedPayload() {
	return { type: logWirePayloadTypes.CLEARED }
}

/**
 * 从快照下行消息中提取 `type` / `entries` 之外的扩展字段（如业务注入的 `canOpenEditor`）。
 * @param {Record<string, unknown>} message - 已解析的整条 JSON 对象。
 * @returns {Record<string, unknown>} 除 `type`、`entries` 外的剩余浅拷贝字段。
 */
export function snapshotMessageMetadata(message) {
	const { type, entries, ...rest } = message
	return rest
}

/**
 * 将服务端/同频道下行消息分发给回调。
 * @param {unknown} parsed - `JSON.parse` 得到的根对象。
 * @param {object} [handlers] - 按 `type` 分发的可选回调集。
 * @param {function({ entries: unknown, metadata: Record<string, unknown>, raw: object }): void} [handlers.onSnapshot] - `vc_log_snapshot`：全量列表与元数据。
 * @param {function({ entry: unknown, raw: object }): void} [handlers.onAppend] - `vc_log_append`：单条追加。
 * @param {function({ ref: string, ok: boolean, snapshot?: unknown, error?: string, raw: object }): void} [handlers.onExpandResult] - `vc_expand_result`：惰性展开结果。
 * @param {function({ raw: object }): void} [handlers.onClear] - `vc_log_cleared`：宿主缓冲已清空。
 * @param {function(object): void} [handlers.onUnknown] - `type` 不在内置枚举时的兜底。
 * @returns {boolean} 若识别并分发任一已知 `type` 则为 `true`，否则 `false`。
 */
export function dispatchLogWireMessage(parsed, handlers = {}) {
	if (!parsed || typeof parsed !== 'object') return false
	const message = /** @type {Record<string, unknown>} */ parsed
	const messageType = message.type
	const { onSnapshot, onAppend, onExpandResult, onClear, onUnknown } = handlers

	if (messageType === logWirePayloadTypes.SNAPSHOT) {
		onSnapshot?.({
			entries: message.entries,
			metadata: snapshotMessageMetadata(message),
			raw: /** @type {object} */ parsed,
		})
		return true
	}
	if (messageType === logWirePayloadTypes.APPEND) {
		onAppend?.({
			entry: message.entry,
			raw: /** @type {object} */ parsed,
		})
		return true
	}
	if (messageType === logWirePayloadTypes.EXPAND_RESULT) {
		onExpandResult?.({
			ref: /** @type {string} */ message.ref,
			ok: Boolean(message.ok),
			snapshot: message.snapshot,
			error: message.error !== undefined ? String(message.error) : undefined,
			raw: /** @type {object} */ parsed,
		})
		return true
	}
	if (messageType === logWirePayloadTypes.CLEARED) {
		onClear?.({
			raw: /** @type {object} */ parsed,
		})
		return true
	}
	onUnknown?.(/** @type {object} */ parsed)
	return false
}
