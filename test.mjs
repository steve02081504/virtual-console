import { VirtualConsole } from '@steve02081504/virtual-console'

/**
 * 测试 VirtualConsole 的各种渲染功能
 */
async function runTest() {
	console.profile('test')
	console.log('🚀 开始测试 VirtualConsole 渲染功能...\n')

	// 创建实例，不输出到真实控制台，只记录
	const vc = new VirtualConsole({
		recordOutput: true,
		realConsoleOutput: false
	})

	// 在 hook 上下文中执行打印操作
	await vc.hookAsyncContext(() => {
		// 1. 基础占位符测试
		console.log('--- [1. Standard Placeholders] ---')
		console.log('String: %s', 'Hello World')
		console.log('Integer: %d, Float: %f', 123, 45.678)
		console.log('JSON Object: %o', { id: 1, status: 'ok' })

		// 2. ANSI 颜色测试 (Node.js 常用)
		console.log('\n--- [2. ANSI Colors] ---')
		console.log('\x1b[31mRed Text\x1b[0m')
		console.log('\x1b[32mGreen Text\x1b[0m and \x1b[34mBlue Text\x1b[0m')
		console.log('\x1b[1mBold\x1b[0m and \x1b[3mItalic\x1b[0m')

		// 3. CSS 样式测试 (%c - 浏览器常用)
		console.log('\n--- [3. CSS Styling (%c)] ---')
		console.log('%cThis text is Blue and Large', 'color: blue; font-size: 20px')
		console.log('Normal, %cRed Background%c, Normal again', 'background: red; color: white', '')

		// 4. 混合测试
		console.log('\n--- [4. Mixed] ---')
		console.log('ANSI: \x1b[33mYellow\x1b[0m + %cCSS: Green%c', 'color: green', '')

		// 5. 注入测试
		console.log('\n--- [5. Injection Test] ---')
		const injectionPayload = '"><script>alert("pwned")</script><span style="'
		console.log('%cInjection Test', injectionPayload)
		console.log('Attempting to inject a script tag: %s', '<script>alert("oops")</script>')

		// 6. 炒饭测试
		console.log('\n--- [6. Special Cases] ---')
		console.log('%s', Object.create(null))
		console.log('%s', new Date())
		const a = {}
		a.a = a
		console.log(a)
		console.log('%_', a)
		console.log('%f', Symbol('lol'))
		console.log('%j', Symbol('lol'))
		console.log('%d', Symbol('lol'))
		console.log('%o', Symbol('lol'))
	})

	// --- 验证结果 ---

	console.log('📋 === [Captured Raw Output (vc.outputs)] ===')
	// 这里显示的是纯文本（在 Node 环境下可能包含 ANSI 码，取决于终端支持）
	console.log(vc.outputs)

	console.log('🌐 === [Captured HTML Output (vc.outputsHtml)] ===')
	// 这里显示的是转换后的 HTML 字符串，你应该检查 span 标签和 style 属性
	console.log(vc.outputsHtml)

	console.log('\n🏁 测试结束')
	console.profileEnd('test')
}

runTest()
