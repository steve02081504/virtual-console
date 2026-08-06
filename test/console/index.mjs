import { runBlockTests } from './block.mjs'
import { runNestingTests } from './nesting.mjs'
import { runPerformanceTests } from './performance.mjs'
import { runRecordingTests } from './recording.mjs'

/**
 * 运行 console 相关测试套件。
 */
export async function runConsoleTests() {
	await runRecordingTests()
	await runNestingTests()
	await runBlockTests()
	await runPerformanceTests()
}
