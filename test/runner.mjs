import { runBrowserTests } from './browser/suite.mjs'
import { runConsoleTests } from './console/index.mjs'
import { runDenoTests } from './deno/suite.mjs'
import { passed, failed, failures, resetHarness } from './harness.mjs'
import { runRuntimeTests } from './runtime.mjs'
import { runSnapshotTests } from './snapshot.mjs'
import { runWireTests } from './wire.mjs'

resetHarness()
console.log('🚀 开始运行所有测试...\n')
await runRuntimeTests()
await runConsoleTests()
await runBrowserTests()
await runSnapshotTests()
await runWireTests()
await runDenoTests()

console.log(`\n${'='.repeat(50)}`)
if (failed === 0)
	console.log(`✅ 全部通过！共 ${passed} 项测试。`)
else {
	console.log(`\n❌ 测试结束：${passed} 通过，${failed} 失败。`)
	console.log(`\n── 失败汇总（共 ${failures.length} 条）──`)
	for (let i = 0; i < failures.length; i++)
		console.log(`\n${i + 1}. ${failures[i]}`)
	console.log('')
	process.exit(1)
}
