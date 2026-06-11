import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { VirtualConsole } from '@steve02081504/virtual-console'

import { assert, assertEqual, runTestGroup } from '../../harness.mjs'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..')

/**
 * @returns {string | null} `deno` 可执行路径；不可用时为 null。
 */
function resolveDenoExecutable() {
	const probe = spawnSync('deno', ['--version'], { encoding: 'utf8' })
	return probe.status === 0 ? 'deno' : null
}

/**
 * Node 侧：async-eval + 本地 VirtualConsole，覆盖 fount 常见 eval 路径。
 * @returns {Promise<void>}
 */
async function testAsyncEvalConsoleLogOnNode() {
	console.log('\n=== [async-eval + VirtualConsole（Node）] ===')

	const { async_eval } = await import('@steve02081504/async-eval')

	/** @returns {VirtualConsole} */
	const quietConsole = () => new VirtualConsole({ recordOutput: true, realConsoleOutput: false })

	const pure = await async_eval('42', { console: quietConsole() })
	assertEqual(pure.result, 42, '纯表达式求值成功')
	assertEqual(pure.error, undefined, '纯表达式无 error')

	const withLog = await async_eval('console.log(1)\n42', { console: quietConsole() })
	assertEqual(withLog.result, 42, 'console.log 后隐式 return 仍为 42')
	assertEqual(withLog.error, undefined, '带 console.log 的 eval 不得抛错')
	assertEqual(withLog.outputEntries.length, 1, '捕获一条 console.log')
	assertEqual(withLog.outputEntries[0]?.args?.[0], 1, 'console.log 参数正确')
	assert(Array.isArray(withLog.outputEntries[0]?.stack), 'log 条目含 stack 数组')
}

/**
 * Deno 子进程：async-eval + 本地 VirtualConsole，复现 AsyncFunction 栈格式（Windows/Deno 高发）。
 * @returns {Promise<void>}
 */
async function testAsyncEvalConsoleLogOnDeno() {
	console.log('\n=== [async-eval + VirtualConsole（Deno 子进程）] ===')

	const deno = resolveDenoExecutable()
	if (!deno) {
		console.log('  ⊘ 跳过：未检测到 deno 可执行文件')
		return
	}

	const script = join(packageRoot, 'test/deno/async-eval-stack.mjs')
	const importMap = join(packageRoot, 'test/deno/import-map.json')
	const run = spawnSync(deno, [
		'run',
		'--allow-read',
		'--allow-env',
		'--allow-sys',
		`--import-map=${importMap}`,
		script,
	], {
		encoding: 'utf8',
		cwd: packageRoot,
	})

	if (run.status !== 0) {
		assert(false, `Deno 子进程退出码为 0（实际 ${run.status}）\n${run.stderr || run.stdout}`)
		return
	}

	const lastLine = run.stdout.trim().split('\n').filter(Boolean).at(-1) ?? ''
	/** @type {{ results?: Array<{ name: string, ok: boolean, detail?: string }> }} */
	let payload
	try {
		payload = JSON.parse(lastLine)
	} catch {
		assert(false, `Deno 子进程 stdout 末行应为 JSON，实际：${lastLine}`)
		return
	}

	const byName = Object.fromEntries((payload.results ?? []).map(r => [r.name, r]))
	for (const name of ['pure_expression', 'console_log_then_return']) {
		const item = byName[name]
		assert(!!item?.ok, `${name} 在 Deno 下通过${item?.detail ? `（${item.detail}）` : ''}`)
	}
}

/**
 * @returns {Promise<void>}
 */
export async function runDenoAsyncEvalTests() {
	await runTestGroup('async-eval × Deno 栈容错', [
		testAsyncEvalConsoleLogOnNode,
		testAsyncEvalConsoleLogOnDeno,
	])
}
