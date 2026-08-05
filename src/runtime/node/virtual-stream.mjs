import { Writable } from 'node:stream'

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
		virtualStreams: new Set(),
	}
	stream.on?.('resize', listenerInfo.listener)
	streamResizeListeners.set(stream, listenerInfo)
	return listenerInfo
}

/**
 * 虚拟流：Writable 外壳 + TTY 属性透传；写入策略由控制台回调决定。
 * @augments {Writable}
 */
export class VirtualStream extends Writable {
	/**
	 * @param {import('node:stream').Writable} targetStream - 用于 TTY 属性透传的底层流。
	 * @param {(chunk: Buffer | string, encoding: string, callback: (error?: Error | null) => void) => void} onWrite - 控制台写入回调。
	 */
	constructor(targetStream, onWrite) {
		super({
			/**
			 * 将写入委托给控制台回调，由上层决定记录与转发策略。
			 * @param {Buffer | string} chunk - 待写入数据块。
			 * @param {string} encoding - 编码名。
			 * @param {(error?: Error | null) => void} callback - 写入完成回调。
			 * @returns {void}
			 */
			write: (chunk, encoding, callback) => onWrite(chunk, encoding, callback),
		})
		this.#targetStream = targetStream

		if (targetStream.isTTY) {
			const virtualStreamRef = new WeakRef(this)
			getListenerInfo(targetStream).virtualStreams.add(virtualStreamRef)
			virtualStreamCleanupRegistry.register(this, {
				stream: targetStream,
				virtualStreamRef,
			})
		}
	}

	/**
	 * @type {import('node:stream').Writable}
	 */
	#targetStream

	/** @returns {boolean} 底层流是否为 TTY。 */
	get isTTY() {
		return this.#targetStream?.isTTY ?? false
	}

	/** @returns {number} 终端列宽；非 TTY 时由底层流决定。 */
	get columns() {
		return this.#targetStream.columns
	}

	/** @returns {number} 终端行高；非 TTY 时由底层流决定。 */
	get rows() {
		return this.#targetStream.rows
	}

	/** @returns {number} 颜色位深，透传底层 `getColorDepth()`。 */
	getColorDepth() {
		return this.#targetStream.getColorDepth()
	}

	/** @returns {boolean} 是否支持彩色输出，透传底层 `hasColors()`。 */
	hasColors() {
		return this.#targetStream.hasColors()
	}

	/** @returns {import('node:stream').Writable} 用于 TTY 属性透传的底层流。 */
	get targetStream() {
		return this.#targetStream
	}
}
