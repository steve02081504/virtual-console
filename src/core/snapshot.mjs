import { parseErrorStack } from './stack.mjs'

/**
 * 检测值是否为 Proxy（可用时使用 `util.types.isProxy`，否则恒为 `false`）。
 * @param {unknown} value - 待检测的值。
 * @returns {boolean} 当 `value` 为 Proxy 实例时为 `true`。
 */
let isProxyInstance = (value) => false
await import('node:util/types').then(module => {
	isProxyInstance = module.isProxy
}).catch(() => 0)

/** 参数快照默认深度（log / dir / 线路一致） */
export const DEFAULT_SNAPSHOT_DEPTH = 5

/**
 * 从结构化片段解析主调用点：优先首个根级 `Error` 快照栈中带路径的帧，否则回退到捕获栈。
 * 与 {@link serializeArgSnapshot} 产出的 Error 快照字段对齐；进程内 {@link LogEntry#toSegments} 与线路 `segments` 共用。
 * @param {import('../shared.d.mts').LogSegment[] | undefined} segments - 结构化片段。
 * @param {import('../shared.d.mts').StackFrame[]} [stack] - `getStackInfo` 捕获栈。
 * @returns {import('../shared.d.mts').StackFrame | null}
 */
export function resolvePrimaryCallsiteFromSegments(segments, stack) {
	for (const seg of segments ?? [])
		if (seg?.kind === 'value' && seg?.snapshot?.kind === 'Error')
			return seg.snapshot.stack.find(f => f?.filePath) ?? null
	return stack?.find(f => f?.filePath) ?? null
}

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
 * `LogEntry` 被 GC 且未走缓冲挤出时，清理 {@link expandRegistry} 中残留的 ref→强引用槽位。
 * @type {FinalizationRegistry<Set<string>>}
 */
const expandEntryFinalizer = new FinalizationRegistry((refs) => {
	if (!refs) return
	for (const ref of refs)
		expandRegistry.delete(ref)
})

/**
 * 为深度截断处的对象注册惰性展开槽位。
 * @param {object} entry - 所属日志条目，用于在淘汰时成批清理 ref。
 * @param {object} strongTarget - 截断边界对象（强引用钉住直至展开或条目淘汰）。
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
 * 条目被丢弃或清空时释放展开注册（避免强引用泄漏）。
 * @param {object} entry - 即将移出缓冲区的日志条目。
 * @returns {void}
 */
export function unregisterExpandRefsForEntry(entry) {
	expandEntryFinalizer.unregister(entry)
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
	const tag = Object.prototype.toString.call(value)
	if (tag === '[object Map]') return `Map(${value.size})`
	if (tag === '[object Set]') return `Set(${value.size})`
	if (tag === '[object Error]') return value.name || 'Error'
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
 * @typedef {object} SerializeArgSnapshotOptions
 * @property {number} [maxDepth=DEFAULT_SNAPSHOT_DEPTH]
 * @property {ReturnType<typeof createExpansionScope> | null} [expansionScope=null]
 */

/**
 * @typedef {object} SerializeWalkContext
 * @property {object[]} seenStack - 当前 DFS 路径上的对象（与 Node `util.inspect` 的 `ctx.seen` 一致；非栈内重复不算环）。
 * @property {Map<object, number> | undefined} circularRefs - 作为 `[Circular *N]` / `<ref *N>` 目标的对象 → 编号。
 * @property {number} maxDepth
 * @property {ReturnType<typeof createExpansionScope> | null} expansionScope
 */

/**
 * 为出现在环上的对象分配稳定编号（与 Node `util.inspect` 的 `ctx.circular` 一致）。
 * @param {SerializeWalkContext} walkContext - 序列化上下文。
 * @param {object} targetObject - 背边指向的目标对象。
 * @returns {number} 从 1 起的编号。
 */
function assignCircularRefIndex(walkContext, targetObject) {
	if (!walkContext.circularRefs)
		walkContext.circularRefs = new Map()
	const map = walkContext.circularRefs
	let index = map.get(targetObject)
	if (index !== undefined) return index
	index = map.size + 1
	map.set(targetObject, index)
	return index
}

/**
 * 若该对象被登记为环目标，则在快照上附带 `inspectRefId`（供 `<ref *N>` 前缀）。
 * @param {import('../shared.d.mts').ArgSnapshot} snap - 刚生成的快照。
 * @param {object} valueObject - 与 `snap` 对应的原始对象引用。
 * @param {SerializeWalkContext} walkContext - 序列化上下文。
 * @returns {import('../shared.d.mts').ArgSnapshot} 与输入同结构的快照；若该对象在环上则多一个 `inspectRefId` 数字字段，否则原样返回。
 */
function attachInspectRefIfNeeded(snap, valueObject, walkContext) {
	const inspectRefIndex = walkContext.circularRefs?.get(valueObject)
	if (inspectRefIndex === undefined) return snap
	if (snap === null || typeof snap !== 'object' || Array.isArray(snap)) return snap
	return /** @type {import('../shared.d.mts').ArgSnapshot} */ {
		...snap,
		inspectRefId: inspectRefIndex
	}
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
		const snapshot = serializeArgSnapshot(strongTarget, { maxDepth, expansionScope: nestedScope })
		return { ok: true, snapshot }
	}
	catch (error) {
		return { ok: false, error: String(error?.message || error) }
	}
}

/**
 * 将非对象原语序列化为带 `kind` 的叶子节点。
 * @param {unknown} value - 原始值。
 * @param {string} valueType - `typeof value`。
 * @returns {import('../shared.d.mts').ArgSnapshot} 叶子快照片段。
 */
function snapshotPrimitive(value, valueType) {
	if (valueType === 'string' || valueType === 'number' || valueType === 'boolean')
		return { kind: valueType, value }
	if (valueType === 'undefined') return { kind: 'undefined', value: 'undefined' }
	if (valueType === 'bigint') return { kind: 'bigint', value: /** @type {bigint} */ value.toString() }
	if (valueType === 'symbol') return { kind: 'symbol', value: /** @type {symbol} */ value.toString() }
	if (valueType === 'function') {
		let isClass = false
		try {
			isClass = /^\s*class[\s{]/.test(Function.prototype.toString.call(value))
		}
		catch {
			isClass = false
		}
		return { kind: 'function', value: /** @type {Function} */ value.name || '(anonymous)', isClass }
	}
	return { kind: 'unknown', value: String(value) }
}

/**
 * 读取自有数据/访问器属性用于快照：数据属性用 `[[GetOwnProperty]]` 的 `value`，避免 Proxy 的 `get` 陷阱掩盖真实引用（与 Node `util.inspect` 一致）。
 * 访问器属性仍调用 getter。
 * @param {object} hostObject - 对象或 Proxy（无 `getOwnPropertyDescriptor` 陷阱时转目标）。
 * @param {string} key - 属性名。
 * @returns {unknown} 数据属性的快照值、访问器调用 getter 的结果，或回退/缺失时为 `undefined`。
 */
function getOwnPropertySnapshotValue(hostObject, key) {
	const descriptor = Reflect.getOwnPropertyDescriptor(hostObject, key)
	if (!descriptor)
		try {
			return /** @type {Record<string, unknown>} */ hostObject[key]
		}
		catch {
			return undefined
		}

	if ('value' in descriptor)
		return descriptor.value
	if (typeof descriptor.get === 'function')
		return descriptor.get.call(hostObject)
	return undefined
}

/**
 * `candidate` 是否与 `proxy` 在自有键及描述符可见取值上一致（透明转发 Proxy 的常见目标识别）。
 * @param {object} proxy - Proxy 实例。
 * @param {object} candidate - 候选目标。
 * @returns {boolean} 当自有键集合一致且各键经描述符可见取值相等时为 `true`（视为透明转发目标）。
 */
function matchesTransparentProxyTarget(proxy, candidate) {
	if (proxy === candidate) return false
	const pKeys = Object.keys(proxy)
	if (Object.keys(candidate).length !== pKeys.length) return false
	for (const key of pKeys)
		if (getOwnPropertySnapshotValue(proxy, key) !== getOwnPropertySnapshotValue(candidate, key))
			return false

	return true
}

/**
 * 无 native `getProxyDetails` 时，用描述符图推断透明 Proxy 的目标（与 Node `util.inspect` 默认解包行为对齐）。
 * @param {object} proxy - Proxy。
 * @returns {object | undefined} 唯一可确定的转发目标；不确定则 `undefined`。
 */
function tryResolveTransparentProxyTarget(proxy) {
	if (!isProxyInstance(proxy)) return undefined
	const pKeys = Object.keys(proxy)
	/** @type {object | undefined} */
	let found
	for (const key of pKeys) {
		const val = getOwnPropertySnapshotValue(proxy, key)
		if (val === null || typeof val !== 'object') continue
		if (!matchesTransparentProxyTarget(proxy, /** @type {object} */ val)) continue
		if (found !== undefined && found !== val) return undefined
		found = /** @type {object} */ val
	}
	return found
}

/**
 * 反复解析透明 Proxy 链直至无法解析，使环检测 / `<ref *N>` 与 `util.inspect` 一样基于目标身份。
 * @param {unknown} value - 任意对象引用。
 * @returns {unknown} 解包后的对象或原值。
 */
function unwrapTransparentProxyChain(value) {
	let current = value
	while (current !== null && typeof current === 'object' && isProxyInstance(/** @type {object} */ current)) {
		const next = tryResolveTransparentProxyTarget(/** @type {object} */ current)
		if (next === undefined) break
		current = next
	}
	return current
}

/**
 * 单键转发 Proxy 且目标为「单键自环」对象时，与 Node `util.inspect` 一样改为序列化**目标**（避免 `get` 陷阱与多包一层结构）。
 * @param {unknown} value - 任意值。
 * @returns {object | undefined} 应直接走 `walk` 的目标对象；不展开时 `undefined`。
 */
function tryUnwrapForwardingProxy(value) {
	if (value === null || typeof value !== 'object') return undefined
	if (!isProxyInstance(value)) return undefined
	const keys = Object.keys(/** @type {object} */ value)
	if (keys.length !== 1) return undefined
	const key = keys[0]
	const inner = getOwnPropertySnapshotValue(/** @type {object} */ value, key)
	if (inner === null || typeof inner !== 'object') return undefined
	const innerKeys = Object.keys(inner)
	if (innerKeys.length !== 1 || innerKeys[0] !== key) return undefined
	if (getOwnPropertySnapshotValue(inner, key) !== inner) return undefined
	return /** @type {object} */ inner
}

/**
 * 序列化对象的自有可枚举属性（按 `Object.keys` 顺序）。
 * 读取属性值时使用快照安全读取，避免触发抛错中断整个序列化。
 * @param {object} targetObject - 待收集属性的对象。
 * @param {(child: unknown) => import('../shared.d.mts').ArgSnapshot} serializeProperty - 子值序列化函数。
 * @returns {Array<{ key: string; value: import('../shared.d.mts').ArgSnapshot }>} 键值快照列表。
 */
function collectOwnEntries(targetObject, serializeProperty) {
	const out = []
	for (const key of Object.keys(targetObject))
		out.push({ key, value: serializeProperty(getOwnPropertySnapshotValue(targetObject, key)) })
	return out
}

/**
 * 按 `Object.prototype.toString` 标签分派对象/Error/容器等结构。
 * @param {unknown} value - 当前值。
 * @param {string} tag - `Object.prototype.toString.call` 类名，如 `[object Array]`。
 * @param {number} depth - 当前深度。
 * @param {SerializeWalkContext} walkContext - 环检测、深度与展开上下文。
 * @param {(value: unknown, depth: number, walkContext: SerializeWalkContext) => import('../shared.d.mts').ArgSnapshot} walk - 递归步进。
 * @returns {import('../shared.d.mts').ArgSnapshot} 子树快照。
 */
function snapshotObjectByTag(value, tag, depth, walkContext, walk) {
	const { maxDepth, expansionScope } = walkContext
	/**
	 * 对子值再走一层 `walk`。
	 * @param {unknown} child - 子属性或元素值。
	 * @returns {import('../shared.d.mts').ArgSnapshot} 子快照。
	 */
	const serializeChild = child => walk(child, depth + 1, walkContext)

	if (depth >= maxDepth)
		return truncateOrPlaceholder(/** @type {object} */ value, expansionScope)

	if (tag === '[object Error]') {
		const err = /** @type {Error & Record<string, unknown>} */ value
		const entries = []
		for (const key of Object.keys(err))
			if (!['stack', 'message', 'name'].includes(key))
				entries.push({ key, value: serializeChild(getOwnPropertySnapshotValue(err, key)) })
		const stack = parseErrorStack(err)
		return {
			kind: 'Error',
			name: err.name,
			message: err.message,
			stack,
			entries,
		}
	}
	if (tag === '[object Date]') return { kind: 'Date', value: /** @type {Date} */ value.toISOString() }
	if (tag === '[object RegExp]') return { kind: 'RegExp', value: /** @type {RegExp} */ value.toString() }

	if (tag === '[object Number]') {
		const boxedObject = /** @type {object} */ value
		const unboxed = Number(boxedObject)
		const entries = collectOwnEntries(boxedObject, serializeChild)
		const boxedText = Object.is(unboxed, -0) ? '-0' : String(unboxed)
		if (!entries.length) return { kind: 'Number', boxedText }
		return { kind: 'Number', boxedText, entries }
	}
	if (tag === '[object Boolean]') {
		const boxedObject = /** @type {object} */ value
		const unboxed = Boolean(boxedObject)
		const entries = collectOwnEntries(boxedObject, serializeChild)
		const boxedText = unboxed ? 'true' : 'false'
		if (!entries.length) return { kind: 'Boolean', boxedText }
		return { kind: 'Boolean', boxedText, entries }
	}
	if (tag === '[object String]') {
		const boxedObject = /** @type {object} */ value
		const unboxed = String(boxedObject)
		const entries = collectOwnEntries(boxedObject, serializeChild)
		if (!entries.length) return { kind: 'String', boxedString: unboxed }
		return { kind: 'String', boxedString: unboxed, entries }
	}

	if (tag === '[object Map]') {
		const map = /** @type {Map<unknown, unknown>} */ value
		return {
			kind: 'Map',
			items: [...map.entries()].map(([key, val]) => ({
				key: serializeChild(key),
				value: serializeChild(val),
			})),
		}
	}

	if (tag === '[object Set]') {
		const set = /** @type {Set<unknown>} */ value
		return {
			kind: 'Set',
			items: [...set.values()].map(el => serializeChild(el)),
		}
	}

	if (Array.isArray(value))
		return { kind: 'array', items: value.map(item => serializeChild(item)) }

	const obj = /** @type {object} */ value
	const entries = collectOwnEntries(obj, serializeChild)
	return {
		kind: obj.constructor?.name || 'object',
		entries,
	}
}

/**
 * 深度优先序列化入口：原语、环检测与对象分派。
 * @param {unknown} value - 当前值。
 * @param {number} depth - 从根算起的深度。
 * @param {SerializeWalkContext} walkContext - 环检测、深度、展开。
 * @returns {import('../shared.d.mts').ArgSnapshot} 根快照。
 */
function walk(value, depth, walkContext) {
	if (value === null)
		return { kind: 'null', value: null }
	const valueType = typeof value
	if (valueType !== 'object')
		return snapshotPrimitive(value, valueType)

	const chainUnwrapped = unwrapTransparentProxyChain(value)
	if (chainUnwrapped !== value)
		return walk(chainUnwrapped, depth, walkContext)

	const proxyUnwrapped = tryUnwrapForwardingProxy(value)
	if (proxyUnwrapped !== undefined)
		return walk(proxyUnwrapped, depth, walkContext)

	const obj = /** @type {object} */ value
	const stack = walkContext.seenStack
	if (stack.includes(obj)) {
		const circularRefIndex = assignCircularRefIndex(walkContext, obj)
		return { kind: 'circular', refId: circularRefIndex }
	}

	stack.push(obj)
	try {
		const tag = Object.prototype.toString.call(value)
		let snap = snapshotObjectByTag(value, tag, depth, walkContext, walk)
		snap = attachInspectRefIfNeeded(snap, obj, walkContext)
		return snap
	}
	finally {
		stack.pop()
	}
}

/**
 * 将任意值序列化为可 JSON 传输的快照（与 `renderPlain(buildArgsSegments(…))` / DevTools 风格展示对齐）。
 * @param {any} value - 原始值。
 * @param {SerializeArgSnapshotOptions} [options] - `maxDepth`、`expansionScope` 等。
 * @returns {import('../shared.d.mts').ArgSnapshot} 可 `JSON.stringify` 的快照树。
 */
export function serializeArgSnapshot(value, options = {}) {
	const {
		maxDepth = DEFAULT_SNAPSHOT_DEPTH,
		expansionScope = null,
	} = options
	/** @type {SerializeWalkContext} */
	const walkContext = {
		seenStack: [],
		circularRefs: undefined,
		maxDepth,
		expansionScope,
	}
	return walk(value, 0, walkContext)
}
