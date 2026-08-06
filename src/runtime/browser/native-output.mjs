/**
 * 浏览器侧原生控制台输出。
 */

import { dict } from '../../util/dict.mjs'

const baseMethodTable = dict({
	stdout: null,
	stderr: null,
	freshLine: 'log',
})

/**
 * 将日志条目转发到浏览器 console。
 * @param {import('../../core/entries/log-entry.mjs').LogEntry} entry - 日志条目。
 * @param {{ baseConsole: object }} options - 输出环境。
 * @returns {void}
 */
export function emitNative(entry, { baseConsole }) {
	baseConsole[baseMethodTable[entry.method] ?? entry.method]?.(...entry.displayArgs)
}
