import { VirtualConsole } from '@steve02081504/virtual-console'

import { assert, assertEqual, runTestGroup } from '../harness.mjs'

/**
 *
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

/**
 *
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

/**
 *
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

/**
 *
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

/**
 *
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

/**
 *
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
	assert(filePath.includes('test/console/block.mjs'), `冻结栈仍指向测试文件，实际：${filePath}`)
}

/**
 * 惰性栈：重复读取复用同一数组；纯渲染不触发 Error.prepareStackTrace。
 */

/**
 *
 */
export async function runBlockTests() {
	await runTestGroup('VirtualConsole block', [
		testBlockDefersOutput, testBlockAllowsExceedingMaxLogEntries, testBlockReentrantAndExtraUnblock, testBlockClearReplay, testBlockDefersStreamOutput, testBlockForcesCaptureOnNonRecordingLayer,
	])
}
