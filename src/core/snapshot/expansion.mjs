import { DEFAULT_SNAPSHOT_DEPTH, serializeArgSnapshot } from './serialize.mjs'

/**
 * 惰性展开 ref → 弱引用条目与强引用截断对象。
 * @type {Map<string, { weakEntryRef: WeakRef<object>, strongTarget: object }>}
 */
const expandRegistry = new Map()

/**
 * 条目 → 该条目注册过的展开 ref 集合。
 * @type {WeakMap<object, Set<string>>}
 */
const entryToExpandRefs = new WeakMap()

/**
 * 条目 → 复用的 expansion scope（同 entry 多次序列化共用 target→ref）。
 * @type {WeakMap<object, { allocRef: (t: object) => string }>}
 */
const entryExpansionScopes = new WeakMap()

/**
 * `LogEntry` 被 GC 时清理 {@link expandRegistry} 中残留的 ref→强引用槽位。
 * @type {FinalizationRegistry<Set<string>>}
 */
const expandEntryFinalizer = new FinalizationRegistry((refs) => {
	for (const ref of refs)
		expandRegistry.delete(ref)
})

/**
 * 为深度截断处的对象注册惰性展开槽位。
 * @param {object} entry - 所属日志条目。
 * @param {object} strongTarget - 截断边界对象（强引用钉住直至展开或条目被 GC）。
 * @returns {string} 客户端请求展开时使用的不透明 `ref`。
 */
function registerExpandSlot(entry, strongTarget) {
	const ref = globalThis.crypto?.randomUUID?.() ||
		`r_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`
	expandRegistry.set(ref, {
		weakEntryRef: new WeakRef(entry),
		strongTarget,
	})
	let set = entryToExpandRefs.get(entry)
	if (!set) {
		set = new Set()
		entryToExpandRefs.set(entry, set)
		expandEntryFinalizer.register(entry, set)
	}
	set.add(ref)
	return ref
}

/**
 * 为单次序列化构造「可分配展开 ref」的上下文（与 {@link LogEntry} 生命周期绑定）。
 * @param {object} entry - 当前正在序列化的日志条目。
 * @returns {{ allocRef: (t: object) => string }} 提供 `allocRef` 以在截断处注册强引用目标。
 */
export function createExpansionScope(entry) {
	/** @type {WeakMap<object, string>} */
	const targetToRef = new WeakMap()
	return {
		/**
		 * 在深度边界为对象注册可展开槽位并返回不透明 ref；同一 target 复用已有 ref。
		 * @param {object} target - 被截断替换为占位符的对象引用。
		 * @returns {string} 展开 ref。
		 */
		allocRef(target) {
			const existing = targetToRef.get(target)
			if (existing && expandRegistry.has(existing)) return existing
			const ref = registerExpandSlot(entry, target)
			targetToRef.set(target, ref)
			return ref
		},
	}
}

/**
 * 按 entry 身份复用 expansion scope，避免多次 `toSegments()` 为同一截断对象分配新 ref。
 * @param {object} entry - 日志条目。
 * @returns {{ allocRef: (t: object) => string }} 与 entry 绑定的展开上下文。
 */
export function getExpansionScope(entry) {
	let scope = entryExpansionScopes.get(entry)
	if (!scope) {
		scope = createExpansionScope(entry)
		entryExpansionScopes.set(entry, scope)
	}
	return scope
}

/**
 * 按 ref 展开深层快照（成功后释放该 ref 的强引用）。
 * @param {string} ref - 客户端自 `truncated.ref` 取得的标识。
 * @param {number} [maxDepth=DEFAULT_SNAPSHOT_DEPTH] - 展开时再序列化的最大深度。
 * @returns {{ ok: true, snapshot: import('../../shared.d.mts').ArgSnapshot } | { ok: false, error: string }} 成功带完整快照，失败带机器可读 `error` 码。
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

	try {
		return {
			ok: true,
			snapshot: serializeArgSnapshot(strongTarget, {
				maxDepth,
				expansionScope: getExpansionScope(entry),
			}),
		}
	}
	catch (error) {
		return { ok: false, error: String(error?.message || error) }
	}
}
