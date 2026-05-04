/**
 * `printf-segments`：解析 `%` 格式串、将参数转为 `LogSegment[]`、单行格式化。
 */
export {
	collectPrintfFormatParts,
	buildArgsSegments,
	formatArgs,
} from './printf-segments.mjs'

/**
 * `stream-segments`：将原始流文本拆为结构化片段（不经 printf 解析）。
 */
export { streamToSegments } from './stream-segments.mjs'
