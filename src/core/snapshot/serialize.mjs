import { parseErrorStack } from '../stack.mjs'

import { getOwnPropertySnapshotValue, isProxyInstance, resolveProxyInspectTarget } from './proxy-target.mjs'

/** 参数快照默认深度（log / dir / 线路一致） */
export const DEFAULT_SNAPSHOT_DEPTH = 5

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
 * @param {{ allocRef: (t: object) => string } | null} expansionScope - 若有则在对象上分配 ref；否则返回空 ref 占位。
 * @returns {import('../../shared.d.mts').ArgSnapshotTruncated} 始终为 `kind: 'truncated'` 的快照片段。
 */
function truncateOrPlaceholder(value, expansionScope) {
	if (expansionScope && value !== null && typeof value === 'object')
		return { kind: 'truncated', ref: expansionScope.allocRef(/** @type {object} */ (value)), label: truncationLabel(value) }
	return { kind: 'truncated', ref: '', label: truncationLabel(value) }
}

/**
 * @typedef {object} SerializeArgSnapshotOptions
 * @property {number} [maxDepth=DEFAULT_SNAPSHOT_DEPTH]
 * @property {{ allocRef: (t: object) => string } | null} [expansionScope=null]
 */

/**
 * @typedef {object} SerializeWalkContext
 * @property {object[]} seenStack - 当前 DFS 路径上的对象（与 Node `util.inspect` 的 `ctx.seen` 一致；非栈内重复不算环）。
 * @property {Map<object, number> | undefined} circularRefs - 作为 `[Circular *N]` / `<ref *N>` 目标的对象 → 编号。
 * @property {number} maxDepth
 * @property {{ allocRef: (t: object) => string } | null} expansionScope
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
 * @param {import('../../shared.d.mts').ArgSnapshot} snap - 刚生成的快照。
 * @param {object} valueObject - 与 `snap` 对应的原始对象引用。
 * @param {SerializeWalkContext} walkContext - 序列化上下文。
 * @returns {import('../../shared.d.mts').ArgSnapshot} 与输入同结构的快照。
 */
function attachInspectRefIfNeeded(snap, valueObject, walkContext) {
	const inspectRefIndex = walkContext.circularRefs?.get(valueObject)
	if (inspectRefIndex === undefined) return snap
	if (snap === null || typeof snap !== 'object' || Array.isArray(snap)) return snap
	return /** @type {import('../../shared.d.mts').ArgSnapshot} */ ({
		...snap,
		inspectRefId: inspectRefIndex,
	})
}

/**
 * 将非对象原语序列化为带 `kind` 的叶子节点。
 * @param {unknown} value - 原始值。
 * @param {string} valueType - `typeof value`。
 * @returns {import('../../shared.d.mts').ArgSnapshot} 叶子快照片段。
 */
function snapshotPrimitive(value, valueType) {
	if (valueType === 'string' || valueType === 'number' || valueType === 'boolean')
		return { kind: valueType, value }
	if (valueType === 'undefined') return { kind: 'undefined', value: 'undefined' }
	if (valueType === 'bigint') return { kind: 'bigint', value: /** @type {bigint} */ (value).toString() }
	if (valueType === 'symbol') return { kind: 'symbol', value: /** @type {symbol} */ (value).toString() }
	if (valueType === 'function') {
		let isClass = false
		try {
			isClass = /^\s*class[\s{]/.test(Function.prototype.toString.call(value))
		}
		catch {
			isClass = false
		}
		return { kind: 'function', value: /** @type {Function} */ (value).name || '(anonymous)', isClass }
	}
	return { kind: 'unknown', value: String(value) }
}

/**
 * 序列化对象的自有可枚举属性（按 `Object.keys` 顺序）。
 * @param {object} targetObject - 待收集属性的对象。
 * @param {(child: unknown) => import('../../shared.d.mts').ArgSnapshot} serializeProperty - 子值序列化函数。
 * @returns {Array<{ key: string; value: import('../../shared.d.mts').ArgSnapshot }>} 键值快照列表。
 */
function collectOwnEntries(targetObject, serializeProperty) {
	const out = []
	for (const key of Object.keys(targetObject))
		out.push({ key, value: serializeProperty(getOwnPropertySnapshotValue(targetObject, key)) })
	return out
}

/**
 * 装箱原语（`new Number` / `new Boolean` / `new String`）快照：拆箱文本 + 可选自有属性。
 * @param {object} boxedObject - 装箱对象。
 * @param {'Number' | 'Boolean' | 'String'} kind - 快照 kind。
 * @param {'boxedText' | 'boxedString'} textField - 承载拆箱文本的字段名。
 * @param {string} text - 拆箱后的展示文本。
 * @param {(child: unknown) => import('../../shared.d.mts').ArgSnapshot} serializeChild - 子值序列化函数。
 * @returns {import('../../shared.d.mts').ArgSnapshot} 装箱原语快照。
 */
function snapshotBoxedPrimitive(boxedObject, kind, textField, text, serializeChild) {
	const entries = collectOwnEntries(boxedObject, serializeChild)
	if (!entries.length) return /** @type {import('../../shared.d.mts').ArgSnapshot} */ ({ kind, [textField]: text })
	return /** @type {import('../../shared.d.mts').ArgSnapshot} */ ({ kind, [textField]: text, entries })
}

/**
 * 按 `Object.prototype.toString` 标签分派对象/Error/容器等结构。
 * @param {unknown} value - 当前值。
 * @param {string} tag - `Object.prototype.toString.call` 类名。
 * @param {number} depth - 当前深度。
 * @param {SerializeWalkContext} walkContext - 环检测、深度与展开上下文。
 * @param {(value: unknown, depth: number, walkContext: SerializeWalkContext) => import('../../shared.d.mts').ArgSnapshot} walkFn - 递归步进。
 * @returns {import('../../shared.d.mts').ArgSnapshot} 子树快照。
 */
function snapshotObjectByTag(value, tag, depth, walkContext, walkFn) {
	const { maxDepth, expansionScope } = walkContext
	/**
	 * @param {unknown} child - 子属性或元素值。
	 * @returns {import('../../shared.d.mts').ArgSnapshot} 子快照。
	 */
	const serializeChild = child => walkFn(child, depth + 1, walkContext)

	if (depth >= maxDepth)
		return truncateOrPlaceholder(/** @type {object} */ (value), expansionScope)

	if (tag === '[object Error]') {
		const err = /** @type {Error & Record<string, unknown>} */ (value)
		const entries = []
		for (const key of Object.keys(err))
			if (!['stack', 'message', 'name'].includes(key))
				entries.push({ key, value: serializeChild(getOwnPropertySnapshotValue(err, key)) })
		return {
			kind: 'Error',
			name: err.name,
			message: err.message,
			stack: parseErrorStack(err),
			entries,
		}
	}
	if (tag === '[object Date]') return { kind: 'Date', value: /** @type {Date} */ (value).getTime() }
	if (tag === '[object RegExp]') return { kind: 'RegExp', value: /** @type {RegExp} */ (value).toString() }

	if (tag === '[object Number]') {
		const unboxed = Number.prototype.valueOf.call(value)
		return snapshotBoxedPrimitive(
			/** @type {object} */ (value),
			'Number',
			'boxedText',
			Object.is(unboxed, -0) ? '-0' : String(unboxed),
			serializeChild,
		)
	}
	if (tag === '[object Boolean]')
		return snapshotBoxedPrimitive(
			/** @type {object} */ (value),
			'Boolean',
			'boxedText',
			String(Boolean.prototype.valueOf.call(value)),
			serializeChild,
		)
	if (tag === '[object String]')
		return snapshotBoxedPrimitive(
			/** @type {object} */ (value),
			'String',
			'boxedString',
			String.prototype.valueOf.call(value),
			serializeChild,
		)

	if (tag === '[object Map]') {
		const map = /** @type {Map<unknown, unknown>} */ (value)
		return {
			kind: 'Map',
			items: [...map.entries()].map(([key, val]) => ({
				key: serializeChild(key),
				value: serializeChild(val),
			})),
		}
	}

	if (tag === '[object Set]') {
		const set = /** @type {Set<unknown>} */ (value)
		return {
			kind: 'Set',
			items: [...set.values()].map(el => serializeChild(el)),
		}
	}

	if (Array.isArray(value))
		return { kind: 'array', items: value.map(item => serializeChild(item)) }

	const obj = /** @type {object} */ (value)
	return {
		kind: obj.constructor?.name || 'object',
		entries: collectOwnEntries(obj, serializeChild),
	}
}

/**
 * 对象环检测与按标签分派（不含 Proxy 外壳）。
 * @param {object} obj - 对象引用。
 * @param {number} depth - 从根算起的深度。
 * @param {SerializeWalkContext} walkContext - 环检测、深度、展开。
 * @returns {import('../../shared.d.mts').ArgSnapshot} 对象快照。
 */
function walkObject(obj, depth, walkContext) {
	const stack = walkContext.seenStack
	if (stack.includes(obj))
		return { kind: 'circular', refId: assignCircularRefIndex(walkContext, obj) }

	stack.push(obj)
	try {
		return attachInspectRefIfNeeded(
			snapshotObjectByTag(obj, Object.prototype.toString.call(obj), depth, walkContext, walk),
			obj,
			walkContext,
		)
	}
	finally {
		stack.pop()
	}
}

/**
 * 深度优先序列化入口：原语、Proxy 外壳、环检测与对象分派。
 * @param {unknown} value - 当前值。
 * @param {number} depth - 从根算起的深度。
 * @param {SerializeWalkContext} walkContext - 环检测、深度、展开。
 * @returns {import('../../shared.d.mts').ArgSnapshot} 根快照。
 */
function walk(value, depth, walkContext) {
	if (value === null)
		return { kind: 'null', value: null }
	const valueType = typeof value
	if (valueType !== 'object')
		return snapshotPrimitive(value, valueType)

	const obj = /** @type {object} */ (value)
	if (isProxyInstance(obj)) {
		const stack = walkContext.seenStack
		// 互相转发的 Proxy 外壳同样成环，且外壳不进 walkObject，需在此自行入栈。
		if (stack.includes(obj))
			return { kind: 'circular', refId: assignCircularRefIndex(walkContext, obj) }
		const resolved = resolveProxyInspectTarget(obj)
		if (resolved === undefined)
			return { kind: 'Proxy', target: walkObject(obj, depth, walkContext) }
		stack.push(obj)
		try {
			return { kind: 'Proxy', target: walk(resolved, depth, walkContext) }
		}
		finally {
			stack.pop()
		}
	}

	return walkObject(obj, depth, walkContext)
}

/**
 * 将任意值序列化为可 JSON 传输的快照（与 `renderPlain(buildArgsSegments(…))` / DevTools 风格展示对齐）。
 * @param {any} value - 原始值。
 * @param {SerializeArgSnapshotOptions} [options] - `maxDepth`、`expansionScope` 等。
 * @returns {import('../../shared.d.mts').ArgSnapshot} 可 `JSON.stringify` 的快照树。
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
