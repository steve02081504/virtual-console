import { Buffer } from 'node:buffer'
import { Console } from 'node:console'
import { Writable } from 'node:stream'

import {
	VirtualConsole,
	renderAnsi,
	renderPlain,
} from '@steve02081504/virtual-console'

import { assert, assertEqual, assertIncludes, runTestGroup } from '../../harness.mjs'

const PERF_ENTRY_COUNT = 3000
const PERF_WARMUP_COUNT = 200

/**
 * 同步执行回调并返回耗时。
 * @param {() => void} fn - 待计时的同步回调。
 * @returns {number} 回调执行耗时（毫秒）。
 */
function measureMs(fn) {
	const start = performance.now()
	fn()
	return performance.now() - start
}

/**
 * 丢弃写入的流，避免终端 I/O 干扰计时。
 * @returns {Console} stdout/stderr 均写入空 sink 的 `Console` 实例。
 */
function createNullConsole() {
	const sink = new Writable({ /**
	 * 忽略写入内容并立即完成。
	 * @param {Buffer | string} _chunk - 被丢弃的数据块。
	 * @param {string} _encoding - 编码名。
	 * @param {(error?: Error | null) => void} callback - 写入完成回调。
	 * @returns {void}
	 */
		write(_chunk, _encoding, callback) { callback() } })
	return new Console({ stdout: sink, stderr: sink })
}

/**
 * 验证 supportsAnsi 模式下对象日志渲染与聚合输出一致。
 */
async function testSupportsAnsiVcLogComplexObject() {
	console.log('\n=== [supportsAnsi：log 含 date/number/string/bigint] ===')

	const obj = { d: new Date(0), n: 72, s: 'hello', b: 2n }
	const vc = new VirtualConsole({ recordOutput: true, realConsoleOutput: false, supportsAnsi: true })

	await vc.hookAsyncContext(() => { console.log(obj) })

	assertEqual(vc.outputEntries.length, 1, '捕获一条日志')
	assert(vc.outputEntries[0].supportsAnsi === true, '条目 supportsAnsi')
	assert(vc.outputEntries[0].args[0] === obj, '参数引用一致')
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
	assert(vc.outputEntries[0].args[0] === 'hello', '第1条捕获参数正确')
	assert(typeof vc.outputEntries[0].timestamp === 'number', 'timestamp 是数字')
	assert(vc.outputEntries[0].timestamp <= Date.now(), 'timestamp 合理')
	assertIncludes(vc.outputEntries[0].toString(), 'hello', 'logEntry.toString() 正确')
	assertIncludes(vc.outputEntries[1].toHtml(), 'a&nbsp;warning', 'logEntry.toHtml() 正确')
	assertIncludes(vc.outputs, 'hello', 'outputs getter 正确聚合内容')
	assertIncludes(vc.outputs, 'a warning', 'outputs 包含所有日志')
}

/**
 * 验证 console.dir 被捕获为结构化条目且渲染一致。
 */
async function testConsoleDir() {
	console.log('\n=== [console.dir 捕获测试] ===')
	const vc = new VirtualConsole({ recordOutput: true, realConsoleOutput: false })
	await vc.hookAsyncContext(() => { console.dir({ id: 72, nested: { ok: true } }, { depth: 3 }) })
	assertEqual(vc.outputEntries.length, 1, 'dir 产生一条 outputEntry')
	const dirEntry = vc.outputEntries[0]
	assertEqual(dirEntry.method, 'dir', 'method 为 dir')
	assertEqual(dirEntry.level, 'log', '语义级别为 log')
	const dirSegments = dirEntry.toSegments()
	assert(dirSegments.length === 2 && dirSegments[0].kind === 'value' && 'snapshot' in dirSegments[0] && dirSegments[1].kind === 'text' && /** @type {{ text: string }} */ dirSegments[1].text === '\n', 'dir：单 value 段 + 尾换行 text')
	const valueSeg = /** @type {{ kind: 'value'; dirOptions?: { depth?: number } }} */ dirSegments[0]
	assertEqual(valueSeg.dirOptions?.depth, 3, 'dirOptions 为浅层 depth，非 ArgSnapshot')
	const ansiFromSegments = renderAnsi(dirSegments, { colorize: dirEntry.supportsAnsi })
	assertEqual(ansiFromSegments, dirEntry.toString(), 'dir：`renderAnsi(toSegments())` 必须与 `toString()` 一致')
	assertEqual(renderPlain(dirSegments), dirEntry.toPlainText(), 'dir：`renderPlain(toSegments())` 必须与 `toPlainText()` 一致')
	assertIncludes(dirEntry.toString(), '72', 'dir toString 包含对象内容')
	assertIncludes(dirEntry.toHtml(), '72', 'dir toHtml 包含对象内容')
	assertIncludes(vc.outputs, '72', 'outputs 聚合含 dir 输出')
}

/**
 * 验证 maxLogEntries 限制仅保留最新日志。
 */
async function testMaxLogEntries() {
	console.log('\n=== [maxLogEntries 限制测试] ===')
	const vc = new VirtualConsole({ recordOutput: true, realConsoleOutput: false, maxLogEntries: 3 })
	await vc.hookAsyncContext(() => { console.log('msg1'); console.log('msg2'); console.log('msg3'); console.log('msg4'); console.log('msg5') })
	assertEqual(vc.outputEntries.length, 3, 'maxLogEntries=3 时只保留最新3条')
	assert(vc.outputEntries[0].args[0] === 'msg3', '第1条保留 msg3')
	assert(vc.outputEntries[1].args[0] === 'msg4', '第2条保留 msg4')
	assert(vc.outputEntries[2].args[0] === 'msg5', '第3条保留 msg5')
}

/**
 * 验证长度裁剪前监听器仍按写入次数同步触发。
 */
async function testMaxLogEntriesListenersFireBeforeTrim() {
	console.log('\n=== [maxLogEntries：监听器在裁剪前逐条触发] ===')
	const seen = []
	const vc = new VirtualConsole({ recordOutput: true, realConsoleOutput: false, maxLogEntries: 3 })
	vc.addLogEntryListener(entry => seen.push(entry.args[0]))
	await vc.hookAsyncContext(() => {
		console.log('msg1'); console.log('msg2'); console.log('msg3'); console.log('msg4'); console.log('msg5')
	})
	assertEqual(seen.length, 5, '监听器触发 5 次（含已被裁掉的条目）')
	assertEqual(seen.join(','), 'msg1,msg2,msg3,msg4,msg5', '监听器按写入顺序收到全部内容')
	assertEqual(vc.outputEntries.map(entry => entry.args[0]).join(','), 'msg3,msg4,msg5', '缓冲仅保留最新 3 条')
	assertIncludes(vc.outputs, 'msg3', 'outputs 含保留条目')
	assert(!vc.outputs.includes('msg1'), 'outputs 不含已裁掉的 msg1')
}

/**
 * 验证 console 与 stream 交错写入的记录顺序。
 */
async function testInterleavedConsoleAndStreamOrder() {
	console.log('\n=== [console / stream 交错顺序] ===')
	const vc = new VirtualConsole({ recordOutput: true, realConsoleOutput: false })
	await vc.hookAsyncContext(() => {
		console.log('a')
		process.stdout.write('b')
		process.stderr.write('c')
		console.log('d')
	})
	assertEqual(vc.outputEntries.map(entry => entry.method).join(','), 'log,stdout,stderr,log', 'method 顺序为 log→stdout→stderr→log')
	assertEqual(vc.outputs, 'a\nbcd\n', 'outputs 按捕获顺序拼接（LogEntry 带 \\n，stream 不带）')
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
	/** @type {import('../../../src/core/entries/log-entry.mjs').LogEntry[]} */
	const seenEntries = []
	/**
	 * 监听 logEntry 事件。
	 * @param {import('../../../src/core/entries/log-entry.mjs').LogEntry} entry - 捕获到的日志条目。
	 * @returns {void}
	 */
	const onLog = (entry) => { logCalls++; seenEntries.push(entry) }
	await vc.hookAsyncContext(async () => {
		console.addLogEntryListener(onLog); console.log('proxy-listener-msg'); console.removeLogEntryListener(onLog); console.log('after-remove')
	})
	assertEqual(logCalls, 1, '通过 Proxy 注册的 addLogEntryListener 只在前一条日志时触发')
	assert(seenEntries.length === 1 && seenEntries[0].args[0] === 'proxy-listener-msg', '回调收到正确条目')
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
 * 验证 recordOutput=false 时监听器也不触发（与存储同门）。
 */
async function testRecordOutputFalseSkipsListeners() {
	console.log('\n=== [recordOutput: false 时监听器不触发] ===')
	let calls = 0
	const vc = new VirtualConsole({ recordOutput: false, realConsoleOutput: false })
	vc.addLogEntryListener(() => { calls++ })
	await vc.hookAsyncContext(() => {
		console.log('silent')
		process.stdout.write('silent-stream')
	})
	assertEqual(calls, 0, 'recordOutput: false 时 addLogEntryListener 不触发')
	assertEqual(vc.outputEntries.length, 0, '缓冲仍为空')
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
 * 嵌套 VC：子级 console.log 与 process.stdout.write 都应到达父级。
 */
async function testNestedVcConsoleAndStreamReachParent() {
	console.log('\n=== [嵌套 VC：console 与流写入到达父级] ===')
	const parent = new VirtualConsole({ recordOutput: true, realConsoleOutput: false })
	const child = new VirtualConsole({
		recordOutput: true,
		realConsoleOutput: true,
		baseConsole: parent,
	})
	await child.hookAsyncContext(() => {
		console.log('nested-log')
		process.stdout.write('nested-stdout\n')
	})
	assertEqual(child.outputEntries.length, 2, '子 VC 记录 console + stdout')
	assertEqual(parent.outputEntries.length, 2, '父 VC 同样收到 console + stdout')
	assert(parent.outputEntries.some(e => e.method === 'log' && e.args[0] === 'nested-log'), '父级含 nested-log')
	assert(parent.outputEntries.some(e => e.method === 'stdout' && e.text?.includes('nested-stdout')), '父级含 nested-stdout')
}

/**
 * 从 segments 树中收集 truncated.ref。
 * @param {unknown} node - 快照或片段树节点。
 * @param {string[]} [out=[]] - 累积 ref 的数组。
 * @returns {string[]} 收集到的全部 truncated ref。
 */
function collectTruncatedRefs(node, out = []) {
	if (!node || typeof node !== 'object') return out
	if (Array.isArray(node)) {
		for (const item of node) collectTruncatedRefs(item, out)
		return out
	}
	const obj = /** @type {Record<string, unknown>} */ node
	if (obj.kind === 'truncated' && typeof obj.ref === 'string') out.push(obj.ref)
	if (obj.kind === 'value') collectTruncatedRefs(obj.snapshot, out)
	else for (const value of Object.values(obj)) collectTruncatedRefs(value, out)
	return out
}

/**
 * 嵌套 VC：父子（及三层链）共享同一 LogEntry；展开 ref 一致。
 */
async function testNestedVcSharesSameEntry() {
	console.log('\n=== [嵌套 VC：共享同一 LogEntry] ===')
	const grandparent = new VirtualConsole({ recordOutput: true, realConsoleOutput: false })
	const parent = new VirtualConsole({
		recordOutput: true,
		realConsoleOutput: true,
		baseConsole: grandparent,
	})
	const child = new VirtualConsole({
		recordOutput: true,
		realConsoleOutput: true,
		baseConsole: parent,
	})

	const deep = { a: { b: { c: { d: { e: { f: { g: 1 } } } } } } }
	await child.hookAsyncContext(() => {
		console.log(deep)
		process.stdout.write('shared-stdout\n')
	})

	assertEqual(child.outputEntries.length, 2, '子 VC 两条')
	assert(child.outputEntries[0] === parent.outputEntries[0], '父子 log 条目为同一对象')
	assert(child.outputEntries[0] === grandparent.outputEntries[0], '孙与祖父 log 条目为同一对象')
	assert(child.outputEntries[1] === parent.outputEntries[1], '父子 stdout 条目为同一对象')
	assert(child.outputEntries[1] === grandparent.outputEntries[1], '孙与祖父 stdout 条目为同一对象')
	assertEqual(child.outputEntries[1].method, 'stdout', '流条目 method 为 stdout')

	const childRefs = collectTruncatedRefs(child.outputEntries[0].toSegments())
	const parentRefs = collectTruncatedRefs(parent.outputEntries[0].toSegments())
	assert(childRefs.length > 0, '深层对象产生 truncated.ref')
	assertEqual(childRefs.join(','), parentRefs.join(','), '父子 toSegments 的 truncated.ref 一致')
}

/**
 * block：记录与监听照常，实际输出延后到 unblock。
 */
async function testBlockDefersOutput() {
	console.log('\n=== [block：延后输出到 unblock] ===')
	const parent = new VirtualConsole({ recordOutput: true, realConsoleOutput: false })
	const child = new VirtualConsole({
		recordOutput: true,
		realConsoleOutput: true,
		baseConsole: parent,
	})
	const seen = []
	child.addLogEntryListener(entry => seen.push(entry.args[0]))

	child.block()
	assert(child.blocked, 'block 后 blocked 为 true')
	await child.hookAsyncContext(() => {
		console.log('a')
		console.log('b')
		console.log('c')
	})
	assertEqual(child.outputEntries.length, 3, 'block 期间本地仍记录 3 条')
	assertEqual(seen.join(','), 'a,b,c', 'block 期间监听器照常触发')
	assertEqual(parent.outputEntries.length, 0, 'block 期间父级零条目')

	child.unblock()
	assert(!child.blocked, 'unblock 后 blocked 为 false')
	assertEqual(parent.outputEntries.length, 3, 'unblock 后父级收到全部 3 条')
	assertEqual(parent.outputEntries.map(e => e.args[0]).join(','), 'a,b,c', '父级按序收到')
	assert(parent.outputEntries[0] === child.outputEntries[0], '转发的仍是同一 entry')
}

/**
 * block + maxLogEntries：block 期间可不裁剪，unblock 后裁回。
 */
async function testBlockAllowsExceedingMaxLogEntries() {
	console.log('\n=== [block：期间可超出 maxLogEntries] ===')
	const parent = new VirtualConsole({ recordOutput: true, realConsoleOutput: false })
	const child = new VirtualConsole({
		recordOutput: true,
		realConsoleOutput: true,
		baseConsole: parent,
		maxLogEntries: 3,
	})
	child.block()
	await child.hookAsyncContext(() => {
		for (const msg of ['msg1', 'msg2', 'msg3', 'msg4', 'msg5']) console.log(msg)
	})
	assertEqual(child.outputEntries.length, 5, 'block 期间保留全部 5 条')
	assertEqual(parent.outputEntries.length, 0, 'block 期间父级仍为空')

	child.unblock()
	assertEqual(child.outputEntries.length, 3, 'unblock 后本地裁到 3 条')
	assertEqual(child.outputEntries.map(e => e.args[0]).join(','), 'msg3,msg4,msg5', '本地保留最新 3 条')
	assertEqual(parent.outputEntries.length, 5, '父级收到全部 5 条（含本地已裁掉的）')
	assertEqual(parent.outputEntries.map(e => e.args[0]).join(','), 'msg1,msg2,msg3,msg4,msg5', '父级按序收到全部')
}

/**
 * block 可重入；depth 0 时多余 unblock 幂等。
 */
async function testBlockReentrantAndExtraUnblock() {
	console.log('\n=== [block：重入与多余 unblock] ===')
	const parent = new VirtualConsole({ recordOutput: true, realConsoleOutput: false })
	const child = new VirtualConsole({
		recordOutput: true,
		realConsoleOutput: true,
		baseConsole: parent,
	})
	child.block()
	child.block()
	await child.hookAsyncContext(() => { console.log('nested-block') })
	child.unblock()
	assertEqual(parent.outputEntries.length, 0, '仅一层 unblock 仍无输出')
	assert(child.blocked, '仍处于 block')
	child.unblock()
	assertEqual(parent.outputEntries.length, 1, '第二次 unblock 才输出')
	assert(!child.blocked, '深度归零')

	child.unblock()
	child.unblock()
	assert(!child.blocked, '多余 unblock 不抛错且仍为未 block')
	child.block()
	await child.hookAsyncContext(() => { console.log('after-extra') })
	assertEqual(parent.outputEntries.length, 1, '再次 block 后新条目未到父级')
	child.unblock()
	assertEqual(parent.outputEntries.length, 2, '后续 block/unblock 仍正常')
	assertEqual(parent.outputEntries[1].args[0], 'after-extra', '后续条目内容正确')
}

/**
 * block 期间 clear：本地立即清空；unblock 时按序重放 clear 标记。
 */
async function testBlockClearReplay() {
	console.log('\n=== [block：clear 标记按序重放] ===')
	const parent = new VirtualConsole({ recordOutput: true, realConsoleOutput: false })
	const child = new VirtualConsole({
		recordOutput: true,
		realConsoleOutput: true,
		baseConsole: parent,
	})
	let clearCount = 0
	child.addClearListener(() => { clearCount++ })

	child.block()
	await child.hookAsyncContext(() => {
		console.log('before-clear')
		console.clear()
		console.log('after-clear')
	})
	assertEqual(clearCount, 1, 'block 期间本地 clear 监听仍触发')
	assertEqual(child.outputEntries.length, 1, 'clear 后本地只余 after-clear')
	assertEqual(child.outputEntries[0].args[0], 'after-clear', '本地 after-clear 正确')
	assertEqual(parent.outputEntries.length, 0, 'block 期间父级仍为空')

	child.unblock()
	assertEqual(parent.outputEntries.length, 1, '父级最终只余 clear 之后的条目')
	assertEqual(parent.outputEntries[0].args[0], 'after-clear', '父级为 after-clear（before-clear 已被重放的 clear 清掉）')
}

/**
 * block 期间 process.stdout.write 不落到 base，unblock 后按序到达。
 */
async function testBlockDefersStreamOutput() {
	console.log('\n=== [block：流写入延后到 unblock] ===')
	const parent = new VirtualConsole({ recordOutput: true, realConsoleOutput: false })
	const child = new VirtualConsole({
		recordOutput: true,
		realConsoleOutput: true,
		baseConsole: parent,
	})
	child.block()
	await child.hookAsyncContext(() => {
		console.log('log-first')
		process.stdout.write('stream-mid')
		console.log('log-last')
	})
	assertEqual(child.outputEntries.length, 3, '本地记录 log+stdout+log')
	assertEqual(parent.outputEntries.length, 0, 'block 期间流也不到父级')

	child.unblock()
	assertEqual(parent.outputEntries.length, 3, 'unblock 后父级收到 3 条')
	assertEqual(parent.outputEntries.map(e => e.method).join(','), 'log,stdout,log', 'method 顺序保持')
	assertEqual(parent.outputEntries[1].text, 'stream-mid', 'stdout 文本正确')
	assert(parent.outputEntries[1] === child.outputEntries[1], '流条目仍为同一对象')
}

/**
 * 透传方法（table）在两种 realConsoleOutput 下都被记录。
 * Node `Console.table` 经 `this.log` 写入，故表现为 `log` 条目而非裸流。
 */
async function testPassthroughMethodsRecordedViaStreams() {
	console.log('\n=== [透传方法：table 在两种 realConsoleOutput 下均记录] ===')
	const quiet = new VirtualConsole({ recordOutput: true, realConsoleOutput: false })
	await quiet.hookAsyncContext(() => { console.table({ a: 1 }) })
	assertEqual(quiet.outputEntries.length, 1, 'realConsoleOutput:false 时 table 被记录')
	assertEqual(quiet.outputEntries[0].method, 'log', 'Console.table 经 this.log 落为 log 条目')
	assertIncludes(quiet.outputs, 'a', 'table 输出含内容')

	const parent = new VirtualConsole({ recordOutput: true, realConsoleOutput: false })
	const child = new VirtualConsole({
		recordOutput: true,
		realConsoleOutput: true,
		baseConsole: parent,
	})
	await child.hookAsyncContext(() => { console.table({ b: 2 }) })
	assertEqual(child.outputEntries.length, 1, 'realConsoleOutput:true 时子 VC 记录 table')
	assertEqual(parent.outputEntries.length, 1, 'realConsoleOutput:true 时父 VC 也收到 table')
	assertIncludes(parent.outputs, 'b', '父级 table 输出含内容')
}

/**
 * 嵌套惰性捕获：子层不记录时由父层捕获，栈仍指向测试文件。
 */
async function testNestedLazyCaptureStackPointsToCaller() {
	console.log('\n=== [嵌套惰性捕获：父层采栈仍指向调用方] ===')
	const parent = new VirtualConsole({ recordOutput: true, realConsoleOutput: false })
	const child = new VirtualConsole({
		recordOutput: false,
		realConsoleOutput: true,
		baseConsole: parent,
	})
	await child.hookAsyncContext(() => { console.log('lazy-stack-marker') })
	assertEqual(parent.outputEntries.length, 1, '父级收到一条')
	assertEqual(child.outputEntries.length, 0, '子级不记录')
	const filePath = String(parent.outputEntries[0].stack[0]?.filePath ?? '').replace(/\\/g, '/')
	assert(filePath.includes('suites/integration/'), `首帧应在 integration 测试文件，实际：${filePath}`)
	assert(!filePath.includes('src/runtime/'), `首帧不得落在 runtime 实现内，实际：${filePath}`)
}

/**
 * README 承诺：包装函数通过 stackFrameSkipCount 跳过自身帧。
 */
async function testStackFrameSkipCountSkipsWrapper() {
	console.log('\n=== [stackFrameSkipCount：包装函数] ===')
	const virtualConsole = new VirtualConsole({ recordOutput: true, realConsoleOutput: false })
	/**
	 * 临时提高 `stackFrameSkipCount` 后转发 `console.log`。
	 * @param {...any} args - 透传给 `console.log` 的参数。
	 * @returns {void}
	 */
	function wrapperLog(...args) {
		try {
			console.stackFrameSkipCount++
			console.log(...args)
		} finally {
			console.stackFrameSkipCount--
		}
	}
	await virtualConsole.hookAsyncContext(() => { wrapperLog('skip-wrapper') })
	const top = virtualConsole.outputEntries[0].stack[0]
	assert(!String(top.functionName).includes('wrapperLog'), `首帧不应为 wrapperLog，实际：${top.functionName}`)
	const filePath = String(top.filePath ?? '').replace(/\\/g, '/')
	assert(filePath.includes('suites/integration/'), `首帧应在测试文件，实际：${filePath}`)
}

/**
 * 纯透传层不建 LogEntry：spy 收到原始 args；Buffer 原样到达原生 stdout。
 */
async function testPassthroughSkipsCapture() {
	console.log('\n=== [纯透传：零捕获，原始 args / Buffer] ===')
	const { streamTable: { stdout } } = await import('../../../src/runtime/node/native-output.mjs')
	/** @type {any[][]} */
	const seenArgs = []
	const spyConsole = {
		/**
		 * 记录 `log` 调用参数供断言。
		 * @param {...any} args - `console.log` 参数。
		 * @returns {void}
		 */
		log: (...args) => { seenArgs.push(args) },
		/**
		 *
		 */
		clear: () => {},
	}
	const passthrough = new VirtualConsole({
		recordOutput: false,
		realConsoleOutput: true,
		baseConsole: spyConsole,
	})
	const payload = { id: 1 }
	passthrough.log(payload, 'raw')
	assertEqual(seenArgs.length, 1, 'spy 收到一次 log')
	assert(seenArgs[0][0] === payload, 'spy 收到同一对象引用')
	assertEqual(seenArgs[0][1], 'raw', 'spy 收到原始第二参数')
	assertEqual(passthrough.outputEntries.length, 0, '透传层无 entry')

	/** @type {any[]} */
	const seenChunks = []
	const originalWrite = stdout.write
	/**
	 * 拦截 `stdout.write` 以收集 chunk，再转发原生实现。
	 * @param {Buffer | string} chunk - 写入的数据块。
	 * @param {string} encoding - 编码名。
	 * @param {(error?: Error | null) => void} callback - 完成回调。
	 * @returns {boolean} 原生 `write` 的返回值。
	 */
	stdout.write = function patchedWrite(chunk, encoding, callback) {
		seenChunks.push(chunk)
		return originalWrite.call(this, chunk, encoding, callback)
	}
	try {
		const buffer = Buffer.from([0x00, 0xff, 0x80])
		const middle = new VirtualConsole({
			recordOutput: false,
			realConsoleOutput: true,
			baseConsole: spyConsole,
		})
		await middle.hookAsyncContext(() => { process.stdout.write(buffer) })
		assertEqual(middle.outputEntries.length, 0, '中间层零条目')
		assert(seenChunks.some(chunk => chunk === buffer), '原生 write 收到同一 Buffer 引用（未解码）')
	} finally {
		stdout.write = originalWrite
	}
}

/**
 * block 期间即便本层不记录，延后输出仍冻结当时条目到父级。
 */
async function testBlockForcesCaptureOnNonRecordingLayer() {
	console.log('\n=== [block：非记录层仍冻结输出] ===')
	const parent = new VirtualConsole({ recordOutput: true, realConsoleOutput: false })
	const child = new VirtualConsole({
		recordOutput: false,
		realConsoleOutput: true,
		baseConsole: parent,
	})
	child.block()
	await child.hookAsyncContext(() => { console.log('blocked-passthrough') })
	assertEqual(child.outputEntries.length, 0, '子级仍不保留条目')
	assertEqual(parent.outputEntries.length, 0, 'block 期间父级为空')
	child.unblock()
	assertEqual(parent.outputEntries.length, 1, 'unblock 后父级收到')
	assertEqual(parent.outputEntries[0].args[0], 'blocked-passthrough', '内容正确')
	const filePath = String(parent.outputEntries[0].stack[0]?.filePath ?? '').replace(/\\/g, '/')
	assert(filePath.includes('suites/integration/'), `冻结栈仍指向测试文件，实际：${filePath}`)
}

/**
 * 惰性栈：重复读取复用同一数组；纯渲染不触发 Error.prepareStackTrace。
 */
async function testLazyStackParseOnRead() {
	console.log('\n=== [惰性栈：缓存与渲染不解析] ===')
	const virtualConsole = new VirtualConsole({ recordOutput: true, realConsoleOutput: false })
	await virtualConsole.hookAsyncContext(() => { console.log('lazy') })
	const entry = virtualConsole.outputEntries[0]

	const previousPrepare = Error.prepareStackTrace
	let prepareCalls = 0
	/**
	 * 统计 `prepareStackTrace` 调用次数的探针。
	 * @param {Error} error - 待格式化的错误。
	 * @param {object[]} structuredStack - V8 结构化栈帧。
	 * @returns {object[]} 解析后的栈表示（或原样透传）。
	 */
	Error.prepareStackTrace = (error, structuredStack) => {
		prepareCalls++
		return previousPrepare ? previousPrepare(error, structuredStack) : structuredStack
	}
	try {
		void entry.toString()
		void entry.toHtml()
		void virtualConsole.outputs
		assertEqual(prepareCalls, 0, 'toString / toHtml / outputs 不触发 prepareStackTrace')
		const first = entry.stack
		const second = entry.stack
		assert(Array.isArray(first) && first.length > 0, '首次读取得到非空栈')
		assert(first === second, '再次读取为同一数组引用')
		assert(prepareCalls >= 1, '读取 stack 时触发解析')
	} finally {
		Error.prepareStackTrace = previousPrepare
	}
}

/**
 * 测量原生 log 与各虚拟路径耗时并断言上限。
 * @param {{ label: string, recordOutput: boolean, logMultiplier: number, writeAsMultiplier: number }} options - 场景标签、是否记录及相对原生的耗时倍数上限。
 * @returns {Promise<void>}
 */
async function assertLogAndWriteAsPerformanceCeiling({ label, recordOutput, logMultiplier, writeAsMultiplier }) {
	console.log(`\n=== [${label}：log / writeAs 性能上限（各 ${PERF_ENTRY_COUNT} 条，recordOutput=${recordOutput}）] ===`)

	const nativeConsole = createNullConsole()

	for (let i = 0; i < PERF_WARMUP_COUNT; i++) nativeConsole.log('warmup', i)
	const nativeLogMs = measureMs(() => {
		for (let i = 0; i < PERF_ENTRY_COUNT; i++) nativeConsole.log('perf', i)
	})
	console.log(`  原生 log: ${nativeLogMs.toFixed(2)} ms`)

	const vcLog = new VirtualConsole({ recordOutput, realConsoleOutput: false })
	let virtualLogMs = 0
	await vcLog.hookAsyncContext(() => {
		for (let i = 0; i < PERF_WARMUP_COUNT; i++) console.log('warmup', i)
		virtualLogMs = measureMs(() => {
			for (let i = 0; i < PERF_ENTRY_COUNT; i++) console.log('perf', i)
		})
	})
	const logCeilingMs = nativeLogMs * logMultiplier
	console.log(`  虚拟 log: ${virtualLogMs.toFixed(2)} ms (上限 ${logCeilingMs.toFixed(2)} ms，${logMultiplier}× 原生)`)
	assert(
		virtualLogMs <= logCeilingMs,
		`虚拟 log (${virtualLogMs.toFixed(2)} ms) 不得超过原生 log 的 ${logMultiplier} 倍 (${logCeilingMs.toFixed(2)} ms)`,
	)
	if (recordOutput)
		assertEqual(vcLog.outputEntries.length, PERF_ENTRY_COUNT + PERF_WARMUP_COUNT, '捕获模式下 log 记录了全部条目')

	const vcWriteAs = new VirtualConsole({ recordOutput, realConsoleOutput: false })
	for (let i = 0; i < PERF_WARMUP_COUNT; i++) vcWriteAs.writeAs('log', 'warmup', i)
	const writeAsLogMs = measureMs(() => {
		for (let i = 0; i < PERF_ENTRY_COUNT; i++) vcWriteAs.writeAs('log', 'perf', i)
	})
	const writeAsCeilingMs = nativeLogMs * writeAsMultiplier
	console.log(`  writeAs('log'): ${writeAsLogMs.toFixed(2)} ms (上限 ${writeAsCeilingMs.toFixed(2)} ms，${writeAsMultiplier}× 原生 log)`)
	assert(
		writeAsLogMs <= writeAsCeilingMs,
		`writeAs('log') (${writeAsLogMs.toFixed(2)} ms) 不得超过原生 log 的 ${writeAsMultiplier} 倍 (${writeAsCeilingMs.toFixed(2)} ms)`,
	)
	if (recordOutput)
		assertEqual(vcWriteAs.outputEntries.length, PERF_ENTRY_COUNT + PERF_WARMUP_COUNT, '捕获模式下 writeAs 记录了全部条目')
	else
		assertEqual(vcWriteAs.outputEntries.length, 0, '非捕获模式下 writeAs 不写入 outputEntries')
}

/** 非捕获：虚拟 log / writeAs 均 ≤ 1× 原生（惰性路径接近零分配）。 */
async function testLogAndWriteAsPerformanceCeiling() {
	await assertLogAndWriteAsPerformanceCeiling({
		label: '非捕获虚拟控制台',
		recordOutput: false,
		logMultiplier: 1,
		writeAsMultiplier: 1,
	})
}

/** 捕获：虚拟 log ≤ 6× 原生，writeAs ≤ 8× 原生。 */
async function testCapturedLogAndWriteAsPerformanceCeiling() {
	await assertLogAndWriteAsPerformanceCeiling({
		label: '捕获虚拟控制台',
		recordOutput: true,
		logMultiplier: 6,
		writeAsMultiplier: 8,
	})
}

/**
 * 非捕获 process.stdout.write 性能上限。
 */
async function testNonCapturingStdoutWritePerformanceCeiling() {
	console.log(`\n=== [非捕获 stdout.write 性能上限（各 ${PERF_ENTRY_COUNT} 次）] ===`)
	const sink = new Writable({ /**
	 * 忽略写入内容并立即完成。
	 * @param {Buffer | string} _chunk - 被丢弃的数据块。
	 * @param {string} _encoding - 编码名。
	 * @param {(error?: Error | null) => void} callback - 写入完成回调。
	 * @returns {void}
	 */
		write(_chunk, _encoding, callback) { callback() } })
	const nativeConsole = new Console({ stdout: sink, stderr: sink })
	for (let i = 0; i < PERF_WARMUP_COUNT; i++) sink.write('w')
	const nativeMs = measureMs(() => {
		for (let i = 0; i < PERF_ENTRY_COUNT; i++) sink.write('p')
	})
	const virtualConsole = new VirtualConsole({
		recordOutput: false,
		realConsoleOutput: false,
		baseConsole: nativeConsole,
	})
	let virtualMs = 0
	await virtualConsole.hookAsyncContext(() => {
		for (let i = 0; i < PERF_WARMUP_COUNT; i++) process.stdout.write('w')
		virtualMs = measureMs(() => {
			for (let i = 0; i < PERF_ENTRY_COUNT; i++) process.stdout.write('p')
		})
	})
	const ceilingMs = nativeMs * 3
	console.log(`  原生 write: ${nativeMs.toFixed(2)} ms`)
	console.log(`  虚拟 write: ${virtualMs.toFixed(2)} ms (上限 ${ceilingMs.toFixed(2)} ms，3× 原生)`)
	assert(virtualMs <= ceilingMs, `非捕获 stdout.write (${virtualMs.toFixed(2)} ms) 不得超过原生的 3 倍`)
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
		testMaxLogEntriesListenersFireBeforeTrim,
		testInterleavedConsoleAndStreamOrder,
		testClear,
		testWriteAs,
		testLogAndWriteAsPerformanceCeiling,
		testCapturedLogAndWriteAsPerformanceCeiling,
		testNonCapturingStdoutWritePerformanceCeiling,
		testWriteAsNoDoubleRecord,
		testNestedVcConsoleAndStreamReachParent,
		testNestedVcSharesSameEntry,
		testNestedLazyCaptureStackPointsToCaller,
		testStackFrameSkipCountSkipsWrapper,
		testPassthroughSkipsCapture,
		testBlockForcesCaptureOnNonRecordingLayer,
		testLazyStackParseOnRead,
		testBlockDefersOutput,
		testBlockAllowsExceedingMaxLogEntries,
		testBlockReentrantAndExtraUnblock,
		testBlockClearReplay,
		testBlockDefersStreamOutput,
		testPassthroughMethodsRecordedViaStreams,
		testProcessStreamRedirection,
		testAddLogEntryListenerCallbacks,
		testRecordOutputFalse,
		testRecordOutputFalseSkipsListeners,
		testGlobalConsoleProxy,
		testRendering,
	])
}
