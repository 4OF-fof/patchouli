import { createSignal } from 'solid-js'
import { type Oklch, formatOklch, parseColor } from './color'

export type Mode = 'light' | 'dark'

/** 配色で変えられる色。CSS 変数の名前から -- を外したもの。 */
export type ColorKey =
  | 'paper'
  | 'side'
  | 'card'
  | 'line-2'
  | 'stage'
  | 'ink'
  | 'ink-2'
  | 'muted'
  | 'disabled'
  | 'accent'
  | 'warm-ink'
  | 'danger'
  | 'ok'
  | 'base08'
  | 'base09'
  | 'base0a'
  | 'base0b'
  | 'base0c'
  | 'base0d'
  | 'base0e'
  | 'base0f'

export type Colors = Partial<Record<ColorKey, string>>

export interface ColorScheme {
  id: string
  name: string
  /** 標準から変えた色だけを持つ。 */
  light: Colors
  dark: Colors
}

export interface ColorEntry {
  key: ColorKey
  label: string
  /** コントラストを測る相手。省くと測らない。 */
  against?: ColorKey
}

export const COLOR_GROUPS: { label: string; entries: ColorEntry[] }[] = [
  {
    label: '面',
    entries: [
      { key: 'paper', label: '背景' },
      { key: 'side', label: 'サイドバー' },
      { key: 'card', label: 'カード・線' },
      { key: 'line-2', label: '枠線' },
      { key: 'stage', label: '画像や動画の背景' },
    ],
  },
  {
    label: '文字',
    entries: [
      { key: 'ink', label: '文字', against: 'paper' },
      { key: 'ink-2', label: 'やや薄い文字', against: 'paper' },
      { key: 'muted', label: '薄い文字', against: 'paper' },
      { key: 'disabled', label: '無効な項目' },
    ],
  },
  {
    label: '色',
    entries: [
      { key: 'accent', label: 'アクセント', against: 'paper' },
      { key: 'warm-ink', label: '注目', against: 'paper' },
      { key: 'danger', label: '危険', against: 'paper' },
      { key: 'ok', label: '成功', against: 'paper' },
    ],
  },
  {
    label: 'コードの色',
    entries: [
      { key: 'base08', label: 'タグ・変数', against: 'side' },
      { key: 'base09', label: '数値・定数', against: 'side' },
      { key: 'base0a', label: '型・クラス', against: 'side' },
      { key: 'base0b', label: '文字列', against: 'side' },
      { key: 'base0c', label: '正規表現・URL', against: 'side' },
      { key: 'base0d', label: '関数', against: 'side' },
      { key: 'base0e', label: 'キーワード', against: 'side' },
      { key: 'base0f', label: 'メタ情報', against: 'side' },
    ],
  },
]

const KEYS = COLOR_GROUPS.flatMap((g) => g.entries.map((e) => e.key))

const isKey = (k: string): k is ColorKey => (KEYS as string[]).includes(k)

/** 標準の色。tokens.css と同じ値にしておく。 */
export const STANDARD: Record<Mode, Record<ColorKey, string>> = {
  dark: {
    paper: 'oklch(0.24 0 0)',
    side: 'oklch(0.215 0 0)',
    card: 'oklch(0.31 0 0)',
    'line-2': 'oklch(0.36 0 0)',
    stage: 'oklch(0.19 0 0)',
    ink: 'oklch(0.853 0 0)',
    'ink-2': 'oklch(0.752 0 0)',
    muted: 'oklch(0.675 0 0)',
    disabled: 'oklch(0.44 0 0)',
    accent: 'oklch(0.674 0.035 235)',
    'warm-ink': 'oklch(0.681 0.075 55)',
    danger: 'oklch(0.69 0.13 25)',
    ok: 'oklch(0.665 0.09 155)',
    base08: 'oklch(0.729 0.1 25)',
    base09: 'oklch(0.725 0.1 55)',
    base0a: 'oklch(0.718 0.1 90)',
    base0b: 'oklch(0.706 0.1 155)',
    base0c: 'oklch(0.706 0.1 195)',
    base0d: 'oklch(0.713 0.1 235)',
    base0e: 'oklch(0.726 0.1 300)',
    base0f: 'oklch(0.721 0.045 55)',
  },
  light: {
    paper: 'oklch(0.99 0 0)',
    side: 'oklch(0.965 0 0)',
    card: 'oklch(0.935 0 0)',
    'line-2': 'oklch(0.89 0 0)',
    stage: 'oklch(0.945 0 0)',
    ink: 'oklch(0.307 0 0)',
    'ink-2': 'oklch(0.4 0 0)',
    muted: 'oklch(0.523 0 0)',
    disabled: 'oklch(0.8 0 0)',
    accent: 'oklch(0.52 0.045 235)',
    'warm-ink': 'oklch(0.529 0.09 55)',
    danger: 'oklch(0.54 0.15 25)',
    ok: 'oklch(0.508 0.11 155)',
    base08: 'oklch(0.455 0.12 25)',
    base09: 'oklch(0.451 0.11 55)',
    base0a: 'oklch(0.442 0.09 90)',
    base0b: 'oklch(0.427 0.104 155)',
    base0c: 'oklch(0.427 0.072 195)',
    base0d: 'oklch(0.436 0.092 235)',
    base0e: 'oklch(0.453 0.12 300)',
    base0f: 'oklch(0.444 0.054 55)',
  },
}

/** 元の色から透かして作る色。値は tokens.css の透明度。 */
const DERIVED: { name: string; from: Record<Mode, ColorKey>; alpha: Record<Mode, number> }[] = [
  { name: 'accent-soft', from: { dark: 'accent', light: 'accent' }, alpha: { dark: 0.18, light: 0.12 } },
  { name: 'mark', from: { dark: 'accent', light: 'accent' }, alpha: { dark: 0.35, light: 0.22 } },
  { name: 'warm', from: { dark: 'warm-ink', light: 'warm-ink' }, alpha: { dark: 0.12, light: 0.08 } },
  { name: 'danger-line', from: { dark: 'danger', light: 'danger' }, alpha: { dark: 0.45, light: 0.35 } },
  { name: 'danger-soft', from: { dark: 'danger', light: 'danger' }, alpha: { dark: 0.12, light: 0.12 } },
  // ライトの重ね表示は、画像の背景ではなく本文の背景を透かす
  { name: 'overlay', from: { dark: 'stage', light: 'paper' }, alpha: { dark: 0.72, light: 0.8 } },
]

/** いまの配色での色。変えていなければ標準の色。 */
export const colorOf = (s: ColorScheme | undefined, mode: Mode, key: ColorKey): Oklch =>
  parseColor(s?.[mode][key] ?? '') ?? parseColor(STANDARD[mode][key])!

const OWNED = [...KEYS, ...DERIVED.map((d) => d.name)]

/** 配色を、ページの CSS 変数に写す。変えていない色は tokens.css のままにする。 */
export const applyScheme = (s: ColorScheme | undefined, mode: Mode, root: HTMLElement) => {
  for (const name of OWNED) root.style.removeProperty(`--${name}`)
  if (!s) return
  for (const key of KEYS) {
    const v = s[mode][key]
    if (v === undefined || !parseColor(v)) continue
    root.style.setProperty(`--${key}`, v)
  }
  for (const d of DERIVED) {
    const from = d.from[mode]
    if (s[mode][from] === undefined) continue
    root.style.setProperty(`--${d.name}`, formatOklch(colorOf(s, mode, from), d.alpha[mode]))
  }
}

const KEY = 'patchouli.schemes'

const cleanColors = (v: unknown): Colors => {
  if (typeof v !== 'object' || !v) return {}
  const out: Colors = {}
  for (const [k, c] of Object.entries(v)) {
    if (isKey(k) && typeof c === 'string' && parseColor(c)) out[k] = c
  }
  return out
}

const read = (): ColorScheme[] => {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    if (!Array.isArray(raw)) return []
    return raw.flatMap((x: Record<string, unknown>) =>
      typeof x?.id === 'string' && typeof x.name === 'string'
        ? [{ id: x.id, name: x.name, light: cleanColors(x.light), dark: cleanColors(x.dark) }]
        : [],
    )
  } catch {
    return []
  }
}

const [schemes, setAll] = createSignal<ColorScheme[]>(read())

export { schemes }

export const setSchemes = (list: ColorScheme[]) => {
  setAll(list)
  try {
    localStorage.setItem(KEY, JSON.stringify(list))
  } catch {}
}

export const newSchemeId = () => `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

/** 同じ名前があれば「（2）」のように番号を付ける。 */
export const uniqueName = (name: string, list: ColorScheme[]) => {
  const taken = new Set(list.map((s) => s.name))
  if (!taken.has(name)) return name
  let i = 2
  while (taken.has(`${name}（${i}）`)) i++
  return `${name}（${i}）`
}

const FILE_TYPE = 'patchouli-color-scheme'
const FILE_VERSION = 1

/** 書き出す JSON。変えた色だけを並べる。 */
export const schemeJson = (s: ColorScheme) =>
  `${JSON.stringify({ type: FILE_TYPE, version: FILE_VERSION, name: s.name, dark: s.dark, light: s.light }, null, 2)}\n`

/** 読み込んだ JSON を配色にする。読めないときは、理由を添えて投げる。 */
export const parseSchemeJson = (text: string, fallbackName: string): Omit<ColorScheme, 'id'> => {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('JSON の読み込みに失敗しました')
  }
  if (typeof raw !== 'object' || !raw || Array.isArray(raw)) throw new Error('配色のファイルではありません')
  const o: Record<string, unknown> = { ...raw }
  if (o.type !== FILE_TYPE) throw new Error('配色のファイルではありません')
  if (o.version !== FILE_VERSION) throw new Error(`このバージョン（${String(o.version)}）の配色には対応していません`)
  const colors = (mode: Mode): Colors => {
    const v = o[mode]
    if (v === undefined) return {}
    if (typeof v !== 'object' || !v || Array.isArray(v)) throw new Error(`「${mode}」の形式が正しくありません`)
    const out: Colors = {}
    for (const [k, c] of Object.entries(v)) {
      if (!isKey(k)) throw new Error(`「${mode}.${k}」は指定できない色です`)
      if (typeof c !== 'string' || !parseColor(c))
        throw new Error(`「${mode}.${k}」には #rrggbb または oklch(L C H) を指定してください`)
      out[k] = c
    }
    return out
  }
  const name = typeof o.name === 'string' && o.name.trim() ? o.name.trim() : fallbackName
  return { name, dark: colors('dark'), light: colors('light') }
}
