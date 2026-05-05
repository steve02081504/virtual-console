import {
	VirtualConsole,
	WireLogEntry,
} from '@steve02081504/virtual-console'
import { attachLogWire } from '@steve02081504/virtual-console/wire/client'
import {
	dispatchLogWireMessage,
	logWirePayloadTypes,
} from '@steve02081504/virtual-console/wire/protocol'
import { createLogWireWebSocketHandler } from '@steve02081504/virtual-console/wire/server'

import { assert, assertEqual, assertIncludes, runTestGroup } from '../../harness.mjs'

/**
 * 验证传入全局 console 代理时 server handler 可正常广播。
 */
async function testCreateLogWireWebSocketHandlerWithProxy() {
	console.log('\n=== [wire：全局 console Proxy + WebSocket handler] ===')
	const vc = new VirtualConsole({ recordOutput: true, realConsoleOutput: false })
	/** @type {{ messages: string[] }} */
	const wire = { messages: [] }
	await vc.hookAsyncContext(async () => {
		const mockWs = {
			readyState: 1,
			/**
			 * 发送下行 JSON 文本。
			 * @param {string} data - 发送内容。
			 * @returns {void}
			 */
			send: (data) => wire.messages.push(data),
			/**
			 * 测试桩事件注册（本用例未使用）。
			 * @param {string} ev - 事件名。
			 * @param {(...args: unknown[]) => void} fn - 回调。
			 * @returns {void}
			 */
			on: (ev, fn) => { void ev; void fn },
		}
		const handler = createLogWireWebSocketHandler(console)
		handler(mockWs)
		console.log('wire-append-marker')
	})
	assert(wire.messages.length >= 1, '连接后至少下发 snapshot')
	assert(JSON.parse(wire.messages[0]).type === logWirePayloadTypes.SNAPSHOT, '首包为 vc_log_snapshot')
	assert(wire.messages.length >= 2, '新日志后下发追加消息')
	assert(JSON.parse(wire.messages[wire.messages.length - 1]).type === logWirePayloadTypes.APPEND, '追加包为 vc_log_append')
}

/**
 * 验证 server handler 的群发、遍历与优雅关闭控制面。
 */
async function testLogWireHandlerClientControl() {
	console.log('\n=== [wire：handler 群发与优雅关闭] ===')
	const vc = new VirtualConsole({ recordOutput: true, realConsoleOutput: false })
	const handler = createLogWireWebSocketHandler(vc)
	/** @type {string[]} */
	const received = []
	let closeEmitCount = 0
	const mockWs = {
		readyState: 1,
		listeners: {},
		/**
		 * 注册事件回调。
		 * @param {string} ev - 事件名。
		 * @param {(...args: unknown[]) => void} fn - 回调。
		 * @returns {void}
		 */
		on(ev, fn) { this.listeners[ev] = fn },
		/**
		 * 发送下行文本。
		 * @param {string} data - 文本内容。
		 * @returns {void}
		 */
		send: (data) => { received.push(String(data)) },
		/**
		 * 关闭连接并触发 close 回调。
		 * @returns {void}
		 */
		close() { this.readyState = 3; closeEmitCount++; this.listeners.close?.() },
	}
	handler(/** @type {Parameters<typeof handler>[0]} */ mockWs)
	handler.broadcastJson({ type: 'host_ping', x: 1 })
	assert(received.some((s) => { try { return JSON.parse(s).type === 'host_ping' } catch { return false } }), 'broadcastJson 下发到已连接客户端')
	let seen = 0
	handler.forEachClient(() => { seen++ })
	assertEqual(seen, 1, 'forEachClient 遍历到 1 个套接字')
	await handler.closeAllWithFinalJson({ type: 'host_bye' })
	assert(received.some((s) => { try { return JSON.parse(s).type === 'host_bye' } catch { return false } }), 'closeAllWithFinalJson 先发最终 JSON')
	assertEqual(closeEmitCount, 1, 'closeAllWithFinalJson 触发 close')
}

/**
 * 验证 server 侧连接建立/断开生命周期回调。
 */
async function testLogWireServerLifecycleHooks() {
	console.log('\n=== [wire：server 生命周期回调] ===')
	const vc = new VirtualConsole({ recordOutput: true, realConsoleOutput: false })
	/** @type {Array<{ type: string, count: number, reason?: string }>} */
	const calls = []
	const handler = createLogWireWebSocketHandler(vc, {
		/**
		 * 连接建立回调。
		 * @param {{ clientCount: number }} root0 - 生命周期参数。
		 * @param {number} root0.clientCount - 当前连接数。
		 * @returns {void}
		 */
		onClientConnected: ({ clientCount }) => { calls.push({ type: 'connected', count: clientCount }) },
		/**
		 * 连接断开回调。
		 * @param {{ clientCount: number, reason: 'close' | 'error' }} root0 - 生命周期参数。
		 * @param {number} root0.clientCount - 当前连接数。
		 * @param {'close' | 'error'} root0.reason - 断开原因。
		 * @returns {void}
		 */
		onClientDisconnected: ({ clientCount, reason }) => { calls.push({ type: 'disconnected', count: clientCount, reason }) },
	})
	const mockWs = {
		readyState: 1,
		listeners: {},
		/**
		 * 发送数据（测试桩，无操作）。
		 * @returns {void}
		 */
		send: () => { },
		/**
		 * 注册事件回调。
		 * @param {string} ev - 事件名。
		 * @param {(...args: unknown[]) => void} fn - 回调。
		 * @returns {void}
		 */
		on(ev, fn) { this.listeners[ev] = fn },
		/**
		 * 关闭连接并触发 close。
		 * @returns {void}
		 */
		close() { this.readyState = 3; this.listeners.close?.() },
	}
	handler(/** @type {Parameters<typeof handler>[0]} */ mockWs)
	assertEqual(calls[0]?.type, 'connected', '新连接触发 onClientConnected')
	assertEqual(calls[0]?.count, 1, 'connected 回调可见连接数')
	mockWs.close()
	assertEqual(calls[1]?.type, 'disconnected', '关闭连接触发 onClientDisconnected')
	assertEqual(calls[1]?.reason, 'close', '断开原因为 close')
	assertEqual(calls[1]?.count, 0, 'disconnect 回调可见移除后连接数')
}

/**
 * 验证 server 可处理客户端自定义上行载荷（按 type 路由 + 兜底）。
 */
async function testLogWireServerCustomClientPayloadHandling() {
	console.log('\n=== [wire：server 处理自定义上行载荷] ===')
	const vc = new VirtualConsole({ recordOutput: true, realConsoleOutput: false })
	/** @type {Array<{ route: string, type: string }>} */
	const seen = []
	/** @type {string[]} */
	const sent = []
	const handler = createLogWireWebSocketHandler(vc, {
		clientMessageHandlers: {
			/**
			 * 命中自定义 type 的专用处理器。
			 * @param {{ message: Record<string, unknown> }} root0 - 消息事件。
			 * @param {Record<string, unknown>} root0.message - 客户端上行消息。
			 * @returns {object} 回包 JSON。
			 */
			my_custom_ping: ({ message }) => {
				seen.push({ route: 'typed', type: String(message.type) })
				return { type: 'my_custom_pong', ok: true }
			},
		},
		/**
		 * 未命中 `clientMessageHandlers` 时的兜底处理。
		 * @param {{ message: Record<string, unknown> }} root0 - 消息事件。
		 * @param {Record<string, unknown>} root0.message - 客户端上行消息。
		 * @returns {object} 回包 JSON。
		 */
		onClientMessage: ({ message }) => {
			seen.push({ route: 'fallback', type: String(message.type) })
			return { type: 'fallback_ack' }
		},
	})
	const mockWs = {
		readyState: 1,
		listeners: {},
		/**
		 * 注册事件回调。
		 * @param {string} ev - 事件名。
		 * @param {(...args: unknown[]) => void} fn - 回调。
		 * @returns {void}
		 */
		on(ev, fn) { this.listeners[ev] = fn },
		/**
		 * 发送文本。
		 * @param {string} data - 文本内容。
		 * @returns {void}
		 */
		send(data) { sent.push(String(data)) },
	}
	await handler(/** @type {Parameters<typeof handler>[0]} */ mockWs)
	await mockWs.listeners.message?.(JSON.stringify({ type: 'my_custom_ping', seq: 1 }))
	await mockWs.listeners.message?.(JSON.stringify({ type: 'my_custom_unknown', seq: 2 }))
	assert(seen.some((x) => x.route === 'typed' && x.type === 'my_custom_ping'), '命中按 type 的自定义处理器')
	assert(seen.some((x) => x.route === 'fallback' && x.type === 'my_custom_unknown'), '未命中时走 onClientMessage 兜底')
	assert(sent.some((s) => { try { return JSON.parse(s).type === 'my_custom_pong' } catch { return false } }), 'typed 处理器返回对象会回包')
	assert(sent.some((s) => { try { return JSON.parse(s).type === 'fallback_ack' } catch { return false } }), 'fallback 处理器返回对象会回包')
}

/**
 * 验证协议分发扩展点与 WireLogEntry 渲染辅助能力。
 */
async function testWireHelpers() {
	console.log('\n=== [wire 协议与辅助] ===')
	let shutdown = /** @type {object | null} */ null
	await dispatchLogWireMessage({ type: 'my_shutdown', code: 42, reason: 'bye' }, {
		extensionHandlers: {
			/**
			 * 捕获自定义 shutdown 载荷。
			 * @param {Record<string, unknown>} raw - 原始消息对象。
			 * @returns {void}
			 */
			my_shutdown: (raw) => { shutdown = raw },
		},
	})
	assert(shutdown != null, 'extensionHandlers 收到自定义 shutdown')
	assertEqual(/** @type {{ code?: number }} */ shutdown.code, 42, '自定义载荷 code')
	assertEqual(/** @type {{ reason?: string }} */ shutdown.reason, 'bye', '自定义载荷 reason')
	let ext = false
	await dispatchLogWireMessage({ type: 'my_app_ping', n: 1 }, {
		extensionHandlers: {
			/**
			 * 标记扩展消息已命中。
			 * @returns {void}
			 */
			my_app_ping: () => { ext = true },
		},
	})
	assert(ext, 'extensionHandlers 分发自定义 type')
	const w = WireLogEntry.from({
		id: 0, level: 'log', method: 'log', timestamp: 1, segments: [{ kind: 'text', text: 'hi' }],
	}, {
		/**
		 * 此用例不应触发展开请求。
		 * @returns {Promise<never>} 始终抛错。
		 */
		requestExpand: async () => { throw new Error('unexpected_expand') },
		supportsAnsi: false,
	})
	assertEqual(await w.renderPlain(), 'hi', 'WireLogEntry renderPlain（由 segments）')
	assertEqual(await w.renderString(), 'hi', 'WireLogEntry renderString')
	assertIncludes(await w.renderHtml(), 'hi', 'WireLogEntry renderHtml')
	assertEqual(w.segments.length, 1, 'segments 长度')

	// 深度链：0(root)->1->2->3->4(truncated ref_deep)
	/** @type {Array<number | undefined>} */
	const requestedDepths = []
	const deepTruncatedEntry = WireLogEntry.from({
		id: 3,
		level: 'log',
		method: 'log',
		timestamp: 3,
		segments: [{
			kind: 'value',
			snapshot: {
				kind: 'object',
				entries: [{
					key: 'a',
					value: {
						kind: 'object',
						entries: [{
							key: 'b',
							value: {
								kind: 'object',
								entries: [{
									key: 'c',
									value: {
										kind: 'object',
										entries: [{ key: 'd', value: { kind: 'truncated', ref: 'ref_deep', label: 'Object' } }],
									},
								}],
							},
						}],
					},
				}],
			},
		}],
		stack: [],
	}, {
		/**
		 * 记录深层截断节点展开请求参数并返回固定快照。
		 * @param {string} ref - 截断引用标识。
		 * @param {number | undefined} maxDepth - 客户端请求的剩余展开深度。
		 * @returns {Promise<import('@steve02081504/virtual-console/shared').ArgSnapshot>} 展开后的快照。
		 */
		requestExpand: async (ref, maxDepth) => {
			assertEqual(ref, 'ref_deep', '深层展开 ref 正确')
			requestedDepths.push(maxDepth)
			return { kind: 'object', entries: [{ key: 'leaf', value: { kind: 'string', value: 'ok' } }] }
		},
		supportsAnsi: false,
	})
	await deepTruncatedEntry.renderPlain({ maxDepth: 7 })
	assertEqual(requestedDepths[0], 3, '展开请求使用剩余深度（7-4=3）')

	/** @type {Array<{ ref: string, maxDepth: number | undefined }>} */
	const concurrentCalls = []
	let gateOpen = false
	/** @type {(() => void) | null} */
	let openGate = null
	const waitGate = new Promise((resolve) => { openGate = resolve })
	const concurrentEntry = WireLogEntry.from({
		id: 4,
		level: 'log',
		method: 'log',
		timestamp: 4,
		segments: [{
			kind: 'value',
			snapshot: { kind: 'truncated', ref: 'ref_concurrent', label: 'Object' },
		}],
		stack: [],
	}, {
		/**
		 * 模拟并发展开请求：首个请求阻塞到 gate 打开后继续。
		 * @param {string} ref - 当前展开引用。
		 * @param {number | undefined} maxDepth - 请求深度上限。
		 * @returns {Promise<import('@steve02081504/virtual-console/shared').ArgSnapshot>} 对应引用的展开结果。
		 */
		requestExpand: async (ref, maxDepth) => {
			concurrentCalls.push({ ref, maxDepth })
			if (!gateOpen) {
				await waitGate
				gateOpen = true
			}
			if (ref === 'ref_concurrent')
				return {
					kind: 'object',
					entries: [{ key: 'next', value: { kind: 'truncated', ref: 'ref_nested', label: 'Object' } }],
				}
			return { kind: 'object', entries: [] }
		},
		supportsAnsi: false,
	})
	const pLow = concurrentEntry.renderPlain({ maxDepth: 3 })
	const pHigh = concurrentEntry.renderHtml({ maxDepth: 7 })
	openGate?.()
	await Promise.all([pLow, pHigh])
	assert(concurrentCalls.some((x) => x.maxDepth === 3), '并发中低深度请求存在')
	assert(concurrentCalls.some((x) => x.ref === 'ref_nested' && x.maxDepth === 6), '并发中高深度任务会在低深度任务后继续补展开')
}

/**
 * 验证 client 侧 snapshot/append/expand/detach 行为。
 */
async function testAttachLogWireDispatchAndExpand() {
	console.log('\n=== [wire：client 分发/扩展/detach] ===')
	/** @type {Record<string, Set<(event: { data?: string }) => void>>} */
	const listeners = {}
	/** @type {string[]} */
	const sentTexts = []
	const ws = {
		readyState: 1,
		/**
		 * 注册事件监听。
		 * @param {string} ev - 事件名。
		 * @param {(event: { data?: string }) => void} fn - 回调。
		 * @returns {void}
		 */
		addEventListener(ev, fn) { if (!listeners[ev]) listeners[ev] = new Set(); listeners[ev].add(fn) },
		/**
		 * 移除事件监听。
		 * @param {string} ev - 事件名。
		 * @param {(event: { data?: string }) => void} fn - 回调。
		 * @returns {void}
		 */
		removeEventListener(ev, fn) { listeners[ev]?.delete(fn) },
		/**
		 * 发送数据。
		 * @param {string} data - 文本内容。
		 * @returns {void}
		 */
		send(data) { sentTexts.push(String(data)) },
		/**
		 * 关闭连接（测试桩）。
		 * @returns {void}
		 */
		close() { },
	}
	/**
	 * 向 message 监听器分发一条消息。
	 * @param {string} data - 事件负载。
	 * @returns {Promise<void>}
	 */
	async function emitMessage(data) {
		const cbs = [...listeners.message || []]
		for (const cb of cbs) await cb({ data })
	}
	/** @type {WireLogEntry[][]} */
	const snapshots = []
	/** @type {WireLogEntry[]} */
	const appends = []
	let clearCalls = 0
	let parseErrors = 0
	let unknownCalls = 0
	const wire = attachLogWire(/** @type {WebSocket} */ ws, {
		/**
		 * 处理快照事件。
		 * @param {WireLogEntry[]} entries - 条目列表。
		 * @returns {void}
		 */
		onSnapshot: (entries) => { snapshots.push(entries) },
		/**
		 * 处理 append 事件。
		 * @param {WireLogEntry} entry - 单条条目。
		 * @returns {void}
		 */
		onAppend: (entry) => { appends.push(entry) },
		/**
		 * 处理 clear 事件。
		 * @returns {void}
		 */
		onClear: () => { clearCalls++ },
		/**
		 * 处理 unknown 事件。
		 * @returns {void}
		 */
		onUnknown: () => { unknownCalls++ },
		/**
		 * 处理 parse 错误。
		 * @returns {void}
		 */
		onParseError: () => { parseErrors++ },
		supportsAnsi: false,
	})
	await emitMessage(JSON.stringify({ type: logWirePayloadTypes.SNAPSHOT, entries: [{ id: 1, level: 'log', method: 'log', timestamp: 1, segments: [{ kind: 'text', text: 's1' }] }] }))
	await emitMessage(JSON.stringify({ type: logWirePayloadTypes.APPEND, entry: { id: 2, level: 'warn', method: 'warn', timestamp: 2, segments: [{ kind: 'text', text: 'a1' }] } }))
	await emitMessage(JSON.stringify({ type: logWirePayloadTypes.CLEARED }))
	await emitMessage('{"type":')
	await emitMessage(JSON.stringify({ type: 'my_custom_type', x: 1 }))
	assertEqual(snapshots.length, 1, 'snapshot 回调触发 1 次')
	assertEqual(snapshots[0].length, 1, 'snapshot 含 1 条 WireLogEntry')
	assertEqual(await snapshots[0][0].renderPlain(), 's1', 'snapshot 条目可渲染')
	assertEqual(appends.length, 1, 'append 回调触发 1 次')
	assertEqual(await appends[0].renderString(), 'a1', 'append 条目可渲染')
	assertEqual(clearCalls, 1, 'clear 回调触发 1 次')
	assertEqual(parseErrors, 1, '非法 JSON 触发 parse error')
	assertEqual(unknownCalls, 1, '未知 type 触发 onUnknown')
	const expOk = wire.requestExpand('ref_ok')
	const req1 = JSON.parse(sentTexts[sentTexts.length - 1])
	assertEqual(req1.type, logWirePayloadTypes.EXPAND_REQUEST, 'requestExpand 发送 expand_request')
	assertEqual(req1.ref, 'ref_ok', 'requestExpand 发送 ref')
	await emitMessage(JSON.stringify({ type: logWirePayloadTypes.EXPAND_RESULT, ref: 'ref_ok', ok: true, snapshot: { kind: 'string', value: 'expanded' } }))
	const expanded = await expOk
	assertEqual(/** @type {{ kind?: string }} */ expanded.kind, 'string', 'expand_result(ok) 兑现快照')
	const expFail = wire.requestExpand('ref_fail')
	await emitMessage(JSON.stringify({ type: logWirePayloadTypes.EXPAND_RESULT, ref: 'ref_fail', ok: false, error: 'boom' }))
	let failMsg = ''
	try { await expFail } catch (error) { failMsg = String(/** @type {Error} */ error.message) }
	assertIncludes(failMsg, 'boom', 'expand_result(fail) 走 reject')
	const expPending = wire.requestExpand('ref_pending')
	wire.detach()
	let detachedMsg = ''
	try { await expPending } catch (error) { detachedMsg = String(/** @type {Error} */ error.message) }
	assertIncludes(detachedMsg, 'log_wire_detached', 'detach 拒绝挂起的 expand 请求')
	const clearOk = wire.requestClear()
	assert(clearOk, 'requestClear 返回 true')
	assertEqual(JSON.parse(sentTexts[sentTexts.length - 1]).type, logWirePayloadTypes.CLEAR_REQUEST, 'requestClear 发送 clear_request')
	const sendOk = wire.sendJson({ type: 'host_ping' })
	assert(sendOk, 'sendJson 返回 true')
	assertEqual(JSON.parse(sentTexts[sentTexts.length - 1]).type, 'host_ping', 'sendJson 发送任意 JSON')
}

/**
 * 运行“wire 协议（server + client）”分组测试。
 */
export async function runWireProtocolTests() {
	await runTestGroup('wire 协议（server + client）', [
		testCreateLogWireWebSocketHandlerWithProxy,
		testLogWireHandlerClientControl,
		testLogWireServerLifecycleHooks,
		testLogWireServerCustomClientPayloadHandling,
		testWireHelpers,
		testAttachLogWireDispatchAndExpand,
	])
}
