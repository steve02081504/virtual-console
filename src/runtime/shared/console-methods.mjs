/**
 * VirtualConsole 方法分组与采栈偏移常量。
 */

/**
 * `#dispatch` → `#capture` → `new Error()` 相对用户调用点的栈顶丢弃量
 *（`parseErrorStack` 内 runtime 对 Error 标题行的隐式 +1 另计）：
 * `#capture`、`#dispatch`、方法箭头（`VirtualConsoleBase.<computed>`）。
 */
export const CONSOLE_CALL_STACK_SKIP = 3

/**
 * 流写入路径相对用户调用点的栈顶丢弃量：
 * `#capture`、`#ingestChunk`、VirtualStream `onWrite` 回调、`VirtualStream.write`；
 * 其后的 `node:internal/streams` 帧由 `StreamLogEntry#stack` 裁掉。
 */
export const STREAM_WRITE_STACK_SKIP = 4

/** 与 Node `console.log` 等对齐、需要缓冲记录的一组方法。 */
export const RECORDABLE_CONSOLE_METHODS = ['log', 'info', 'warn', 'debug', 'error', 'trace', 'dir']

/** 透传方法：Node 走 `Console` 原型并由流路径记录；浏览器在 `realConsoleOutput` 时转发 base。 */
export const PASSTHROUGH_CONSOLE_METHODS = [
	'table', 'assert', 'count', 'countReset', 'time', 'timeLog', 'timeEnd',
	'group', 'groupCollapsed', 'groupEnd',
]

/**
 * 构造时需 `bind(this)` 的实例方法（经全局 `console` 代理取出后仍指向本实例）。
 */
export const BOUND_INSTANCE_METHODS = [
	'freshLine', 'clear', 'writeAs', 'block', 'unblock',
	'addLogEntryListener', 'removeLogEntryListener',
	'addClearListener', 'removeClearListener',
]

/**
 * 无需 `baseConsole` 同名方法、由 `emitNative` 自行渲染的伪方法。
 * 快路径据此判断可否不建带栈条目而直接 `newLogEntry` 后原生输出。
 */
export const PLATFORM_EMITTED_METHODS = ['stdout', 'stderr', 'freshLine']
