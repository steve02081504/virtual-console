/**
 * Proxy 检测与解包启发式（对齐 Node `util.inspect` / `getProxyDetails`）。
 */

/**
 * 检测值是否为 Proxy（可用时使用 `util.types.isProxy`，否则恒为 `false`）。
 * @param {unknown} value - 待检测的值。
 * @returns {boolean} 当 `value` 为 Proxy 实例时为 `true`。
 */
export let isProxyInstance = (value) => false
await import('node:util/types').then(module => {
	const candidate = module.isProxy
	// 浏览器垫片（如 esm.sh/unenv）会把未实现的 isProxy 做成“调用即抛错”的桩函数，
	// import() 本身不抛错，故需实际探测一次；不可用时维持恒 false 回退而非直接采用。
	if (globalThis.document) candidate({})
	isProxyInstance = candidate
}).catch(() => 0)

/**
 * 读取自有数据/访问器属性用于快照：数据属性用 `[[GetOwnProperty]]` 的 `value`，避免 Proxy 的 `get` 陷阱掩盖真实引用（与 Node `util.inspect` 一致）。
 * 访问器属性仍调用 getter。
 * @param {object} hostObject - 对象或 Proxy。
 * @param {string} key - 属性名。
 * @returns {unknown} 数据属性的快照值、访问器调用 getter 的结果，或回退/缺失时为 `undefined`。
 */
export function getOwnPropertySnapshotValue(hostObject, key) {
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
 * @returns {boolean} 当自有键集合一致且各键经描述符可见取值相等时为 `true`。
 */
function matchesTransparentProxyTarget(proxy, candidate) {
	if (proxy === candidate) return false
	const proxyKeys = Object.keys(proxy)
	if (Object.keys(candidate).length !== proxyKeys.length) return false
	for (const key of proxyKeys)
		if (getOwnPropertySnapshotValue(proxy, key) !== getOwnPropertySnapshotValue(candidate, key))
			return false
	return true
}

/**
 * 无 native `getProxyDetails` 时，用描述符图推断透明 Proxy 的目标。
 * @param {object} proxy - Proxy。
 * @returns {object | undefined} 唯一可确定的转发目标；不确定则 `undefined`。
 */
function tryResolveTransparentProxyTarget(proxy) {
	if (!isProxyInstance(proxy)) return undefined
	const proxyKeys = Object.keys(proxy)
	/** @type {object | undefined} */
	let found
	for (const key of proxyKeys) {
		const val = getOwnPropertySnapshotValue(proxy, key)
		if (val === null || typeof val !== 'object') continue
		if (!matchesTransparentProxyTarget(proxy, /** @type {object} */ val)) continue
		if (found !== undefined && found !== val) return undefined
		found = /** @type {object} */ val
	}
	return found
}

/**
 * 单键转发 Proxy 且目标为「单键自环」对象时，改为序列化目标。
 * @param {object} proxy - 已确认为 Proxy 的对象。
 * @returns {object | undefined} 应直接走序列化的目标对象；不展开时 `undefined`。
 */
function tryUnwrapForwardingProxy(proxy) {
	const keys = Object.keys(proxy)
	if (keys.length !== 1) return undefined
	const key = keys[0]
	const inner = getOwnPropertySnapshotValue(proxy, key)
	if (inner === null || typeof inner !== 'object') return undefined
	const innerKeys = Object.keys(inner)
	if (innerKeys.length !== 1 || innerKeys[0] !== key) return undefined
	if (getOwnPropertySnapshotValue(inner, key) !== inner) return undefined
	return /** @type {object} */ inner
}

/**
 * 解析 Proxy 的展示目标：优先透明转发推断，其次单键自环启发式。
 * @param {object} proxy - Proxy 实例。
 * @returns {object | undefined} 目标对象；无法推断时 `undefined`。
 */
export function resolveProxyInspectTarget(proxy) {
	return tryResolveTransparentProxyTarget(proxy) ?? tryUnwrapForwardingProxy(proxy)
}
