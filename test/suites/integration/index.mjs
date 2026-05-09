import { passed, failed, failures, resetHarness } from '../../harness.mjs'

import { runRuntimeAndContextTests } from './runtime-and-context.mjs'
import { runSnapshotAndRenderingTests } from './snapshot-and-rendering.mjs'
import { runVirtualConsoleTests } from './virtual-console.mjs'
import { runWireProtocolTests } from './wire-protocol.mjs'

/**
 *
 */
export async function runAllTests() {
	resetHarness()
	console.log('🚀 开始运行所有测试...\n')
	await runRuntimeAndContextTests()
	await runVirtualConsoleTests()
	await runSnapshotAndRenderingTests()
	await runWireProtocolTests()

	console.log(`\n${'='.repeat(50)}`)
	if (failed === 0)
		console.log(`✅ 全部通过！共 ${passed} 项测试。`)
	else {
		// 与断言输出同一流（stdout），避免 stderr/stdout 交错导致汇总夹在中间
		console.log(`\n❌ 测试结束：${passed} 通过，${failed} 失败。`)
		console.log(`\n── 失败汇总（共 ${failures.length} 条）──`)
		for (let i = 0; i < failures.length; i++)
			console.log(`\n${i + 1}. ${failures[i]}`)
		console.log('')
		process.exit(1)
	}
}
