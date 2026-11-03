import { createSignal } from 'solid-js'

export type TabsAt = 'top' | 'left'
export type Sort = 'moved' | 'name' | 'kind'
/** プラグインが足す画面。プラグインの id と画面の id を / でつなぐ。 */
export type ScreenStart = `screen:${string}`

/** この端末の画面まわりの設定。 */
export interface Prefs {
  /** 起動したときに、前に開いていたタブを戻すか、ホームかプラグインの画面だけを開くか */
  start: 'last' | 'home' | ScreenStart
  /** ノートのリンクを押したときの開き方 */
  openLink: 'peek' | 'here' | 'tab'
  theme: 'system' | 'light' | 'dark'
  tabsAt: TabsAt
  cardSize: 'S' | 'M' | 'L'
  sort: Sort
  /** 動画や音声のサムネイルにマウスを乗せたときに再生するか */
  hoverPreview: boolean
  /** サムネイルで再生するときに音を出すか */
  hoverSound: boolean
  noteFont: 'S' | 'M' | 'L'
  noteWidth: 'narrow' | 'normal' | 'wide'
  /** ノートを開いたときに、見出しのカードを開いておくか */
  headsOpen: boolean
}

export const DEFAULT_PREFS: Prefs = {
  start: 'last',
  openLink: 'peek',
  theme: 'dark',
  tabsAt: 'top',
  cardSize: 'M',
  sort: 'moved',
  hoverPreview: true,
  hoverSound: false,
  noteFont: 'M',
  noteWidth: 'normal',
  headsOpen: true,
}

const KEY = 'patchouli.prefs'
const OLD_TABS_AT = 'patchouli.tabsAt'

const CHOICES: { [K in keyof Prefs]: readonly Prefs[K][] } = {
  start: ['last', 'home'],
  openLink: ['peek', 'here', 'tab'],
  theme: ['system', 'light', 'dark'],
  tabsAt: ['top', 'left'],
  cardSize: ['S', 'M', 'L'],
  sort: ['moved', 'name', 'kind'],
  hoverPreview: [true, false],
  hoverSound: [true, false],
  noteFont: ['S', 'M', 'L'],
  noteWidth: ['narrow', 'normal', 'wide'],
  headsOpen: [true, false],
}

export const screenStart = (plugin: string, id: string): ScreenStart => `screen:${plugin}/${id}`

const isScreenStart = (v: unknown): v is ScreenStart => typeof v === 'string' && v.startsWith('screen:')

/** 保存してあったものから、いまの選択肢にある値だけを拾う。 */
const pick = <K extends keyof Prefs>(saved: Record<string, unknown>, key: K): Prefs[K] =>
  CHOICES[key].find((c) => c === saved[key]) ?? DEFAULT_PREFS[key]

const read = (): Prefs => {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    const saved: Record<string, unknown> = typeof raw === 'object' && raw ? { ...raw } : {}
    if (!('tabsAt' in saved) && localStorage.getItem(OLD_TABS_AT) === 'left') saved.tabsAt = 'left'
    return {
      start: isScreenStart(saved.start) ? saved.start : pick(saved, 'start'),
      openLink: pick(saved, 'openLink'),
      theme: pick(saved, 'theme'),
      tabsAt: pick(saved, 'tabsAt'),
      cardSize: pick(saved, 'cardSize'),
      sort: pick(saved, 'sort'),
      hoverPreview: pick(saved, 'hoverPreview'),
      hoverSound: pick(saved, 'hoverSound'),
      noteFont: pick(saved, 'noteFont'),
      noteWidth: pick(saved, 'noteWidth'),
      headsOpen: pick(saved, 'headsOpen'),
    }
  } catch {
    return DEFAULT_PREFS
  }
}

const [prefs, setAll] = createSignal<Prefs>(read())

export { prefs }

export const setPrefs = (patch: Partial<Prefs>) => {
  const next = { ...prefs(), ...patch }
  setAll(next)
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
    localStorage.removeItem(OLD_TABS_AT)
  } catch {}
}

const dark = () => typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches

/** いま使っているテーマ。system なら OS に合わせる。 */
export const themeOf = (p: Prefs): 'light' | 'dark' => (p.theme === 'system' ? (dark() ? 'dark' : 'light') : p.theme)

const SCALE = { S: 0.85, M: 1, L: 1.2 } as const
const NOTE_WIDTH = { narrow: 640, normal: 880, wide: 1080 } as const

/** 設定を、ページ全体のテーマと CSS 変数に写す。設定や OS のテーマが変わるたびに呼ぶ。 */
export const applyPrefs = (p: Prefs, root = document.documentElement) => {
  if (themeOf(p) === 'light') root.dataset.theme = 'light'
  else delete root.dataset.theme
  root.style.setProperty('--card-scale', String(SCALE[p.cardSize]))
  root.style.setProperty('--note-scale', String(SCALE[p.noteFont]))
  root.style.setProperty('--note-width', `${NOTE_WIDTH[p.noteWidth]}px`)
}
