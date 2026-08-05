import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { VirtualConsole } from '@steve02081504/virtual-console'

import { assert, assertEqual, runTestGroup } from '../../harness.mjs'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..')

/**
 * Node 侧顺带覆盖：freshLine 在 realConsoleOutput:false 时只记录、不抛错。
 * @returns {void}
 */
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

/**
 * 子进程加载 `/browser` 入口，覆盖浏览器实现与 Node 的行为差异。
 * @returns {void}
 */
function testBrowserImplementationInChildProcess() {
	console.log('\n=== [browser 子进程：/browser 入口] ===')

	const script = join(packageRoot, 'test/browser/run.mjs')
	const run = spawnSync(process.execPath, [script], {
		encoding: 'utf8',
		cwd: packageRoot,
	})

	if (run.status !== 0 && !run.stdout.trim()) {
		assert(false, `browser 子进程退出码为 0（实际 ${run.status}）\n${run.stderr || run.stdout}`)
		return
	}

	const lastLine = run.stdout.trim().split('\n').filter(Boolean).at(-1) ?? ''
	/** @type {{ results?: Array<{ name: string, ok: boolean, detail?: string }> }} */
	let payload
	try {
		payload = JSON.parse(lastLine)
	} catch {
		assert(false, `browser 子进程 stdout 末行应为 JSON，实际：${lastLine}\nstderr: ${run.stderr}`)
		return
	}

	const results = payload.results ?? []
	assert(results.length > 0, 'browser 子进程返回了用例结果')

	const expected = [
		'capture_log_warn_error',
		'nested_context_isolation',
		'freshLine_records_each_call',
		'supportsAnsi_defaults_to_chrome',
		'macro_task_escapes_hookAsyncContext',
		'no_arg_hookAsyncContext_sets_global',
		'writeAs_and_clear',
		'maxLogEntries',
	]
	for (const name of expected) {
		const item = results.find(r => r.name === name)
		assert(!!item, `存在用例 ${name}`)
		assert(!!item?.ok, `${name} 通过${item?.detail ? `（${item.detail}）` : ''}`)
	}
	assertEqual(run.status, 0, 'browser 子进程退出码为 0')
}

/**
 * @returns {Promise<void>}
 */
export async function runBrowserConsoleTests() {
	await runTestGroup('浏览器 VirtualConsole', [
		testNodeFreshLineRecordsWithoutThrow,
		testBrowserImplementationInChildProcess,
	])
}
