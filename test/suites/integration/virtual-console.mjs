import {
	VirtualConsole,
	getLogEntryArgs,
	renderAnsi,
	renderPlain,
} from '@steve02081504/virtual-console'

import { assert, assertEqual, assertIncludes, runTestGroup } from '../../harness.mjs'

/**
 * 验证 supportsAnsi 模式下对象日志渲染与聚合输出一致。
 */
async function testSupportsAnsiVcLogComplexObject() {
	console.log('\n=== [supportsAnsi：log 含 date/number/string/bigint] ===')

	const obj = { d: new Date(0), n: 42, s: 'hello', b: 2n }
	const vc = new VirtualConsole({ recordOutput: true, realConsoleOutput: false, supportsAnsi: true })

	await vc.hookAsyncContext(() => { console.log(obj) })

	assertEqual(vc.outputEntries.length, 1, '捕获一条日志')
	assert(vc.outputEntries[0].supportsAnsi === true, '条目 supportsAnsi')
	assert(getLogEntryArgs(vc.outputEntries[0])[0] === obj, '参数引用一致')
	assertEqual(vc.outputs, renderAnsi(vc.outputEntries[0].toSegments(), { colorize: true }), 'outputs 与 toSegments→renderAnsi（换行在片段内）一致')
}

/**
 * 覆盖常见占位符、ANSI、CSS 与注入场景的渲染行为。
 */
async function testRendering() {
	console.log('\n=== [渲染功能测试] ===')
	const vc = new VirtualConsole({ recordOutput: true, realConsoleOutput: false })
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
		const a = {}; a.a = a
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
 * 验证 outputEntries 的级别、参数与聚合输出。
 */
async function testOutputEntries() {
	console.log('\n=== [outputEntries 结构化日志条目测试] ===')
	const vc = new VirtualConsole({ recordOutput: true, realConsoleOutput: false })
	await vc.hookAsyncContext(() => {
		console.log('hello'); console.warn('a warning'); console.error('an error'); console.info('info message'); console.debug('debug message')
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
 * 验证 console.dir 被捕获为结构化条目且渲染一致。
 */
async function testConsoleDir() {
	console.log('\n=== [console.dir 捕获测试] ===')
	const vc = new VirtualConsole({ recordOutput: true, realConsoleOutput: false })
	await vc.hookAsyncContext(() => { console.dir({ id: 42, nested: { ok: true } }, { depth: 3 }) })
	assertEqual(vc.outputEntries.length, 1, 'dir 产生一条 outputEntry')
	const dirEntry = vc.outputEntries[0]
	assertEqual(dirEntry.method, 'dir', 'method 为 dir')
	assertEqual(dirEntry.level, 'log', '语义级别为 log')
	const dirSegments = dirEntry.toSegments()
	assert(dirSegments.length === 2 && dirSegments[0].kind === 'value' && 'snapshot' in dirSegments[0] && dirSegments[1].kind === 'text' && /** @type {{ text: string }} */ dirSegments[1].text === '\n', 'dir：单 value 段 + 尾换行 text')
	const ansiFromSegments = renderAnsi(dirSegments, { colorize: dirEntry.supportsAnsi })
	assertEqual(ansiFromSegments, dirEntry.toString(), 'dir：`renderAnsi(toSegments())` 必须与 `toString()` 一致')
	assertEqual(renderPlain(dirSegments), dirEntry.toPlainText(), 'dir：`renderPlain(toSegments())` 必须与 `toPlainText()` 一致')
	assertIncludes(dirEntry.toString(), '42', 'dir toString 包含对象内容')
	assertIncludes(dirEntry.toHtml(), '42', 'dir toHtml 包含对象内容')
	assertIncludes(vc.outputs, '42', 'outputs 聚合含 dir 输出')
}

/**
 * 验证 maxLogEntries 限制仅保留最新日志。
 */
async function testMaxLogEntries() {
	console.log('\n=== [maxLogEntries 限制测试] ===')
	const vc = new VirtualConsole({ recordOutput: true, realConsoleOutput: false, maxLogEntries: 3 })
	await vc.hookAsyncContext(() => { console.log('msg1'); console.log('msg2'); console.log('msg3'); console.log('msg4'); console.log('msg5') })
	assertEqual(vc.outputEntries.length, 3, 'maxLogEntries=3 时只保留最新3条')
	assert(getLogEntryArgs(vc.outputEntries[0])[0] === 'msg3', '第1条保留 msg3')
	assert(getLogEntryArgs(vc.outputEntries[1])[0] === 'msg4', '第2条保留 msg4')
	assert(getLogEntryArgs(vc.outputEntries[2])[0] === 'msg5', '第3条保留 msg5')
}

/**
 * 验证 clear 会重置缓存并触发 clear 监听器。
 */
async function testClear() {
	console.log('\n=== [clear() 重置测试] ===')
	const vc = new VirtualConsole({ recordOutput: true, realConsoleOutput: false })
	await vc.hookAsyncContext(() => { console.log('before clear') })
	assertEqual(vc.outputEntries.length, 1, 'clear 前有1条日志')
	let clearCount = 0
	vc.addClearListener(() => { clearCount++ })
	vc.clear()
	assertEqual(clearCount, 1, 'clear 后触发 addClearListener')
	assertEqual(vc.outputEntries.length, 0, 'clear 后 outputEntries 为空')
	assertEqual(vc.outputs, '', 'clear 后 outputs 为空字符串')
	assertEqual(vc.outputsHtml, '', 'clear 后 outputsHtml 为空字符串')
}

/**
 * 验证全局 console 代理暴露 API 且监听绑定正确。
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
	/** @type {import('../../../src/core/entries.mjs').LogEntry[]} */
	const seenEntries = []
	/**
	 * 监听 logEntry 事件。
	 * @param {import('../../../src/core/entries.mjs').LogEntry} entry - 捕获到的日志条目。
	 * @returns {void}
	 */
	const onLog = (entry) => { logCalls++; seenEntries.push(entry) }
	await vc.hookAsyncContext(async () => {
		console.addLogEntryListener(onLog); console.log('proxy-listener-msg'); console.removeLogEntryListener(onLog); console.log('after-remove')
	})
	assertEqual(logCalls, 1, '通过 Proxy 注册的 addLogEntryListener 只在前一条日志时触发')
	assert(seenEntries.length === 1 && getLogEntryArgs(seenEntries[0])[0] === 'proxy-listener-msg', '回调收到正确条目')
	let clearCount = 0
	/**
	 * 记录 clear 回调触发次数。
	 * @returns {void}
	 */
	const onClear = () => { clearCount++ }
	await vc.hookAsyncContext(async () => {
		console.addClearListener(onClear); console.clear(); console.removeClearListener(onClear); console.clear()
	})
	assertEqual(clearCount, 1, '通过 Proxy 注册的 addClearListener 只在首次 clear 时触发')
}

/**
 * 验证 writeAs 可以按指定级别写入日志条目。
 */
async function testWriteAs() {
	console.log('\n=== [writeAs 方法测试] ===')
	const vc = new VirtualConsole({ recordOutput: true, realConsoleOutput: false })
	await vc.hookAsyncContext(() => { vc.writeAs('log', 'written as log'); vc.writeAs('error', 'written as error') })
	assertEqual(vc.outputEntries.length, 2, 'writeAs 记录了2条日志')
	assertEqual(vc.outputEntries[0].level, 'log', 'writeAs log 级别正确')
	assertEqual(vc.outputEntries[1].level, 'error', 'writeAs error 级别正确')
	assertIncludes(vc.outputEntries[0].toString(), 'written as log', 'writeAs 内容正确')
}

/**
 * 验证 process.stdout/stderr 写入会被重定向并分级。
 */
async function testProcessStreamRedirection() {
	console.log('\n=== [process.stdout / stderr 重定向测试] ===')
	const vc = new VirtualConsole({ recordOutput: true, realConsoleOutput: false })
	await vc.hookAsyncContext(async () => { process.stdout.write('written to process.stdout\n'); process.stderr.write('written to process.stderr\n') })
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
	await vcStreamOnly.hookAsyncContext(async () => { process.stdout.write('stream-no-newline-end') })
	const streamAggHtml = vcStreamOnly.outputsHtml.trim()
	assert(!streamAggHtml.endsWith('<br/>') && !streamAggHtml.endsWith('<br>'), '纯 stream 输出（无尾换行）时 outputsHtml.trim() 末尾不得为 br；stream 与 LogEntry 行尾后缀不同')
	assert(!vcStreamOnly.outputsHtml.endsWith('<br/>\n'), 'stream 条目不得误加 LogEntry 的 <br/>\\n 行尾')
}

/**
 * 验证 addLogEntryListener 对 console 与流写入均生效。
 */
async function testAddLogEntryListenerCallbacks() {
	console.log('\n=== [addLogEntryListener：console 与流] ===')
	const callbackEntries = []
	const vc = new VirtualConsole({ recordOutput: true, realConsoleOutput: false })
	vc.addLogEntryListener((entry) => callbackEntries.push(entry))
	await vc.hookAsyncContext(async () => {
		console.log('msg1'); console.warn('msg2'); console.error('msg3'); process.stdout.write('stdout msg\n'); process.stderr.write('stderr msg\n')
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
 * 验证 recordOutput=false 时不会保留任何输出条目。
 */
async function testRecordOutputFalse() {
	console.log('\n=== [recordOutput: false 测试] ===')
	const vc = new VirtualConsole({ recordOutput: false, realConsoleOutput: false })
	await vc.hookAsyncContext(() => { console.log('should not be recorded'); console.warn('also not recorded') })
	assertEqual(vc.outputEntries.length, 0, 'recordOutput: false 时 outputEntries 为空')
	assertEqual(vc.outputs, '', 'recordOutput: false 时 outputs 为空字符串')
}

/**
 * 验证 realConsoleOutput=true 时 writeAs 不会重复记录。
 */
async function testWriteAsNoDoubleRecord() {
	console.log('\n=== [writeAs 不双重记录测试] ===')
	const capturedEntries = []
	const vc = new VirtualConsole({
		recordOutput: true,
		realConsoleOutput: true,
		baseConsole: new VirtualConsole({ recordOutput: false, realConsoleOutput: false }),
	})
	vc.addLogEntryListener((entry) => capturedEntries.push(entry))
	vc.writeAs('log', 'should appear once')
	vc.writeAs('error', 'error once')
	assertEqual(vc.outputEntries.length, 2, 'writeAs 在 realConsoleOutput: true 时只记录一次（共2条）')
	assertEqual(capturedEntries.length, 2, 'addLogEntryListener 也只被触发 2 次')
}

/**
 * 运行“VirtualConsole 记录与输出”分组测试。
 */
export async function runVirtualConsoleTests() {
	await runTestGroup('VirtualConsole 记录与输出', [
		testSupportsAnsiVcLogComplexObject,
		testOutputEntries,
		testConsoleDir,
		testMaxLogEntries,
		testClear,
		testWriteAs,
		testWriteAsNoDoubleRecord,
		testProcessStreamRedirection,
		testAddLogEntryListenerCallbacks,
		testRecordOutputFalse,
		testGlobalConsoleProxy,
		testRendering,
	])
}
