/*
 * コア機能の plugin.json と、そこから決めた形式。デスクトップでは Rust 側が同じ決まりで決めて渡すので、
 * ここで決めたものは見本と Storybook で使う。
 */
import audio from '../../plugins/audio/plugin.json'
import image from '../../plugins/image/plugin.json'
import video from '../../plugins/video/plugin.json'
import youtube from '../../plugins/youtube/plugin.json'
import type {
  Cap,
  Conflict,
  Deps,
  Fit,
  FormatDecl,
  FormatInfo,
  Manifest,
  Media,
  Part,
  PluginReport,
  PluginStatus,
  Problem,
  UiRef,
} from './types'

type RawFormat = Omit<FormatDecl, 'fit' | 'media' | 'parts' | 'script'> & {
  fit?: string
  media?: string
  parts?: string[]
  script?: string[]
}

export interface RawManifest extends Omit<Manifest, 'formats' | 'links'> {
  links?: { host: string[]; parts?: string[] }[]
  formats?: RawFormat[]
}

const PARTS: readonly Part[] = ['thumbnail', 'view', 'details', 'excerpt', 'hover', 'embed']
const FITS: readonly Fit[] = ['center', 'top', 'contain']
const MEDIA: readonly Media[] = ['image', 'video', 'audio']

const partsOf = (raw?: string[]) => (raw ?? []).flatMap((p) => PARTS.find((x) => x === p) ?? [])

export const readManifest = (raw: RawManifest): Manifest => ({
  ...raw,
  links: (raw.links ?? []).map((d) => ({ host: d.host.map((h) => h.toLowerCase()), parts: partsOf(d.parts) })),
  formats: (raw.formats ?? []).map((d) => ({
    ...d,
    ext: d.ext.map((e) => e.toLowerCase()),
    fit: FITS.find((f) => f === d.fit),
    media: MEDIA.find((m) => m === d.media),
    parts: partsOf(d.parts),
    script: partsOf(d.script),
  })),
})

export const BUILTIN_MANIFESTS = [image, video, audio, youtube].map(readManifest)

const DEFAULT_RATIO = 1.6

/** 本体が読むショートカット。src-tauri/src/library/shortcut.rs と合わせる。 */
const SHORTCUT: FormatInfo = {
  ext: 'url',
  label: 'ショートカット',
  ratio: 1.91,
  fit: 'center',
  thumbnail: true,
  link: true,
}

export interface Resolved {
  formats: Map<string, FormatInfo>
  problems: Map<string, Problem[]>
  conflicts: Conflict[]
}

/**
 * 形式ごとに受け持つプラグインを決める。src-tauri/src/plugin/mod.rs と同じ決まり。
 * WASM の export や、スクリプトが本当にあるかは確かめない。
 */
export function resolveFormats(
  manifests: Manifest[],
  builtin: (m: Manifest) => boolean = (m) => BUILTIN_MANIFESTS.includes(m),
): Resolved {
  const problems = new Map<string, Problem[]>(manifests.map((m) => [m.id, []]))
  const add = (id: string, text: string, level: Problem['level'] = 'error') => problems.get(id)?.push({ level, text })
  const claims = new Map<string, Manifest[]>()
  const declOf = new Map<Manifest, Map<string, FormatDecl>>()
  for (const m of manifests) {
    const own = new Map<string, FormatDecl>()
    for (const d of m.formats ?? [])
      for (const ext of d.ext) {
        if (ext === SHORTCUT.ext) {
          add(m.id, `「.${ext}」は本体が読むため、使用していません`, 'warning')
          continue
        }
        if (own.has(ext)) {
          add(m.id, `「.${ext}」を formats に 2 回書いています`)
          continue
        }
        own.set(ext, d)
        claims.set(ext, [...(claims.get(ext) ?? []), m])
      }
    declOf.set(m, own)
  }
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
  const formats = new Map<string, FormatInfo>([[SHORTCUT.ext, SHORTCUT]])
  for (const [ext, owner] of claim) {
    const d = declOf.get(owner)?.get(ext)
    if (!d) continue
    const parts = d.parts ?? []
    const ui = (p: Part): UiRef | undefined =>
      owner.script && parts.includes(p) && d.script?.includes(p)
        ? { plugin: owner.id, module: owner.script }
        : undefined
    const uiThumbnail = ui('thumbnail')
    const uiHover = ui('hover')
    const uiEmbed = ui('embed')
    formats.set(ext, {
      ext,
      label: d.label ?? ext.toUpperCase(),
      ratio: d.ratio ?? DEFAULT_RATIO,
      fit: d.fit ?? 'center',
      plugin: owner.id,
      thumbnail: parts.includes('thumbnail'),
      ...(uiThumbnail && { uiThumbnail }),
      ...(d.media && { media: d.media }),
      ...(uiHover && { uiHover }),
      ...(uiEmbed && { uiEmbed }),
    })
  }
  return { formats, problems, conflicts }
}

const resolvedBuiltin = resolveFormats(BUILTIN_MANIFESTS)

const capsOf = (m: Manifest): Cap[] => {
  const caps: Cap[] = [
    ...(m.formats ?? []).flatMap((d) =>
      (d.parts ?? []).map((part): Cap => ({ part, by: d.script?.includes(part) ? 'script' : 'wasm' })),
    ),
    ...(m.links ?? []).flatMap((d) => (d.parts ?? []).map((part): Cap => ({ part, by: 'script' }))),
    ...(m.menu ? [{ part: 'menu', by: 'wasm' } as const] : []),
  ]
  return caps.filter((c, i) => caps.findIndex((x) => x.part === c.part && x.by === c.by) === i)
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
  links: (m.links ?? []).flatMap((d) => d.host).toSorted(),
  screens: Object.values(m.screens ?? {}).map((d) => d.label),
  permissions: m.permissions ?? [],
  script: !!m.script,
  fetch: m.fetch ?? [],
  settings: [],
  problems: r.problems.get(m.id) ?? [],
})

export const BUILTIN_FORMATS: ReadonlyMap<string, FormatInfo> = resolvedBuiltin.formats

export const builtinReport = (): PluginReport => ({
  plugins: BUILTIN_MANIFESTS.map((m) => statusOf(m, resolvedBuiltin, true)),
  conflicts: resolvedBuiltin.conflicts,
})
