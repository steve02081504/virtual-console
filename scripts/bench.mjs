/**
 * VirtualConsole 微基准：dispatch / 渲染 / 快照格式化深度扫描。
 * 用法：`npm run bench`
 *
 * 深度扫描若呈指数级增长，说明 snapshot-display 又退化成了对子节点双重渲染。
 */

import { Writable } from 'node:stream'

import {
	VirtualConsole,
	newLogEntry,
	serializeArgSnapshot,
} from '@steve02081504/virtual-console'

import { formatSnapshot } from '../src/format/snapshot-display.mjs'

/**
 * @param {string} label - 场景名。
 * @param {(i: number) => void} fn - 待测函数。
 * @param {number} [n=20000] - 迭代次数。
 * @param {number} [warmup=2000] - 预热次数。
 * @returns {number} 每次迭代耗时（µs）。
 */
function bench(label, fn, n = 20000, warmup = 2000) {
	for (let i = 0; i < warmup; i++) fn(i)
	const start = performance.now()
	for (let i = 0; i < n; i++) fn(i)
	const us = (performance.now() - start) / n * 1000
	console.log(`  ${label.padEnd(42)} ${us.toFixed(3)} µs/op`)
	return us
}

/**
 * @returns {Console} 丢弃写入的原生 Console。
 */
function createNullConsole() {
	const sink = new Writable({
		/**
		 *
		 * @param _chunk
		 * @param _encoding
		 * @param callback
		 */
		write(_chunk, _encoding, callback) { callback() },
	})
	return new console.Console(sink, sink)
}

console.log('\n=== dispatch ===')
{
	const native = createNullConsole()
	bench('native log', i => native.log('perf', i))

	const noRecord = new VirtualConsole({ recordOutput: false, realConsoleOutput: false })
	bench('vc writeAs [no record]', i => noRecord.writeAs('log', 'perf', i))
	bench('vc log [no record]', i => noRecord.log('perf', i))

	const capture = new VirtualConsole({ recordOutput: true, realConsoleOutput: false })
	bench('vc writeAs [record]', i => {
		capture.writeAs('log', 'perf', i)
		if (capture.outputEntries.length > 100) capture.outputEntries.length = 0
	})
	bench('vc log [record]', i => {
		capture.log('perf', i)
		if (capture.outputEntries.length > 100) capture.outputEntries.length = 0
	})
}

console.log('\n=== stream write ===')
{
	const sink = new Writable({
		/**
		 *
		 * @param _chunk
		 * @param _encoding
		 * @param callback
		 */
		write(_chunk, _encoding, callback) { callback() },
	})
	/**
	 *
	 * @param chunk
	 * @param encoding
	 * @param cb
	 */
	const nativeWrite = (chunk, encoding, cb) => sink.write(chunk, encoding, cb)
	bench('native write', i => {
		nativeWrite(String(i), 'utf8', () => {})
	}, 10000)

	const vc = new VirtualConsole({ recordOutput: false, realConsoleOutput: false, baseConsole: createNullConsole() })
	// 非捕获 + 无 realConsoleOutput：ingestChunk 直接 callback
	bench('vc stdout.write [no record/no out]', i => {
		vc._stdout.write(String(i), 'utf8', () => {})
	}, 10000)
}

console.log('\n=== entry render ===')
{
	const nested = { a: 1, b: 'two', c: [1, 2, 3], d: { e: { f: { g: { h: 'deep', i: [4, 5] } } } }, j: new Map([['k', 1]]) }
	const plainEntry = newLogEntry({ method: 'log', args: ['hello world'], supportsAnsi: false })
	const twoArgs = newLogEntry({ method: 'log', args: ['perf', 42], supportsAnsi: false })
	const objEntry = newLogEntry({ method: 'log', args: ['obj:', nested], supportsAnsi: false })
	let sink
	bench('plain string toString', () => { sink = plainEntry.toString() }, 5000)
	bench('2-arg toString', () => { sink = twoArgs.toString() }, 5000)
	bench('nested obj toSegments', () => { sink = objEntry.toSegments() }, 3000)
	bench('nested obj toString', () => { sink = objEntry.toString() }, 2000)
	bench('nested obj toPlainText', () => { sink = objEntry.toPlainText() }, 2000)
	bench('nested obj toHtml', () => { sink = objEntry.toHtml() }, 2000)
	void sink
}

console.log('\n=== snapshot format depth scan (must stay ~linear) ===')
{
	const times = []
	for (let depth = 1; depth <= 8; depth++) {
		let o = { leaf: 1, s: 'x' }
		for (let i = 0; i < depth; i++) o = { k: o, n: i, t: 'txt' }
		const snap = serializeArgSnapshot(o, { maxDepth: 20 })
		const us = bench(`depth ${depth}`, () => formatSnapshot(snap, { depth: Infinity, colorize: false }), 400, 40)
		times.push(us)
	}
	const ratio = times[7] / times[0]
	console.log(`  depth8/depth1 ratio: ${ratio.toFixed(2)}× (exponential would be ~128×+)`)
	if (ratio > 40)
		console.warn('  ⚠ ratio suspiciously high — check for double-render regression')
}

console.log('')
