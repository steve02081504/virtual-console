import { Buffer } from 'node:buffer'
import { Writable } from 'node:stream'

import { getStackInfo, trimLeadingRuntimeInternalFrames } from '../../core/stack.mjs'

/**
 * WeakMap 用于存储每个流对应的 resize 监听器信息。
 * @type {WeakMap<import('node:stream').Writable, { listener: () => void, virtualStreams: Set<WeakRef<import('node:stream').Writable>> }>}
 */
const streamResizeListeners = new WeakMap()

/**
 * FinalizationRegistry 用于清理虚拟流引用。
 */
const virtualStreamCleanupRegistry = new FinalizationRegistry(({ stream, virtualStreamRef }) => {
	const listenerInfo = streamResizeListeners.get(stream)
	if (!listenerInfo) return
	listenerInfo.virtualStreams.delete(virtualStreamRef)
	if (listenerInfo.virtualStreams.size) return
	stream.off?.('resize', listenerInfo.listener)
	streamResizeListeners.delete(stream)
})

/**
 * 获取或创建一个流对应的监听器信息。
 * @param {import('node:stream').Writable} stream - 目标流。
 * @returns {{ listener: () => void, virtualStreams: Set<WeakRef<import('node:stream').Writable>> }} 监听器信息。
 */
function getListenerInfo(stream) {
	const existing = streamResizeListeners.get(stream)
	if (existing) return existing
	const listenerInfo = {
		/**
		 * 统一的 resize 监听器，会通知所有使用该流的虚拟流。
		 * @returns {void}
		 */
		listener: () => {
			for (const ref of listenerInfo.virtualStreams) {
				const virtualStream = ref.deref()
				if (virtualStream) try { virtualStream.emit?.('resize') } catch (error) { console.error(error) }
				else listenerInfo.virtualStreams.delete(ref)
			}
			if (listenerInfo.virtualStreams.size) return
			stream.off?.('resize', listenerInfo.listener)
			streamResizeListeners.delete(stream)
		},
		virtualStreams: new Set()
	}
	stream.on?.('resize', listenerInfo.listener)

	streamResizeListeners.set(stream, listenerInfo)
	return listenerInfo
}

/**
 * 虚拟流类，用于创建虚拟控制台流。
 * @augments {Writable}
 */
export class VirtualStream extends Writable {
	/**
	 * 包装真实 `stdout`/`stderr` Writable：写入时合并或新建流式 `LogEntry`，并可透传到底层流。
	 * @param {import('node:stream').Writable} targetStream - 目标流。
	 * @param {string} streamName - 流名称。
	 * @param {object} context - 虚拟控制台上下文。
	 * @param {() => void} context.onWrite - 写入时的回调函数，用于重置 lastFreshLineId。
	 * @param {object} context.options - 虚拟控制台的配置选项。
	 * @param {boolean} context.options.recordOutput - 是否记录输出。
	 * @param {boolean} context.options.realConsoleOutput - 是否输出到真实控制台。
	 * @param {{ outputs: string }} context.state - 虚拟控制台的状态对象，包含 outputs 属性。
	 */
	constructor(targetStream, streamName, context) {
		super({
			/**
			 * 写入数据到虚拟流。
			 * @param {Buffer | string} chunk - 要写入的数据块。
			 * @param {string} encoding - 编码格式。
			 * @param {() => void} callback - 写入完成的回调函数。
			 */
			write: (chunk, encoding, callback) => {
				context.onWrite(chunk, encoding, streamName)

				if (context.options.recordOutput) try {
					context.state.stackFrameSkipCount++
					const text = chunk instanceof Buffer ? chunk.toString(encoding === 'buffer' ? 'utf8' : encoding) : String(chunk)
					context.addEntry(streamName, [text], trimLeadingRuntimeInternalFrames(getStackInfo(context.state.stackFrameSkipCount + 1)))
				} finally { context.state.stackFrameSkipCount-- }
				if (context.options.realConsoleOutput)
					targetStream.write(chunk, encoding, callback)
				else callback()
			},
		})

		this.#targetStream = targetStream

		if (targetStream.isTTY) {
			const virtualStreamRef = new WeakRef(this)
			const listenerInfo = getListenerInfo(targetStream)
			listenerInfo.virtualStreams.add(virtualStreamRef)
			virtualStreamCleanupRegistry.register(this, {
				stream: targetStream,
				virtualStreamRef
			})
		}
	}

	/**
	 * 底层真实可写流（透传 TTY 能力）。
	 * @private @type {import('node:stream').Writable}
	 */
	#targetStream

	/**
	 * 判断目标流是否为 TTY
	 * @returns {boolean} 是否为 TTY
	 */
	get isTTY() {
		return this.#targetStream?.isTTY ?? false
	}

	/**
	 * 获取目标流的列数
	 * @returns {number} 列数
	 */
	get columns() {
		return this.#targetStream.columns
	}

	/**
	 * 获取目标流的行数
	 * @returns {number} 行数
	 */
	get rows() {
		return this.#targetStream.rows
	}

	/**
	 * 获取目标流的颜色深度
	 * @returns {number} 颜色深度
	 */
	getColorDepth() {
		return this.#targetStream.getColorDepth()
	}

	/**
	 * 判断目标流是否支持颜色
	 * @returns {boolean} 是否支持颜色
	 */
	hasColors() {
		return this.#targetStream.hasColors()
	}

	/**
	 * 获取底层目标流。
	 * @returns {import('node:stream').Writable} 底层目标流。
	 */
	get targetStream() {
		return this.#targetStream
	}
}
