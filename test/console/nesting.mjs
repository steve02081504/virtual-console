import { Buffer } from 'node:buffer'

import { VirtualConsole } from '@steve02081504/virtual-console'

import { assert, assertEqual, assertIncludes, runTestGroup } from '../harness.mjs'

/**
 * 嵌套 VC：console 与流写入均到达父级。
 * @returns {Promise<void>}
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
 * @returns {Promise<void>}
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
 * @returns {Promise<void>}
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
	assert(filePath.includes('test/console/nesting.mjs'), `首帧应在 nesting 测试文件，实际：${filePath}`)
	assert(!filePath.includes('src/runtime/'), `首帧不得落在 runtime 实现内，实际：${filePath}`)
}

/**
 * README 承诺：包装函数通过 stackFrameSkipCount 跳过自身帧。
 * @returns {Promise<void>}
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
	assert(filePath.includes('test/console/nesting.mjs'), `首帧应在测试文件，实际：${filePath}`)
}

/**
 * 纯透传层不建 LogEntry：spy 收到原始 args；Buffer 原样到达原生 stdout。
 * @returns {Promise<void>}
 */
async function testPassthroughSkipsCapture() {
	console.log('\n=== [纯透传：零捕获，原始 args / Buffer] ===')
	const { streamTable: { stdout } } = await import('../../src/runtime/node/native-output.mjs')
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
		 * 空实现，满足 Console 形状。
		 * @returns {void}
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
 * @returns {Promise<void>}
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
 * 透传方法：table 在两种 realConsoleOutput 下均记录。
 * @returns {Promise<void>}
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
 * @returns {Promise<void>}
 */
export async function runNestingTests() {
	await runTestGroup('VirtualConsole 嵌套与透传', [
		testNestedVcConsoleAndStreamReachParent, testNestedVcSharesSameEntry, testNestedLazyCaptureStackPointsToCaller, testStackFrameSkipCountSkipsWrapper, testPassthroughSkipsCapture, testLazyStackParseOnRead, testPassthroughMethodsRecordedViaStreams,
	])
}
