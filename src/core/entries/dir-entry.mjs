import { ENTRY_TRAILING_NEWLINE } from '../../format/segments.mjs'
import { normalizeDirOptionsPayload } from '../snapshot/dir-options.mjs'
import { getExpansionScope } from '../snapshot/expansion.mjs'
import { serializeArgSnapshot } from '../snapshot/serialize.mjs'

import { LogEntry } from './log-entry.mjs'

/** `console.dir` 条目：携带单个 value 段及可选 dirOptions。 */
export class DirLogEntry extends LogEntry {
	/**
	 * @returns {import('../../shared.d.mts').LogSegment[]} value + 末尾换行片段。
	 */
	toSegments() {
		const [subject, rawDirOptions] = this.args
		const dirOptions = normalizeDirOptionsPayload(rawDirOptions)
		return [{
			kind: 'value',
			snapshot: serializeArgSnapshot(subject, {
				maxDepth: dirOptions.depth,
				expansionScope: getExpansionScope(this),
			}),
			dirOptions,
		}, ENTRY_TRAILING_NEWLINE]
	}
}
