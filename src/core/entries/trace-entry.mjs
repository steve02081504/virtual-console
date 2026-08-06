import { buildArgsSegments, ENTRY_TRAILING_NEWLINE } from '../../format/segments.mjs'
import { getExpansionScope } from '../snapshot/expansion.mjs'
import { DEFAULT_SNAPSHOT_DEPTH } from '../snapshot/serialize.mjs'

import { LogEntry } from './log-entry.mjs'

/** `console.trace` 条目：普通参数片段 + trace 快照片段。 */
export class TraceLogEntry extends LogEntry {
	/**
	 * @returns {import('../../shared.d.mts').LogSegment[]} 参数片段、trace 片段与末尾换行。
	 */
	toSegments() {
		return [
			...buildArgsSegments(this.displayArgs, getExpansionScope(this), DEFAULT_SNAPSHOT_DEPTH),
			{ kind: 'trace', stack: this.stack },
			ENTRY_TRAILING_NEWLINE,
		]
	}
}
