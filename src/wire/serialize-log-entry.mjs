/**
 * 线路/DTO 序列化（不含原始 `args`，仅 `segments` / `plainText` 等）。
 * @param {import('../core/entries.mjs').LogEntry} entry - 已捕获的单条日志实例。
 * @param {number} index - 列表序号（作为下行 JSON 中的稳定 `id`）。
 * @returns {object} 可 `JSON.stringify` 后经由 WebSocket 发送的扁平条目。
 */
export function serializeLogEntryForWire(entry, index) {
	const callsite = entry.primaryCallsite
	return {
		id: index,
		level: entry.level,
		method: entry.method,
		timestamp: entry.timestamp,
		plainText: entry.plainText,
		segments: entry.toSegments(),
		callsite: callsite ? {
			functionName: callsite.functionName,
			filePath: callsite.filePath,
			line: callsite.line,
			column: callsite.column,
			raw: callsite.raw,
		} : null,
	}
}
