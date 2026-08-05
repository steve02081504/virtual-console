/**
 * Deno 子进程冒烟脚本：async-eval + 本地 virtual-console，复现 AsyncFunction 栈解析场景。
 * 由 Node 测试运行器 `test/suites/integration/deno-async-eval.mjs` 启动并解析 stdout JSON。
 *
 * 必须显式注入本地 VirtualConsole：async-eval 默认 `import('@steve02081504/virtual-console')`
 * 会落到其 node_modules 内嵌的旧版包，无法测到工作区源码。
 */
import { VirtualConsole } from '@steve02081504/virtual-console'

import { async_eval } from '../../node_modules/@steve02081504/async-eval/main.mjs'

/** @typedef {{ name: string, ok: boolean, detail?: string }} CaseResult */

/** @returns {VirtualConsole} 仅记录、不转发输出的 VirtualConsole。 */
function quietConsole() {
	return new VirtualConsole({ recordOutput: true, realConsoleOutput: false })
}

/** @returns {Promise<CaseResult[]>} 全部 Deno 子进程冒烟用例的执行结果。 */
async function runCases() {
	/** @type {CaseResult[]} */
	const results = []

	const pure = await async_eval('72', { console: quietConsole() })
	results.push({
		name: 'pure_expression',
		ok: pure.result === 72 && !pure.error,
		detail: pure.error ? String(pure.error?.message ?? pure.error) : undefined,
	})

	const withLog = await async_eval('console.log(1)\n72', { console: quietConsole() })
	const logOk = withLog.result === 72
		&& !withLog.error
		&& withLog.outputEntries.length === 1
		&& withLog.outputEntries[0]?.args?.[0] === 1
	results.push({
		name: 'console_log_then_return',
		ok: logOk,
		detail: withLog.error
			? String(withLog.error?.message ?? withLog.error)
			: `result=${withLog.result}, entries=${withLog.outputEntries.length}`,
	})

	return results
}

const results = await runCases()
console.log(JSON.stringify({ results }))
