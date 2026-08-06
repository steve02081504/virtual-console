import process from 'node:process'

import ansiEscapes from 'ansi-escapes'

import { dict } from '../../util/dict.mjs'

/**
 * Node 侧原生控制台 / 流输出。
 */
export const streamTable = dict({
	stdout: process.stdout,
	stderr: process.stderr,
})
const defaultStream = streamTable.stdout

/**
 * 将日志条目写入原生 stdout/stderr 或 baseConsole 方法。
 * @param {import('../../core/entries/log-entry.mjs').LogEntry} entry - 日志条目。
 * @param {{ baseConsole: object, supportsAnsi: boolean, lastFreshLineId: string | null }} options - 输出环境。
 * @returns {void}
 */
export function emitNative(entry, { baseConsole, supportsAnsi, lastFreshLineId }) {
	if (streamTable[entry.method])
		return streamTable[entry.method].write(entry.text)
	if (entry.method === 'freshLine') {
		if (supportsAnsi && entry.id === lastFreshLineId)
			defaultStream.write(ansiEscapes.cursorUp(1) + ansiEscapes.eraseLine)
		return baseConsole.log(...entry.displayArgs)
	}
	const nativeMethod = baseConsole[entry.method]
	if (nativeMethod instanceof Function)
		return void nativeMethod.apply(baseConsole, entry.displayArgs)
	const content = entry.toString()
	defaultStream.write(content)
}

/**
 * 将原始 chunk 写入原生流（保留二进制与背压回调）。
 * @param {'stdout' | 'stderr'} streamName - 流名。
 * @param {any} chunk - 数据块。
 * @param {string} encoding - 编码。
 * @param {(error?: Error | null) => void} callback - 完成回调。
 * @returns {void}
 */
export function writeNativeChunk(streamName, chunk, encoding, callback) {
	return streamTable[streamName].write(chunk, encoding, callback)
}
