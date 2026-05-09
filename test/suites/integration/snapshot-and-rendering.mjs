import util from 'node:util'
import vm from 'node:vm'

import {
	newLogEntry,
	VirtualConsole,
	DEFAULT_SNAPSHOT_DEPTH,
	buildArgsSegments,
	expandSnapshotRef,
	renderAnsi,
	renderHtml,
	renderPlain,
	serializeArgSnapshot,
} from '@steve02081504/virtual-console'

import { pathToFileURL } from '../../../src/core/stack.mjs'
import { parseCssDecls } from '../../../src/format/css-to-ansi.mjs'
import { applyExpandedSnapshotsInSegments } from '../../../src/wire/expand-wire-segments.mjs'
import { assert, assertEqual, assertIncludes, runTestGroup } from '../../harness.mjs'

/**
 * printf 风格参数转 plain 文本。
 * @param {unknown[]} args - console 参数列表。
 * @returns {string} 渲染后的纯文本。
 */
function renderPrintfPlain(args) {
	return renderPlain(buildArgsSegments(args, null, DEFAULT_SNAPSHOT_DEPTH))
}

/**
 * 验证 Windows 盘符路径转 file URL 时不会错误编码盘符冒号。
 */
function testPathToFileURLWindowsDriveUnescapedColon() {
	console.log('\n=== [pathToFileURL：Windows 盘符 URL] ===')
	const url = pathToFileURL('C:/Users/foo bar')
	assert(url.startsWith('file:///C:/'), 'file URL 应以 file:///C:/ 为前缀')
	assert(!url.includes('C%3A'), '盘符不应被误编成 C%3A')
	assert(url.includes('foo%20bar'), '空格应编码为 %20')
}

/**
 * 验证 4 位十六进制颜色中的 alpha 会触发 dim 标记。
 */
function testCssHex4DigitAlphaDim() {
	console.log('\n=== [CSS #RGBA 四位 hex → dim] ===')
	const flags = parseCssDecls('color: #1234')
	assert(flags.dim === true, '#1234 含非不透明 alpha 时须 dim')
}

/**
 * 覆盖 printf 参数在 plain 渲染下的边界行为。
 */
function testRenderPrintfPlain() {
	console.log('\n=== [renderPrintfPlain（printf→plain）] ===')
	assertEqual(renderPrintfPlain([]), '', '空参数返回空字符串')
	assertEqual(renderPrintfPlain(['hello']), 'hello', '单字符串正确返回')
	assertEqual(renderPrintfPlain(['%s', 'world']), 'world', '%s 格式化正确')
	assertEqual(renderPrintfPlain(['%d', 42]), '42', '%d 格式化正确')
	assertEqual(renderPrintfPlain(['%f', 3.14]), '3.14', '%f 格式化正确')
	assertEqual(renderPrintfPlain(['%f', Symbol('x')]), 'NaN', '%f 对 Symbol 返回 NaN')
	assertEqual(renderPrintfPlain(['%d', Symbol('x')]), 'NaN', '%d 对 Symbol 返回 NaN')
	assertEqual(renderPrintfPlain(['value: %s', 'test']), 'value: test', '字符串中插值正确')
	assert(typeof renderPrintfPlain(['a', 'b', 'c']) === 'string', '多参数返回字符串')
	assert(typeof renderPrintfPlain([{ key: 'value' }]) === 'string', '对象参数返回字符串')
	const circular = { name: 'self' }; circular.self = circular
	const circularResult = renderPrintfPlain(['%o', circular])
	assert(typeof circularResult === 'string', '循环对象通过 %o 格式化后返回字符串')
	assert(circularResult.length > 0, '循环对象通过 %o 格式化后不抛错且有输出')
	const err = new Error('virtual-console printf edge-case error')
	const errResult = renderPrintfPlain([err])
	assertIncludes(errResult, 'Error: virtual-console printf edge-case error', 'Error 参数格式化结果包含错误类型与消息')
	assertIncludes(errResult, 'at ', 'Error 参数格式化结果包含堆栈信息')
	const traceEntry = newLogEntry({
		method: 'trace',
		args: ['trace label'],
		stack: [{ functionName: 'testFormatArgs', filePath: 'test.mjs', line: 250, column: 10, raw: '    at testFormatArgs (test.mjs:250:10)' }],
		supportsAnsi: false,
	})
	const traceResult = renderPrintfPlain([traceEntry])
	assertIncludes(traceResult, 'debug', 'renderPrintfPlain(LogEntry) 文本包含 level 语义')
	assertIncludes(traceResult, 'trace', 'renderPrintfPlain(LogEntry) 文本含 method 信息')
	assertIncludes(traceEntry.toString(), 'trace label', 'LogEntry trace toString 含消息')
	assertIncludes(traceResult, 'testFormatArgs', 'renderPrintfPlain 结果含栈帧函名信息')
}

/**
 * 验证跨 realm 值的快照类型与渲染行为。
 */
function testCrossRealmSnapshotKinds() {
	console.log('\n=== [跨 realm 快照类型识别] ===')
	const crossRealmDate = vm.runInNewContext('new Date("2026-05-04T13:32:05.473Z")')
	const dateSnap = serializeArgSnapshot(crossRealmDate)
	assertEqual(dateSnap.kind, 'Date', '跨 realm Date.kind')
	assertEqual(dateSnap.value, '2026-05-04T13:32:05.473Z', '跨 realm Date.value 为 ISO')
	assert(renderAnsi([{ kind: 'value', snapshot: dateSnap }], { colorize: true }).includes('\x1b[35m'), '跨 realm Date ANSI 为紫色')
	const crossRealmRegExp = vm.runInNewContext('/as/')
	const regSnap = serializeArgSnapshot(crossRealmRegExp)
	assertEqual(regSnap.kind, 'RegExp', '跨 realm RegExp.kind')
	assertEqual(regSnap.value, '/as/', '跨 realm RegExp.value')
	assert(renderAnsi([{ kind: 'value', snapshot: regSnap }], { colorize: true }).includes('\x1b[31m'), '跨 realm RegExp ANSI 为红色')
	const crossNum = vm.runInNewContext('new Number(0)')
	const numSnap = serializeArgSnapshot(crossNum)
	assertEqual(numSnap.kind, 'Number', '跨 realm 装箱 Number.kind')
	assertEqual(renderPlain([{ kind: 'value', snapshot: numSnap }]), util.inspect(crossNum, { colors: false }), '装箱 Number plain 与 util.inspect 一致')
}

/**
 * 验证字符串字面量引号选择与 util.inspect 对齐。
 */
function testStringLiteralQuoteParity() {
	console.log('\n=== [字符串字面量引号策略] ===')
	const value = '\\ba\n\n\'\''
	const snap = serializeArgSnapshot(value)
	assertEqual(renderPlain([{ kind: 'value', snapshot: snap }]), util.inspect(value, { colors: false }), 'value snapshot plain 与 util.inspect 一致')
}

/**
 * 验证循环引用与共享子对象的快照渲染一致性。
 */
function testCircularSnapshotParity() {
	console.log('\n=== [循环引用快照 vs util.inspect] ===')
	const ring = {}; ring.a = ring
	assertEqual(renderPlain([{ kind: 'value', snapshot: serializeArgSnapshot(ring) }]), util.inspect(ring, { colors: false }), 'a.a=a 式自环与 util.inspect 一致')
	const selfRef = {}; selfRef.loop = selfRef
	assertEqual(renderPlain([{ kind: 'value', snapshot: serializeArgSnapshot(selfRef) }]), util.inspect(selfRef, { colors: false }), '自环属性名非 a 时仍一致')
	const inner = {}; const dagShared = { u: inner, v: inner }
	assertEqual(renderPlain([{ kind: 'value', snapshot: serializeArgSnapshot(dagShared) }]), util.inspect(dagShared, { colors: false }), '无环 DAG 共享子对象与 util.inspect 一致')
	const cycle = {}; cycle.a = cycle
	const proxiedCycle = new Proxy(cycle, {
		/**
		 * 测试专用 get：固定返回 1。
		 * @returns {number} 固定值 1。
		 */
		get: () => 1,
	})
	assertEqual(renderPlain([{ kind: 'value', snapshot: serializeArgSnapshot(proxiedCycle) }]), util.inspect(proxiedCycle, { colors: false }), 'Proxy 包自环：描述符取值与 util.inspect 一致')
	const ac = /** @type {{ a: object, b: number }} */ {}
	ac.a = ac; ac.b = 3
	const transparent = new Proxy(ac, {
		/**
		 * 透明转发 get。
		 * @param {object} t - 目标对象。
		 * @param {string | symbol} k - 属性键。
		 * @param {unknown} r - receiver。
		 * @returns {unknown} 反射读取值。
		 */
		get: (t, k, r) => Reflect.get(t, k, r),
	})
	assertEqual(renderPlain([{ kind: 'value', snapshot: serializeArgSnapshot(transparent) }]), util.inspect(transparent, { colors: false }), '透明转发 Proxy：根级 <ref> 与 util.inspect 一致')
}

/**
 * 验证 class 构造函数快照渲染与 util.inspect 一致。
 */
function testClassSnapshotParity() {
	console.log('\n=== [class 快照渲染] ===')
	const named = vm.runInNewContext('class a{}; a')
	assertEqual(renderPlain([{ kind: 'value', snapshot: serializeArgSnapshot(named) }]), util.inspect(named, { colors: false }), '具名 class plain 与 util.inspect 一致')
	const anonymous = vm.runInNewContext('(class {})')
	assertEqual(renderPlain([{ kind: 'value', snapshot: serializeArgSnapshot(anonymous) }]), util.inspect(anonymous, { colors: false }), '匿名 class plain 与 util.inspect 一致')
}

/**
 * 验证 Error 首行不会被重复拼接。
 */
function testErrorStackNoDuplicate() {
	console.log('\n=== [Error 快照去重] ===')
	let syntaxErr = null
	try { vm.runInNewContext('class a{}; class a{}') } catch (e) { syntaxErr = e }
	assert(!!syntaxErr && typeof syntaxErr === 'object' && syntaxErr.name === 'SyntaxError', '应捕获到 SyntaxError')
	const plain = renderPlain([{ kind: 'value', snapshot: serializeArgSnapshot(syntaxErr) }])
	const needle = `SyntaxError: ${syntaxErr.message}`
	assertEqual(plain.split(needle).length - 1, 1, 'SyntaxError 首行不重复')
}

/**
 * 验证 Error 的 ANSI 渲染包含颜色与可点击栈链接。
 */
function testErrorSnapshotAnsiRich() {
	console.log('\n=== [Error 快照 ANSI 增强] ===')
	const err = new Error('vc-peek-error-message')
	const ansi = renderAnsi([{ kind: 'value', snapshot: serializeArgSnapshot(err) }], { colorize: true })
	assert(ansi.includes('\x1b[31m'), 'Error message 段含红色')
	assert(ansi.includes('vc-peek-error-message'), '保留 message 原文')
	assert(ansi.includes('\x1b]8;;'), '栈路径含 OSC8 超链接')
}

/**
 * 验证 Error 快照结构使用已解析的 stack 帧数组。
 */
function testErrorSnapshotStackFramesShape() {
	console.log('\n=== [Error 快照：解析 stack 数组] ===')
	const snap = serializeArgSnapshot(new Error('shape-check'))
	assertEqual(snap.kind, 'Error', 'kind')
	assert(typeof snap.stack !== 'string', '不存原始 stack 字符串')
	assert(Array.isArray(snap.stack), 'stack 为解析帧数组')
	assert(snap.stack.length > 0, '有解析帧')
	const first = snap.stack[0]
	assert(first && typeof first.raw === 'string' && first.raw.length > 0, '首帧含 raw')
	assert(!/^\w+Error:\s/.test(first.raw.trim()), '首帧不是 Error: 标题行')
}

/**
 * 验证无栈 Error 快照使用中括号整段展示。
 */
function testErrorSnapshotNoStackBrackets() {
	console.log('\n=== [Error 无栈：整段中括号] ===')
	const snap = { kind: 'Error', name: 'ReferenceError', message: 'exit is not defined', stack: [] }
	const plain = renderPlain([{ kind: 'value', snapshot: snap }])
	assertEqual(plain.trim(), '[ReferenceError: exit is not defined]', 'plain 整段包在中括号内')
	const ansi = renderAnsi([{ kind: 'value', snapshot: snap }], { colorize: true })
	assertIncludes(ansi, '[', 'ANSI 含左括号')
	assertIncludes(ansi, 'ReferenceError', 'ANSI 含类型名')
	assertIncludes(ansi, 'exit is not defined', 'ANSI 含 message')
}

/**
 * 验证 renderPrintfPlain 与 buildArgsSegments 的核心一致性。
 */
function testPrintfDispatchParity() {
	console.log('\n=== [printf 核心一致性] ===')
	const args = ['[%s:%d]', 'a', 1]
	assertEqual(renderPrintfPlain(args), '[a:1]', 'renderPrintfPlain 多占位（无独立空格段）')
	assertEqual(renderPlain(buildArgsSegments(args)), '[a:1]', 'buildArgsSegments → renderPlain 与 renderPrintfPlain 一致（独立空格段会被 strip 剥除，故用冒号模板）')
	assertEqual(renderPrintfPlain(['%%']), '%%', '单实参字符串：与 util.format 一致，不解析 %%')
	assertEqual(renderPlain(buildArgsSegments(['%%'])), '%%', '单实参 segments 与 native log 同为字面 %%')
}

/**
 * 验证 %c CSS 到 ANSI SGR 的映射行为。
 */
function testPrintfCssAnsiMapping() {
	console.log('\n=== [%c → ANSI（真彩色与 SGR）] ===')
	const segs = buildArgsSegments(['%ca', 'color: red'], null, DEFAULT_SNAPSHOT_DEPTH)
	const ansi = renderAnsi(segs, { colorize: true })
	assertIncludes(ansi, '\x1b[38;2;255;0;0m', 'color:red → 38;2;255;0;0')
	assertIncludes(ansi, 'a', '可见文本保留')
	assertIncludes(ansi, '\x1b[0m', '段末 SGR 重置')
	assert(renderPlain(segs) === 'a' && !/\x1b/.test(renderPlain(segs)), 'renderPlain 无转义、仅 a')
	assertEqual(renderAnsi(segs, { omitPrintfCss: true }), 'a', 'omitPrintfCss 不注入真彩色')
	assertIncludes(renderAnsi(buildArgsSegments(['%cx', 'font-style:italic;font-weight:bold;text-decoration:underline'], null, DEFAULT_SNAPSHOT_DEPTH), { colorize: true }), '\x1b[1;3;4m', '粗体+斜体+下划线合并为单条 SGR')
	assertIncludes(renderAnsi(buildArgsSegments(['%cy', 'text-decoration: line-through; color: navy'], null, DEFAULT_SNAPSHOT_DEPTH), { colorize: true }), '\x1b[9;38;2;0;0;128m', '删除线 + navy 真彩色同序列')
	assertIncludes(renderAnsi(buildArgsSegments(['%cd', 'opacity:0.5;color:red'], null, DEFAULT_SNAPSHOT_DEPTH), { colorize: true }), '\x1b[2;38;2;255;0;0m', 'opacity∈(0,1) → SGR2 + 前景色')
	assertIncludes(renderAnsi(buildArgsSegments(['%ce', 'color:rgba(0,255,0,0.6)'], null, DEFAULT_SNAPSHOT_DEPTH), { colorize: true }), '\x1b[2;38;2;0;255;0m', 'rgba 半透明 → dim + rgb')
	assertEqual(renderAnsi(buildArgsSegments(['%cf', 'font-weight: lighter'], null, DEFAULT_SNAPSHOT_DEPTH), { colorize: true }), '\x1b[2mf\x1b[0m', 'font-weight:lighter → SGR2')
	assertIncludes(renderAnsi(buildArgsSegments(['%cz', 'color: rebeccapurple'], null, DEFAULT_SNAPSHOT_DEPTH), { colorize: true }), '\x1b[38;2;102;51;153m', '命名色 rebeccapurple（color-name）')
	assertIncludes(renderAnsi(buildArgsSegments(['%cg', 'color: grey'], null, DEFAULT_SNAPSHOT_DEPTH), { colorize: true }), '\x1b[38;2;128;128;128m', '命名 grey 与 gray 一致')
}

/**
 * 验证 renderPlain / renderHtml 的基础输出行为。
 */
function testRenderPlainHtmlOptions() {
	console.log('\n=== [renderPlain / renderHtml 顶层 API] ===')
	const segments = [{ kind: 'text', text: 'hello' }]
	assertEqual(renderPlain(segments), 'hello', 'renderPlain')
	assertIncludes(renderHtml(segments, {}), 'hello', 'renderHtml')
}

/**
 * 验证 HTML trace 链接可由 resolveTraceFrameHref 覆盖。
 */
function testResolveTraceFrameHref() {
	console.log('\n=== [HTML resolveTraceFrameHref] ===')
	const html = renderHtml([{
		kind: 'trace',
		stack: [{ functionName: 'f', filePath: '/x.mjs', line: 1, column: 0, raw: 'at f (/x.mjs:1:0)' }],
	}], {
		/**
		 * 自定义 trace 链接目标。
		 * @returns {string} 自定义 href。
		 */
		resolveTraceFrameHref: () => 'https://example.com/custom',
	})
	assertIncludes(html, 'https://example.com/custom', '自定义 trace 链接 href')
}

/**
 * 验证 trace 条目 toSegments 使用结构化栈帧数组（与 LogEntry#stack 同源），而非 ArgSnapshot。
 */
function testTraceSegmentUsesStructuredStack() {
	console.log('\n=== [trace 片段：结构化 stack] ===')
	const frames = [{ functionName: 'g', filePath: 'z.mjs', line: 2, column: 3, raw: '  at g (z.mjs:2:3)' }]
	const traceEntry = newLogEntry({
		method: 'trace',
		args: ['label'],
		stack: frames,
		supportsAnsi: false,
	})
	const traceSeg = traceEntry.toSegments().find(s => s.kind === 'trace')
	assert(traceSeg != null && traceSeg.kind === 'trace', '存在 trace 段')
	assert(traceSeg.stack === frames, 'trace.stack 与条目 stack 同源引用')
	assert(!Object.prototype.hasOwnProperty.call(traceSeg, 'snapshot'), 'trace 段不应含 snapshot 字段')
}

/**
 * 验证 trace 片段在 plain / ANSI 渲染下的输出。
 */
function testRenderTraceSegmentAnsiAndPlain() {
	console.log('\n=== [trace 片段：ANSI / plain 渲染] ===')
	const stack = [{ functionName: '', filePath: '/tmp/a.mjs', line: 10, column: 1, raw: 'at (/tmp/a.mjs:10:1)' }]
	const segments = [{ kind: 'trace', stack }]
	assertEqual(renderPlain(segments), stack[0].raw, 'plain 为 raw 行拼接')
	const ansiOn = renderAnsi(segments, { colorize: true })
	assertIncludes(ansiOn, '\x1b]8;;', '可链接帧含 OSC8')
	const ansiOff = renderAnsi(segments, { colorize: false })
	assert(!/\x1b]8;;/.test(ansiOff), '关闭着色时不注入 OSC8')
}

/**
 * 验证 wire 侧就地展开不会误把 trace 段当作快照根写入 snapshot。
 */
function testApplyExpandedSnapshotsPreservesTraceSegment() {
	console.log('\n=== [wire 展开：trace 段不参与快照槽位] ===')
	const segments = [{
		kind: 'trace',
		stack: [{ functionName: '', filePath: '', line: 0, column: 0, raw: 'at native' }],
	}]
	applyExpandedSnapshotsInSegments(segments, new Map())
	assert(!Object.prototype.hasOwnProperty.call(segments[0], 'snapshot'), 'trace 段不应出现 snapshot 字段')
	assertEqual(renderPlain(segments), 'at native', '展开后 plain 渲染不变')
}

/**
 * 验证 truncated 快照引用与 expandSnapshotRef 可用性。
 */
async function testTruncatedAndExpand() {
	console.log('\n=== [truncated 快照与 expandSnapshotRef] ===')
	let deep = { l: 'leaf' }
	for (let i = 0; i < 10; i++) deep = { nest: deep }
	const vc = new VirtualConsole({ recordOutput: true, realConsoleOutput: false })
	await vc.hookAsyncContext(() => { console.log(deep) })
	const segments = vc.outputEntries[0].toSegments()
	/**
	 * 在快照树中查找第一个 truncated ref。
	 * @param {unknown} snap - 当前快照节点。
	 * @returns {string} 找到的 ref，找不到则空串。
	 */
	function findTruncatedRef(snap) {
		if (!snap || typeof snap !== 'object') return ''
		const node = /** @type {Record<string, unknown>} */ snap
		if (node.kind === 'truncated' && typeof node.ref === 'string' && node.ref) return node.ref
		for (const child of Object.values(node)) { const found = findTruncatedRef(child); if (found) return found }
		return ''
	}
	let ref = ''
	for (const seg of segments) if (seg.kind === 'value') { ref = findTruncatedRef(seg.snapshot); if (ref) break }
	assert(ref.length > 0, 'toSegments 中含可展开 truncated.ref')
	const exp = expandSnapshotRef(ref)
	assert(exp.ok === true, 'expandSnapshotRef 成功')
	assert(exp.snapshot != null, '展开得到快照')
	const noCtx = serializeArgSnapshot(deep)
	/**
	 * 判断快照树中是否存在空 ref 的 truncated 节点。
	 * @param {unknown} snap - 当前快照节点。
	 * @returns {boolean} 是否存在空 ref。
	 */
	function hasTruncatedEmptyRef(snap) {
		if (!snap || typeof snap !== 'object') return false
		const node = /** @type {Record<string, unknown>} */ snap
		if (node.kind === 'truncated' && node.ref === '') return true
		return Object.values(node).some(child => hasTruncatedEmptyRef(child))
	}
	assert(hasTruncatedEmptyRef(noCtx), '无注册上下文时截断节点 ref 为空串')
	assertEqual(DEFAULT_SNAPSHOT_DEPTH, 5, '默认快照深度为 5')
}

/**
 * 运行“快照与渲染一致性”分组测试。
 */
export async function runSnapshotAndRenderingTests() {
	await runTestGroup('快照与渲染一致性', [
		testRenderPrintfPlain,
		testPrintfDispatchParity,
		testPrintfCssAnsiMapping,
		testRenderPlainHtmlOptions,
		testResolveTraceFrameHref,
		testTraceSegmentUsesStructuredStack,
		testRenderTraceSegmentAnsiAndPlain,
		testApplyExpandedSnapshotsPreservesTraceSegment,
		testCrossRealmSnapshotKinds,
		testStringLiteralQuoteParity,
		testCircularSnapshotParity,
		testClassSnapshotParity,
		testErrorStackNoDuplicate,
		testErrorSnapshotAnsiRich,
		testErrorSnapshotStackFramesShape,
		testErrorSnapshotNoStackBrackets,
		testTruncatedAndExpand,
		testPathToFileURLWindowsDriveUnescapedColon,
		testCssHex4DigitAlphaDim,
	])
}
