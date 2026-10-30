/** ジャケットの絵。色のままのものと灰色にしたもの、平均の明るさ（0〜1）。 */
export interface Art {
  color: HTMLCanvasElement
  gray: HTMLCanvasElement
  lum: number
}

/** 舞台の地の色とジャケットから決めた、背景と波形の塗り方。 */
export interface Tone {
  dark: boolean
  /** 背景に重ねて明るさを揃える、舞台の地の色 */
  veil: string
  /** veil を重ねたあとの背景の明るさ */
  bg: number
  lum: number
}

export interface WaveBox {
  x: number
  y: number
  w: number
  h: number
}

const EDGE = 256
const BLUR = 24
/** ぼかしは 1/SCALE の大きさで描いて引き伸ばす */
const SCALE = 4
/** ぼかした縁が見えないよう、舞台より大きく敷く */
const BLEED = 80
/** 背景を舞台の地の色に寄せる割合。ジャケットの明るさをこの割合で寄せたところへ揃える */
const VEIL = { dark: 0.6, light: 0.4 }

const canvas = (w: number, h: number) => {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  return c
}

const context = (c: HTMLCanvasElement) => {
  const g = c.getContext('2d', { willReadFrequently: true })
  if (!g) throw new Error('canvas を描けません')
  return g
}

const luma = (r: number, g: number, b: number) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255

function artOf(img: HTMLImageElement): Art {
  const s = Math.min(1, EDGE / Math.max(img.naturalWidth, img.naturalHeight))
  const w = Math.max(1, Math.round(img.naturalWidth * s))
  const h = Math.max(1, Math.round(img.naturalHeight * s))
  const color = canvas(w, h)
  context(color).drawImage(img, 0, 0, w, h)
  const gray = canvas(w, h)
  const gg = context(gray)
  gg.drawImage(color, 0, 0)
  const d = gg.getImageData(0, 0, w, h)
  const px = d.data
  for (let i = 0; i < px.length; i += 4) {
    const y = 0.3 * (px[i] ?? 0) + 0.59 * (px[i + 1] ?? 0) + 0.11 * (px[i + 2] ?? 0)
    px[i] = px[i + 1] = px[i + 2] = y
  }
  gg.putImageData(d, 0, 0)
  const m = canvas(8, 8)
  const mg = context(m)
  mg.drawImage(color, 0, 0, 8, 8)
  const md = mg.getImageData(0, 0, 8, 8).data
  let lum = 0
  for (let i = 0; i < md.length; i += 4) lum += luma(md[i] ?? 0, md[i + 1] ?? 0, md[i + 2] ?? 0)
  return { color, gray, lum: lum / 64 }
}

export function loadArt(src: string) {
  return new Promise<Art>((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.addEventListener('load', () => {
      try {
        resolve(artOf(img))
      } catch (e) {
        reject(e)
      }
    })
    img.addEventListener('error', () => reject(new Error(`ジャケットを読み込めません: ${src}`)))
    img.src = src
  })
}

const rgbs = new Map<string, [number, number, number]>()

function rgbOf(color: string) {
  const hit = rgbs.get(color)
  if (hit) return hit
  const g = context(canvas(1, 1))
  g.fillStyle = color
  g.fillRect(0, 0, 1, 1)
  const [r = 0, gr = 0, b = 0] = g.getImageData(0, 0, 1, 1).data
  const rgb: [number, number, number] = [r, gr, b]
  rgbs.set(color, rgb)
  return rgb
}

export function toneOf(art: Art, stage: string): Tone {
  const [r, g, b] = rgbOf(stage)
  const base = luma(r, g, b)
  const dark = base < 0.5
  const v = dark ? VEIL.dark : VEIL.light
  const L = art.lum
  const target = 0.45 * (1 - v) + base * v
  const a = Math.abs(L - base) < 0.02 ? v : Math.min(0.92, Math.max(0, (L - target) / (L - base)))
  return { dark, veil: `rgb(${r} ${g} ${b} / ${a})`, bg: L * (1 - a) + base * a, lum: L }
}

/** 背景の上に置く文字の色。背景とのコントラストが大きいほうを、黒か白から選ぶ。 */
export function inkOf(tone: Tone) {
  const lin = ((tone.bg + 0.055) / 1.055) ** 2.4
  const c = (lin + 0.05) / 0.05 > 1.05 / (lin + 0.05) ? '20 20 20' : '255 255 255'
  return { ink: `rgb(${c})`, muted: `rgb(${c} / 0.78)` }
}

const blurs = new WeakMap<HTMLCanvasElement, { key: string; out: HTMLCanvasElement }>()

/** 舞台（w × h）に敷く、ぼかした絵。1/SCALE の大きさで返す。 */
function blurred(src: HTMLCanvasElement, w: number, h: number) {
  const cw = Math.ceil(w / SCALE)
  const ch = Math.ceil(h / SCALE)
  const key = `${cw}x${ch}`
  const hit = blurs.get(src)
  if (hit?.key === key) return hit.out
  const out = canvas(cw, ch)
  const g = context(out)
  const bleed = BLEED / SCALE
  const [x, y, bw, bh] = [-bleed, -bleed, cw + bleed * 2, ch + bleed * 2]
  const s = Math.max(bw / src.width, bh / src.height)
  g.filter = `blur(${BLUR / SCALE}px)`
  g.drawImage(src, x + (bw - src.width * s) / 2, y + (bh - src.height * s) / 2, src.width * s, src.height * s)
  blurs.set(src, { key, out })
  return out
}

const fit = (c: HTMLCanvasElement, w: number, h: number) => {
  const dpr = devicePixelRatio || 1
  const [pw, ph] = [Math.round(w * dpr), Math.round(h * dpr)]
  if (c.width !== pw || c.height !== ph) [c.width, c.height] = [pw, ph]
  const g = context(c)
  g.setTransform(dpr, 0, 0, dpr, 0, 0)
  g.clearRect(0, 0, w, h)
  return g
}

const fill = (g: CanvasRenderingContext2D, op: GlobalCompositeOperation, color: string, w: number, h: number) => {
  g.save()
  g.globalCompositeOperation = op
  g.fillStyle = color
  g.fillRect(0, 0, w, h)
  g.restore()
}

/** 舞台の背景。ぼかしたジャケットに舞台の地の色を重ねて、明るさを揃える。 */
export function paintStage(c: HTMLCanvasElement, art: Art, tone: Tone, w: number, h: number) {
  const g = fit(c, w, h)
  const b = blurred(art.color, w, h)
  g.drawImage(b, 0, 0, b.width * SCALE, b.height * SCALE)
  fill(g, 'source-over', tone.veil, w, h)
}

/**
 * 波形の棒を、背景と同じ絵で切り抜く。box は舞台の中の波形の場所。
 * 再生したところ（done）はダークでは背景より明るく、ライトでは濃い灰色にし、まだのところ（base）は灰色の絵を背景から少し浮かせる。
 */
export function paintWave(
  canvases: { base: HTMLCanvasElement; done: HTMLCanvasElement },
  art: Art,
  tone: Tone,
  stage: { w: number; h: number },
  box: WaveBox,
  path: string,
) {
  const bar = new Path2D(path)
  const paint = (c: HTMLCanvasElement, draw: (g: CanvasRenderingContext2D) => void) => {
    const g = fit(c, box.w, box.h)
    g.save()
    g.clip(bar)
    draw(g)
    g.restore()
  }
  const image = (g: CanvasRenderingContext2D, src: HTMLCanvasElement) => {
    const b = blurred(src, stage.w, stage.h)
    g.drawImage(b, -box.x, -box.y, b.width * SCALE, b.height * SCALE)
  }
  const { w, h } = box
  paint(canvases.done, (g) => {
    if (tone.dark) {
      image(g, art.color)
      const target = Math.min(0.95, tone.bg + 0.45)
      const a = Math.min(0.75, Math.max(0.15, 1 - (1 - target) / Math.max(0.05, 1 - tone.lum)))
      fill(g, 'screen', `rgb(255 255 255 / ${a})`, w, h)
      return
    }
    image(g, art.gray)
    const target = Math.max(0.05, Math.min(0.4, tone.bg - 0.33))
    const v = Math.round(Math.min(1, Math.max(0, (target - 0.2 * tone.lum) / 0.8)) * 255)
    fill(g, 'source-over', `rgb(${v} ${v} ${v} / 0.8)`, w, h)
  })
  paint(canvases.base, (g) => {
    image(g, art.gray)
    fill(g, 'source-over', tone.veil, w, h)
    if (tone.dark) fill(g, 'screen', 'rgb(255 255 255 / 0.2)', w, h)
    else fill(g, 'multiply', 'rgb(0 0 0 / 0.2)', w, h)
  })
}
