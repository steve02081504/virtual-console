import { VirtualConsole } from '@steve02081504/virtual-console'

import { TraceLogEntry } from './src/core/entries.mjs'
import {
	DEFAULT_SNAPSHOT_DEPTH,
	expandSnapshotRef,
	getLogEntryArgs,
	serializeArgSnapshot,
} from './src/core/snapshot.mjs'
import { getStackInfo } from './src/core/stack.mjs'
import { formatArgs } from './src/format/segments.mjs'

let passed = 0
let failed = 0

/**
 * 断言条件为真；失败时记录失败计数并输出可读错误。
 * @param {boolean} condition - 断言条件。
 * @param {string} message - 断言说明文本。
 * @returns {void} 无返回值。
 */
function assert(condition, message) {
	if (condition) {
		console.log(`  ✓ ${message}`)
		passed++
	} else {
		console.error(`  ✗ FAIL: ${message}`)
		failed++
	}
}

/**
 * 断言两值严格相等（===）。
 * @param {unknown} actual - 实际值。
 * @param {unknown} expected - 期望值。
 * @param {string} message - 断言说明文本。
 * @returns {void} 无返回值。
 */
function assertEqual(actual, expected, message) {
	if (actual === expected) {
		console.log(`  ✓ ${message}`)
		passed++
	} else {
		console.error(`  ✗ FAIL: ${message}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`)
		failed++
	}
}

/**
 * 断言字符串包含指定子串。
 * @param {string} str - 目标字符串。
 * @param {string} substr - 期望出现的子串。
 * @param {string} message - 断言说明文本。
 * @returns {void} 无返回值。
 */
function assertIncludes(str, substr, message) {
	if (typeof str === 'string' && str.includes(substr)) {
		console.log(`  ✓ ${message}`)
		passed++
	} else {
		console.error(`  ✗ FAIL: ${message}\n    "${substr}" not found in "${str}"`)
		failed++
	}
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
 * 测试 console.dir 被捕获为 DirLogEntry（Node / util.newLogEntry 与浏览器一致）
 */
async function testConsoleDir() {
	console.log('\n=== [console.dir 捕获测试] ===')

	const vc = new VirtualConsole({ recordOutput: true, realConsoleOutput: false })

	await vc.hookAsyncContext(() => {
		console.dir({ id: 42, nested: { ok: true } }, { depth: 3 })
	})

	assertEqual(vc.outputEntries.length, 1, 'dir 产生一条 outputEntry')
	assertEqual(vc.outputEntries[0].method, 'dir', 'method 为 dir')
	assertEqual(vc.outputEntries[0].level, 'log', '语义级别为 log')
	assertIncludes(vc.outputEntries[0].toString(), '42', 'dir toString 包含对象内容')
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
 * 测试 write_as 方法
 */
async function testWriteAs() {
	console.log('\n=== [write_as 方法测试] ===')

	const vc = new VirtualConsole({ recordOutput: true, realConsoleOutput: false })

	await vc.hookAsyncContext(() => {
		vc.write_as('log', 'written as log')
		vc.write_as('error', 'written as error')
	})

	assertEqual(vc.outputEntries.length, 2, 'write_as 记录了2条日志')
	assertEqual(vc.outputEntries[0].level, 'log', 'write_as log 级别正确')
	assertEqual(vc.outputEntries[1].level, 'error', 'write_as error 级别正确')
	assertIncludes(vc.outputEntries[0].toString(), 'written as log', 'write_as 内容正确')
}

/**
 * 测试 process.stdout 重定向
 */
async function testStdoutRedirection() {
	console.log('\n=== [process.stdout 重定向测试] ===')

	const vc = new VirtualConsole({ recordOutput: true, realConsoleOutput: false })

	await vc.hookAsyncContext(async () => {
		process.stdout.write('written to process.stdout\n')
	})

	assertIncludes(vc.outputs, 'written to process.stdout', 'process.stdout.write 被虚拟控制台捕获')
	assert(vc.outputEntries.length > 0, 'process.stdout 写入被记录为 outputEntry')
	assertEqual(vc.outputEntries[0].method, 'stdout', 'process.stdout 写入的 method 为 stdout')
	assertEqual(vc.outputEntries[0].level, 'log', 'process.stdout 语义级别为 log')
}

/**
 * 测试 getStackInfo 函数
 */
async function testGetStackInfo() {
	console.log('\n=== [getStackInfo 函数测试] ===')

	const stack = getStackInfo(0)
	assert(Array.isArray(stack), 'getStackInfo 返回数组')
	assert(stack.length > 0, 'getStackInfo 返回非空数组')

	const firstFrame = stack[0]
	assert(typeof firstFrame.functionName !== 'undefined', '包含 functionName 字段')
	assert(typeof firstFrame.filePath === 'string', '包含 filePath 字段')
	assert(typeof firstFrame.line === 'number', '包含 line 字段')
	assert(typeof firstFrame.column === 'number', '包含 column 字段')
	assert(typeof firstFrame.raw === 'string', '包含 raw 字段')
	assert(firstFrame.line > 0, 'line 大于 0')

	const stackSkipped = getStackInfo(1)
	assert(stackSkipped.length < stack.length || stackSkipped[0]?.raw !== stack[0]?.raw, 'skip_num 参数有效，跳过了帧')
}

/**
 * 测试 formatArgs 函数
 */
function testFormatArgs() {
	console.log('\n=== [formatArgs 函数测试] ===')

	assertEqual(formatArgs([]), '', '空参数返回空字符串')
	assertEqual(formatArgs(['hello']), 'hello', '单字符串正确返回')
	assertEqual(formatArgs(['%s', 'world']), 'world', '%s 格式化正确')
	assertEqual(formatArgs(['%d', 42]), '42', '%d 格式化正确')
	assertEqual(formatArgs(['%f', 3.14]), '3.14', '%f 格式化正确')
	assertEqual(formatArgs(['%%']), '%', '%% 转义正确')
	assertEqual(formatArgs(['%f', Symbol('x')]), 'NaN', '%f 对 Symbol 返回 NaN')
	assertEqual(formatArgs(['%d', Symbol('x')]), 'NaN', '%d 对 Symbol 返回 NaN')

	const result = formatArgs(['value: %s', 'test'])
	assertEqual(result, 'value: test', '字符串中插值正确')

	const multiResult = formatArgs(['a', 'b', 'c'])
	assert(typeof multiResult === 'string', '多参数返回字符串')

	const objResult = formatArgs([{ key: 'value' }])
	assert(typeof objResult === 'string', '对象参数返回字符串')

	const circular = { name: 'self' }
	circular.self = circular
	const circularResult = formatArgs(['%o', circular])
	assert(typeof circularResult === 'string', '循环对象通过 %o 格式化后返回字符串')
	assert(circularResult.length > 0, '循环对象通过 %o 格式化后不抛错且有输出')

	const err = new Error('formatArgs edge-case error')
	const errResult = formatArgs([err])
	assertIncludes(errResult, err.message, 'Error 参数格式化结果包含错误消息')
	assertIncludes(errResult, 'Error: formatArgs edge-case error', 'Error 参数格式化结果包含错误类型与消息')
	assertIncludes(errResult, 'at ', 'Error 参数格式化结果包含堆栈信息')

	const traceEntry = new TraceLogEntry({
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
	const traceResult = formatArgs([traceEntry])
	assertIncludes(traceResult, '"level": "debug"', 'TraceLogEntry 格式化结果包含语义 level（trace→debug）')
	assertIncludes(traceResult, '"method": "trace"', 'TraceLogEntry 格式化结果包含 method 字段')
	assertIncludes(traceEntry.toString(), 'trace label', 'TraceLogEntry toString 包含标签文本')
	assertIncludes(traceResult, '"functionName": "testFormatArgs"', 'TraceLogEntry 格式化结果包含栈帧关键字段')
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
 * 测试 process.stderr 重定向
 */
async function testStderrRedirection() {
	console.log('\n=== [process.stderr 重定向测试] ===')

	const vc = new VirtualConsole({ recordOutput: true, realConsoleOutput: false })

	await vc.hookAsyncContext(async () => {
		process.stderr.write('written to process.stderr\n')
	})

	assertIncludes(vc.outputs, 'written to process.stderr', 'process.stderr.write 被虚拟控制台捕获')
	assert(vc.outputEntries.length > 0, 'process.stderr 写入被记录为 outputEntry')
	assertEqual(vc.outputEntries[0].method, 'stderr', 'process.stderr 写入的 method 为 stderr')
	assertEqual(vc.outputEntries[0].level, 'error', 'process.stderr 语义级别为 error')
}

/**
 * 测试 addLogEntryListener 回调
 */
async function testOnLogEntryCallback() {
	console.log('\n=== [addLogEntryListener 回调测试] ===')

	const callbackEntries = []
	const vc = new VirtualConsole({
		recordOutput: true,
		realConsoleOutput: false,
	})
	/**
	 * 记录每条新增日志，供断言回调触发次数与内容。
	 * @param {import('./src/core/entries.mjs').LogEntry} entry - 新增日志条目对象。
	 * @returns {void} 无返回值。
	 */
	vc.addLogEntryListener((entry) => callbackEntries.push(entry))

	await vc.hookAsyncContext(() => {
		console.log('msg1')
		console.warn('msg2')
		console.error('msg3')
	})

	assertEqual(callbackEntries.length, 3, 'addLogEntryListener 被调用了 3 次')
	if (callbackEntries.length >= 3) {
		assertEqual(callbackEntries[0].level, 'log', 'addLogEntryListener 第1次回调 level 为 log')
		assertEqual(callbackEntries[1].level, 'warn', 'addLogEntryListener 第2次回调 level 为 warn')
		assertEqual(callbackEntries[2].level, 'error', 'addLogEntryListener 第3次回调 level 为 error')
		assert(callbackEntries[0] === vc.outputEntries[0], 'addLogEntryListener 回调传入的是同一个 entry 对象')
	}
}

/**
 * 测试 addLogEntryListener 在 process.stdout/stderr 写入时也触发
 */
async function testOnLogEntryCallbackForStreams() {
	console.log('\n=== [addLogEntryListener 流回调测试] ===')

	const callbackEntries = []
	const vc = new VirtualConsole({
		recordOutput: true,
		realConsoleOutput: false,
	})
	/**
	 * 收集由 stdout/stderr 触发的回调条目。
	 * @param {import('./src/core/entries.mjs').LogEntry} entry - 新增日志条目对象。
	 * @returns {void} 无返回值。
	 */
	vc.addLogEntryListener((entry) => callbackEntries.push(entry))

	await vc.hookAsyncContext(async () => {
		process.stdout.write('stdout msg\n')
		process.stderr.write('stderr msg\n')
	})

	assert(callbackEntries.length >= 2, 'process.stdout/stderr 写入也触发 addLogEntryListener 回调')
	assert(callbackEntries.some(e => e.method === 'stdout'), '包含 stdout 流的回调')
	assert(callbackEntries.some(e => e.method === 'stderr'), '包含 stderr 流的回调')
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
 * 测试 process.stdout 捕获条目的 stack 首帧为用户调用处，而非 Node/Deno 流内部栈。
 */
async function testStdoutCaptureStackTopIsUserCode() {
	console.log('\n=== [stdout 捕获栈首帧为用户代码] ===')

	const vc = new VirtualConsole({ recordOutput: true, realConsoleOutput: false })

	/**
	 * 与栈断言对应的调用点：stdout 写入必须发自具名函数便于辨认。
	 * @returns {void}
	 */
	function callerOfStdoutWrite() {
		process.stdout.write('stdout-stack-top-marker\n')
	}

	await vc.hookAsyncContext(() => callerOfStdoutWrite())

	const entry = vc.outputEntries.find(e =>
		e.method === 'stdout' && typeof e.streamText === 'string' && e.streamText.includes('stdout-stack-top-marker'))

	assert(entry, '找到带标记的 stdout 条目')
	assert(Array.isArray(entry.stack) && entry.stack.length > 0, 'stdout 条目含非空 stack')

	const top = entry.stack[0]
	const fp = top.filePath

	assert(
		!fp.startsWith('node:') && !fp.startsWith('deno:') && !fp.startsWith('ext:'),
		`首帧不应为运行时内部路径，实际 filePath=${fp}`)

	assert(
		fp.includes('test.mjs'),
		`首帧应落在本测试文件（test.mjs），实际 filePath=${fp}`)

	assert(
		top.functionName.includes('callerOfStdoutWrite'),
		`首帧函数名应对应为写入调用者，实际 functionName=${top.functionName}`)
}

/**
 * 测试 logEntry 的 stack 字段（Node.js 专属）
 */
async function testLogEntryStackField() {
	console.log('\n=== [logEntry.stack 字段测试] ===')

	const vc = new VirtualConsole({ recordOutput: true, realConsoleOutput: false })

	await vc.hookAsyncContext(() => {
		console.log('test stack')
	})

	const entry = vc.outputEntries[0]
	assert('stack' in entry, 'logEntry 包含 stack 字段')
	assert(Array.isArray(entry.stack), 'logEntry.stack 是数组')
	assert(entry.stack.length > 0, 'logEntry.stack 不为空')
	assert(typeof entry.stack[0].filePath === 'string', 'stack 帧包含 filePath')
	assert(typeof entry.stack[0].line === 'number', 'stack 帧包含 line 号')
	// 第一帧应该是用户代码（test.mjs），而非库内部帧（node.mjs / browser.mjs / entries.mjs 等）
	assert(entry.stack[0].filePath.includes('test.mjs'), `第一个栈帧应指向用户代码（test.mjs），实际为：${entry.stack[0].filePath}`)
}

/**
 * 测试 write_as 在 realConsoleOutput: true 时不双重记录
 */
async function testWriteAsNoDoubleRecord() {
	console.log('\n=== [write_as 不双重记录测试] ===')

	const capturedEntries = []
	const vc = new VirtualConsole({
		recordOutput: true,
		realConsoleOutput: true,
		base_console: new VirtualConsole({ recordOutput: false, realConsoleOutput: false }),
	})
	/**
	 * 收集 write_as 触发的日志，验证不会重复记录。
	 * @param {import('./src/core/entries.mjs').LogEntry} entry - 新增日志条目对象。
	 * @returns {void} 无返回值。
	 */
	vc.addLogEntryListener((entry) => capturedEntries.push(entry))

	vc.write_as('log', 'should appear once')
	vc.write_as('error', 'error once')

	assertEqual(vc.outputEntries.length, 2, 'write_as 在 realConsoleOutput: true 时只记录一次（共2条）')
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
		if (seg.kind === 'values' && seg.items?.[0])
			ref = findTruncatedRef(seg.items[0].snapshot)
		if (ref) break
		if (seg.kind === 'value')
			ref = findTruncatedRef(seg.snapshot)
		if (ref) break
	}

	assert(ref.length > 0, 'toSegments 中含可展开 truncated.ref')

	const exp = expandSnapshotRef(ref)
	assert(exp.ok === true, 'expandSnapshotRef 成功')
	assert(exp.snapshot != null, '展开得到快照')

	const noCtx = serializeArgSnapshot(deep, new WeakSet(), 0, DEFAULT_SNAPSHOT_DEPTH, null)
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
 * 按顺序执行全部测试，并在末尾输出汇总结果。
 * @returns {Promise<void>} 全部测试执行完成后 resolve。
 */
async function runAllTests() {
	console.log('🚀 开始运行所有测试...\n')

	await testRendering()
	await testOutputEntries()
	await testConsoleDir()
	await testMaxLogEntries()
	await testClear()
	await testWriteAs()
	await testStdoutRedirection()
	await testStderrRedirection()
	await testOnLogEntryCallback()
	await testOnLogEntryCallbackForStreams()
	await testRecordOutputFalse()
	await testStdoutCaptureStackTopIsUserCode()
	await testLogEntryStackField()
	await testWriteAsNoDoubleRecord()
	await testConsecutiveStdoutMerge()
	await testConcurrentAsyncIsolation()
	await testGetStackInfo()
	testFormatArgs()
	await testTruncatedAndExpand()
	await testContextIsolation()

	console.log(`\n${'='.repeat(50)}`)
	if (failed === 0)
		console.log(`✅ 全部通过！共 ${passed} 项测试。`)
	else {
		console.error(`❌ 测试结束：${passed} 通过，${failed} 失败。`)
		process.exit(1)
	}
}

runAllTests()
