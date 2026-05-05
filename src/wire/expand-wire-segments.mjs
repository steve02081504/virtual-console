/**
 * Wire 下行 `LogSegment[]` 中对 `ArgSnapshot` 树里的 `truncated` 节点收集 ref / 就地替换。
 */

/**
 * @param {unknown} snap - `ArgSnapshot` 子树。
 * @param {Set<string>} refs - 收集到的非空 ref。
 * @returns {void} 仅副作用写入 `refs`。
 */
function collectTruncatedRefsInSnapshot(snap, refs) {
	if (snap === null || typeof snap !== 'object') return
	if (snap.kind === 'truncated' && snap.ref)
		refs.add(snap.ref)
	for (const value of Object.values(snap))
		collectTruncatedRefsInSnapshot(value, refs)
}

/**
 * @param {import('../shared.d.mts').LogSegment[]} segments - 片段数组。
 * @returns {Generator<{ get: () => unknown, set: (v: unknown) => void }>} 各快照挂载点的读写句柄。
 */
function* iterSegmentSnapshotSlots(segments) {
	for (const seg of segments)
		if (seg.kind === 'value') {
			yield {
				/**
				 * @returns {unknown} 当前 `value` 段快照根。
				 */
				get: () => seg.snapshot,
				/**
				 * @param {unknown} v - 替换后的快照根。
				 * @returns {void}
				 */
				set: (v) => { seg.snapshot = v },
			}
			if (seg.dirOptions) yield {
				/**
				 * @returns {unknown} 当前 `dirOptions` 快照。
				 */
				get: () => seg.dirOptions,
				/**
				 * @param {unknown} v - 新的 `dirOptions` 快照。
				 * @returns {void}
				 */
				set: (v) => { seg.dirOptions = v },
			}
		}
		else if (seg.kind === 'trace') yield {
			/**
			 * @returns {unknown} 当前 `trace` 段快照。
			 */
			get: () => seg.snapshot,
			/**
			 * @param {unknown} v - 替换后的 trace 快照。
			 * @returns {void}
			 */
			set: (v) => { seg.snapshot = v },
		}
}

/**
 * @param {import('../shared.d.mts').LogSegment[]} segments - 片段数组。
 * @returns {Set<string>} 需要云端展开的非空 ref 集合。
 */
export function collectTruncatedRefsFromSegments(segments) {
	const refs = new Set()
	for (const slot of iterSegmentSnapshotSlots(segments))
		collectTruncatedRefsInSnapshot(slot.get(), refs)

	return refs
}

/**
 * 将快照树中指定 ref 的 `truncated` 节点替换为展开后的快照（就地改写克隆）。
 * @param {unknown} snap - 任意快照子树。
 * @param {string} ref - 目标 ref。
 * @param {unknown} replacement - 服务端返回的展开快照。
 * @returns {unknown} 可能替换后的根。
 */
function replaceTruncatedInSnapshot(snap, ref, replacement) {
	if (snap === null || typeof snap !== 'object') return snap
	if (snap.kind === 'truncated' && snap.ref === ref)
		return replacement

	if (Array.isArray(snap)) {
		for (let i = 0; i < snap.length; i++)
			snap[i] = replaceTruncatedInSnapshot(snap[i], ref, replacement)

		return snap
	}

	for (const key of Object.keys(snap))
		snap[key] = replaceTruncatedInSnapshot(snap[key], ref, replacement)

	return snap
}

/**
 * 深度克隆 `LogSegment[]`（JSON 安全载荷）。
 * @param {import('../shared.d.mts').LogSegment[]} segments - 原始片段。
 * @returns {import('../shared.d.mts').LogSegment[]} 可变的克隆副本。
 */
export function cloneSegments(segments) {
	return JSON.parse(JSON.stringify(segments ?? []))
}

/**
 * 克隆片段后，按 ref→快照映射替换所有可展开截断节点。
 * @param {import('../shared.d.mts').LogSegment[]} segments - 克隆后的片段。
 * @param {Map<string, unknown>} refToSnapshot - ref 到展开快照。
 * @returns {import('../shared.d.mts').LogSegment[]} 同一数组引用（便于调用方直接持有）。
 */
export function applyExpandedSnapshotsInSegments(segments, refToSnapshot) {
	for (const [ref, snapshot] of refToSnapshot)
		for (const slot of iterSegmentSnapshotSlots(segments))
			slot.set(replaceTruncatedInSnapshot(slot.get(), ref, snapshot))

	return segments
}
