/**
 * Wire 下行 `LogSegment[]` 中对 `ArgSnapshot` 树里的 `truncated` 节点收集 ref / 就地替换。
 */

/**
 * @param {unknown} snap - `ArgSnapshot` 子树。
 * @param {Map<string, number>} refsToMinDepth - ref 到最浅深度映射（相对当前快照根）。
 * @param {number} depth - 当前节点深度。
 * @returns {void} 仅副作用写入 `refs`。
 */
function collectTruncatedRefsInSnapshot(snap, refsToMinDepth, depth) {
	if (snap === null || typeof snap !== 'object') return
	if (snap.kind === 'truncated' && snap.ref) {
		const existed = refsToMinDepth.get(snap.ref)
		if (existed === undefined || depth < existed)
			refsToMinDepth.set(snap.ref, depth)
		return
	}

	const kind = typeof snap.kind === 'string' ? snap.kind : ''
	if (kind === 'array' || kind === 'Set') {
		for (const item of Array.isArray(snap.items) ? snap.items : [])
			collectTruncatedRefsInSnapshot(item, refsToMinDepth, depth + 1)
		return
	}
	if (kind === 'Map') {
		for (const item of Array.isArray(snap.items) ? snap.items : []) {
			collectTruncatedRefsInSnapshot(item?.key, refsToMinDepth, depth + 1)
			collectTruncatedRefsInSnapshot(item?.value, refsToMinDepth, depth + 1)
		}
		return
	}
	if (Array.isArray(snap.entries))
		for (const entry of snap.entries)
			collectTruncatedRefsInSnapshot(entry?.value, refsToMinDepth, depth + 1)
}

/**
 * @param {import('../shared.d.mts').LogSegment[]} segments - 片段数组。
 * @returns {Generator<{ get: () => unknown, set: (v: unknown) => void }>} 各快照挂载点的读写句柄。
 */
function* iterSegmentSnapshotSlots(segments) {
	for (const seg of segments)
		if (seg.kind === 'value')
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
}

/**
 * @param {import('../shared.d.mts').LogSegment[]} segments - 片段数组。
 * @returns {Map<string, number>} 需要展开的 ref 及其在快照中的最浅深度（相对片段快照根）。
 */
export function collectTruncatedRefsWithDepthFromSegments(segments) {
	/** @type {Map<string, number>} */
	const refsToMinDepth = new Map()
	for (const slot of iterSegmentSnapshotSlots(segments))
		collectTruncatedRefsInSnapshot(slot.get(), refsToMinDepth, 0)
	return refsToMinDepth
}

/**
 * 按 ref 映射替换快照树中的 `truncated` 节点（就地改写克隆）。
 * @param {unknown} snap - 任意快照子树。
 * @param {Map<string, unknown>} refToSnapshot - ref 到展开快照映射。
 * @returns {unknown} 可能替换后的根。
 */
function replaceTruncatedInSnapshot(snap, refToSnapshot) {
	if (snap === null || typeof snap !== 'object') return snap
	if (snap.kind === 'truncated' && typeof snap.ref === 'string' && refToSnapshot.has(snap.ref)) {
		const replacement = refToSnapshot.get(snap.ref)
		// 保护：若 replacement 与当前节点同引用，则直接返回，避免自引用替换死循环。
		if (replacement === snap) return snap
		return replaceTruncatedInSnapshot(replacement, refToSnapshot)
	}

	if (Array.isArray(snap)) {
		for (let i = 0; i < snap.length; i++)
			snap[i] = replaceTruncatedInSnapshot(snap[i], refToSnapshot)

		return snap
	}

	for (const key of Object.keys(snap))
		snap[key] = replaceTruncatedInSnapshot(snap[key], refToSnapshot)

	return snap
}

/**
 * 克隆片段后，按 ref→快照映射替换所有可展开截断节点。
 * @param {import('../shared.d.mts').LogSegment[]} segments - 克隆后的片段。
 * @param {Map<string, unknown>} refToSnapshot - ref 到展开快照。
 * @returns {import('../shared.d.mts').LogSegment[]} 同一数组引用（便于调用方直接持有）。
 */
export function applyExpandedSnapshotsInSegments(segments, refToSnapshot) {
	for (const slot of iterSegmentSnapshotSlots(segments))
		slot.set(replaceTruncatedInSnapshot(slot.get(), refToSnapshot))

	return segments
}
