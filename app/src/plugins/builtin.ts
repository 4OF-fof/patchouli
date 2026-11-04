/*
 * 組み込みのプラグインの plugin.json と、そこから決めた形式。デスクトップでは Rust 側が同じ決まりで決めて渡すので、
 * ここで決めたものは見本と Storybook で使う。
 */
import audio from '../../plugins/audio/plugin.json'
import image from '../../plugins/image/plugin.json'
import shortcut from '../../plugins/shortcut/plugin.json'
import video from '../../plugins/video/plugin.json'
import youtube from '../../plugins/youtube/plugin.json'
import type {
  Cap,
  Conflict,
  Deps,
  Embed,
  Fit,
  FormatInfo,
  Hover,
  LinkPart,
  Manifest,
  Part,
  PluginReport,
  PluginStatus,
  Problem,
} from './types'

export interface RawManifest extends Omit<Manifest, 'formats' | 'links'> {
  links?: Record<string, { elevated?: string[] }>
  formats?: Record<
    string,
    {
      extends?: string
      label?: string
      ratio?: number
      fit?: string
      hover?: string
      embed?: string
      sandbox?: boolean
      elevated?: string[]
      keepDecoded?: boolean
    }
  >
}

const PARTS: readonly Part[] = ['thumbnail', 'view', 'waveform', 'hover', 'details', 'embed', 'content', 'link']
/** WASM が受け持つものは export で決まる。ここでは WASM を読まないので、組み込みの WASM が export するものを使う。 */
const WASM_PARTS: readonly Part[] = ['thumbnail', 'view', 'details', 'content']
const LINK_PARTS: readonly LinkPart[] = ['thumbnail', 'view', 'embed', 'details']
const FITS: readonly Fit[] = ['center', 'top', 'contain']
const HOVERS: readonly Hover[] = ['video', 'audio']
const EMBEDS: readonly Embed[] = ['view', 'card']

const partsOf = (raw?: string[]) => (raw ?? []).flatMap((p) => PARTS.find((x) => x === p) ?? [])

export const readManifest = (raw: RawManifest): Manifest => ({
  ...raw,
  links: Object.fromEntries(
    Object.entries(raw.links ?? {}).map(([host, d]) => [
      host,
      { elevated: (d.elevated ?? []).flatMap((p) => LINK_PARTS.find((x) => x === p) ?? []) },
    ]),
  ),
  formats: Object.fromEntries(
    Object.entries(raw.formats ?? {}).map(([ext, d]) => [
      ext.toLowerCase(),
      {
        ...d,
        extends: d.extends?.toLowerCase(),
        fit: FITS.find((f) => f === d.fit),
        hover: HOVERS.find((h) => h === d.hover),
        embed: EMBEDS.find((e) => e === d.embed),
        elevated: partsOf(d.elevated),
      },
    ]),
  ),
})

export const BUILTIN_MANIFESTS = [image, video, audio, shortcut, youtube].map(readManifest)

const DEFAULT_RATIO = 1.6

export interface Resolved {
  formats: Map<string, FormatInfo>
  problems: Map<string, Problem[]>
  conflicts: Conflict[]
}

/**
 * 形式ごとに受け持つプラグインを決め、引き継ぎをたどる。src-tauri/src/plugin/mod.rs と同じ決まり。
 * 処理の部分や組み込み UI が本当にあるかは確かめない。
 */
export function resolveFormats(
  manifests: Manifest[],
  builtin: (m: Manifest) => boolean = (m) => BUILTIN_MANIFESTS.includes(m),
): Resolved {
  const problems = new Map<string, Problem[]>(manifests.map((m) => [m.id, []]))
  const add = (id: string, text: string, level: Problem['level'] = 'error') => problems.get(id)?.push({ level, text })
  const claims = new Map<string, Manifest[]>()
  for (const m of manifests)
    for (const ext of Object.keys(m.formats ?? {})) claims.set(ext, [...(claims.get(ext) ?? []), m])
  const claim = new Map<string, Manifest>()
  const conflicts: Conflict[] = []
  for (const [ext, by] of [...claims].toSorted(([a], [b]) => (a < b ? -1 : 1))) {
    let owner: Manifest | undefined
    for (const side of [by.filter((m) => !builtin(m)), by.filter(builtin)]) {
      if (!side.length) continue
      if (owner) {
        for (const m of side) add(m.id, `「.${ext}」は「${owner.name}」が対応しているため、使用していません`, 'warning')
        continue
      }
      const [only, ...more] = side
      if (only && !more.length) {
        owner = only
        continue
      }
      for (const m of side) {
        const others = side.filter((o) => o !== m).map((o) => `「${o.name}」`)
        add(m.id, `「.${ext}」は${others.join('')}も対応しているため、使用していません`)
      }
      conflicts.push({ ext, plugins: side.map((m) => m.id) })
    }
    if (owner) claim.set(ext, owner)
  }
  const formats = new Map<string, FormatInfo>()
  for (const [ext, owner] of claim) {
    let label: string | undefined
    let ratio: number | undefined
    let fit: Fit | undefined
    let hover: Hover | undefined
    let embed: Embed | undefined
    const parts = new Map<Part, Manifest | 'sandbox'>()
    const seen = new Set<string>()
    let at: Manifest | undefined = owner
    let fmt = ext
    while (at) {
      if (seen.has(fmt)) {
        add(owner.id, `「.${ext}」の形式定義（extends）が循環しています`)
        break
      }
      seen.add(fmt)
      const d = at.formats?.[fmt]
      if (!d) break
      label ??= d.label
      ratio ??= d.ratio
      fit ??= d.fit
      hover ??= d.hover
      embed ??= d.embed
      for (const p of d.elevated ?? []) {
        const now = parts.get(p)
        if ((now === undefined || now === 'sandbox') && at.elevated) parts.set(p, at)
      }
      if (d.sandbox) for (const p of WASM_PARTS) if (!parts.has(p)) parts.set(p, 'sandbox')
      if (!d.extends) break
      const next = claim.get(d.extends)
      if (!next) add(at.id, `「.${fmt}」が引き継ぐ「.${d.extends}」に対応するプラグインがありません`)
      at = next
      fmt = d.extends
    }
    const ui = parts.get('thumbnail')
    const wave = parts.get('waveform')
    const hoverUi = parts.get('hover')
    const embedUi = parts.get('embed')
    const linkUi = parts.get('link')
    formats.set(ext, {
      ext,
      label: label ?? ext.toUpperCase(),
      ratio: ratio ?? DEFAULT_RATIO,
      fit: fit ?? 'center',
      plugin: owner.id,
      thumbnail: parts.has('thumbnail') || parts.has('link'),
      ...(linkUi &&
        linkUi !== 'sandbox' &&
        linkUi.elevated && { uiLink: { plugin: linkUi.id, module: linkUi.elevated } }),
      ...(ui && ui !== 'sandbox' && ui.elevated && { uiThumbnail: { plugin: ui.id, module: ui.elevated } }),
      ...(wave && wave !== 'sandbox' && wave.elevated && { uiWaveform: { plugin: wave.id, module: wave.elevated } }),
      ...(hover && { hover }),
      ...(hoverUi &&
        hoverUi !== 'sandbox' &&
        hoverUi.elevated && { uiHover: { plugin: hoverUi.id, module: hoverUi.elevated } }),
      ...(embed && { embed }),
      ...(embedUi &&
        embedUi !== 'sandbox' &&
        embedUi.elevated && { uiEmbed: { plugin: embedUi.id, module: embedUi.elevated } }),
    })
  }
  return { formats, problems, conflicts }
}

const resolvedBuiltin = resolveFormats(BUILTIN_MANIFESTS)

const capsOf = (m: Manifest): Cap[] => {
  const formats = Object.values(m.formats ?? {})
  const elevated = (p: Part) =>
    formats.some((d) => d.elevated?.includes(p)) ||
    Object.values(m.links ?? {}).some((d) => d.elevated?.some((x) => x === p))
  return [
    ...(formats.some((d) => d.sandbox) ? WASM_PARTS.map((part): Cap => ({ part, by: 'sandbox' })) : []),
    ...PARTS.filter(elevated).map((part): Cap => ({ part, by: 'elevated' })),
    ...(m.menu ? [{ part: 'menu', by: m.menu.by } as const] : []),
  ]
}

const depsOf = (d?: Deps): Deps => ({ commands: d?.commands ?? {}, plugins: d?.plugins ?? {} })

export const statusOf = (m: Manifest, r: Resolved, builtin: boolean): PluginStatus => ({
  id: m.id,
  name: m.name,
  version: m.version,
  description: m.description ?? '',
  builtin,
  dev: false,
  enabled: true,
  state: 'active',
  required: depsOf(m.required),
  optional: depsOf(m.optional),
  via: [],
  caps: capsOf(m),
  formats: [...r.formats.values()]
    .filter((f) => f.plugin === m.id)
    .map((f) => f.ext)
    .toSorted(),
  links: Object.keys(m.links ?? {}).toSorted(),
  screens: Object.values(m.screens ?? {}).map((d) => d.label),
  permissions: m.permissions ?? [],
  elevated: !!m.elevated,
  fetch: m.fetch ?? [],
  settings: [],
  problems: r.problems.get(m.id) ?? [],
})

export const BUILTIN_FORMATS: ReadonlyMap<string, FormatInfo> = resolvedBuiltin.formats

export const builtinReport = (): PluginReport => ({
  plugins: BUILTIN_MANIFESTS.map((m) => statusOf(m, resolvedBuiltin, true)),
  conflicts: resolvedBuiltin.conflicts,
})
