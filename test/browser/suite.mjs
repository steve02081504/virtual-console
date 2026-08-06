import { join } from 'node:path'

import { VirtualConsole } from '@steve02081504/virtual-console'

import { assert, assertEqual, runTestGroup } from '../harness.mjs'
import { packageRoot, spawnChildJsonResults } from '../helpers.mjs'

function testNodeFreshLineRecordsWithoutThrow() {
	console.log('\n=== [Node：freshLine 记录] ===')
	const vc = new VirtualConsole({ recordOutput: true, realConsoleOutput: false })
	vc.freshLine('build', 'step1')
	vc.freshLine('build', 'step2')
	assertEqual(vc.outputEntries.length, 2, 'freshLine 各调用记一条')
	assertEqual(vc.outputEntries[0].method, 'freshLine', 'method 为 freshLine')
	assertEqual(vc.outputEntries[0].args[0], 'build', '保留 id')
	assertEqual(vc.outputEntries[1].args[1], 'step2', '第二条内容为 step2')
}

function testBrowserImplementationInChildProcess() {
	console.log('\n=== [browser 子进程：/browser 入口] ===')

	const { status, results, stderr, stdout } = spawnChildJsonResults(join(packageRoot, 'test/browser/child.mjs'))
	if (status !== 0 && !stdout.trim())
		return assert(false, `browser 子进程退出码为 0（实际 ${status}）\n${stderr || stdout}`)

	assert(results.length > 0, 'browser 子进程返回了用例结果')

	for (const name of [
		'capture_log_warn_error',
		'nested_context_isolation',
		'freshLine_records_each_call',
		'supportsAnsi_defaults_to_chrome',
		'macro_task_escapes_hookAsyncContext',
		'no_arg_hookAsyncContext_sets_global',
		'writeAs_and_clear',
		'stream_pseudo_methods_emit_native',
		'maxLogEntries',
	]) {
		const item = results.find(r => r.name === name)
		assert(!!item, `存在用例 ${name}`)
		assert(!!item?.ok, `${name} 通过${item?.detail ? `（${item.detail}）` : ''}`)
	}
	assertEqual(status, 0, 'browser 子进程退出码为 0')
}

export async function runBrowserTests() {
	await runTestGroup('浏览器 VirtualConsole', [
		testNodeFreshLineRecordsWithoutThrow,
		testBrowserImplementationInChildProcess,
	])
}
