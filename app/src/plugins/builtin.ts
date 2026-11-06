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
  Fit,
  FormatDecl,
  FormatInfo,
  LinkPart,
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
  links?: Record<string, { elevated?: string[] }>
  formats?: RawFormat[]
}

const PARTS: readonly Part[] = ['thumbnail', 'view', 'details', 'excerpt', 'hover', 'embed', 'link']
const LINK_PARTS: readonly LinkPart[] = ['thumbnail', 'view', 'embed', 'details']
const FITS: readonly Fit[] = ['center', 'top', 'contain']
const MEDIA: readonly Media[] = ['image', 'video', 'audio']

const partsOf = (raw?: string[]) => (raw ?? []).flatMap((p) => PARTS.find((x) => x === p) ?? [])

export const readManifest = (raw: RawManifest): Manifest => ({
  ...raw,
  links: Object.fromEntries(
    Object.entries(raw.links ?? {}).map(([host, d]) => [
      host,
      { elevated: (d.elevated ?? []).flatMap((p) => LINK_PARTS.find((x) => x === p) ?? []) },
    ]),
  ),
  formats: (raw.formats ?? []).map((d) => ({
    ...d,
    ext: d.ext.map((e) => e.toLowerCase()),
    fit: FITS.find((f) => f === d.fit),
    media: MEDIA.find((m) => m === d.media),
    parts: partsOf(d.parts),
    script: partsOf(d.script),
  })),
})

export const BUILTIN_MANIFESTS = [image, video, audio, shortcut, youtube].map(readManifest)

const DEFAULT_RATIO = 1.6

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
  const formats = new Map<string, FormatInfo>()
  for (const [ext, owner] of claim) {
    const d = declOf.get(owner)?.get(ext)
    if (!d) continue
    const parts = d.parts ?? []
    const ui = (p: Part): UiRef | undefined =>
      owner.script && parts.includes(p) && d.script?.includes(p)
        ? { plugin: owner.id, module: owner.script }
        : undefined
    const uiLink = ui('link')
    const uiThumbnail = ui('thumbnail')
    const uiHover = ui('hover')
    const uiEmbed = ui('embed')
    formats.set(ext, {
      ext,
      label: d.label ?? ext.toUpperCase(),
      ratio: d.ratio ?? DEFAULT_RATIO,
      fit: d.fit ?? 'center',
      plugin: owner.id,
      thumbnail: parts.includes('thumbnail') || parts.includes('link'),
      ...(uiLink && { uiLink }),
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
      (d.parts ?? []).map((part): Cap => ({ part, by: d.script?.includes(part) ? 'elevated' : 'sandbox' })),
    ),
    ...Object.values(m.links ?? {}).flatMap((d) => (d.elevated ?? []).map((part): Cap => ({ part, by: 'elevated' }))),
    ...(m.menu ? [{ part: 'menu', by: m.menu.by } as const] : []),
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
  links: Object.keys(m.links ?? {}).toSorted(),
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
