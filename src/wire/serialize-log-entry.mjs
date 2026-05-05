/**
 * 线路/DTO 序列化（不含原始 `args`；文本视图由对端对 `segments` 调用 `renderPlain` / `renderAnsi` / `renderHtml` 派生）。
 * @param {import('../core/entries.mjs').LogEntry} entry - 已捕获的单条日志实例。
 * @returns {object} 可 `JSON.stringify` 后经由 WebSocket 发送的扁平条目。
 */
export function serializeLogEntryForWire(entry) {
	const callsite = entry.primaryCallsite
	return {
		id: entry.id,
		level: entry.level,
		method: entry.method,
		timestamp: entry.timestamp,
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
