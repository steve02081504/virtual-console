import { DEFAULT_SNAPSHOT_DEPTH } from './serialize.mjs'

/**
 * 将 `console.dir` 第二参数收敛为可 JSON 传输的浅层选项（仅 `depth`、`colors`）。
 * @param {unknown} raw - 原始 options。
 * @returns {import('../../shared.d.mts').DirOptionsPayload} 浅层 dir 选项。
 */
export function normalizeDirOptionsPayload(raw) {
	return {
		depth: raw?.depth ?? DEFAULT_SNAPSHOT_DEPTH,
		colors: raw?.colors ?? true,
	}
}
