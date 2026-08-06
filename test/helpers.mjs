import { spawnSync } from 'node:child_process'
import { Console } from 'node:console'
import { dirname, join } from 'node:path'
import { Writable } from 'node:stream'
import { fileURLToPath } from 'node:url'

/**
 * 单条测试用例运行结果。
 * @typedef {{ name: string, ok: boolean, detail?: string }} CaseResult
 */

/**
 * 包根目录绝对路径。
 * @returns {string}
 */
export const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * 丢弃写入的流，避免终端 I/O 干扰计时。
 * @returns {Console} 写入 null sink 的 Console。
 */
export function createNullConsole() {
	const sink = new Writable({
		/**
		 * 忽略写入并立即回调完成。
		 * @param {Buffer | string} _chunk - 被丢弃的数据块。
		 * @param {string} _encoding - 编码名。
		 * @param {(error?: Error | null) => void} callback - 写入完成回调。
		 * @returns {void}
		 */
		write(_chunk, _encoding, callback) { callback() },
	})
	return new Console({ stdout: sink, stderr: sink })
}

/**
 * 测量同步函数耗时。
 * @param {() => void} fn - 待计时的函数。
 * @returns {number} 毫秒数。
 */
export function measureMs(fn) {
	const start = performance.now()
	fn()
	return performance.now() - start
}

/**
 * 执行单条子进程用例，捕获异常为失败结果。
 * @param {string} name - 用例名。
 * @param {() => void | Promise<void>} fn - 用例主体。
 * @returns {Promise<CaseResult>} 成功或失败摘要。
 */
export async function runCase(name, fn) {
	try {
		await fn()
		return { name, ok: true }
	} catch (err) {
		return { name, ok: false, detail: err instanceof Error ? err.message : String(err) }
	}
}

/**
 * 条件为假时抛出 Error。
 * @param {boolean} condition - 断言条件。
 * @param {string} message - 失败说明。
 * @returns {void}
 */
export function check(condition, message) {
	if (!condition) throw new Error(message)
}

/**
 * 将用例结果 JSON 打到 stdout 并设置 exitCode。
 * @param {CaseResult[]} results - 子进程用例结果列表。
 * @returns {void}
 */
export function emitChildResults(results) {
	console.log(JSON.stringify({ results }))
	process.exitCode = results.every(r => r.ok) ? 0 : 1
}

/**
 * 启动子进程脚本并解析末行 JSON 结果。
 * @param {string} script - 子进程入口脚本绝对路径。
 * @param {{ executable?: string, args?: string[], cwd?: string }} [options] - spawn 选项。
 * @returns {{ status: number | null, results: CaseResult[], stderr: string, stdout: string }} 退出码、解析结果与标准输出/错误。
 */
export function spawnChildJsonResults(script, { executable = process.execPath, args = [], cwd = packageRoot } = {}) {
	const run = spawnSync(executable, [...args, script], { encoding: 'utf8', cwd })
	const lastLine = run.stdout.trim().split('\n').filter(Boolean).at(-1) ?? ''
	let results = []
	try {
		results = JSON.parse(lastLine).results ?? []
	} catch { /* 由调用方断言 */ }
	return { status: run.status, results, stderr: run.stderr, stdout: run.stdout }
}
