import { spawnSync } from 'node:child_process'
import { Console } from 'node:console'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Writable } from 'node:stream'

/** @typedef {{ name: string, ok: boolean, detail?: string }} CaseResult */

export const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * 丢弃写入的流，避免终端 I/O 干扰计时。
 * @returns {Console}
 */
export function createNullConsole() {
	const sink = new Writable({ write(_chunk, _encoding, callback) { callback() } })
	return new Console({ stdout: sink, stderr: sink })
}

/**
 * @param {() => void} fn
 * @returns {number} 毫秒
 */
export function measureMs(fn) {
	const start = performance.now()
	fn()
	return performance.now() - start
}

/**
 * @param {string} name
 * @param {() => void | Promise<void>} fn
 * @returns {Promise<CaseResult>}
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
 * @param {boolean} condition
 * @param {string} message
 */
export function check(condition, message) {
	if (!condition) throw new Error(message)
}

/**
 * @param {CaseResult[]} results
 */
export function emitChildResults(results) {
	console.log(JSON.stringify({ results }))
	process.exit(results.every(r => r.ok) ? 0 : 1)
}

/**
 * @param {string} script - 子进程入口脚本绝对路径
 * @param {{ executable?: string, args?: string[], cwd?: string }} [options]
 * @returns {{ status: number | null, results: CaseResult[], stderr: string, stdout: string }}
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
