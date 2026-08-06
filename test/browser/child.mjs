/**
 * 浏览器实现冒烟：在 Node 子进程内 shim `window` 后加载 `/browser` 入口。
 * 必须独立进程：browser 入口会替换 `globalThis.console`，不能与 Node 侧测试同进程混跑。
 */
import { emitChildResults, runCase, check } from '../helpers.mjs'

const originalConsole = globalThis.console
globalThis.window = { console: originalConsole }

const {
	VirtualConsole,
	defaultConsole,
	getGlobalConsoleResolver,
} = await import('@steve02081504/virtual-console/browser')

/**
 *
 * @param options
 */
function quietVc(options = {}) {
	return new VirtualConsole({
		recordOutput: true,
		realConsoleOutput: false,
		baseConsole: originalConsole,
		...options,
	})
}

/**
 *
 */
async function runCases() {
	const results = []

	results.push(await runCase('capture_log_warn_error', async () => {
		const vc = quietVc()
		await vc.hookAsyncContext(() => {
			console.log('L')
			console.warn('W')
			console.error('E')
		})
		check(vc.outputEntries.length === 3, `expected 3 entries, got ${vc.outputEntries.length}`)
		check(vc.outputEntries[0].args[0] === 'L' && vc.outputEntries[0].level === 'log', 'log entry')
		check(vc.outputEntries[1].args[0] === 'W' && vc.outputEntries[1].level === 'warn', 'warn entry')
		check(vc.outputEntries[2].args[0] === 'E' && vc.outputEntries[2].level === 'error', 'error entry')
	}))

	results.push(await runCase('nested_context_isolation', async () => {
		const vc1 = quietVc()
		const vc2 = quietVc()
		await vc1.hookAsyncContext(async () => {
			console.log('from vc1')
			await vc2.hookAsyncContext(async () => {
				console.log('from vc2')
			})
			console.log('back to vc1')
		})
		check(vc1.outputEntries.length === 2, `vc1 expected 2, got ${vc1.outputEntries.length}`)
		check(vc2.outputEntries.length === 1, `vc2 expected 1, got ${vc2.outputEntries.length}`)
		check(vc1.outputEntries[0].args[0] === 'from vc1', 'vc1 first')
		check(vc2.outputEntries[0].args[0] === 'from vc2', 'vc2 only')
		check(vc1.outputEntries[1].args[0] === 'back to vc1', 'vc1 second')
	}))

	results.push(await runCase('freshLine_records_each_call', async () => {
		const vc = quietVc()
		vc.freshLine('build', 'step1')
		vc.freshLine('build', 'step2')
		check(vc.outputEntries.length === 2, `expected 2 freshLine entries, got ${vc.outputEntries.length}`)
		check(vc.outputEntries[0].method === 'freshLine' && vc.outputEntries[0].args[0] === 'build', 'first freshLine')
		check(vc.outputEntries[0].args[1] === 'step1', 'step1 arg')
		check(vc.outputEntries[1].args[1] === 'step2', 'step2 arg（浏览器不覆盖，各记一条）')
	}))

	results.push(await runCase('supportsAnsi_defaults_to_chrome', () => {
		const hadChrome = 'chrome' in globalThis
		const prevChrome = globalThis.chrome
		try {
			delete globalThis.chrome
			check(quietVc().options.supportsAnsi === false, '无 chrome 时 supportsAnsi 应为 false')
			globalThis.chrome = {}
			check(quietVc().options.supportsAnsi === true, '有 chrome 时 supportsAnsi 应为 true')
			check(quietVc({ supportsAnsi: false }).options.supportsAnsi === false, '显式 supportsAnsi:false 优先生效')
		} finally {
			if (hadChrome) globalThis.chrome = prevChrome
			else delete globalThis.chrome
		}
	}))

	results.push(await runCase('macro_task_escapes_hookAsyncContext', async () => {
		const vc = quietVc()
		const after = quietVc()
		const { setActiveConsole } = getGlobalConsoleResolver()
		await vc.hookAsyncContext(() => {
			console.log('inside')
			setTimeout(() => { console.log('macro') }, 15)
		})
		check(vc.outputEntries.length === 1, `hook 内仅 1 条，实际 ${vc.outputEntries.length}`)
		check(vc.outputEntries[0].args[0] === 'inside', 'inside 被捕获')
		setActiveConsole(after)
		try {
			await new Promise(r => setTimeout(r, 40))
			check(vc.outputEntries.length === 1, '宏任务 log 不得写入已结束的 hook 上下文')
			check(after.outputEntries.length === 1 && after.outputEntries[0].args[0] === 'macro', '宏任务落入 hook 结束后的活动控制台')
		} finally {
			setActiveConsole(null)
		}
	}))

	results.push(await runCase('no_arg_hookAsyncContext_sets_global', async () => {
		const vc = quietVc()
		const { setActiveConsole } = getGlobalConsoleResolver()
		try {
			vc.hookAsyncContext()
			console.log('global-hook')
			check(vc.outputEntries.length === 1, '无参 hook 后 console.log 写入该实例')
			check(vc.outputEntries[0].args[0] === 'global-hook', '内容正确')
		} finally {
			setActiveConsole(null)
			check(getGlobalConsoleResolver().getActiveConsole() === defaultConsole, '清理后回到 defaultConsole')
		}
	}))

	results.push(await runCase('writeAs_and_clear', async () => {
		const vc = quietVc()
		let clears = 0
		vc.addClearListener(() => { clears++ })
		vc.writeAs('warn', 'via-writeAs')
		check(vc.outputEntries.length === 1 && vc.outputEntries[0].level === 'warn', 'writeAs warn')
		check(vc.outputEntries[0].args[0] === 'via-writeAs', 'writeAs args')
		vc.clear()
		check(vc.outputEntries.length === 0 && clears === 1, 'clear 清空并触发监听')
	}))

	results.push(await runCase('stream_pseudo_methods_emit_native', async () => {
		const calls = []
		const fakeConsole = {
			/**
			 *
			 * @param {...any} args
			 */
			log: (...args) => calls.push(['log', ...args]),
			/**
			 *
			 * @param {...any} args
			 */
			error: (...args) => calls.push(['error', ...args]),
		}
		const vc = new VirtualConsole({ recordOutput: false, realConsoleOutput: true, baseConsole: fakeConsole })
		vc.writeAs('stdout', 'out-text')
		vc.writeAs('stderr', 'err-text')
		check(calls.length === 0, `stdout/stderr 不向原生 console 转发，实际 ${calls.length} 次`)
		vc.writeAs('log', 'still-log')
		vc.writeAs('freshLine', 'line-id', 'step')
		check(calls.length === 2, 'log / freshLine 仍转发')
		check(calls[0][0] === 'log' && calls[0][1] === 'still-log', 'log 走 console.log')
		check(calls[1][0] === 'log' && calls[1][1] === 'step', 'freshLine 走 console.log')
	}))

	results.push(await runCase('maxLogEntries', async () => {
		const vc = quietVc({ maxLogEntries: 2 })
		await vc.hookAsyncContext(() => {
			console.log('1'); console.log('2'); console.log('3')
		})
		check(vc.outputEntries.length === 2, 'maxLogEntries=2')
		check(vc.outputEntries[0].args[0] === '2' && vc.outputEntries[1].args[0] === '3', '保留最新两条')
	}))

	return results
}

emitChildResults(await runCases())
