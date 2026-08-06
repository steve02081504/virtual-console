/**
 * Deno 子进程冒烟：async-eval + 工作区 VirtualConsole。
 */
import { VirtualConsole } from '@steve02081504/virtual-console'

import { async_eval } from '../../node_modules/@steve02081504/async-eval/main.mjs'
import { emitChildResults } from '../helpers.mjs'

/**
 * 创建静默 VirtualConsole。
 * @returns {VirtualConsole} 记录输出、不转发原生的实例。
 */
function quietConsole() {
	return new VirtualConsole({ recordOutput: true, realConsoleOutput: false })
}

/**
 * 运行 Deno 子进程冒烟用例。
 * @returns {Promise<import('../helpers.mjs').CaseResult[]>} 各用例执行结果。
 */
async function runCases() {
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

emitChildResults(await runCases())
