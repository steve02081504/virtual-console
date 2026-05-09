/**
 * 本测试运行中累计通过的断言次数（由 `assert` / `assertEqual` / `assertIncludes` 递增）。
 */
export let passed = 0
/**
 * 本测试运行中累计失败的断言次数。
 */
export let failed = 0
/**
 * 本轮运行中每条失败断言的摘要（与 `failed` 一一对应，供末尾汇总）。
 * @type {string[]}
 */
export const failures = []

/**
 * 重置计数与失败列表（新一轮完整测试跑数前调用）。
 * @returns {void}
 */
export function resetHarness() {
	passed = 0
	failed = 0
	failures.length = 0
}

/**
 * 断言条件为真；失败时记录失败计数并输出可读错误。
 * @param {boolean} condition - 断言条件。
 * @param {string} message - 断言说明文本。
 * @returns {void} 无返回值。
 */
export function assert(condition, message) {
	if (condition) {
		console.log(`  ✓ ${message}`)
		passed++
	} else {
		console.error(`  ✗ FAIL: ${message}`)
		failures.push(message)
		failed++
		debugger
	}
}

/**
 * 断言两值严格相等（===）。
 * @param {unknown} actual - 实际值。
 * @param {unknown} expected - 期望值。
 * @param {string} message - 断言说明文本。
 * @returns {void} 无返回值。
 */
export function assertEqual(actual, expected, message) {
	if (actual === expected) {
		console.log(`  ✓ ${message}`)
		passed++
	} else {
		console.error(`  ✗ FAIL: ${message}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`)
		failures.push(`${message}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`)
		failed++
		debugger
	}
}

/**
 * 断言字符串包含指定子串。
 * @param {string} str - 目标字符串。
 * @param {string} substr - 期望出现的子串。
 * @param {string} message - 断言说明文本。
 * @returns {void} 无返回值。
 */
export function assertIncludes(str, substr, message) {
	if (typeof str === 'string' && str.includes(substr)) {
		console.log(`  ✓ ${message}`)
		passed++
	} else {
		console.error(`  ✗ FAIL: ${message}\n    "${substr}" not found in "${str}"`)
		failures.push(`${message}\n    "${substr}" not found in "${str}"`)
		failed++
		debugger
	}
}

/**
 * 顺序执行同一主题测试，便于阅读与维护。
 * @param {string} title - 分组标题。
 * @param {Array<() => void | Promise<void>>} tests - 测试函数列表。
 * @returns {Promise<void>}
 */
export async function runTestGroup(title, tests) {
	console.log(`\n--- [${title}] ---`)
	for (const testFn of tests)
		await testFn()
}
