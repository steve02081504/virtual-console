import { dict } from '../../util/dict.mjs'

/**
 * console 方法名 → 语义级别（未列出的方法名原样返回）。
 */
const METHOD_NAME_TO_LEVEL = dict({
	dir: 'log',
	freshLine: 'log',
	trace: 'debug',
	stdout: 'log',
	stderr: 'error',
})

/**
 * 将 console 方法名转换为语义级别。
 * @param {string} methodName - console 方法名。
 * @returns {string} 语义级别。
 */
export function methodNameToLevel(methodName) {
	return METHOD_NAME_TO_LEVEL[methodName] ?? methodName
}
