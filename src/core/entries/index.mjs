import { dict } from '../../util/dict.mjs'

import { DirLogEntry } from './dir-entry.mjs'
import { FreshLineLogEntry } from './fresh-line-entry.mjs'
import { LogEntry } from './log-entry.mjs'
import { StreamLogEntry } from './stream-entry.mjs'
import { TraceLogEntry } from './trace-entry.mjs'

/**
 *
 */
export { LogEntry } from './log-entry.mjs'
/**
 *
 */
export { FreshLineLogEntry } from './fresh-line-entry.mjs'
/**
 *
 */
export { DirLogEntry } from './dir-entry.mjs'
/**
 *
 */
export { TraceLogEntry } from './trace-entry.mjs'
/**
 *
 */
export { StreamLogEntry } from './stream-entry.mjs'

const methodToConstructorMap = dict({
	stdout: StreamLogEntry,
	stderr: StreamLogEntry,
	dir: DirLogEntry,
	trace: TraceLogEntry,
	freshLine: FreshLineLogEntry,
})

/**
 * @param {object} options - 见 {@link LogEntry} 构造函数。
 * @returns {LogEntry} 新分配的日志条目实例。
 */
export function newLogEntry(options) {
	return new (methodToConstructorMap[options.method] ?? LogEntry)(options)
}
