/**
 * 创建无原型对象字典，供用户可控字符串做键查找时使用。
 * 普通 `{}` 会继承 `Object.prototype`，`map['toString']` 等会命中继承方法而非「未登记键」。
 * @template {Record<PropertyKey, unknown>} T
 * @param {T} entries - 自有键值。
 * @returns {T} 原型为 `null` 的字典。
 */
export function dict(entries) {
	return Object.assign(Object.create(null), entries)
}
