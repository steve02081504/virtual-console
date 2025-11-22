import { AnsiUp } from 'ansi_up'

const ansi_up = new AnsiUp()

/**
 * 将 console 参数格式化为 HTML 字符串。
 * @param {any[]} args - console 方法接收的参数数组。
 * @returns {string} 格式化后的 HTML 字符串。
 */
export function argsToHtml(args) {
	if (args.length === 0) return ''
	const format = args[0]
	if (format?.constructor !== String)
		return args.map(arg => {
			if (arg instanceof Error && arg.stack) return ansi_up.ansi_to_html(arg.stack)
			if ((arg === null || arg instanceof Object) && !(arg instanceof Function))
				try { return ansi_up.ansi_to_html(JSON.stringify(arg, null, '\t')) }
				catch { return String(arg) }

			return ansi_up.ansi_to_html(String(arg))
		}).join(' ')


	let html = ansi_up.ansi_to_html(format)
	let argIndex = 1
	let hasStyle = false

	const regex = /%[sdifoOc%]/g
	html = html.replace(regex, (match) => {
		if (match === '%%') return '%'
		if (argIndex >= args.length) return match

		const arg = args[argIndex++]
		switch (match) {
			case '%c': {
				hasStyle = true
				const style = String(arg)
				return `</span><span style="${style}">`
			}
			case '%s':
				return ansi_up.ansi_to_html(String(arg))
			case '%d':
			case '%i':
				return String(parseInt(arg))
			case '%f':
				return String(parseFloat(arg))
			case '%o':
			case '%O':
				try { return ansi_up.ansi_to_html(JSON.stringify(arg)) }
				catch { return String(arg) }
		}
		return match
	})

	if (hasStyle) html = `<span>${html}</span>`

	while (argIndex < args.length) {
		const arg = args[argIndex++]
		html += ' '
		if (arg instanceof Error && arg.stack) html += ansi_up.ansi_to_html(arg.stack)
		else if ((arg === null || arg instanceof Object) && !(arg instanceof Function))
			try { html += ansi_up.ansi_to_html(JSON.stringify(arg, null, '\t')) }
			catch { html += String(arg) }

		else html += ansi_up.ansi_to_html(String(arg))
	}

	return html
}
