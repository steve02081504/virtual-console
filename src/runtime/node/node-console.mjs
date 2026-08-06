import { AsyncLocalStorage } from 'node:async_hooks'
import { Console } from 'node:console'
import process from 'node:process'
import { Writable } from 'node:stream'

import supportsAnsi from 'supports-ansi'

import { createConsoleRouting, createGlobalConsoleProxy } from '../shared/console-routing.mjs'
import { VirtualConsoleMixin } from '../shared/virtual-console.mjs'

import {
	emitNative,
	streamTable,
	writeNativeChunk,
} from './native-output.mjs'
import { VirtualStream } from './virtual-stream.mjs'

/**
 * Node 运行时：`VirtualConsole`、`AsyncLocalStorage` 与全局 `console` 代理。
 */

/**
 * Node 异步上下文槽位。
 * @type {AsyncLocalStorage<VirtualConsole>}
 */
export const consoleAsyncStorage = new AsyncLocalStorage()

/**
 * 构造丢弃所有写入的占位 `Writable`，供 `Console` 基类构造使用。
 * 每实例传两个独立流：Node `Console` 会对同一 Writable 挂多个监听，共用一个会触发 MaxListeners 警告。
 * @returns {import('node:stream').Writable} 写入即完成、不落地的流。
 */
const createDiscardStream = () => new Writable({
	/**
	 * 忽略写入内容，仅调用 `callback` 表示完成。
	 * @param {Buffer | string} _chunk - 被丢弃的数据块。
	 * @param {string} _encoding - 编码名。
	 * @param {(error?: Error | null) => void} callback - 写入完成回调。
	 * @returns {void}
	 */
	write(_chunk, _encoding, callback) { callback() },
})

const originalConsole = globalThis.console
// 钉死到 hook 前的原生流，避免之后 `process.stdout` getter 让透传再绕回虚拟流。
originalConsole._stdout = streamTable.stdout
originalConsole._stderr = streamTable.stderr

const routing = createConsoleRouting({
	/** @returns {VirtualConsole | undefined} 当前 `AsyncLocalStorage` 槽位。 */
	getActiveConsole: () => consoleAsyncStorage.getStore(),
	/**
	 * 将后续同异步上下文内的 `console.*` 绑定到指定实例。
	 * @param {VirtualConsole} value - 活动控制台。
	 * @returns {void}
	 */
	setActiveConsole: (value) => consoleAsyncStorage.enterWith(value),
	/**
	 * 在 `callback` 执行期间将 `value` 存入 `AsyncLocalStorage`，结束后自动恢复。
	 * @param {VirtualConsole} value - 本次上下文使用的控制台。
	 * @param {() => any} callback - 在绑定上下文中执行的回调。
	 * @returns {any} `callback` 的返回值。
	 */
	runWithActiveConsole: (value, callback) => consoleAsyncStorage.run(value, callback),
}, () => defaultConsole)

const nodePlatform = {
	routing,
	emitNative,
	/**
	 * 构造绑定原生流的虚拟输出流。
	 * @param {'stdout' | 'stderr'} streamName - 流名。
	 * @param {(chunk: any, encoding: string, callback: Function) => void} onWrite - 写入回调。
	 * @returns {VirtualStream} 绑定到对应原生流、经 `onWrite` 接入管线的虚拟流。
	 */
	createStream(streamName, onWrite) {
		return new VirtualStream(
			streamTable[streamName],
			onWrite,
		)
	},
	writeNativeChunk,
}

/**
 * Node 运行时 VirtualConsole（混入 `Console`）。
 * @augments {Console}
 */
export class VirtualConsole extends VirtualConsoleMixin(Console, nodePlatform) {
	/**
	 * @param {object} [options={}] - 配置选项。
	 * @param {boolean} [options.realConsoleOutput=false] - 是否将捕获输出转发到 `baseConsole` 或原生流。
	 * @param {boolean} [options.recordOutput=true] - 是否写入 `outputEntries`。
	 * @param {boolean} [options.supportsAnsi] - 是否保留 ANSI；默认继承 `baseConsole` 或 `supports-ansi` 探测。
	 * @param {Console} [options.baseConsole] - 透传目标；缺省时取当前活动控制台。
	 * @param {number} [options.maxLogEntries=Infinity] - `outputEntries` 上限，超出丢弃最旧条目。
	 */
	constructor(options = {}) {
		const baseConsole = options.baseConsole ?? routing.resolveActiveConsole()
		super({
			supportsAnsi: baseConsole.options?.supportsAnsi ?? supportsAnsi,
			...options,
			baseConsole,
		}, createDiscardStream(), createDiscardStream())

		for (const property of ['_stdout', '_stderr'])
			delete this[property]
	}
}

/**
 * 始终在线的兜底控制台：不记录任何条目，直接将所有输出透传到原始全局 `console`。
 */
export const defaultConsole = new VirtualConsole({
	baseConsole: originalConsole,
	recordOutput: false,
	realConsoleOutput: true,
})

/**
 * 注入自定义活动控制台解析器（测试或宿主接管全局 `console` 路由）。
 * @type {typeof routing.setGlobalConsoleResolver}
 */
export const setGlobalConsoleResolver = routing.setGlobalConsoleResolver
/**
 * 读取当前生效的路由三元组（`getActiveConsole` / `setActiveConsole` / `runWithActiveConsole`）。
 * @type {typeof routing.getGlobalConsoleResolver}
 */
export const getGlobalConsoleResolver = routing.getGlobalConsoleResolver

/**
 * 全局控制台实例。
 */
export const console = globalThis.console = createGlobalConsoleProxy({
	getActiveConsole: routing.resolveActiveConsole,
	originalConsole,
})

for (const streamName of Object.keys(streamTable))
	Object.defineProperty(process, streamName, {
		/** @returns {import('./virtual-stream.mjs').VirtualStream} 当前活动控制台的虚拟输出。 */
		get: () => routing.resolveActiveConsole()[`_${streamName}`],
		configurable: true,
	})
