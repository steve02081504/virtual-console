/** 参数快照默认深度（log / dir / 线路一致） */
export const DEFAULT_SNAPSHOT_DEPTH = 5

/**
 * `LogEntry` 实例 → 原始参数数组。
 * @type {WeakMap<object, unknown[]>}
 */
const logEntryArgs = new WeakMap()

/**
 * 惰性展开 ref → 弱引用条目与强引用截断对象。
 * @type {Map<string, { weakEntryRef: WeakRef<object>, strongTarget: object }>}
 */
const expandRegistry = new Map()

/**
 * 条目 → 该条目注册过的展开 ref 集合（便于淘汰时清理）。
 * @type {WeakMap<object, Set<string>>}
 */
const entryToExpandRefs = new WeakMap()

/**
 * 将原始 `console` 参数关联到条目（WeakMap）。
 * @param {object} entry - 目标 `LogEntry` 实例。
 * @param {unknown[]} args - 与 `console.*` 调用完全一致的参数数组。
 * @returns {void}
 */
export function setLogEntryArgs(entry, args) {
	logEntryArgs.set(entry, args)
}

/**
 * 进程内读取捕获参数（惰性展开用；不进入 JSON 线路）。
 * @param {object} entry - 任意 {@link LogEntry} 实例或兼容对象。
 * @returns {unknown[]} 构造时存入 WeakMap 的参数数组；流式条目无缓存时回退为 `[streamText]`。
 */
export function getLogEntryArgs(entry) {
	return logEntryArgs.get(entry) ?? [entry.streamText]
}

/**
 * 为深度截断处的对象注册惰性展开槽位。
 * @param {object} entry - 所属日志条目，用于在淘汰时成批清理 ref。
 * @param {object} strongTarget - 截断边界对象（强引用钉住直至展开或条目淘汰）。
 * @returns {string} 客户端请求展开时使用的不透明 `ref`。
 */
function registerExpandSlot(entry, strongTarget) {
	const ref = typeof crypto !== 'undefined' && crypto.randomUUID
		? crypto.randomUUID()
		: `r_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`
	expandRegistry.set(ref, {
		weakEntryRef: new WeakRef(entry),
		strongTarget,
	})
	let set = entryToExpandRefs.get(entry)
	if (!set) {
		set = new Set()
		entryToExpandRefs.set(entry, set)
	}
	set.add(ref)
	return ref
}

/**
 * 条目被丢弃或清空时释放展开注册（避免强引用泄漏）。
 * @param {object} entry - 即将移出缓冲区的日志条目。
 * @returns {void}
 */
export function unregisterExpandRefsForEntry(entry) {
	const set = entryToExpandRefs.get(entry)
	if (!set) return
	for (const ref of set)
		expandRegistry.delete(ref)
	entryToExpandRefs.delete(entry)
}

/**
 * 为单次序列化构造「可分配展开 ref」的上下文（与 {@link LogEntry} 生命周期绑定）。
 * @param {object} entry - 当前正在序列化的日志条目。
 * @returns {{ allocRef: (t: object) => string }} 提供 `allocRef` 以在截断处注册强引用目标。
 */
export function createExpansionScope(entry) {
	return {
		/**
		 * 在深度边界为对象注册可展开槽位并返回不透明 ref。
		 * @param {object} target - 被截断替换为占位符的对象引用。
		 * @returns {string} 新注册的展开 ref。
		 */
		allocRef(target) {
			return registerExpandSlot(entry, target)
		},
	}
}

/**
 * 为截断占位生成人类可读标签（数组长度、Map size、构造名等）。
 * @param {object} value - 被截断的对象值。
 * @returns {string} 简短类型描述，用于 UI 折叠展示。
 */
function truncationLabel(value) {
	if (Array.isArray(value)) return `Array(${value.length})`
	if (value instanceof Map) return `Map(${value.size})`
	if (value instanceof Set) return `Set(${value.size})`
	if (value instanceof Error) return value.name || 'Error'
	const name = value?.constructor?.name
	if (name && name !== 'Object') return name
	return 'Object'
}

/**
 * 在达到 `maxDepth` 时将对象折叠为 `truncated` 节点，可选注册展开槽。
 * @param {object} value - 当前深度的对象值。
 * @param {ReturnType<typeof createExpansionScope> | null} expansionScope - 若有则在对象上分配 ref；否则返回空 ref 占位。
 * @returns {import('../shared.d.mts').ArgSnapshotTruncated} 始终为 `kind: 'truncated'` 的快照片段。
 */
function truncateOrPlaceholder(value, expansionScope) {
	if (expansionScope && value !== null && typeof value === 'object') {
		const ref = expansionScope.allocRef(/** @type {object} */ value)
		return { kind: 'truncated', ref, label: truncationLabel(value) }
	}
	return { kind: 'truncated', ref: '', label: truncationLabel(value) }
}

/**
 * 按 ref 展开深层快照（成功后释放该 ref 的强引用）。
 * @param {string} ref - 客户端自 `truncated.ref` 取得的标识。
 * @param {number} [maxDepth=DEFAULT_SNAPSHOT_DEPTH] - 展开时再序列化的最大深度。
 * @returns {{ ok: true, snapshot: import('../shared.d.mts').ArgSnapshot } | { ok: false, error: string }} 成功带完整快照，失败带机器可读 `error` 码。
 */
export function expandSnapshotRef(ref, maxDepth = DEFAULT_SNAPSHOT_DEPTH) {
	const slot = expandRegistry.get(ref)
	if (!slot) return { ok: false, error: 'unknown_ref' }
	const entry = slot.weakEntryRef.deref()
	if (!entry) {
		expandRegistry.delete(ref)
		return { ok: false, error: 'entry_gone' }
	}
	const { strongTarget } = slot
	expandRegistry.delete(ref)
	const refsSet = entryToExpandRefs.get(entry)
	refsSet?.delete(ref)
	if (refsSet && refsSet.size === 0) entryToExpandRefs.delete(entry)

	const nestedScope = createExpansionScope(entry)
	try {
		const snapshot = serializeArgSnapshot(strongTarget, new WeakSet(), 0, maxDepth, nestedScope)
		return { ok: true, snapshot }
	}
	catch (e) {
		return { ok: false, error: String(e?.message || e) }
	}
}

/**
 * 将任意值序列化为可 JSON 传输的快照（与 {@link formatArgs} / DevTools 风格展示对齐）。
 * @param {any} value - 原始值。
 * @param {WeakSet<object>} [seen] - 循环引用检测。
 * @param {number} [depth=0] - 当前深度。
 * @param {number} [maxDepth=DEFAULT_SNAPSHOT_DEPTH] - 最大深度。
 * @param {ReturnType<typeof createExpansionScope> | null} [expansionScope] - 若提供则深度边界生成 `truncated` 并注册展开槽。
 * @returns {object} JSON-safe 树。
 */
export function serializeArgSnapshot(value, seen = new WeakSet(), depth = 0, maxDepth = DEFAULT_SNAPSHOT_DEPTH, expansionScope = null) {
	if (value === null) return { kind: 'null', value: null }
	const valueType = typeof value
	if (valueType === 'string' || valueType === 'number' || valueType === 'boolean')
		return { kind: valueType, value }
	if (valueType === 'undefined') return { kind: 'undefined', value: 'undefined' }
	if (valueType === 'bigint') return { kind: 'bigint', value: value.toString() }
	if (valueType === 'symbol') return { kind: 'symbol', value: value.toString() }
	if (valueType === 'function') return { kind: 'function', value: value.name || '(anonymous)' }
	if (!(value instanceof Object)) return { kind: 'unknown', value: String(value) }
	if (seen.has(value)) return { kind: 'circular', value: '[Circular]' }
	seen.add(value)

	/**
	 * 递归序列化子节点时统一递增深度并传递同一 `seen` 集。
	 * @param {unknown} child - 属性值或数组元素。
	 * @returns {object} 子快照节点。
	 */
	const serializeChild = child => serializeArgSnapshot(child, seen, depth + 1, maxDepth, expansionScope)

	if (depth >= maxDepth)
		return truncateOrPlaceholder(/** @type {object} */ value, expansionScope)

	if (value instanceof Error) {
		const entries = []
		for (const key of Object.keys(value))
			if (key !== 'stack' && key !== 'message' && key !== 'name')
				entries.push({ key, value: serializeChild(value[key]) })
		return {
			kind: 'Error',
			name: value.name || 'Error',
			message: value.message || '',
			stack: value.stack || '',
			entries,
		}
	}
	if (value instanceof Date) return { kind: 'Date', value: value.toISOString() }
	if (value instanceof RegExp) return { kind: 'RegExp', value: value.toString() }
	if (value instanceof Map)
		return {
			kind: 'Map',
			items: [...value.entries()].map(([key, val]) => ({
				key: serializeChild(key),
				value: serializeChild(val),
			})),
		}

	if (value instanceof Set)
		return {
			kind: 'Set',
			items: [...value.values()].map(el => serializeChild(el)),
		}


	if (Array.isArray(value))
		return { kind: 'array', items: value.map(item => serializeChild(item)) }

	const entries = []
	for (const key of Object.keys(value))
		entries.push({ key, value: serializeChild(value[key]) })
	return {
		kind: value.constructor?.name || 'object',
		entries,
	}
}
