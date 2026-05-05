/**
 * 将 `console` 风格 `%c` 的 CSS 子集映射为 ANSI SGR + 24 位真彩色。
 * - 颜色：`color` / `background-color` / `background`（纯色）、`#rgb`、`rgb()`/`hsl()`、命名色。
 * - 字形：`font-weight`→粗体(1)、`lighter`→半亮(2)；`font-style: italic|oblique`→斜体(3)。
 * - 装饰：`text-decoration` / `text-decoration-line`→下划线(4)、删除线(9)。
 * - 半亮：`opacity`∈(0,1)、带半透明通道的颜色、`font-weight:lighter`→SGR 2（dim）。
 */

import colorName from 'color-name'

/** @typedef {{ r: number; g: number; b: number }} Rgb */

/**
 * @typedef {object} CssAnsiDeclFlags
 * @property {Rgb | undefined} [fg]
 * @property {Rgb | undefined} [bg]
 * @property {boolean} [dim]
 * @property {boolean} [bold]
 * @property {boolean} [italic]
 * @property {boolean} [underline]
 * @property {boolean} [lineThrough]
 */

/**
 * @param {[number, number, number]} triple - `color-name` 的 RGB 三元组。
 * @returns {Rgb} 与三元组通道对应的 `{ r, g, b }` 对象。
 */
function namedTripleToRgb(triple) {
	return { r: triple[0], g: triple[1], b: triple[2] }
}

/**
 * @param {number} n - 0xRRGGBB
 * @returns {Rgb} 拆分的 R/G/B 通道。
 */
function hexIntToRgb(n) {
	return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

/**
 * @param {number} x - 通道值
 * @returns {number} 钳制到 0–255 的整数。
 */
function clampByte(x) {
	return Math.max(0, Math.min(255, Math.round(x)))
}

/**
 * @param {string} raw - 单段数值或百分比
 * @param {number} i - 通道索引 0–2
 * @returns {number} 单通道字节或 NaN。
 */
function parseRgbComponent(raw, i) {
	const s = raw.trim()
	if (s.endsWith('%')) {
		const p = parseFloat(s.slice(0, -1))
		if (Number.isNaN(p)) return NaN
		return clampByte((p / 100) * 255)
	}
	const n = parseFloat(s)
	if (Number.isNaN(n)) return NaN
	// 规范：0–255 或 0–1 浮点
	if (n <= 1 && s.includes('.') && !s.includes('e') && !s.includes('E'))
		return clampByte(n * 255)
	return clampByte(n)
}

/**
 * @param {string} inner - 括号内串（逗号或空白分隔）
 * @returns {Rgb | null} 解析成功返回 RGB，否则 null。
 */
function parseRgbFunctionInner(inner) {
	const parts = inner.includes(',')
		? inner.split(',').map(p => p.trim()).filter(Boolean)
		: inner.trim().split(/\s+/).filter(Boolean)
	if (parts.length < 3) return null
	const r = parseRgbComponent(parts[0], 0)
	const g = parseRgbComponent(parts[1], 1)
	const b = parseRgbComponent(parts[2], 2)
	if ([r, g, b].some(Number.isNaN)) return null
	return { r, g, b }
}

/**
 * @param {string} value - 颜色串
 * @returns {Rgb | null} 可映射的前景色 RGB；无法解析时为 null。
 */
export function parseCssColorToRgb(value) {
	const v = String(value || '').trim()
	if (!v || v.toLowerCase() === 'transparent' || v.toLowerCase() === 'currentcolor')
		return null

	const lower = v.toLowerCase()
	const named = /** @type {Record<string, [number, number, number]>} */ colorName[lower]
	if (named)
		return namedTripleToRgb(named)

	const hexMatch = /^#([\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.exec(v)
	if (hexMatch) {
		let h = hexMatch[1]
		if (h.length === 3 || h.length === 4)
			h = h.slice(0, 3).split('').map(c => c + c).join('')

		else if (h.length === 8)
			h = h.slice(0, 6)
		const n = parseInt(h, 16)
		if (Number.isNaN(n)) return null
		return hexIntToRgb(n)
	}

	const rgbMatch = /^rgba?\(\s*([\S\s]+?)\s*\)$/i.exec(v)
	if (rgbMatch) {
		const rgb = parseRgbFunctionInner(rgbMatch[1].replace(/\s*\/\s*[\d.]+\s*$/, ''))
		return rgb
	}

	// hsl(h,s,l) 与 hsla(h,s,l,α)：前三项为色相/饱和度/亮度（颜色）；第四项 α 是透明度，不参与 RGB 换算。
	// 斜杠语法里的 α 已在 inner 上去掉；逗号形式 hsla 则需丢弃第四段，避免把 α 误当作 L。
	const hslMatch = /^hsla?\(\s*([\S\s]+?)\s*\)$/i.exec(v)
	if (hslMatch) {
		const inner = hslMatch[1].replace(/\s*\/\s*[\d.]+\s*$/, '')
		let parts = inner.includes(',')
			? inner.split(',').map(p => p.trim()).filter(Boolean)
			: inner.trim().split(/\s+/).filter(Boolean)
		if (parts.length > 3) parts = parts.slice(0, 3)
		if (parts.length < 3) return null
		let h = parseFloat(parts[0])
		const sStr = parts[1]
		const lStr = parts[2]
		if (Number.isNaN(h)) return null
		h = ((h % 360) + 360) % 360
		let s = parseFloat(sStr)
		let l = parseFloat(lStr)
		if (sStr.endsWith('%')) s = parseFloat(sStr.slice(0, -1)) / 100
		else if (s > 1) s /= 100
		if (lStr.endsWith('%')) l = parseFloat(lStr.slice(0, -1)) / 100
		else if (l > 1) l /= 100
		if (Number.isNaN(s) || Number.isNaN(l)) return null
		s = Math.max(0, Math.min(1, s))
		l = Math.max(0, Math.min(1, l))
		return hslToRgb(h, s, l)
	}

	return null
}

/**
 * HSL → RGB。入参 h 为色相角度（度），s/l 已归一化到 [0,1]。
 * @param {number} h - 色相 0–360（函数内会 /360）
 * @param {number} s - 饱和度 0–1
 * @param {number} l - 亮度 0–1（注意：不是 hsla 里的 α）
 * @returns {Rgb} HSL 换算得到的 sRGB 通道。
 */
function hslToRgb(h, s, l) {
	h /= 360
	/**
	 * HSL 分段线性插值辅助。
	 * @param {number} p - 暗端。
	 * @param {number} q - 亮端。
	 * @param {number} t - [0,1] 上的色相相位参数。
	 * @returns {number} 单通道 0–1 浮点。
	 */
	const hue2rgb = (p, q, t) => {
		let tt = t
		if (tt < 0) tt += 1
		if (tt > 1) tt -= 1
		if (tt < 1 / 6) return p + (q - p) * 6 * tt
		if (tt < 1 / 2) return q
		if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6
		return p
	}
	let r; let g; let b
	if (s === 0)
		r = g = b = l
	else {
		const q = l < 0.5 ? l * (1 + s) : l + s - l * s
		const p = 2 * l - q
		r = hue2rgb(p, q, h + 1 / 3)
		g = hue2rgb(p, q, h)
		b = hue2rgb(p, q, h - 1 / 3)
	}
	return { r: clampByte(r * 255), g: clampByte(g * 255), b: clampByte(b * 255) }
}

/**
 * @param {string} val - `font-weight` 声明值
 * @returns {boolean} 视为粗体映射时为 true。
 */
function parseFontWeightBold(val) {
	const v = String(val || '').trim().toLowerCase()
	if (v === 'bold' || v === 'bolder') return true
	if (v === 'normal' || v === 'lighter') return false
	const n = parseInt(v, 10)
	if (!Number.isNaN(n)) return n >= 600
	return false
}

/**
 * @param {string} val - `font-style` 声明值
 * @returns {boolean} italic/oblique 时为 true。
 */
function parseFontStyleItalic(val) {
	const v = String(val || '').trim().toLowerCase()
	return v === 'italic' || v === 'oblique'
}

/**
 * @param {string} val - `text-decoration` / `text-decoration-line`
 * @returns {{ underline: boolean; lineThrough: boolean }} 下划线与删除线开关。
 */
function parseTextDecorationKeywords(val) {
	const t = String(val || '').toLowerCase().trim()
	if (!t || t === 'none')
		return { underline: false, lineThrough: false }
	return {
		underline: /\bunderline\b/.test(t),
		lineThrough: /\bline-through\b/.test(t),
	}
}

/**
 * @param {string} raw - alpha 分量
 * @returns {number | null} 归一化到 [0,1]；不可解析时为 null。
 */
function parseAlphaComponent(raw) {
	const t = String(raw || '').trim()
	if (t.endsWith('%')) {
		const p = parseFloat(t.slice(0, -1)) / 100
		return Number.isNaN(p) ? null : Math.max(0, Math.min(1, p))
	}
	const n = parseFloat(t)
	if (Number.isNaN(n)) return null
	return Math.max(0, Math.min(1, n))
}

/**
 * `opacity`：严格介于 0 与 1 之间时视为半亮提示。
 * @param {string} val - 声明值
 * @returns {boolean} 应触发半亮（dim）提示时为 true。
 */
function parseOpacityInducesDim(val) {
	const t = String(val || '').trim()
	if (t.endsWith('%')) {
		const p = parseFloat(t.slice(0, -1)) / 100
		if (Number.isNaN(p)) return false
		return p > 0 && p < 1
	}
	const n = parseFloat(t)
	if (Number.isNaN(n)) return false
	return n > 0 && n < 1
}

/**
 * 颜色字符串 → RGB；若含半透明（alpha∈(0,1)）则 `dimHint`。
 * `hsla` 的第四段是 α 而非 HSL 的「第四个颜色分量」；与 `hsl(…/α)` 一样只影响是否 dim。
 * @param {string} val - `color` / `background-color` 等一侧的值
 * @returns {{ rgb: Rgb | null; dimHint: boolean }} RGB 与是否因半透明建议 dim。
 */
function cssColorValueToRgbAndDimHint(val) {
	const v = String(val || '').trim()
	let dimHint = false

	const hex8Match = /^#([\da-f]{8})$/i.exec(v)
	if (hex8Match) {
		const full = parseInt(hex8Match[1], 16)
		const a = (full & 0xff) / 255
		if (a > 0 && a < 1) dimHint = true
		const rgbInt = (full >>> 8) & 0xffffff
		return { rgb: hexIntToRgb(rgbInt), dimHint }
	}

	const hex4Match = /^#([\da-f]{4})$/i.exec(v)
	if (hex4Match) {
		const expanded = hex4Match[1].split('').map(c => c + c).join('')
		const rgbInt = parseInt(expanded.slice(0, 6), 16)
		const aByte = parseInt(expanded.slice(6, 8), 16)
		const a = aByte / 255
		if (a > 0 && a < 1) dimHint = true
		return { rgb: hexIntToRgb(rgbInt), dimHint }
	}

	if (/^rgba\(/i.test(v)) {
		const body = /^rgba\(\s*([\S\s]+?)\s*\)$/i.exec(v)
		if (body) {
			const inner = body[1]
			const preSlash = inner.replace(/\s*\/\s*[\d\s%.]+$/, '')
			const parts = preSlash.includes(',')
				? preSlash.split(',').map(p => p.trim()).filter(Boolean)
				: preSlash.split(/\s+/).filter(Boolean)
			if (parts.length >= 4) {
				const a = parseAlphaComponent(parts[3])
				if (a !== null && a > 0 && a < 1) dimHint = true
			}
			else {
				const slash = inner.match(/\/\s*([\d\s%.]+)\s*$/)
				if (slash) {
					const a = parseAlphaComponent(slash[1].trim())
					if (a !== null && a > 0 && a < 1) dimHint = true
				}
			}
		}
		return { rgb: parseCssColorToRgb(v), dimHint }
	}

	// hsla：第四段为 α；半透明时提示 dim（RGB 仍由 parseCssColorToRgb 仅用 H,S,L 算出）。
	if (/^hsla\(/i.test(v)) {
		const body = /^hsla\(\s*([\S\s]+?)\s*\)$/i.exec(v)
		if (body) {
			const inner = body[1].replace(/\s*\/\s*[\d\s%.]+$/, '')
			const parts = inner.includes(',')
				? inner.split(',').map(p => p.trim()).filter(Boolean)
				: inner.trim().split(/\s+/).filter(Boolean)
			if (parts.length >= 4) {
				const a = parseAlphaComponent(parts[3])
				if (a !== null && a > 0 && a < 1) dimHint = true
			}
		}
		return { rgb: parseCssColorToRgb(v), dimHint }
	}

	if (/^rgb\(/i.test(v) && !/^rgba\(/i.test(v)) {
		const m = v.match(/\/\s*([\d\s%.]+)\s*\)\s*$/i)
		if (m) {
			const a = parseAlphaComponent(m[1].trim())
			if (a !== null && a > 0 && a < 1) dimHint = true
		}
		return { rgb: parseCssColorToRgb(v), dimHint }
	}

	if (/^hsl\(/i.test(v) && !/^hsla\(/i.test(v)) {
		const m = v.match(/\/\s*([\d\s%.]+)\s*\)\s*$/i)
		if (m) {
			const a = parseAlphaComponent(m[1].trim())
			if (a !== null && a > 0 && a < 1) dimHint = true
		}
		return { rgb: parseCssColorToRgb(v), dimHint }
	}

	return { rgb: parseCssColorToRgb(v), dimHint: false }
}

/**
 * @param {string} css - `font-size:…; color: red` 等
 * @returns {CssAnsiDeclFlags} 解析得到的着色与字形标志。
 */
export function parseCssDecls(css) {
	const s = String(css || '')
	/** @type {Rgb | undefined} */
	let fg
	/** @type {Rgb | undefined} */
	let bg
	let dim = false
	let bold = false
	let italic = false
	let underline = false
	let lineThrough = false

	for (const chunk of s.split(';')) {
		const colon = chunk.indexOf(':')
		if (colon === -1) continue
		const prop = chunk.slice(0, colon).trim().toLowerCase()
		const val = chunk.slice(colon + 1).trim()
		if (!val) continue

		if (prop === 'color') {
			const { rgb, dimHint } = cssColorValueToRgbAndDimHint(val)
			if (rgb) fg = rgb
			if (dimHint) dim = true
		}
		else if (prop === 'background-color') {
			const { rgb, dimHint } = cssColorValueToRgbAndDimHint(val)
			if (rgb) bg = rgb
			if (dimHint) dim = true
		}
		else if (prop === 'background') {
			if (/\b(?:url|gradient|linear-gradient|radial-gradient|repeating-linear|repeating-radial)\(/i.test(val))
				continue
			const { rgb, dimHint } = cssColorValueToRgbAndDimHint(val)
			if (rgb) bg = rgb
			if (dimHint) dim = true
		}
		else if (prop === 'opacity') {
			if (parseOpacityInducesDim(val)) dim = true
		}
		else if (prop === 'font-weight') {
			const vv = String(val || '').trim().toLowerCase()
			if (vv === 'lighter') dim = true
			bold = parseFontWeightBold(val)
		}
		else if (prop === 'font-style')
			italic = parseFontStyleItalic(val)
		else if (prop === 'text-decoration' || prop === 'text-decoration-line') {
			const d = parseTextDecorationKeywords(val)
			underline = d.underline
			lineThrough = d.lineThrough
		}
	}

	return { fg, bg, dim, bold, italic, underline, lineThrough }
}

/**
 * @param {CssAnsiDeclFlags} flags - {@link parseCssDecls} 产物。
 * @returns {string} 如 `\x1b[2;1;3;4;38;2;255;0;0m`，无可映射项时 `''`。
 */
export function flagsToSgrPrefix(flags) {
	const codes = []
	if (flags.dim) codes.push('2')
	if (flags.bold) codes.push('1')
	if (flags.italic) codes.push('3')
	if (flags.underline) codes.push('4')
	if (flags.lineThrough) codes.push('9')
	if (flags.fg) codes.push(`38;2;${flags.fg.r};${flags.fg.g};${flags.fg.b}`)
	if (flags.bg) codes.push(`48;2;${flags.bg.r};${flags.bg.g};${flags.bg.b}`)
	if (!codes.length) return ''
	return `\x1b[${codes.join(';')}m`
}

/**
 * @param {string} css - `font-size:…; color: red` 等
 * @returns {string} 如 `\x1b[2;1;3;4;38;2;255;0;0m`，无可映射项时 `''`。
 */
export function cssStyleStringToAnsiPrefix(css) {
	const flags = parseCssDecls(css)
	if (!String(css || '').trim()) return ''
	return flagsToSgrPrefix(flags)
}
