import { passed, failed } from '../../harness.mjs'

import { runRuntimeAndContextTests } from './runtime-and-context.mjs'
import { runSnapshotAndRenderingTests } from './snapshot-and-rendering.mjs'
import { runVirtualConsoleTests } from './virtual-console.mjs'
import { runWireProtocolTests } from './wire-protocol.mjs'

/**
 *
 */
export async function runAllTests() {
	console.log('🚀 开始运行所有测试...\n')
	await runRuntimeAndContextTests()
	await runVirtualConsoleTests()
	await runSnapshotAndRenderingTests()
	await runWireProtocolTests()

	console.log(`\n${'='.repeat(50)}`)
	if (failed === 0)
		console.log(`✅ 全部通过！共 ${passed} 项测试。`)
	else {
		console.error(`❌ 测试结束：${passed} 通过，${failed} 失败。`)
		process.exit(1)
	}
}
