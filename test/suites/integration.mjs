import util from 'node:util'
import vm from 'node:vm'

import {
	VirtualConsole,
	LogEntry,
	WireLogEntry,
	DEFAULT_SNAPSHOT_DEPTH,
	expandSnapshotRef,
	getLogEntryArgs,
	serializeArgSnapshot,
	getStackInfo,
	renderAnsi,
	renderHtml,
	renderPlain,
	buildArgsSegments,
} from '@steve02081504/virtual-console'
import {
	dispatchLogWireMessage,
	logWirePayloadTypes,
} from '@steve02081504/virtual-console/wire/protocol'
import { createLogWireWebSocketHandler } from '@steve02081504/virtual-console/wire/server'


import { pathToFileURL } from '../../src/core/stack.mjs'
import { parseCssDecls } from '../../src/format/css-to-ansi.mjs'
import { assert, assertEqual, assertIncludes, passed, failed } from '../harness.mjs'

/**
 * printf 风格参数 → 纯文本（等价于 `renderPlain(buildArgsSegments(args, null, DEFAULT_SNAPSHOT_DEPTH))`，仅测试使用）。
 * @param {unknown[]} args - 与 `console.log` 一致的参数列表。
 * @returns {string} 剥除 ANSI 后的拼接文本。
 */
function renderPrintfPlain(args) {
	return renderPlain(buildArgsSegments(args, null, DEFAULT_SNAPSHOT_DEPTH))
}

/**
 * 无 `node:url` 时降级 `pathToFileURL` 在 Windows 盘符路径上应保留 `C:` 而非 `C%3A`。
 * @returns {void}
 */
function testPathToFileURLWindowsDriveUnescapedColon() {
	console.log('\n=== [pathToFileURL：Windows 盘符 URL] ===')
	const url = pathToFileURL('C:/Users/foo bar')
	assert(url.startsWith('file:///C:/'), 'file URL 应以 file:///C:/ 为前缀')
	assert(!url.includes('C%3A'), '盘符不应被误编成 C%3A')
	assert(url.includes('foo%20bar'), '空格应编码为 %20')
}

/**
 * `#RGBA` 四位十六进制色应识别 alpha 并参与 dim 提示（与八位 hex 一致）。
 * @returns {void}
 */
function testCssHex4DigitAlphaDim() {
	console.log('\n=== [CSS #RGBA 四位 hex → dim] ===')
	const flags = parseCssDecls('color: #1234')
	assert(flags.dim === true, '#1234 含非不透明 alpha 时须 dim')
}

/**
 * Node `Console` 子类在删除实例上的 `_stdout` 后，读属性仍应命中子类 getter 并返回 `VirtualStream`。
 * @returns {Promise<void>}
 */
async function testNodeVirtualConsoleStdoutUsesGetterVirtualStream() {
	console.log('\n=== [Node：VirtualConsole#_stdout → VirtualStream] ===')
	const vc = new VirtualConsole({ recordOutput: true, realConsoleOutput: false })
	assert(vc._stdout?.constructor?.name === 'VirtualStream', '应经 getter 取得 VirtualStream，而非被基类 own 属性挡住')
}

/**
 * `supportsAnsi: true` 的 VirtualConsole：`console.log(obj)` 的聚合文本等于 `renderAnsi(toSegments(), { colorize: true })`（尾换行在片段中）；obj 含 Date、number、string、bigint。
 */
async function testSupportsAnsiVcLogComplexObject() {
	console.log('\n=== [supportsAnsi：log 含 date/number/string/bigint] ===')

	const obj = {
		d: new Date(0),
		n: 42,
		s: 'hello',
		b: 2n,
	}

	const vc = new VirtualConsole({
		recordOutput: true,
		realConsoleOutput: false,
		supportsAnsi: true,
	})

	await vc.hookAsyncContext(() => {
		console.log(obj)
	})

	assertEqual(vc.outputEntries.length, 1, '捕获一条日志')
	assert(vc.outputEntries[0].supportsAnsi === true, '条目 supportsAnsi')
	assert(getLogEntryArgs(vc.outputEntries[0])[0] === obj, '参数引用一致')
	assertEqual(
		vc.outputs,
		renderAnsi(vc.outputEntries[0].toSegments(), { colorize: true }),
		'outputs 与 toSegments→renderAnsi（换行在片段内）一致',
	)
}

/**
 * 测试 VirtualConsole 的各种渲染功能（原有测试，保留为可视化验证）
 */
async function testRendering() {
	console.log('\n=== [渲染功能测试] ===')

	const vc = new VirtualConsole({
		recordOutput: true,
		realConsoleOutput: false
	})

	await vc.hookAsyncContext(() => {
		console.log('--- [1. Standard Placeholders] ---')
		console.log('String: %s', 'Hello World')
		console.log('Integer: %d, Float: %f', 123, 45.678)
		console.log('JSON Object: %o', { id: 1, status: 'ok' })

		console.log('\n--- [2. ANSI Colors] ---')
		console.log('\x1b[31mRed Text\x1b[0m')
		console.log('\x1b[32mGreen Text\x1b[0m and \x1b[34mBlue Text\x1b[0m')

		console.log('\n--- [3. CSS Styling (%c)] ---')
		console.log('%cThis text is Blue and Large', 'color: blue; font-size: 20px')
		console.log('Normal, %cRed Background%c, Normal again', 'background: red; color: white', '')

		console.log('\n--- [4. Injection Test] ---')
		const injectionPayload = '"><script>alert("pwned")</script><span style="'
		console.log('%cInjection Test', injectionPayload)
		console.log('Attempting to inject a script tag: %s', '<script>alert("oops")</script>')

		console.log('\n--- [5. Special Cases] ---')
		console.log('%s', Object.create(null))
		const a = {}
		a.a = a
		console.log(a)
		console.log('%f', Symbol('lol'))
		console.log('%d', Symbol('lol'))
		console.log('%j', Symbol('lol'))
		console.log('%o', Symbol('lol'))
	})

	assertIncludes(vc.outputs, 'String: Hello World', 'outputs 包含格式化字符串')
	assertIncludes(vc.outputs, 'Integer: 123, Float: 45.678', 'outputs 包含数字格式化')
	assertIncludes(vc.outputsHtml, '&lt;script&gt;', 'HTML 输出对 script 标签进行了转义')
	assertIncludes(vc.outputsHtml, 'color: blue; font-size: 20px', '支持 %c CSS 样式')
	assertIncludes(vc.outputs, 'NaN', 'Symbol 用于 %f/%d 格式化时返回 NaN')
}

/**
 * 测试 outputEntries 结构化日志条目
 */
async function testOutputEntries() {
	console.log('\n=== [outputEntries 结构化日志条目测试] ===')

	const vc = new VirtualConsole({ recordOutput: true, realConsoleOutput: false })

	await vc.hookAsyncContext(() => {
		console.log('hello')
		console.warn('a warning')
		console.error('an error')
		console.info('info message')
		console.debug('debug message')
	})

	assertEqual(vc.outputEntries.length, 5, 'outputEntries 记录了5条日志')
	assertEqual(vc.outputEntries[0].level, 'log', '第1条为 log 级别')
	assertEqual(vc.outputEntries[1].level, 'warn', '第2条为 warn 级别')
	assertEqual(vc.outputEntries[2].level, 'error', '第3条为 error 级别')
	assertEqual(vc.outputEntries[3].level, 'info', '第4条为 info 级别')
	assertEqual(vc.outputEntries[4].level, 'debug', '第5条为 debug 级别')

	assert(getLogEntryArgs(vc.outputEntries[0])[0] === 'hello', '第1条捕获参数正确')
	assert(typeof vc.outputEntries[0].timestamp === 'number', 'timestamp 是数字')
	assert(vc.outputEntries[0].timestamp <= Date.now(), 'timestamp 合理')

	assertIncludes(vc.outputEntries[0].toString(), 'hello', 'logEntry.toString() 正确')
	assertIncludes(vc.outputEntries[1].toHtml(), 'a warning', 'logEntry.toHtml() 正确')

	assertIncludes(vc.outputs, 'hello', 'outputs getter 正确聚合内容')
	assertIncludes(vc.outputs, 'a warning', 'outputs 包含所有日志')
}

/**
 * 测试 console.dir 被捕获为 LogEntry（method === 'dir'）
 */
async function testConsoleDir() {
	console.log('\n=== [console.dir 捕获测试] ===')

	const vc = new VirtualConsole({ recordOutput: true, realConsoleOutput: false })

	await vc.hookAsyncContext(() => {
		console.dir({ id: 42, nested: { ok: true } }, { depth: 3 })
	})

	assertEqual(vc.outputEntries.length, 1, 'dir 产生一条 outputEntry')
	const dirEntry = vc.outputEntries[0]
	assertEqual(dirEntry.method, 'dir', 'method 为 dir')
	assertEqual(dirEntry.level, 'log', '语义级别为 log')

	const dirSegments = dirEntry.toSegments()
	assert(
		dirSegments.length === 2
		&& dirSegments[0].kind === 'value'
		&& 'snapshot' in dirSegments[0]
		&& dirSegments[1].kind === 'text' && /** @type {{ text: string }} */ dirSegments[1].text === '\n',
		'dir：单 value 段 + 尾换行 text',
	)

	const ansiFromSegments = renderAnsi(dirSegments, { colorize: dirEntry.supportsAnsi })
	assertEqual(
		ansiFromSegments,
		dirEntry.toString(),
		'dir：`renderAnsi(toSegments())` 必须与 `toString()` 一致',
	)
	assertEqual(
		renderPlain(dirSegments),
		dirEntry.toPlainText(),
		'dir：`renderPlain(toSegments())` 必须与 `toPlainText()` 一致',
	)

	assertIncludes(dirEntry.toString(), '42', 'dir toString 包含对象内容')
	assertIncludes(dirEntry.toHtml(), '42', 'dir toHtml 包含对象内容')
	assertIncludes(vc.outputs, '42', 'outputs 聚合含 dir 输出')
}

/**
 * 测试 maxLogEntries 限制
 */
async function testMaxLogEntries() {
	console.log('\n=== [maxLogEntries 限制测试] ===')

	const vc = new VirtualConsole({ recordOutput: true, realConsoleOutput: false, maxLogEntries: 3 })

	await vc.hookAsyncContext(() => {
		console.log('msg1')
		console.log('msg2')
		console.log('msg3')
		console.log('msg4')
		console.log('msg5')
	})

	assertEqual(vc.outputEntries.length, 3, 'maxLogEntries=3 时只保留最新3条')
	assert(getLogEntryArgs(vc.outputEntries[0])[0] === 'msg3', '第1条保留 msg3')
	assert(getLogEntryArgs(vc.outputEntries[1])[0] === 'msg4', '第2条保留 msg4')
	assert(getLogEntryArgs(vc.outputEntries[2])[0] === 'msg5', '第3条保留 msg5')
}

/**
 * 测试 clear() 重置
 */
async function testClear() {
	console.log('\n=== [clear() 重置测试] ===')

	const vc = new VirtualConsole({ recordOutput: true, realConsoleOutput: false })

	await vc.hookAsyncContext(() => {
		console.log('before clear')
	})

	assertEqual(vc.outputEntries.length, 1, 'clear 前有1条日志')
	let clearCount = 0
	vc.addClearListener(() => {
		clearCount++
	})
	vc.clear()
	assertEqual(clearCount, 1, 'clear 后触发 addClearListener')
	assertEqual(vc.outputEntries.length, 0, 'clear 后 outputEntries 为空')
	assertEqual(vc.outputs, '', 'clear 后 outputs 为空字符串')
	assertEqual(vc.outputsHtml, '', 'clear 后 outputsHtml 为空字符串')
}

/**
 * 全局 `console` 为 Proxy 时：须暴露监听/清空 API，且 add/remove 与 clear 可正确绑定 VirtualConsole。
 */
async function testGlobalConsoleProxy() {
	console.log('\n=== [全局 console 代理：API 与可调用性] ===')

	assert(typeof console.addLogEntryListener === 'function', 'console.addLogEntryListener 为函数')
	assert(typeof console.removeLogEntryListener === 'function', 'console.removeLogEntryListener 为函数')
	assert(typeof console.addClearListener === 'function', 'console.addClearListener 为函数')
	assert(typeof console.removeClearListener === 'function', 'console.removeClearListener 为函数')
	assert(typeof console.clear === 'function', 'console.clear 为函数')

	const vc = new VirtualConsole({ recordOutput: true, realConsoleOutput: false })

	let logCalls = 0
	/** @type {import('../../src/core/entries.mjs').LogEntry[]} */
	const seenEntries = []
	/**
	 * @param {import('../../src/core/entries.mjs').LogEntry} entry - 日志条目。
	 * @returns {void}
	 */
	const onLog = (entry) => {
		logCalls++
		seenEntries.push(entry)
	}

	await vc.hookAsyncContext(async () => {
		console.addLogEntryListener(onLog)
		console.log('proxy-listener-msg')
		console.removeLogEntryListener(onLog)
		console.log('after-remove')
	})

	assertEqual(logCalls, 1, '通过 Proxy 注册的 addLogEntryListener 只在前一条日志时触发')
	assert(
		seenEntries.length === 1 && getLogEntryArgs(seenEntries[0])[0] === 'proxy-listener-msg',
		'回调收到正确条目')

	let clearCount = 0
	/**
	 * @returns {void}
	 */
	const onClear = () => {
		clearCount++
	}

	await vc.hookAsyncContext(async () => {
		console.addClearListener(onClear)
		console.clear()
		console.removeClearListener(onClear)
		console.clear()
	})

	assertEqual(clearCount, 1, '通过 Proxy 注册的 addClearListener 只在首次 clear 时触发')
}

/**
 * 将全局 `console` Proxy 传入 createLogWireWebSocketHandler 时不应抛错，且能广播 append。
 */
async function testCreateLogWireWebSocketHandlerWithProxy() {
	console.log('\n=== [wire：全局 console Proxy + WebSocket handler] ===')

	const vc = new VirtualConsole({ recordOutput: true, realConsoleOutput: false })

	/** @type {{ messages: string[] }} */
	const wire = { messages: [] }

	await vc.hookAsyncContext(async () => {
		const sent = wire.messages
		const mockWs = {
			readyState: 1,
			/**
			 * @param {string} data - JSON 文本。
			 * @returns {void}
			 */
			send: (data) => {
				sent.push(data)
			},
			/**
			 * 测试桩：`ws` 的 `on` 在本用例中未使用，保持无操作即可。
			 */
			on: () => { },
		}

		const handler = createLogWireWebSocketHandler(console)
		handler(mockWs)

		console.log('wire-append-marker')
	})

	assert(wire.messages.length >= 1, '连接后至少下发 snapshot')
	const snap = JSON.parse(wire.messages[0])
	assert(snap.type === logWirePayloadTypes.SNAPSHOT, '首包为 vc_log_snapshot')
	assert(wire.messages.length >= 2, '新日志后下发追加消息')
	const append = JSON.parse(wire.messages[wire.messages.length - 1])
	assert(append.type === logWirePayloadTypes.APPEND, '追加包为 vc_log_append')
}

/**
 * createLogWireWebSocketHandler 返回的函数附带 broadcastJson / forEachClient / closeAllWithFinalJson。
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
		/** @type {Record<string, (...args: unknown[]) => void>} */
		listeners: {},
		/**
		 * @param {string} ev - 事件名。
		 * @param {(...args: unknown[]) => void} fn - 回调。
		 */
		on(ev, fn) {
			this.listeners[ev] = fn
		},
		/**
		 * @param {string} data - 下行文本。
		 */
		send: (data) => {
			received.push(String(data))
		},
		/**
		 * 模拟 WebSocket：标记关闭态并触发 `close` 监听。
		 * @returns {void}
		 */
		close() {
			this.readyState = 3
			closeEmitCount++
			this.listeners.close?.()
		},
	}

	handler(/** @type {Parameters<typeof handler>[0]} */ mockWs)

	handler.broadcastJson({ type: 'host_ping', x: 1 })
	assert(received.some((s) => {
		try {
			return JSON.parse(s).type === 'host_ping'
		}
		catch {
			return false
		}
	}), 'broadcastJson 下发到已连接客户端')

	let seen = 0
	handler.forEachClient(() => { seen++ })
	assertEqual(seen, 1, 'forEachClient 遍历到 1 个套接字')

	await handler.closeAllWithFinalJson({ type: 'host_bye' })
	assert(received.some((s) => {
		try {
			return JSON.parse(s).type === 'host_bye'
		}
		catch {
			return false
		}
	}), 'closeAllWithFinalJson 先发最终 JSON')
	assertEqual(closeEmitCount, 1, 'closeAllWithFinalJson 触发 close')
}

/**
 * 测试 writeAs 方法
 */
async function testWriteAs() {
	console.log('\n=== [writeAs 方法测试] ===')

	const vc = new VirtualConsole({ recordOutput: true, realConsoleOutput: false })

	await vc.hookAsyncContext(() => {
		vc.writeAs('log', 'written as log')
		vc.writeAs('error', 'written as error')
	})

	assertEqual(vc.outputEntries.length, 2, 'writeAs 记录了2条日志')
	assertEqual(vc.outputEntries[0].level, 'log', 'writeAs log 级别正确')
	assertEqual(vc.outputEntries[1].level, 'error', 'writeAs error 级别正确')
	assertIncludes(vc.outputEntries[0].toString(), 'written as log', 'writeAs 内容正确')
}

/**
 * 测试 process.stdout / stderr 重定向
 */
async function testProcessStreamRedirection() {
	console.log('\n=== [process.stdout / stderr 重定向测试] ===')

	const vc = new VirtualConsole({ recordOutput: true, realConsoleOutput: false })

	await vc.hookAsyncContext(async () => {
		process.stdout.write('written to process.stdout\n')
		process.stderr.write('written to process.stderr\n')
	})

	assertIncludes(vc.outputs, 'written to process.stdout', 'process.stdout.write 被虚拟控制台捕获')
	assertIncludes(vc.outputs, 'written to process.stderr', 'process.stderr.write 被虚拟控制台捕获')
	assert(vc.outputEntries.length >= 2, 'stdout/stderr 各产生 outputEntry')

	const out = vc.outputEntries.find(e => e.method === 'stdout')
	const err = vc.outputEntries.find(e => e.method === 'stderr')
	assert(out, '存在 stdout 条目')
	assert(err, '存在 stderr 条目')
	assertEqual(out.level, 'log', 'process.stdout 语义级别为 log')
	assertEqual(err.level, 'error', 'process.stderr 语义级别为 error')

	const vcStreamOnly = new VirtualConsole({ recordOutput: true, realConsoleOutput: false })
	await vcStreamOnly.hookAsyncContext(async () => {
		process.stdout.write('stream-no-newline-end')
	})
	const streamAggHtml = vcStreamOnly.outputsHtml.trim()
	assert(
		!streamAggHtml.endsWith('<br/>') && !streamAggHtml.endsWith('<br>'),
		'纯 stream 输出（无尾换行）时 outputsHtml.trim() 末尾不得为 br；stream 与 LogEntry 行尾后缀不同',
	)
	assert(
		!vcStreamOnly.outputsHtml.endsWith('<br/>\n'),
		'stream 条目不得误加 LogEntry 的 <br/>\\n 行尾',
	)
}

/**
 * 测试 getStackInfo 函数
 */
async function testGetStackInfo() {
	console.log('\n=== [getStackInfo 函数测试] ===')

	const stack = getStackInfo(1)
	assert(Array.isArray(stack), 'getStackInfo 返回数组')
	assert(stack.length > 0, 'getStackInfo 返回非空数组')

	const firstFrame = stack[0]
	assert(typeof firstFrame.functionName !== 'undefined', '包含 functionName 字段')
	assert(typeof firstFrame.filePath === 'string', '包含 filePath 字段')
	assert(typeof firstFrame.line === 'number', '包含 line 字段')
	assert(typeof firstFrame.column === 'number', '包含 column 字段')
	assert(typeof firstFrame.raw === 'string', '包含 raw 字段')
	assert(firstFrame.line > 0, 'line 大于 0')

	const stackSkipped = getStackInfo(2)
	assert(stackSkipped.length < stack.length || stackSkipped[0]?.raw !== stack[0]?.raw, 'extraFramesToSkip 参数有效，跳过了帧')
}

/**
 * 测试 `renderPrintfPlain`（`buildArgsSegments` + `renderPlain`）。
 */
function testRenderPrintfPlain() {
	console.log('\n=== [renderPrintfPlain（printf→plain）] ===')

	assertEqual(renderPrintfPlain([]), '', '空参数返回空字符串')
	assertEqual(renderPrintfPlain(['hello']), 'hello', '单字符串正确返回')
	assertEqual(renderPrintfPlain(['%s', 'world']), 'world', '%s 格式化正确')
	assertEqual(renderPrintfPlain(['%d', 42]), '42', '%d 格式化正确')
	assertEqual(renderPrintfPlain(['%f', 3.14]), '3.14', '%f 格式化正确')
	assertEqual(renderPrintfPlain(['%%']), '%%', '单实参：与 util.format 一致，不解析 %%')
	assertEqual(renderPrintfPlain(['%%', 'y']), '% y', '多实参时 %% 转义为单 % 并消费后续参数')
	assertEqual(renderPrintfPlain(['%f', Symbol('x')]), 'NaN', '%f 对 Symbol 返回 NaN')
	assertEqual(renderPrintfPlain(['%d', Symbol('x')]), 'NaN', '%d 对 Symbol 返回 NaN')

	const result = renderPrintfPlain(['value: %s', 'test'])
	assertEqual(result, 'value: test', '字符串中插值正确')

	const multiResult = renderPrintfPlain(['a', 'b', 'c'])
	assert(typeof multiResult === 'string', '多参数返回字符串')

	const objResult = renderPrintfPlain([{ key: 'value' }])
	assert(typeof objResult === 'string', '对象参数返回字符串')

	const circular = { name: 'self' }
	circular.self = circular
	const circularResult = renderPrintfPlain(['%o', circular])
	assert(typeof circularResult === 'string', '循环对象通过 %o 格式化后返回字符串')
	assert(circularResult.length > 0, '循环对象通过 %o 格式化后不抛错且有输出')

	const err = new Error('virtual-console printf edge-case error')
	const errResult = renderPrintfPlain([err])
	assertIncludes(errResult, 'Error: virtual-console printf edge-case error', 'Error 参数格式化结果包含错误类型与消息')
	assertIncludes(errResult, 'at ', 'Error 参数格式化结果包含堆栈信息')

	const traceEntry = new LogEntry({
		method: 'trace',
		args: ['trace label'],
		stack: [{
			functionName: 'testFormatArgs',
			filePath: 'test.mjs',
			line: 250,
			column: 10,
			raw: '    at testFormatArgs (test.mjs:250:10)'
		}],
		supportsAnsi: false
	})
	const traceResult = renderPrintfPlain([traceEntry])
	assertIncludes(traceResult, 'debug', 'renderPrintfPlain(LogEntry) 文本包含 level 语义')
	assertIncludes(traceResult, 'trace', 'renderPrintfPlain(LogEntry) 文本含 method 信息')
	assertIncludes(traceEntry.toString(), 'trace label', 'LogEntry trace toString 含消息')
	assertIncludes(traceResult, 'testFormatArgs', 'renderPrintfPlain 结果含栈帧函名信息')
}

/**
 * 跨 realm（如 REPL / vm context）下，Date / RegExp / 装箱 Number 仍应保留类型语义；装箱 Number 的 plain 文本与 `util.inspect` 对齐。
 */
function testCrossRealmSnapshotKinds() {
	console.log('\n=== [跨 realm 快照类型识别] ===')

	const crossRealmDate = vm.runInNewContext('new Date("2026-05-04T13:32:05.473Z")')
	const dateSnap = serializeArgSnapshot(crossRealmDate)
	assertEqual(dateSnap.kind, 'Date', '跨 realm Date.kind')
	assertEqual(dateSnap.value, '2026-05-04T13:32:05.473Z', '跨 realm Date.value 为 ISO')
	const dateAnsi = renderAnsi([{ kind: 'value', snapshot: dateSnap }], { colorize: true })
	assert(dateAnsi.includes('\x1b[35m'), '跨 realm Date ANSI 为紫色')

	const crossRealmRegExp = vm.runInNewContext('/as/')
	const regSnap = serializeArgSnapshot(crossRealmRegExp)
	assertEqual(regSnap.kind, 'RegExp', '跨 realm RegExp.kind')
	assertEqual(regSnap.value, '/as/', '跨 realm RegExp.value')
	const regAnsi = renderAnsi([{ kind: 'value', snapshot: regSnap }], { colorize: true })
	assert(regAnsi.includes('\x1b[31m'), '跨 realm RegExp ANSI 为红色')

	const crossNum = vm.runInNewContext('new Number(0)')
	const numSnap = serializeArgSnapshot(crossNum)
	assertEqual(numSnap.kind, 'Number', '跨 realm 装箱 Number.kind')
	const numPlain = renderPlain([{ kind: 'value', snapshot: numSnap }])
	assertEqual(numPlain, util.inspect(crossNum, { colors: false }), '装箱 Number plain 与 util.inspect 一致')
}

/**
 * 字符串字面量引号选择应尽量贴近 util.inspect（避免无谓转义）。
 */
function testStringLiteralQuoteParity() {
	console.log('\n=== [字符串字面量引号策略] ===')
	const value = '\\ba\n\n\'\''
	const snap = serializeArgSnapshot(value)
	const plain = renderPlain([{ kind: 'value', snapshot: snap }])
	const inspectText = util.inspect(value, { colors: false })
	assertEqual(plain, inspectText, 'value snapshot plain 与 util.inspect 一致')
}

/**
 * 循环引用：`<ref *N>` / `[Circular *N]` 与 `util.inspect` 对齐；DAG 共享子对象不得误判为环。
 */
function testCircularSnapshotParity() {
	console.log('\n=== [循环引用快照 vs util.inspect] ===')
	const ring = {}
	ring.a = ring
	assertEqual(
		renderPlain([{ kind: 'value', snapshot: serializeArgSnapshot(ring) }]),
		util.inspect(ring, { colors: false }),
		'a.a=a 式自环与 util.inspect 一致',
	)

	const selfRef = {}
	selfRef.loop = selfRef
	assertEqual(
		renderPlain([{ kind: 'value', snapshot: serializeArgSnapshot(selfRef) }]),
		util.inspect(selfRef, { colors: false }),
		'自环属性名非 a 时仍一致',
	)

	const inner = {}
	const dagShared = { u: inner, v: inner }
	assertEqual(
		renderPlain([{ kind: 'value', snapshot: serializeArgSnapshot(dagShared) }]),
		util.inspect(dagShared, { colors: false }),
		'无环 DAG 共享子对象与 util.inspect 一致',
	)

	const cycle = {}
	cycle.a = cycle
	const proxiedCycle = new Proxy(cycle, {
		/**
		 * 测试用 `get` 陷阱：不读取目标，始终返回字面量 `1`。
		 * @returns {number} 固定值 `1`。
		 */
		get: () => 1
	})
	assertEqual(
		renderPlain([{ kind: 'value', snapshot: serializeArgSnapshot(proxiedCycle) }]),
		util.inspect(proxiedCycle, { colors: false }),
		'Proxy 包自环：描述符取值与 util.inspect 一致',
	)

	const ac = /** @type {{ a: object, b: number }} */ {}
	ac.a = ac
	ac.b = 3
	const transparent = new Proxy(ac, {
		/**
		 * 透明转发：与 `Reflect.get` 行为一致。
		 * @param {object} t - Proxy 目标对象。
		 * @param {string | symbol} k - 属性键。
		 * @param {unknown} r - `get` 调用的 receiver。
		 * @returns {unknown} `Reflect.get(t, k, r)` 的结果。
		 */
		get: (t, k, r) => Reflect.get(t, k, r)
	})
	assertEqual(
		renderPlain([{ kind: 'value', snapshot: serializeArgSnapshot(transparent) }]),
		util.inspect(transparent, { colors: false }),
		'透明转发 Proxy：根级 <ref> 与 util.inspect 一致',
	)
}

/**
 * class 构造函数应渲染为 `[class Name]`（而非 `[Function: Name]`）。
 */
function testClassSnapshotParity() {
	console.log('\n=== [class 快照渲染] ===')
	const named = vm.runInNewContext('class a{}; a')
	const namedSnap = serializeArgSnapshot(named)
	const namedPlain = renderPlain([{ kind: 'value', snapshot: namedSnap }])
	assertEqual(namedPlain, util.inspect(named, { colors: false }), '具名 class plain 与 util.inspect 一致')

	const anonymous = vm.runInNewContext('(class {})')
	const anonSnap = serializeArgSnapshot(anonymous)
	const anonPlain = renderPlain([{ kind: 'value', snapshot: anonSnap }])
	assertEqual(anonPlain, util.inspect(anonymous, { colors: false }), '匿名 class plain 与 util.inspect 一致')
}

/**
 * Error 若已带完整 stack，不应再额外拼接一遍 `name: message`。
 */
function testErrorStackNoDuplicate() {
	console.log('\n=== [Error 快照去重] ===')
	let syntaxErr = null
	try {
		vm.runInNewContext('class a{}; class a{}')
	}
	catch (e) {
		syntaxErr = e
	}
	assert(!!syntaxErr && typeof syntaxErr === 'object' && syntaxErr.name === 'SyntaxError', '应捕获到 SyntaxError')
	const snap = serializeArgSnapshot(syntaxErr)
	const plain = renderPlain([{ kind: 'value', snapshot: snap }])
	const needle = `SyntaxError: ${syntaxErr.message}`
	const occurrences = plain.split(needle).length - 1
	assertEqual(occurrences, 1, 'SyntaxError 首行不重复')
}

/**
 * Error 快照在 ANSI 下：message 用红色；可解析的栈路径套 OSC8（与 trace 一致）。
 */
function testErrorSnapshotAnsiRich() {
	console.log('\n=== [Error 快照 ANSI 增强] ===')
	const err = new Error('vc-peek-error-message')
	const snap = serializeArgSnapshot(err)
	const ansi = renderAnsi([{ kind: 'value', snapshot: snap }], { colorize: true })
	assert(ansi.includes('\x1b[31m'), 'Error message 段含红色')
	assert(ansi.includes('vc-peek-error-message'), '保留 message 原文')
	assert(ansi.includes('\x1b]8;;'), '栈路径含 OSC8 超链接')
}

/**
 * Error 快照：不存原始 stack 字符串，仅 `name` / `message` / 解析后的 `stack` 帧数组。
 */
function testErrorSnapshotStackFramesShape() {
	console.log('\n=== [Error 快照：解析 stack 数组] ===')
	const err = new Error('shape-check')
	const snap = serializeArgSnapshot(err)
	assertEqual(snap.kind, 'Error', 'kind')
	assert(typeof snap.stack !== 'string', '不存原始 stack 字符串')
	assert(Array.isArray(snap.stack), 'stack 为解析帧数组')
	assert(snap.stack.length > 0, '有解析帧')
	const first = snap.stack[0]
	assert(first && typeof first.raw === 'string' && first.raw.length > 0, '首帧含 raw')
	assert(!/^\w+Error:\s/.test(first.raw.trim()), '首帧不是 Error: 标题行')
}

/**
 * 无栈（空帧数组或旧版无 stack 串）时：首行 `[TypeName: message]`，便于与带 `at` 栈区分。
 */
function testErrorSnapshotNoStackBrackets() {
	console.log('\n=== [Error 无栈：整段中括号] ===')
	const snap = { kind: 'Error', name: 'ReferenceError', message: 'exit is not defined', stack: [] }
	const plain = renderPlain([{ kind: 'value', snapshot: snap }])
	assertEqual(plain.trim(), '[ReferenceError: exit is not defined]', 'plain 整段包在中括号内')
	const ansi = renderAnsi([{ kind: 'value', snapshot: snap }], { colorize: true })
	assertIncludes(ansi, '[', 'ANSI 含左括号')
	assertIncludes(ansi, 'ReferenceError', 'ANSI 含类型名')
	assertIncludes(ansi, 'exit is not defined', 'ANSI 含 message')
}

/**
 * 测试 hookAsyncContext 的作用域隔离
 */
async function testContextIsolation() {
	console.log('\n=== [异步上下文隔离测试] ===')

	const vc1 = new VirtualConsole({ recordOutput: true, realConsoleOutput: false })
	const vc2 = new VirtualConsole({ recordOutput: true, realConsoleOutput: false })

	await vc1.hookAsyncContext(async () => {
		console.log('from vc1')
		await vc2.hookAsyncContext(async () => {
			console.log('from vc2')
		})
		console.log('back to vc1')
	})

	assertEqual(vc1.outputEntries.length, 2, 'vc1 捕获了2条（vc2 上下文中的不计入）')
	assertEqual(vc2.outputEntries.length, 1, 'vc2 只捕获了自己上下文中的1条')
	assert(getLogEntryArgs(vc1.outputEntries[0])[0] === 'from vc1', 'vc1 第1条内容正确')
	assert(getLogEntryArgs(vc2.outputEntries[0])[0] === 'from vc2', 'vc2 第1条内容正确')
	assert(getLogEntryArgs(vc1.outputEntries[1])[0] === 'back to vc1', 'vc1 第2条内容正确')
}

/**
 * 测试 addLogEntryListener：console 与 stdout/stderr 均触发，且回调 entry 与 outputEntries 一致
 */
async function testAddLogEntryListenerCallbacks() {
	console.log('\n=== [addLogEntryListener：console 与流] ===')

	const callbackEntries = []
	const vc = new VirtualConsole({
		recordOutput: true,
		realConsoleOutput: false,
	})
	/**
	 * @param {import('../../src/core/entries.mjs').LogEntry} entry - 新增日志条目对象。
	 * @returns {void}
	 */
	vc.addLogEntryListener((entry) => callbackEntries.push(entry))

	await vc.hookAsyncContext(async () => {
		console.log('msg1')
		console.warn('msg2')
		console.error('msg3')
		process.stdout.write('stdout msg\n')
		process.stderr.write('stderr msg\n')
	})

	assertEqual(callbackEntries.length, 5, 'addLogEntryListener 共 5 次（log/warn/error + stdout + stderr）')
	assertEqual(callbackEntries[0].level, 'log', '第1条回调 level 为 log')
	assertEqual(callbackEntries[1].level, 'warn', '第2条回调 level 为 warn')
	assertEqual(callbackEntries[2].level, 'error', '第3条回调 level 为 error')
	assert(callbackEntries.some(e => e.method === 'stdout'), '包含 stdout 流的回调')
	assert(callbackEntries.some(e => e.method === 'stderr'), '包含 stderr 流的回调')
	assert(callbackEntries[0] === vc.outputEntries[0], '首条回调与 outputEntries[0] 为同一对象')
}

/**
 * 测试 recordOutput: false 时不记录日志
 */
async function testRecordOutputFalse() {
	console.log('\n=== [recordOutput: false 测试] ===')

	const vc = new VirtualConsole({ recordOutput: false, realConsoleOutput: false })

	await vc.hookAsyncContext(() => {
		console.log('should not be recorded')
		console.warn('also not recorded')
	})

	assertEqual(vc.outputEntries.length, 0, 'recordOutput: false 时 outputEntries 为空')
	assertEqual(vc.outputs, '', 'recordOutput: false 时 outputs 为空字符串')
}

/**
 * logEntry.stack：console.log 与 stdout 捕获的首帧均指向本测试用户代码（非运行时内部栈）。
 */
async function testLogEntryStack() {
	console.log('\n=== [logEntry.stack：console 与 stdout 首帧] ===')

	const vc = new VirtualConsole({ recordOutput: true, realConsoleOutput: false })

	await vc.hookAsyncContext(() => {
		console.log('test stack')
	})

	const logEntry = vc.outputEntries[0]
	assert('stack' in logEntry, 'logEntry 包含 stack 字段')
	assert(Array.isArray(logEntry.stack), 'logEntry.stack 是数组')
	assert(logEntry.stack.length > 0, 'logEntry.stack 不为空')
	assert(typeof logEntry.stack[0].filePath === 'string', 'stack 帧包含 filePath')
	assert(typeof logEntry.stack[0].line === 'number', 'stack 帧包含 line 号')
	const logFp = String(logEntry.stack[0].filePath).replace(/\\/g, '/')
	assert(logFp.includes('suites/integration.mjs'), `console.log 首帧应为本测试文件，实际：${logEntry.stack[0].filePath}`)

	const vc2 = new VirtualConsole({ recordOutput: true, realConsoleOutput: false })

	/**
	 * @returns {void}
	 */
	function callerOfStdoutWrite() {
		process.stdout.write('stdout-stack-top-marker\n')
	}

	await vc2.hookAsyncContext(() => callerOfStdoutWrite())

	const stdoutEntry = vc2.outputEntries.find(e =>
		e.method === 'stdout' && typeof e.streamText === 'string' && e.streamText.includes('stdout-stack-top-marker'))

	assert(stdoutEntry, '找到带标记的 stdout 条目')
	assert(Array.isArray(stdoutEntry.stack) && stdoutEntry.stack.length > 0, 'stdout 条目含非空 stack')

	const top = stdoutEntry.stack[0]
	const fp = top.filePath

	assert(
		!fp.startsWith('node:') && !fp.startsWith('deno:') && !fp.startsWith('ext:'),
		`stdout 首帧不应为运行时内部路径，实际 filePath=${fp}`)

	const nfp = String(fp).replace(/\\/g, '/')
	assert(nfp.includes('suites/integration.mjs'), `stdout 首帧应落回本测试文件，实际 filePath=${fp}`)
	assert(
		top.functionName.includes('callerOfStdoutWrite'),
		`stdout 首帧函数名应为写入调用者，实际 functionName=${top.functionName}`)
}

/**
 * 测试 writeAs 在 realConsoleOutput: true 时不双重记录
 */
async function testWriteAsNoDoubleRecord() {
	console.log('\n=== [writeAs 不双重记录测试] ===')

	const capturedEntries = []
	const vc = new VirtualConsole({
		recordOutput: true,
		realConsoleOutput: true,
		baseConsole: new VirtualConsole({ recordOutput: false, realConsoleOutput: false }),
	})
	/**
	 * 收集 writeAs 触发的日志，验证不会重复记录。
	 * @param {import('../../src/core/entries.mjs').LogEntry} entry - 新增日志条目对象。
	 * @returns {void} 无返回值。
	 */
	vc.addLogEntryListener((entry) => capturedEntries.push(entry))

	vc.writeAs('log', 'should appear once')
	vc.writeAs('error', 'error once')

	assertEqual(vc.outputEntries.length, 2, 'writeAs 在 realConsoleOutput: true 时只记录一次（共2条）')
	assertEqual(capturedEntries.length, 2, 'addLogEntryListener 也只被触发 2 次')
}

/**
 * 测试连续 stdout 写入的合并行为
 */
async function testConsecutiveStdoutMerge() {
	console.log('\n=== [连续 stdout 写入合并测试] ===')

	const vc = new VirtualConsole({ recordOutput: true, realConsoleOutput: false })

	await vc.hookAsyncContext(async () => {
		process.stdout.write('part1 ')
		process.stdout.write('part2\n')
	})

	assertEqual(vc.outputEntries.length, 1, '连续 stdout 写入被合并为一条 entry')
	assertIncludes(vc.outputEntries[0].streamText, 'part1 part2', '合并后内容正确')
}

/**
 * 测试真实并发异步隔离
 */
async function testConcurrentAsyncIsolation() {
	console.log('\n=== [真实并发异步隔离测试] ===')

	const vcA = new VirtualConsole({ recordOutput: true, realConsoleOutput: false })
	const vcB = new VirtualConsole({ recordOutput: true, realConsoleOutput: false })

	/**
	 * 模拟异步任务，打印开始和结束日志。
	 * @param {string} id - 任务标识（A/B）。
	 * @param {number} duration - 延迟毫秒数。
	 * @returns {Promise<void>} 任务完成后 resolve。
	 */
	async function work(id, duration) {
		console.log(`Starting task ${id}`)
		await new Promise(r => setTimeout(r, duration))
		console.log(`Finished task ${id}`)
	}

	await Promise.all([
		vcA.hookAsyncContext(() => work('A', 30)),
		vcB.hookAsyncContext(() => work('B', 10)),
	])

	assertEqual(vcA.outputEntries.length, 2, 'vcA 捕获了2条日志')
	assertEqual(vcB.outputEntries.length, 2, 'vcB 捕获了2条日志')
	assert(getLogEntryArgs(vcA.outputEntries[0])[0] === 'Starting task A', 'vcA 第1条内容正确')
	assert(getLogEntryArgs(vcA.outputEntries[1])[0] === 'Finished task A', 'vcA 第2条内容正确')
	assert(getLogEntryArgs(vcB.outputEntries[0])[0] === 'Starting task B', 'vcB 第1条内容正确')
	assert(getLogEntryArgs(vcB.outputEntries[1])[0] === 'Finished task B', 'vcB 第2条内容正确')
}

/**
 * 深度截断与 expandSnapshotRef
 */
async function testTruncatedAndExpand() {
	console.log('\n=== [truncated 快照与 expandSnapshotRef] ===')

	let deep = { l: 'leaf' }
	for (let i = 0; i < 10; i++)
		deep = { nest: deep }

	const vc = new VirtualConsole({ recordOutput: true, realConsoleOutput: false })
	await vc.hookAsyncContext(() => {
		console.log(deep)
	})

	const segments = vc.outputEntries[0].toSegments()

	/**
	 * 深度优先查找快照树中第一个非空 `truncated.ref`。
	 * @param {unknown} snap - `serializeArgSnapshot` 或片段内的嵌套对象。
	 * @returns {string} 找到的 ref；否则空串。
	 */
	function findTruncatedRef(snap) {
		if (!snap || typeof snap !== 'object') return ''
		const node = /** @type {Record<string, unknown>} */ snap
		if (node.kind === 'truncated' && typeof node.ref === 'string' && node.ref)
			return node.ref
		for (const child of Object.values(node)) {
			const found = findTruncatedRef(child)
			if (found) return found
		}
		return ''
	}

	let ref = ''
	for (const seg of segments) {
		if (ref) break
		if (seg.kind === 'value')
			ref = findTruncatedRef(seg.snapshot)
		if (ref) break
	}

	assert(ref.length > 0, 'toSegments 中含可展开 truncated.ref')

	const exp = expandSnapshotRef(ref)
	assert(exp.ok === true, 'expandSnapshotRef 成功')
	assert(exp.snapshot != null, '展开得到快照')

	const noCtx = serializeArgSnapshot(deep)
	/**
	 * 判断快照树中是否存在「无展开上下文」导致的空字符串 ref。
	 * @param {unknown} snap - 任意快照子树。
	 * @returns {boolean} 若存在 `kind === 'truncated' && ref === ''` 则为 true。
	 */
	function hasTruncatedEmptyRef(snap) {
		if (!snap || typeof snap !== 'object') return false
		const node = /** @type {Record<string, unknown>} */ snap
		if (node.kind === 'truncated' && node.ref === '')
			return true
		return Object.values(node).some(child => hasTruncatedEmptyRef(child))
	}
	assert(hasTruncatedEmptyRef(noCtx), '无注册上下文时截断节点 ref 为空串')

	assertEqual(DEFAULT_SNAPSHOT_DEPTH, 5, '默认快照深度为 5')
}

/**
 * wire：extensionHandlers、WireLogEntry、`renderAnsi`（link、colorize 时 OSC8）
 */
/**
 * printf：`renderPrintfPlain` 与 `buildArgsSegments` + `renderPlain` 共享同一 dispatch。
 */
function testPrintfDispatchParity() {
	console.log('\n=== [printf 核心一致性] ===')

	const args = ['[%s:%d]', 'a', 1]
	assertEqual(renderPrintfPlain(args), '[a:1]', 'renderPrintfPlain 多占位（无独立空格段）')
	const plain = renderPlain(buildArgsSegments(args))
	assertEqual(plain, '[a:1]', 'buildArgsSegments → renderPlain 与 renderPrintfPlain 一致（独立空格段会被 strip 剥除，故用冒号模板）')

	assertEqual(renderPrintfPlain(['%%']), '%%', '单实参字符串：与 util.format 一致，不解析 %%')
	assertEqual(
		renderPlain(buildArgsSegments(['%%'])),
		'%%',
		'单实参 segments 与 native log 同为字面 %%',
	)
}

/**
 * `%c`：CSS → ANSI 真彩色与 SGR（粗斜线划、半亮等）。
 */
function testPrintfCssAnsiMapping() {
	console.log('\n=== [%c → ANSI（真彩色与 SGR）] ===')

	const segs = buildArgsSegments(['%ca', 'color: red'], null, DEFAULT_SNAPSHOT_DEPTH)
	const ansi = renderAnsi(segs, { colorize: true })
	assertIncludes(ansi, '\x1b[38;2;255;0;0m', 'color:red → 38;2;255;0;0')
	assertIncludes(ansi, 'a', '可见文本保留')
	assertIncludes(ansi, '\x1b[0m', '段末 SGR 重置')
	const plain = renderPlain(segs)
	assert(plain === 'a' && !/\x1b/.test(plain), 'renderPlain 无转义、仅 a')
	const noCss = renderAnsi(segs, { omitPrintfCss: true })
	assertEqual(noCss, 'a', 'omitPrintfCss 不注入真彩色')

	const segsStyle = buildArgsSegments(['%cx', 'font-style:italic;font-weight:bold;text-decoration:underline'], null, DEFAULT_SNAPSHOT_DEPTH)
	const ansiStyle = renderAnsi(segsStyle, { colorize: true })
	assertIncludes(ansiStyle, '\x1b[1;3;4m', '粗体+斜体+下划线合并为单条 SGR')
	assertIncludes(ansiStyle, 'x', '正文保留')

	const segsStrike = buildArgsSegments(['%cy', 'text-decoration: line-through; color: navy'], null, DEFAULT_SNAPSHOT_DEPTH)
	const ansiStrike = renderAnsi(segsStrike, { colorize: true })
	assertIncludes(ansiStrike, '\x1b[9;38;2;0;0;128m', '删除线 + navy 真彩色同序列')

	const segsDimOp = buildArgsSegments(['%cd', 'opacity:0.5;color:red'], null, DEFAULT_SNAPSHOT_DEPTH)
	assertIncludes(renderAnsi(segsDimOp, { colorize: true }), '\x1b[2;38;2;255;0;0m', 'opacity∈(0,1) → SGR2 + 前景色')
	const segsRgba = buildArgsSegments(['%ce', 'color:rgba(0,255,0,0.6)'], null, DEFAULT_SNAPSHOT_DEPTH)
	assertIncludes(renderAnsi(segsRgba, { colorize: true }), '\x1b[2;38;2;0;255;0m', 'rgba 半透明 → dim + rgb')
	const segsLighter = buildArgsSegments(['%cf', 'font-weight: lighter'], null, DEFAULT_SNAPSHOT_DEPTH)
	assertEqual(renderAnsi(segsLighter, { colorize: true }), '\x1b[2mf\x1b[0m', 'font-weight:lighter → SGR2')

	const segsRebecca = buildArgsSegments(['%cz', 'color: rebeccapurple'], null, DEFAULT_SNAPSHOT_DEPTH)
	assertIncludes(renderAnsi(segsRebecca, { colorize: true }), '\x1b[38;2;102;51;153m', '命名色 rebeccapurple（color-name）')
	const segsGrey = buildArgsSegments(['%cg', 'color: grey'], null, DEFAULT_SNAPSHOT_DEPTH)
	assertIncludes(renderAnsi(segsGrey, { colorize: true }), '\x1b[38;2;128;128;128m', '命名 grey 与 gray 一致')
}

/**
 * `renderPlain` / `renderHtml` 顶层 API。
 */
function testRenderPlainHtmlOptions() {
	console.log('\n=== [renderPlain / renderHtml 顶层 API] ===')

	const segments = [{ kind: 'text', text: 'hello' }]
	assertEqual(renderPlain(segments), 'hello', 'renderPlain')
	assertIncludes(renderHtml(segments, {}), 'hello', 'renderHtml')
}

/**
 * HTML：`resolveTraceFrameHref` 可覆盖 trace 栈链接。
 */
function testResolveTraceFrameHref() {
	console.log('\n=== [HTML resolveTraceFrameHref] ===')

	const html = renderHtml([{
		kind: 'trace',
		snapshot: serializeArgSnapshot([{
			functionName: 'f',
			filePath: '/x.mjs',
			line: 1,
			column: 0,
			raw: 'at f (/x.mjs:1:0)',
		}]),
	}], {
		/**
		 * @returns {string} 该栈帧在 HTML 中使用的 `href`。
		 */
		resolveTraceFrameHref: () => 'https://example.com/custom',
	})
	assertIncludes(html, 'https://example.com/custom', '自定义 trace 链接 href')
}

/**
 * 覆盖 logWire 协议分发、扩展帧（如自定义 shutdown）及客户端辅助行为。
 */
async function testWireHelpers() {
	console.log('\n=== [wire 协议与辅助] ===')

	let shutdown = /** @type {object | null} */ null
	await dispatchLogWireMessage({ type: 'my_shutdown', code: 42, reason: 'bye' }, {
		extensionHandlers: {
			/**
			 * 捕获自定义 shutdown 帧全文。
			 * @param {Record<string, unknown>} raw - 解析后的 JSON 对象（含 `code`/`reason` 等）。
			 * @returns {void}
			 */
			my_shutdown: (raw) => {
				shutdown = raw
			},
		},
	})
	assert(shutdown != null, 'extensionHandlers 收到自定义 shutdown')
	assertEqual(/** @type {{ code?: number }} */ shutdown.code, 42, '自定义载荷 code')
	assertEqual(/** @type {{ reason?: string }} */ shutdown.reason, 'bye', '自定义载荷 reason')

	let ext = false
	await dispatchLogWireMessage({ type: 'my_app_ping', n: 1 }, {
		extensionHandlers: {
			/**
			 * 置位：已收到 `my_app_ping` 扩展帧。
			 * @returns {void} 无。
			 */
			my_app_ping: () => {
				ext = true
			},
		},
	})
	assert(ext, 'extensionHandlers 分发自定义 type')

	const w = WireLogEntry.from({
		id: 0,
		level: 'log',
		method: 'log',
		timestamp: 1,
		segments: [{ kind: 'text', text: 'hi' }],
	}, {
		/**
		 * 无截断 ref 时不会调用。
		 * @returns {Promise<never>} 不应被触发。
		 */
		requestExpand: async () => {
			throw new Error('unexpected_expand')
		},
		supportsAnsi: false,
	})
	assertEqual(await w.renderPlain(), 'hi', 'WireLogEntry renderPlain（由 segments）')
	assertEqual(await w.renderString(), 'hi', 'WireLogEntry renderString')
	assertIncludes(await w.renderHtml(), 'hi', 'WireLogEntry renderHtml')
	assertEqual(w.segments.length, 1, 'segments 长度')

	const ansi = renderAnsi([{
		kind: 'text',
		text: '\x1b]8;;https://a\x07L\x1b]8;;\x07',
	}], { colorize: true })
	assert(ansi.includes('\x1b]8;;'), 'text 段可承载 OSC8 超链接起始序列')
}

/**
 * 按顺序执行全部测试，并在末尾输出汇总结果。
 * @returns {Promise<void>} 全部测试执行完成后 resolve。
 */
export async function runAllTests() {
	console.log('🚀 开始运行所有测试...\n')

	await testSupportsAnsiVcLogComplexObject()
	await testNodeVirtualConsoleStdoutUsesGetterVirtualStream()
	testPathToFileURLWindowsDriveUnescapedColon()
	testCssHex4DigitAlphaDim()
	await testRendering()
	await testOutputEntries()
	await testConsoleDir()
	await testMaxLogEntries()
	await testClear()
	await testGlobalConsoleProxy()
	await testCreateLogWireWebSocketHandlerWithProxy()
	await testLogWireHandlerClientControl()
	await testWriteAs()
	await testProcessStreamRedirection()
	await testAddLogEntryListenerCallbacks()
	await testRecordOutputFalse()
	await testLogEntryStack()
	await testWriteAsNoDoubleRecord()
	await testConsecutiveStdoutMerge()
	await testConcurrentAsyncIsolation()
	await testGetStackInfo()
	testRenderPrintfPlain()
	testCrossRealmSnapshotKinds()
	testStringLiteralQuoteParity()
	testCircularSnapshotParity()
	testClassSnapshotParity()
	testErrorStackNoDuplicate()
	testErrorSnapshotAnsiRich()
	testErrorSnapshotStackFramesShape()
	testErrorSnapshotNoStackBrackets()
	testPrintfDispatchParity()
	testPrintfCssAnsiMapping()
	testRenderPlainHtmlOptions()
	testResolveTraceFrameHref()
	await testTruncatedAndExpand()
	await testContextIsolation()
	await testWireHelpers()

	console.log(`\n${'='.repeat(50)}`)
	if (failed === 0)
		console.log(`✅ 全部通过！共 ${passed} 项测试。`)
	else {
		console.error(`❌ 测试结束：${passed} 通过，${failed} 失败。`)
		process.exit(1)
	}
}
