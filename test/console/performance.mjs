import { Console } from 'node:console'
import { Writable } from 'node:stream'

import { VirtualConsole } from '@steve02081504/virtual-console'

import { assert, assertEqual, runTestGroup } from '../harness.mjs'
import { createNullConsole, measureMs } from '../helpers.mjs'

const PERF_ENTRY_COUNT = 3000
const PERF_WARMUP_COUNT = 200

/**
 *
 * @param root0
 * @param root0.label
 * @param root0.recordOutput
 * @param root0.logMultiplier
 * @param root0.writeAsMultiplier
 */
async function assertLogAndWriteAsPerformanceCeiling({ label, recordOutput, logMultiplier, writeAsMultiplier }) {
	console.log(`\n=== [${label}：log / writeAs 性能上限（各 ${PERF_ENTRY_COUNT} 条，recordOutput=${recordOutput}）] ===`)

	const nativeConsole = createNullConsole()

	for (let i = 0; i < PERF_WARMUP_COUNT; i++) nativeConsole.log('warmup', i)
	const nativeLogMs = measureMs(() => {
		for (let i = 0; i < PERF_ENTRY_COUNT; i++) nativeConsole.log('perf', i)
	})
	console.log(`  原生 log: ${nativeLogMs.toFixed(2)} ms`)

	const vcLog = new VirtualConsole({ recordOutput, realConsoleOutput: false })
	let virtualLogMs = 0
	await vcLog.hookAsyncContext(() => {
		for (let i = 0; i < PERF_WARMUP_COUNT; i++) console.log('warmup', i)
		virtualLogMs = measureMs(() => {
			for (let i = 0; i < PERF_ENTRY_COUNT; i++) console.log('perf', i)
		})
	})
	const logCeilingMs = nativeLogMs * logMultiplier
	console.log(`  虚拟 log: ${virtualLogMs.toFixed(2)} ms (上限 ${logCeilingMs.toFixed(2)} ms，${logMultiplier}× 原生)`)
	assert(
		virtualLogMs <= logCeilingMs,
		`虚拟 log (${virtualLogMs.toFixed(2)} ms) 不得超过原生 log 的 ${logMultiplier} 倍 (${logCeilingMs.toFixed(2)} ms)`,
	)
	if (recordOutput)
		assertEqual(vcLog.outputEntries.length, PERF_ENTRY_COUNT + PERF_WARMUP_COUNT, '捕获模式下 log 记录了全部条目')

	const vcWriteAs = new VirtualConsole({ recordOutput, realConsoleOutput: false })
	for (let i = 0; i < PERF_WARMUP_COUNT; i++) vcWriteAs.writeAs('log', 'warmup', i)
	const writeAsLogMs = measureMs(() => {
		for (let i = 0; i < PERF_ENTRY_COUNT; i++) vcWriteAs.writeAs('log', 'perf', i)
	})
	const writeAsCeilingMs = nativeLogMs * writeAsMultiplier
	console.log(`  writeAs('log'): ${writeAsLogMs.toFixed(2)} ms (上限 ${writeAsCeilingMs.toFixed(2)} ms，${writeAsMultiplier}× 原生 log)`)
	assert(
		writeAsLogMs <= writeAsCeilingMs,
		`writeAs('log') (${writeAsLogMs.toFixed(2)} ms) 不得超过原生 log 的 ${writeAsMultiplier} 倍 (${writeAsCeilingMs.toFixed(2)} ms)`,
	)
	if (recordOutput)
		assertEqual(vcWriteAs.outputEntries.length, PERF_ENTRY_COUNT + PERF_WARMUP_COUNT, '捕获模式下 writeAs 记录了全部条目')
	else
		assertEqual(vcWriteAs.outputEntries.length, 0, '非捕获模式下 writeAs 不写入 outputEntries')
}

/** 非捕获：虚拟 log / writeAs 均 ≤ 1× 原生（惰性路径接近零分配）。 */

/**
 *
 */
async function testLogAndWriteAsPerformanceCeiling() {
	await assertLogAndWriteAsPerformanceCeiling({
		label: '非捕获虚拟控制台',
		recordOutput: false,
		logMultiplier: 1,
		writeAsMultiplier: 1,
	})
}

/** 捕获：虚拟 log ≤ 6× 原生，writeAs ≤ 8× 原生。 */

/**
 *
 */
async function testCapturedLogAndWriteAsPerformanceCeiling() {
	await assertLogAndWriteAsPerformanceCeiling({
		label: '捕获虚拟控制台',
		recordOutput: true,
		logMultiplier: 6,
		writeAsMultiplier: 8,
	})
}

/**
 * 非捕获 process.stdout.write 性能上限。
 */

/**
 *
 */
async function testNonCapturingStdoutWritePerformanceCeiling() {
	console.log(`\n=== [非捕获 stdout.write 性能上限（各 ${PERF_ENTRY_COUNT} 次）] ===`)
	const sink = new Writable({ /**
	 * 忽略写入内容并立即完成。
	 * @param {Buffer | string} _chunk - 被丢弃的数据块。
	 * @param {string} _encoding - 编码名。
	 * @param {(error?: Error | null) => void} callback - 写入完成回调。
	 * @returns {void}
	 */
		write(_chunk, _encoding, callback) { callback() } })
	const nativeConsole = new Console({ stdout: sink, stderr: sink })
	for (let i = 0; i < PERF_WARMUP_COUNT; i++) sink.write('w')
	const nativeMs = measureMs(() => {
		for (let i = 0; i < PERF_ENTRY_COUNT; i++) sink.write('p')
	})
	const virtualConsole = new VirtualConsole({
		recordOutput: false,
		realConsoleOutput: false,
		baseConsole: nativeConsole,
	})
	let virtualMs = 0
	await virtualConsole.hookAsyncContext(() => {
		for (let i = 0; i < PERF_WARMUP_COUNT; i++) process.stdout.write('w')
		virtualMs = measureMs(() => {
			for (let i = 0; i < PERF_ENTRY_COUNT; i++) process.stdout.write('p')
		})
	})
	const ceilingMs = nativeMs * 3
	console.log(`  原生 write: ${nativeMs.toFixed(2)} ms`)
	console.log(`  虚拟 write: ${virtualMs.toFixed(2)} ms (上限 ${ceilingMs.toFixed(2)} ms，3× 原生)`)
	assert(virtualMs <= ceilingMs, `非捕获 stdout.write (${virtualMs.toFixed(2)} ms) 不得超过原生的 3 倍`)
}

/**
 *
 */
export async function runPerformanceTests() {
	await runTestGroup('VirtualConsole 性能上限', [
		testLogAndWriteAsPerformanceCeiling, testCapturedLogAndWriteAsPerformanceCeiling, testNonCapturingStdoutWritePerformanceCeiling,
	])
}
