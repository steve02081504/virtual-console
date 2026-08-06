import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

import { VirtualConsole } from '@steve02081504/virtual-console'

import { assert, assertEqual, runTestGroup } from '../harness.mjs'
import { packageRoot, spawnChildJsonResults } from '../helpers.mjs'

/**
 * 检测 deno 是否在 PATH 中可用。
 * @returns {string | null} 可用时为 `'deno'`，否则 `null`。
 */
function resolveDenoExecutable() {
	return spawnSync('deno', ['--version'], { encoding: 'utf8' }).status === 0 ? 'deno' : null
}

/**
 * Node 侧 async-eval + VirtualConsole 集成。
 * @returns {Promise<void>}
 */
async function testAsyncEvalConsoleLogOnNode() {
	console.log('\n=== [async-eval + VirtualConsole（Node）] ===')

	const { async_eval } = await import('@steve02081504/async-eval')
	/**
	 * 构造仅录制、不转发到原生的 VirtualConsole 工厂。
	 * @returns {VirtualConsole} 静默 VirtualConsole。
	 */
	const quietConsole = () => new VirtualConsole({ recordOutput: true, realConsoleOutput: false })

	const pure = await async_eval('72', { console: quietConsole() })
	assertEqual(pure.result, 72, '纯表达式求值成功')
	assertEqual(pure.error, undefined, '纯表达式无 error')

	const withLog = await async_eval('console.log(1)\n72', { console: quietConsole() })
	assertEqual(withLog.result, 72, 'console.log 后隐式 return 仍为 72')
	assertEqual(withLog.error, undefined, '带 console.log 的 eval 不得抛错')
	assertEqual(withLog.outputEntries.length, 1, '捕获一条 console.log')
	assertEqual(withLog.outputEntries[0]?.args?.[0], 1, 'console.log 参数正确')
	assert(Array.isArray(withLog.outputEntries[0]?.stack), 'log 条目含 stack 数组')
}

/**
 * Deno 子进程 async-eval + VirtualConsole 集成。
 * @returns {Promise<void>}
 */
async function testAsyncEvalConsoleLogOnDeno() {
	console.log('\n=== [async-eval + VirtualConsole（Deno 子进程）] ===')

	const deno = resolveDenoExecutable()
	if (!deno) {
		console.log('  ⊘ 跳过：未检测到 deno 可执行文件')
		return
	}

	const script = join(packageRoot, 'test/deno/child.mjs')
	const importMap = join(packageRoot, 'test/deno/import-map.json')
	const { status, results } = spawnChildJsonResults(script, {
		executable: deno,
		args: ['run', '--allow-read', '--allow-env', '--allow-sys', `--import-map=${importMap}`],
	})

	if (status !== 0)
		return assert(false, `Deno 子进程退出码为 0（实际 ${status}）`)

	const byName = Object.fromEntries(results.map(r => [r.name, r]))
	for (const name of ['pure_expression', 'console_log_then_return']) {
		const item = byName[name]
		assert(!!item?.ok, `${name} 在 Deno 下通过${item?.detail ? `（${item.detail}）` : ''}`)
	}
}

/**
 * 运行 Deno 子进程测试套件。
 * @returns {Promise<void>}
 */
export async function runDenoTests() {
	await runTestGroup('async-eval × Deno 栈容错', [
		testAsyncEvalConsoleLogOnNode,
		testAsyncEvalConsoleLogOnDeno,
	])
}
