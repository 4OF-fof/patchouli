/** OKLCH の色。l は 0〜1、c は 0 以上、h は 0〜360。 */
export interface Oklch {
  l: number
  c: number
  h: number
}

const HEX = /^#([0-9a-f]{6})$/i
const OKLCH = /^oklch\(\s*([\d.]+)(%?)\s+([\d.]+)\s+([\d.]+)(?:deg)?\s*\)$/i

const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
const fromLinear = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055)

type Rgb = [number, number, number]

const rgbToOklch = ([r, g, b]: Rgb): Oklch => {
  const [lr, lg, lb] = [toLinear(r), toLinear(g), toLinear(b)]
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb)
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb)
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb)
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s
  const c = Math.hypot(a, bb)
  return { l: L, c: c < 1e-4 ? 0 : c, h: c < 1e-4 ? 0 : ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360 }
}

/** 0〜1 の線形でない sRGB。範囲の外に出ることがある。 */
const oklchToRgb = ({ l: L, c, h }: Oklch): Rgb => {
  const a = c * Math.cos((h * Math.PI) / 180)
  const b = c * Math.sin((h * Math.PI) / 180)
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  return [
    fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ]
}

const clip = (v: number) => Math.min(1, Math.max(0, v))

const inGamut = (rgb: number[]) => rgb.every((v) => v >= -1e-4 && v <= 1 + 1e-4)

/** 明るさと色相を保ったまま、sRGB に入るところまで鮮やかさを下げる。 */
export const inSrgb = (o: Oklch): Oklch => {
  if (inGamut(oklchToRgb(o))) return o
  let lo = 0
  let hi = o.c
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2
    if (inGamut(oklchToRgb({ ...o, c: mid }))) lo = mid
    else hi = mid
  }
  return { ...o, c: lo }
}

const clampRgb = (o: Oklch): Rgb => {
  const [r, g, b] = oklchToRgb(inSrgb(o))
  return [clip(r), clip(g), clip(b)]
}

/** `#rrggbb` か `oklch(L C H)` を読む。読めなければ undefined。 */
export const parseColor = (s: string): Oklch | undefined => {
  const t = s.trim()
  const hex = HEX.exec(t)
  if (hex) {
    const n = parseInt(hex[1], 16)
    return rgbToOklch([(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255])
  }
  const m = OKLCH.exec(t)
  if (!m) return undefined
  const l = Number(m[1]) / (m[2] ? 100 : 1)
  const c = Number(m[3])
  const h = Number(m[4]) % 360
  if (![l, c, h].every(Number.isFinite) || l > 1) return undefined
  return { l, c, h }
}

const round = (n: number, d: number) => Number(n.toFixed(d))

export const formatOklch = (o: Oklch, alpha?: number) =>
  `oklch(${round(o.l, 3)} ${round(o.c, 3)} ${round(o.h, 1)}${alpha === undefined ? '' : ` / ${alpha}`})`

export const toHex = (o: Oklch) =>
  `#${clampRgb(o)
    .map((v) =>
      Math.round(v * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`

const luminance = (o: Oklch) => {
  const [r, g, b] = clampRgb(o).map(toLinear)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG のコントラスト比。 */
export const contrast = (a: Oklch, b: Oklch) => {
  const [x, y] = [luminance(a), luminance(b)].toSorted((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}

/** コントラスト比の目安。WCAG の AA の本文。 */
export const ENOUGH_CONTRAST = 4.5
