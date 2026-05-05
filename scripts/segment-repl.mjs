#!/usr/bin/env node
/**
 * 交互式比对 REPL：eval 结果与 `log(...)` 均用片段管线（ANSI / plain / HTML）
 * 与 `util.inspect`（着色）、原生 `console.log` 对照。
 *
 * 用法（仓库根目录）：`npm run repl` 或 `node scripts/segment-repl.mjs`
 */

import repl from 'node:repl'
import util from 'node:util'

import { DEFAULT_SNAPSHOT_DEPTH, serializeArgSnapshot } from '#vc/core/snapshot.mjs'
import { renderAnsi, renderHtml, renderPlain } from '#vc/format/render.mjs'
import { buildArgsSegments } from '#vc/format/segments.mjs'

/** @type {(...args: unknown[]) => void} */
const nativeLog = console.log.bind(console)

/** 当前这一轮 REPL 求值里是否调用过 `log`（每轮 `eval` 开头清零）。 */
let logWasCalledThisEval = false

const HEADER = {
	ansi: '\x1b[1;36m━━ segments → ANSI ━━\x1b[0m',
	plain: '\x1b[1;36m━━ segments → plain ━━\x1b[0m',
	html: '\x1b[1;36m━━ segments → HTML ━━\x1b[0m',
	nativeLog: '\x1b[1;36m━━ native console.log ━━\x1b[0m',
	inspect: '\x1b[1;35m━━ util.inspect (colors) ━━\x1b[0m',
	evalAnsi: '\x1b[1;36m━━ value snapshot → ANSI ━━\x1b[0m',
	evalPlain: '\x1b[1;36m━━ value snapshot → plain ━━\x1b[0m',
	evalHtml: '\x1b[1;36m━━ value snapshot → HTML ━━\x1b[0m',
}

const replOptions = {
	snapshotMaxDepth: DEFAULT_SNAPSHOT_DEPTH,
	render: {
		indent: '\t',
		maxDepth: Infinity,
		colorize: true,
		supportsAnsi: true,
	},
	inspect: {
		colors: true,
		depth: 12,
		maxArrayLength: 50,
		maxStringLength: 2000,
	},
}

/**
 * 与正式管线一致：求值结果先 `serializeArgSnapshot` 再包成**单条** `kind: 'value'` 片段，
 * 经 `renderAnsi` / `renderPlain` / `renderHtml` 从**同一份快照**派生各视图
 *（另用 `util.inspect` 作 Node 侧参照，不经过片段）。
 * @param {unknown} value - 任意求值结果。
 * @param {number} [snapshotMaxDepth=DEFAULT_SNAPSHOT_DEPTH] - 快照序列化深度。
 * @returns {import('../src/shared.d.mts').LogSegment[]} 单元素数组：`kind: 'value'` + `serializeArgSnapshot` 快照。
 */
function valueToSegments(value, snapshotMaxDepth = DEFAULT_SNAPSHOT_DEPTH) {
	return [{
		kind: 'value',
		snapshot: serializeArgSnapshot(value, { maxDepth: snapshotMaxDepth }),
	}]
}

/**
 * 将单次求值结果按与正式管线相同的方式打印（片段 → ANSI / plain / HTML），并附带 `util.inspect` 对照。
 * @param {unknown} value - 求值结果。
 * @param {typeof replOptions} [options=replOptions] - 渲染配置（REPL 内可直接修改）。
 */
function displayEvalResult(value, options = replOptions) {
	const segments = valueToSegments(value, options.snapshotMaxDepth)
	nativeLog(HEADER.evalAnsi)
	nativeLog(renderAnsi(segments, {
		colorize: options.render.colorize,
		indent: options.render.indent,
		maxDepth: options.render.maxDepth,
	}))
	nativeLog(HEADER.evalPlain)
	nativeLog(renderPlain(segments, {
		indent: options.render.indent,
		maxDepth: options.render.maxDepth,
	}))
	nativeLog(HEADER.evalHtml)
	nativeLog(renderHtml(segments, {
		supportsAnsi: options.render.supportsAnsi,
		indent: options.render.indent,
		maxDepth: options.render.maxDepth,
	}))
	nativeLog(HEADER.inspect)
	nativeLog(util.inspect(value, options.inspect))
}

/**
 * 与 `console.log` 相同的参数语义：`buildArgsSegments`；首参为 string 时解析占位符。
 * @param {...unknown} args - 与 `console.log` 一致。
 */
function segmentLog(...args) {
	logWasCalledThisEval = true
	const segments = buildArgsSegments(args, null, DEFAULT_SNAPSHOT_DEPTH)
	nativeLog(HEADER.ansi)
	nativeLog(renderAnsi(segments, { colorize: true }))
	nativeLog(HEADER.plain)
	nativeLog(renderPlain(segments))
	nativeLog(HEADER.html)
	nativeLog(renderHtml(segments, { supportsAnsi: true }))
	nativeLog(HEADER.nativeLog)
	nativeLog(...args)
}

/**
 * REPL 的 `writer`：同步值经 `displayEvalResult` 输出多段对照；`Promise` 在 settled 后异步打印；返回给 REPL 的均为简短状态串。
 * @param {unknown} output - REPL 求值结果。
 * @returns {string} 返回到 REPL 的简短提示（详细已由 `displayEvalResult` 打印）。
 */
function replWriter(output) {
	if (output != null && typeof /** @type {{ then?: unknown }} */ output.then === 'function') {
		Promise.resolve(output).then(
			(v) => {
				if (!(v === undefined && logWasCalledThisEval)) displayEvalResult(v)
				nativeLog('\x1b[2m(Promise fulfilled)\x1b[0m')
			},
			(e) => nativeLog('\x1b[31m(Promise rejected)\x1b[0m', e),
		)
		return '\x1b[2m[Promise]\x1b[0m'
	}
	if (output === undefined && logWasCalledThisEval)
		return '\x1b[2m(see blocks above)\x1b[0m'

	displayEvalResult(output)
	return '\x1b[2m(see blocks above)\x1b[0m'
}

nativeLog('\x1b[1mvirtual-console segment REPL\x1b[0m')
nativeLog('· 输入表达式求值：结果会以「快照片段 → ANSI / plain / HTML」与 `util.inspect` 对照输出。')
nativeLog('· 使用 \x1b[33mlog(...args)\x1b[0m：与 console.log 相同参数规则；首参为 string 时解析 % 占位符。')
nativeLog('· 可直接修改 \x1b[33moptions\x1b[0m（如 `options.render.indent = "  "` / `options.render.maxDepth = 5` / `options.snapshotMaxDepth = 3`）。')
nativeLog('· 退出：\x1b[33m.exit\x1b[0m 或 Ctrl+D。\n')

const r = repl.start({
	prompt: 'vc> ',
	writer: replWriter,
})

const defaultEval = r.eval.bind(r)
/**
 * 重写 REPL `eval` 方法：每次求值前清零 `logWasCalledThisEval`。
 * @param {string} cmd - 求值命令。
 * @param {unknown} context - 求值上下文。
 * @param {string} filename - 求值文件名。
 * @param {() => void} callback - 求值回调。
 * @returns {unknown} 求值结果。
 */
r.eval = (cmd, context, filename, callback) => {
	logWasCalledThisEval = false
	return defaultEval(cmd, context, filename, callback)
}

r.context.log = segmentLog
r.context.options = replOptions
