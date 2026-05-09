import {
	VirtualConsole,
	WireLogEntry,
} from '@steve02081504/virtual-console'
import {
	attachLogWire,
	createWireLogEntryFromJson,
} from '@steve02081504/virtual-console/wire/client'
import {
	dispatchLogWireMessage,
	logWirePayloadTypes,
} from '@steve02081504/virtual-console/wire/protocol'
import { createLogWireWebSocketHandler } from '@steve02081504/virtual-console/wire/server'

import { assert, assertEqual, assertIncludes, runTestGroup } from '../../harness.mjs'

/**
 * 生成一个最小可用的 WebSocket 测试桩。
 * @param {{ onSend?: (data: string) => void, onClose?: () => void }} [options] - 可选钩子。
 * @returns {{
 *   readyState: number,
 *   listeners: Record<string, ((...args: unknown[]) => void)[]>,
 *   on: (ev: string, fn: (...args: unknown[]) => void) => void,
 *   once: (ev: string, fn: (...args: unknown[]) => void) => void,
 *   addEventListener: (ev: string, fn: (...args: unknown[]) => void) => void,
 *   removeEventListener: (ev: string, fn: (...args: unknown[]) => void) => void,
 *   send: (data: string) => void,
 *   emit: (ev: string, ...args: unknown[]) => void,
 *   close: () => void,
 * }} 可注入事件并记录发送文本的最小 WebSocket 兼容对象。
 */
function createMockWebSocket({ onSend, onClose } = {}) {
	/** @type {Record<string, ((...args: unknown[]) => void)[]>} */
	const listeners = {}
	/**
	 * 注册事件监听器。
	 * @param {string} ev - 事件名。
	 * @param {(...args: unknown[]) => void} fn - 事件回调。
	 * @returns {void}
	 */
	const add = (ev, fn) => {
		if (!listeners[ev])
			listeners[ev] = []
		listeners[ev].push(fn)
	}
	const ws = {
		readyState: 1,
		listeners,
		on: add,
		/**
		 * 注册一次性事件监听器。
		 * @param {string} ev - 事件名。
		 * @param {(...args: unknown[]) => void} fn - 事件回调。
		 * @returns {void}
		 */
		once: (ev, fn) => {
			/**
			 * 包装原始回调并在首次触发后自动卸载。
			 * @param {...unknown} args - 事件参数。
			 * @returns {void}
			 */
			const onceFn = (...args) => {
				ws.removeEventListener(ev, onceFn)
				fn(...args)
			}
			add(ev, onceFn)
		},
		addEventListener: add,
		/**
		 * 移除指定事件上的一个监听函数。
		 * @param {string} ev - 事件名。
		 * @param {(...args: unknown[]) => void} fn - 目标回调。
		 * @returns {void}
		 */
		removeEventListener: (ev, fn) => {
			if (!listeners[ev])
				return
			listeners[ev] = listeners[ev].filter((cb) => cb !== fn)
		},
		/**
		 * 发送文本帧到测试桩外侧收集器。
		 * @param {string} data - 待发送文本。
		 * @returns {void}
		 */
		send: (data) => { onSend?.(String(data)) },
		/**
		 * 触发指定事件并同步分发到监听器。
		 * @param {string} ev - 事件名。
		 * @param {...unknown} args - 事件参数。
		 * @returns {void}
		 */
		emit: (ev, ...args) => {
			for (const cb of [...listeners[ev] || []])
				cb(...args)
		},
		/**
		 * 关闭测试桩连接并触发 close 事件。
		 * @returns {void}
		 */
		close: () => {
			ws.readyState = 3
			onClose?.()
			ws.emit('close')
		},
	}
	return ws
}

/**
 * 判断发送列表中是否存在指定 type。
 * @param {string[]} sentTexts - 已发送文本帧。
 * @param {string} type - 目标 type。
 * @returns {boolean} 命中指定 `type` 时返回 `true`。
 */
function hasSentType(sentTexts, type) {
	return sentTexts.some((s) => {
		try {
			return JSON.parse(s).type === type
		}
		catch {
			return false
		}
	})
}

/**
 * 向 message 监听器分发一条消息。
 * @param {ReturnType<typeof createMockWebSocket>} ws - 测试桩套接字。
 * @param {string} data - 事件负载。
 * @returns {Promise<void>}
 */
async function emitWireMessage(ws, data) {
	for (const cb of [...ws.listeners.message || []])
		await cb({ data })
}

/**
 * 等待一个事件循环轮次，便于观察异步回调副作用。
 * @returns {Promise<void>}
 */
async function waitOneTick() {
	await new Promise(resolve => setTimeout(resolve, 0))
}

/**
 * 验证传入全局 console 代理时 server handler 可正常广播。
 */
async function testCreateLogWireWebSocketHandlerWithProxy() {
	console.log('\n=== [wire：全局 console Proxy + WebSocket handler] ===')
	const vc = new VirtualConsole({ recordOutput: true, realConsoleOutput: false })
	/** @type {{ messages: string[] }} */
	const wire = { messages: [] }
	await vc.hookAsyncContext(async () => {
		const mockWs = createMockWebSocket({
			/**
			 * 收集服务端发送帧文本。
			 * @param {string} data - 序列化 JSON 文本帧。
			 * @returns {void}
			 */
			onSend: (data) => wire.messages.push(data),
		})
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
	const mockWs = createMockWebSocket({
		/**
		 * 收集 handler 广播与回包文本。
		 * @param {string} data - 序列化 JSON 文本帧。
		 * @returns {void}
		 */
		onSend: (data) => { received.push(data) },
		/**
		 * 记录 close 触发次数。
		 * @returns {void}
		 */
		onClose: () => { closeEmitCount++ },
	})
	handler(/** @type {Parameters<typeof handler>[0]} */ mockWs)
	handler.broadcastJson({ type: 'host_ping', x: 1 })
	assert(hasSentType(received, 'host_ping'), 'broadcastJson 下发到已连接客户端')
	let seen = 0
	handler.forEachClient(() => { seen++ })
	assertEqual(seen, 1, 'forEachClient 遍历到 1 个套接字')
	await handler.closeAllWithFinalJson({ type: 'host_bye' })
	assert(hasSentType(received, 'host_bye'), 'closeAllWithFinalJson 先发最终 JSON')
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
	const mockWs = createMockWebSocket()
	handler(/** @type {Parameters<typeof handler>[0]} */ mockWs)
	assertEqual(calls[0]?.type, 'connected', '新连接触发 onClientConnected')
	assertEqual(calls[0]?.count, 1, 'connected 回调可见连接数')
	mockWs.close()
	assertEqual(calls[1]?.type, 'disconnected', '关闭连接触发 onClientDisconnected')
	assertEqual(calls[1]?.reason, 'close', '断开原因为 close')
	assertEqual(calls[1]?.count, 0, 'disconnect 回调可见移除后连接数')
}

/**
 * 验证 server 内置控制消息：expand_request/clear_request。
 */
async function testLogWireServerBuiltInClientMessages() {
	console.log('\n=== [wire：server 内置客户端控制消息] ===')
	let clearCalls = 0
	const vc = {
		outputEntries: [],
		/**
		 *
		 */
		addLogEntryListener: () => { },
		/**
		 * 测试桩：不需要实现具体移除逻辑。
		 * @returns {void}
		 */
		removeLogEntryListener: () => { },
		/**
		 * 测试桩：不需要实现具体注册逻辑。
		 * @returns {void}
		 */
		addClearListener: () => { },
		/**
		 * 测试桩：不需要实现具体移除逻辑。
		 * @returns {void}
		 */
		removeClearListener: () => { },
		/**
		 * 统计 clear 调用次数。
		 * @returns {void}
		 */
		clear: () => { clearCalls++ },
	}
	/** @type {string[]} */
	const sent = []
	const handler = createLogWireWebSocketHandler(vc)
	const mockWs = createMockWebSocket({
		/**
		 * 收集服务端回包文本。
		 * @param {string} data - 序列化 JSON 文本帧。
		 * @returns {void}
		 */
		onSend: (data) => sent.push(data),
	})
	handler(/** @type {Parameters<typeof handler>[0]} */ mockWs)
	await mockWs.listeners.message?.[0]?.(JSON.stringify({ type: logWirePayloadTypes.EXPAND_REQUEST, ref: 'missing_ref' }))
	await mockWs.listeners.message?.[0]?.(JSON.stringify({ type: logWirePayloadTypes.CLEAR_REQUEST }))
	const expandReplies = sent
		.map((text) => JSON.parse(text))
		.filter((payload) => payload.type === logWirePayloadTypes.EXPAND_RESULT)
	assert(expandReplies.some((payload) => payload.ref === 'missing_ref' && payload.ok === false), 'expand_request(missing_ref) 返回 fail')
	assertEqual(clearCalls, 1, 'clear_request 触发 virtualConsole.clear')
}

/**
 * 验证 server 生命周期回调支持 async 且不会产生未处理拒绝。
 */
async function testLogWireServerLifecycleAsyncHooksAreAbsorbed() {
	console.log('\n=== [wire：server async 生命周期回调托管] ===')
	const vc = new VirtualConsole({ recordOutput: true, realConsoleOutput: false })
	/** @type {unknown[]} */
	const unhandled = []
	/**
	 * 记录未处理 Promise 拒绝，便于断言 handler 是否正确托管异步错误。
	 * @param {unknown} reason - rejection 原因。
	 * @returns {void}
	 */
	const onUnhandled = (reason) => { unhandled.push(reason) }
	process.on('unhandledRejection', onUnhandled)
	try {
		const handler = createLogWireWebSocketHandler(vc, {
			/**
			 * 模拟连接回调异步失败。
			 * @returns {Promise<void>}
			 */
			onClientConnected: async () => { throw new Error('connect_async_fail') },
			/**
			 * 模拟断开回调异步失败。
			 * @returns {Promise<void>}
			 */
			onClientDisconnected: async () => { throw new Error('disconnect_async_fail') },
		})
		const mockWs = createMockWebSocket()
		handler(/** @type {Parameters<typeof handler>[0]} */ mockWs)
		mockWs.close()
		await waitOneTick()
		assertEqual(unhandled.length, 0, 'async 生命周期回调 reject 不产生 unhandledRejection')
	}
	finally {
		process.off('unhandledRejection', onUnhandled)
	}
}

/**
 * 验证 server 在 ws error 分支触发 disconnected(reason=error)。
 */
async function testLogWireServerLifecycleErrorHook() {
	console.log('\n=== [wire：server error 生命周期回调] ===')
	const vc = new VirtualConsole({ recordOutput: true, realConsoleOutput: false })
	/** @type {Array<{ reason: string, count: number }>} */
	const disconnected = []
	const handler = createLogWireWebSocketHandler(vc, {
		/**
		 * 收集断连事件参数。
		 * @param {{ reason: 'close' | 'error', clientCount: number }} root0 - 生命周期参数。
		 * @param {'close' | 'error'} root0.reason - 断开原因。
		 * @param {number} root0.clientCount - 断开后连接数。
		 * @returns {void}
		 */
		onClientDisconnected: ({ reason, clientCount }) => {
			disconnected.push({ reason, count: clientCount })
		},
	})
	const mockWs = createMockWebSocket()
	handler(/** @type {Parameters<typeof handler>[0]} */ mockWs)
	mockWs.emit('error', new Error('socket_error'))
	assertEqual(disconnected.length, 1, 'error 事件触发 disconnect 回调')
	assertEqual(disconnected[0].reason, 'error', '断开原因为 error')
	assertEqual(disconnected[0].count, 0, '错误断开后连接数为 0')
}

/**
 * 验证 dispose 可移除在 virtualConsole 上注册的监听器。
 */
async function testLogWireServerHandlerDispose() {
	console.log('\n=== [wire：server handler dispose] ===')
	/** @type {Set<(entry: unknown) => void>} */
	const logListeners = new Set()
	/** @type {Set<() => void>} */
	const clearListeners = new Set()
	const vc = {
		outputEntries: [],
		/**
		 * 测试桩：仅占位，测试中不触发。
		 * @returns {void}
		 */
		clear: () => { },
		/**
		 * 记录日志监听器注册。
		 * @param {(entry: unknown) => void} fn - 日志监听器。
		 * @returns {void}
		 */
		addLogEntryListener: (fn) => { logListeners.add(fn) },
		/**
		 * 记录日志监听器移除。
		 * @param {(entry: unknown) => void} fn - 日志监听器。
		 * @returns {void}
		 */
		removeLogEntryListener: (fn) => { logListeners.delete(fn) },
		/**
		 * 记录 clear 监听器注册。
		 * @param {() => void} fn - clear 监听器。
		 * @returns {void}
		 */
		addClearListener: (fn) => { clearListeners.add(fn) },
		/**
		 * 记录 clear 监听器移除。
		 * @param {() => void} fn - clear 监听器。
		 * @returns {void}
		 */
		removeClearListener: (fn) => { clearListeners.delete(fn) },
	}
	const handler = createLogWireWebSocketHandler(vc)
	assertEqual(logListeners.size, 1, '创建 handler 时新增一条日志监听')
	assertEqual(clearListeners.size, 1, '创建 handler 时新增一条 clear 监听')
	handler.dispose()
	assertEqual(logListeners.size, 0, 'dispose 后日志监听被移除')
	assertEqual(clearListeners.size, 0, 'dispose 后 clear 监听被移除')
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
	const mockWs = createMockWebSocket({
		/**
		 * 收集 typed/fallback 处理器回包。
		 * @param {string} data - 序列化 JSON 文本帧。
		 * @returns {void}
		 */
		onSend: (data) => sent.push(data),
	})
	await handler(/** @type {Parameters<typeof handler>[0]} */ mockWs)
	await mockWs.listeners.message?.[0]?.(JSON.stringify({ type: 'my_custom_ping', seq: 1 }))
	await mockWs.listeners.message?.[0]?.(JSON.stringify({ type: 'my_custom_unknown', seq: 2 }))
	assert(seen.some((x) => x.route === 'typed' && x.type === 'my_custom_ping'), '命中按 type 的自定义处理器')
	assert(seen.some((x) => x.route === 'fallback' && x.type === 'my_custom_unknown'), '未命中时走 onClientMessage 兜底')
	assert(hasSentType(sent, 'my_custom_pong'), 'typed 处理器返回对象会回包')
	assert(hasSentType(sent, 'fallback_ack'), 'fallback 处理器返回对象会回包')
}

/**
 * 验证 server 处理自定义上行消息时会托管异步拒绝。
 */
async function testLogWireServerCustomClientPayloadAsyncRejectIsAbsorbed() {
	console.log('\n=== [wire：server 自定义上行 reject 托管] ===')
	const vc = new VirtualConsole({ recordOutput: true, realConsoleOutput: false })
	/** @type {unknown[]} */
	const unhandled = []
	/**
	 * 记录未处理 Promise 拒绝，验证是否被 server 吸收。
	 * @param {unknown} reason - rejection 原因。
	 * @returns {void}
	 */
	const onUnhandled = (reason) => { unhandled.push(reason) }
	process.on('unhandledRejection', onUnhandled)
	try {
		const handler = createLogWireWebSocketHandler(vc, {
			/**
			 * 模拟自定义上行处理器异步失败。
			 * @param {{ message: Record<string, unknown> }} root0 - 客户端消息事件。
			 * @param {Record<string, unknown>} root0.message - 客户端消息体。
			 * @returns {Promise<null>} 始终返回 `null` 以表示无自定义回包。
			 */
			onClientMessage: async ({ message }) => {
				if (message.type === 'my_async_fail')
					throw new Error('custom_async_fail')
				return null
			},
		})
		const mockWs = createMockWebSocket()
		handler(/** @type {Parameters<typeof handler>[0]} */ mockWs)
		await mockWs.listeners.message?.[0]?.(JSON.stringify({ type: 'my_async_fail' }))
		await waitOneTick()
		assertEqual(unhandled.length, 0, '自定义上行处理 reject 不产生 unhandledRejection')
	}
	finally {
		process.off('unhandledRejection', onUnhandled)
	}
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
	const w = createWireLogEntryFromJson({
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
	const deepTruncatedEntry = createWireLogEntryFromJson({
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
	const concurrentEntry = createWireLogEntryFromJson({
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
	/** @type {string[]} */
	const sentTexts = []
	const ws = createMockWebSocket({
		/**
		 * 收集 client 侧发出的请求帧。
		 * @param {string} data - 序列化 JSON 文本帧。
		 * @returns {void}
		 */
		onSend: (data) => sentTexts.push(data),
	})
	/** @type {WireLogEntry[][]} */
	const snapshots = []
	/** @type {WireLogEntry[]} */
	const appends = []
	let clearCalls = 0
	let parseErrors = 0
	let dispatchErrors = 0
	let fatalFallbackErrors = 0
	let unknownCalls = 0
	const wire = attachLogWire(/** @type {WebSocket} */ ws, {
		/**
		 * 处理快照事件。
		 * @param {WireLogEntry[]} entries - 条目列表。
		 * @returns {void}
		 */
		onSnapshot: (entries) => {
			const firstSegment = entries[0]?.segments?.[0]
			if (firstSegment?.kind === 'text' && firstSegment.text === 'dispatch_err')
				throw new Error('snapshot_dispatch_error')
			snapshots.push(entries)
		},
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
		/**
		 * 处理分发错误。
		 * @returns {void}
		 */
		onDispatchError: () => { dispatchErrors++ },
		supportsAnsi: false,
	})
	await emitWireMessage(ws, JSON.stringify({ type: logWirePayloadTypes.SNAPSHOT, entries: [{ id: 1, level: 'log', method: 'log', timestamp: 1, segments: [{ kind: 'text', text: 's1' }] }] }))
	await emitWireMessage(ws, JSON.stringify({ type: logWirePayloadTypes.APPEND, entry: { id: 2, level: 'warn', method: 'warn', timestamp: 2, segments: [{ kind: 'text', text: 'a1' }] } }))
	await emitWireMessage(ws, JSON.stringify({ type: logWirePayloadTypes.CLEARED }))
	await emitWireMessage(ws, '{"type":')
	await emitWireMessage(ws, JSON.stringify({ type: logWirePayloadTypes.SNAPSHOT, entries: [{ id: 9, level: 'log', method: 'log', timestamp: 9, segments: [{ kind: 'text', text: 'dispatch_err' }] }] }))
	await emitWireMessage(ws, JSON.stringify({ type: 'my_custom_type', x: 1 }))
	assertEqual(snapshots.length, 1, 'snapshot 回调触发 1 次')
	assertEqual(snapshots[0].length, 1, 'snapshot 含 1 条 WireLogEntry')
	assertEqual(await snapshots[0][0].renderPlain(), 's1', 'snapshot 条目可渲染')
	assertEqual(appends.length, 1, 'append 回调触发 1 次')
	assertEqual(await appends[0].renderString(), 'a1', 'append 条目可渲染')
	assertEqual(clearCalls, 1, 'clear 回调触发 1 次')
	assertEqual(parseErrors, 1, '非法 JSON 触发 parse error')
	assertEqual(dispatchErrors, 1, '分发/回调异常触发 dispatch error')
	assertEqual(unknownCalls, 1, '未知 type 触发 onUnknown')
	const expOk = wire.requestExpand('ref_ok')
	const req1 = JSON.parse(sentTexts[sentTexts.length - 1])
	assertEqual(req1.type, logWirePayloadTypes.EXPAND_REQUEST, 'requestExpand 发送 expand_request')
	assertEqual(req1.ref, 'ref_ok', 'requestExpand 发送 ref')
	assertEqual(req1.maxDepth, undefined, '未传 maxDepth 时请求不带该字段')
	const expNeg = wire.requestExpand('ref_depth_neg', -1)
	const reqDepthNeg = JSON.parse(sentTexts[sentTexts.length - 1])
	assertEqual(reqDepthNeg.maxDepth, 0, '负数 maxDepth 会被归一化为 0')
	const expFloat = wire.requestExpand('ref_depth_float', 5.8)
	const reqDepthFloat = JSON.parse(sentTexts[sentTexts.length - 1])
	assertEqual(reqDepthFloat.maxDepth, 5, '小数 maxDepth 会向下取整')
	await emitWireMessage(ws, JSON.stringify({ type: logWirePayloadTypes.EXPAND_RESULT, ref: 'ref_depth_neg', ok: true, snapshot: { kind: 'number', value: '0' } }))
	await emitWireMessage(ws, JSON.stringify({ type: logWirePayloadTypes.EXPAND_RESULT, ref: 'ref_depth_float', ok: true, snapshot: { kind: 'number', value: '5' } }))
	await expNeg
	await expFloat
	const expSameRefA = wire.requestExpand('ref_same')
	const expSameRefB = wire.requestExpand('ref_same')
	assertEqual(expSameRefA, expSameRefB, '同 ref 并发请求复用同一 Promise')
	assertEqual(
		sentTexts.filter((s) => {
			try {
				const payload = JSON.parse(s)
				return payload.type === logWirePayloadTypes.EXPAND_REQUEST && payload.ref === 'ref_same'
			}
			catch {
				return false
			}
		}).length,
		1,
		'同 ref 并发请求仅发送一次 expand_request',
	)
	await emitWireMessage(ws, JSON.stringify({ type: logWirePayloadTypes.EXPAND_RESULT, ref: 'ref_same', ok: true, snapshot: { kind: 'string', value: 'same' } }))
	const [sameA, sameB] = await Promise.all([expSameRefA, expSameRefB])
	assertEqual(/** @type {{ value?: string }} */ sameA.value, 'same', '同 ref 第一个等待者收到结果')
	assertEqual(/** @type {{ value?: string }} */ sameB.value, 'same', '同 ref 第二个等待者收到结果')
	await emitWireMessage(ws, JSON.stringify({ type: logWirePayloadTypes.EXPAND_RESULT, ref: 'ref_ok', ok: true, snapshot: { kind: 'string', value: 'expanded' } }))
	const expanded = await expOk
	assertEqual(/** @type {{ kind?: string }} */ expanded.kind, 'string', 'expand_result(ok) 兑现快照')
	const expFail = wire.requestExpand('ref_fail')
	await emitWireMessage(ws, JSON.stringify({ type: logWirePayloadTypes.EXPAND_RESULT, ref: 'ref_fail', ok: false, error: 'boom' }))
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

	// 兜底接口：未提供 onParseError/onDispatchError 时，错误走 onFatal。
	const wsLegacy = createMockWebSocket()
	const wireLegacy = attachLogWire(/** @type {WebSocket} */ wsLegacy, {
		/**
		 * 测试桩：用于触发 onFatal 兜底。
		 * @returns {void}
		 */
		onSnapshot: () => { throw new Error('legacy_dispatch_error') },
		/**
		 * 测试桩：用于增加 fatalFallbackErrors 计数来验证兜底效果。
		 * @returns {void}
		 */
		onFatal: () => { fatalFallbackErrors++ },
		supportsAnsi: false,
	})
	await emitWireMessage(
		wsLegacy,
		JSON.stringify({ type: logWirePayloadTypes.SNAPSHOT, entries: [{ id: 10, level: 'log', method: 'log', timestamp: 10, segments: [{ kind: 'text', text: 'legacy' }] }] }),
	)
	assertEqual(fatalFallbackErrors, 1, '未提供特化处理器时分发错误走 onFatal 兜底')
	wireLegacy.detach()
}

/**
 * 验证 client 在非 OPEN 连接上的发送行为。
 */
async function testAttachLogWireNonOpenSendBehavior() {
	console.log('\n=== [wire：client 非 OPEN 发送行为] ===')
	const ws = createMockWebSocket()
	ws.readyState = 0
	const wire = attachLogWire(/** @type {WebSocket} */ ws, { supportsAnsi: false })
	assertEqual(wire.requestClear(), false, '非 OPEN 时 requestClear 返回 false')
	assertEqual(wire.sendJson({ type: 'custom' }), false, '非 OPEN 时 sendJson 返回 false')
	let rejected = ''
	try {
		await wire.requestExpand('non_open_ref')
	}
	catch (error) {
		rejected = String(/** @type {Error} */ error.message)
	}
	assertIncludes(rejected, 'log_wire_send_failed', '非 OPEN 时 requestExpand 走 reject')
	wire.detach()
}

/**
 * 运行“wire 协议（server + client）”分组测试。
 */
export async function runWireProtocolTests() {
	await runTestGroup('wire 协议（server + client）', [
		testCreateLogWireWebSocketHandlerWithProxy,
		testLogWireHandlerClientControl,
		testLogWireServerLifecycleHooks,
		testLogWireServerBuiltInClientMessages,
		testLogWireServerLifecycleAsyncHooksAreAbsorbed,
		testLogWireServerLifecycleErrorHook,
		testLogWireServerHandlerDispose,
		testLogWireServerCustomClientPayloadHandling,
		testLogWireServerCustomClientPayloadAsyncRejectIsAbsorbed,
		testWireHelpers,
		testAttachLogWireDispatchAndExpand,
		testAttachLogWireNonOpenSendBehavior,
	])
}
