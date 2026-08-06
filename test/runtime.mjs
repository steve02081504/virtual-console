import { realpathSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import {
	VirtualConsole,
	getStackInfo,
} from '@steve02081504/virtual-console'

import { parseStackTraceLine, pathToFileURL, stackFrameToOsc8Href } from '../src/core/stack.mjs'

import { assert, assertEqual, runTestGroup } from './harness.mjs'

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
	assert(vc1.outputEntries[0].args[0] === 'from vc1', 'vc1 第1条内容正确')
	assert(vc2.outputEntries[0].args[0] === 'from vc2', 'vc2 第1条内容正确')
	assert(vc1.outputEntries[1].args[0] === 'back to vc1', 'vc1 第2条内容正确')
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
	assert(vcA.outputEntries[0].args[0] === 'Starting task A', 'vcA 第1条内容正确')
	assert(vcA.outputEntries[1].args[0] === 'Finished task A', 'vcA 第2条内容正确')
	assert(vcB.outputEntries[0].args[0] === 'Starting task B', 'vcB 第1条内容正确')
	assert(vcB.outputEntries[1].args[0] === 'Finished task B', 'vcB 第2条内容正确')
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
 * `eval at …` / AsyncFunction 栈行：畸形路径不得抛错；可解析时指向宿主文件行列。
 */
function testParseStackTraceLineEvalAtFrames() {
	console.log('\n=== [parseStackTraceLine：eval at / AsyncFunction 栈] ===')

	const hostFile = realpathSync(fileURLToPath(import.meta.url))
	const hostUrl = pathToFileURL(hostFile)
	const hostBase = hostFile.replace(/\\/g, '/').split('/').pop()

	/** @param {string} line @returns {void} */
	const assertNoThrow = line => {
		parseStackTraceLine(line)
	}

	assertNoThrow(`    at eval (eval at <anonymous> (${hostUrl}:151:40), <anonymous>:3:13)`)
	assertNoThrow('    at eval (eval at <anonymous> (file:///C:/missing/async-eval/deno.mjs:151:40), <anonymous>:3:13)')
	assertNoThrow('    at eval (eval at <anonymous> (deno.mjs:151:40), <anonymous>:3:13)')

	const resolved = parseStackTraceLine(`    at eval (eval at <anonymous> (${hostUrl}:151:40), <anonymous>:3:13)`)
	assertEqual(resolved.functionName, 'eval', 'eval-at 帧 functionName')
	assert(resolved.filePath.replace(/\\/g, '/').endsWith(hostBase), `eval-at 帧 filePath 指向宿主文件，实际：${resolved.filePath}`)
	assertEqual(resolved.line, 151, 'eval-at 帧 line 为宿主行')
	assertEqual(resolved.column, 40, 'eval-at 帧 column 为宿主列')
	assert(stackFrameToOsc8Href(resolved).length > 0, 'eval-at 宿主帧可生成 OSC8 href')

	const plainHost = parseStackTraceLine('    at eval (eval at run (/tmp/host.mjs:10:1), <anonymous>:2:3)')
	assertEqual(plainHost.functionName, 'eval', '普通路径 eval-at functionName')
	assertEqual(plainHost.filePath, '/tmp/host.mjs', '普通路径 eval-at filePath')
	assertEqual(plainHost.line, 10, '普通路径 eval-at line')
	assertEqual(plainHost.column, 1, '普通路径 eval-at column')

	const missing = parseStackTraceLine('    at eval (eval at <anonymous> (file:///C:/missing/async-eval/deno.mjs:151:40), <anonymous>:3:13)')
	assertEqual(missing.filePath, '', '不存在宿主 file:// 时 filePath 为空')
	assertEqual(missing.line, 3, '不存在宿主时保留 <anonymous> 行')
	assertEqual(missing.column, 13, '不存在宿主时保留 <anonymous> 列')
	assertEqual(stackFrameToOsc8Href(missing), '', '不可链接帧无 OSC8 href')

	const malformed = parseStackTraceLine('    at eval (eval at <anonymous> (deno.mjs:151:40), <anonymous>:3:13)')
	assertEqual(malformed.filePath, 'deno.mjs', 'eval-at 普通宿主路径保留')
	assertEqual(malformed.line, 151, 'eval-at 普通宿主 line')
	assertEqual(malformed.column, 40, 'eval-at 普通宿主 column')
	assertEqual(malformed.functionName, 'eval', 'eval-at 普通宿主 functionName')

	const anonymousOnly = parseStackTraceLine('    at foo (<anonymous>:1:1)')
	assertEqual(anonymousOnly.filePath, '', '<anonymous> 帧无 filePath')
	assertEqual(anonymousOnly.line, 1, '<anonymous> 帧保留行列')
}

/**
 * AsyncFunction 内 console.log 不得因 stack 解析抛错而中断（async-eval / Deno 场景）。
 */
async function testAsyncFunctionConsoleLogDoesNotThrow() {
	console.log('\n=== [AsyncFunction + console.log 栈容错] ===')

	const AsyncFunction = Object.getPrototypeOf(async function () { }).constructor
	const vc = new VirtualConsole({ recordOutput: true, realConsoleOutput: false })

	await vc.hookAsyncContext(async () => {
		const fn = new AsyncFunction('console.log(\'async-fn-stack-marker\')')
		await fn()
	})

	assertEqual(vc.outputEntries.length, 1, 'AsyncFunction 内 console.log 应成功捕获')
	assertEqual(vc.outputEntries[0].args[0], 'async-fn-stack-marker', '捕获内容正确')
	assert(Array.isArray(vc.outputEntries[0].stack), 'log 条目含 stack 数组')
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
	assert(logFp.includes('test/runtime.mjs'), `console.log 首帧应为 runtime 测试文件，实际：${logEntry.stack[0].filePath}`)

	const vc2 = new VirtualConsole({ recordOutput: true, realConsoleOutput: false })

	/**
	 * @returns {void}
	 */
	function callerOfStdoutWrite() {
		process.stdout.write('stdout-stack-top-marker\n')
	}

	await vc2.hookAsyncContext(() => callerOfStdoutWrite())

	const stdoutEntry = vc2.outputEntries.find(e =>
		e.method === 'stdout' && typeof e.text === 'string' && e.text.includes('stdout-stack-top-marker'))

	assert(stdoutEntry, '找到带标记的 stdout 条目')
	assert(Array.isArray(stdoutEntry.stack) && stdoutEntry.stack.length > 0, 'stdout 条目含非空 stack')

	const top = stdoutEntry.stack[0]
	const fp = top.filePath

	assert(
		!fp.startsWith('node:') && !fp.startsWith('deno:') && !fp.startsWith('ext:'),
		`stdout 首帧不应为运行时内部路径，实际 filePath=${fp}`)

	const nfp = String(fp).replace(/\\/g, '/')
	assert(nfp.includes('test/runtime.mjs'), `stdout 首帧应落回 runtime 测试文件，实际 filePath=${fp}`)
	assert(
		top.functionName.includes('callerOfStdoutWrite'),
		`stdout 首帧函数名应为写入调用者，实际 functionName=${top.functionName}`)
}

/**
 *
 */
export async function runRuntimeTests() {
	await runTestGroup('runtime 与上下文隔离', [
		testNodeVirtualConsoleStdoutUsesGetterVirtualStream,
		testContextIsolation,
		testConcurrentAsyncIsolation,
		testGetStackInfo,
		testParseStackTraceLineEvalAtFrames,
		testAsyncFunctionConsoleLogDoesNotThrow,
		testLogEntryStack,
	])
}
