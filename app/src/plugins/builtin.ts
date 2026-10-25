/*
 * 組み込みのプラグインの plugin.json と、そこから決めた形式。デスクトップでは Rust 側が同じ決まりで決めて渡すので、
 * ここで決めたものは見本と Storybook で使う。
 */
import audio from '../../plugins/audio/plugin.json'
import image from '../../plugins/image/plugin.json'
import note from '../../plugins/note/plugin.json'
import video from '../../plugins/video/plugin.json'
import type { Cap, Deps, FormatInfo, Manifest, Part, PluginReport, PluginStatus, Problem } from './types'

/** JSON のままの plugin.json。 */
export interface RawManifest extends Omit<Manifest, 'formats'> {
  formats: Record<string, { extends?: string; label?: string; ratio?: number; parts?: string[]; ui?: string[] }>
}

const PARTS: readonly Part[] = ['thumbnail', 'view']

const partsOf = (raw?: string[]) => (raw ?? []).flatMap((p) => PARTS.find((x) => x === p) ?? [])

/** 知らない値は捨てる。 */
export const readManifest = (raw: RawManifest): Manifest => ({
  ...raw,
  formats: Object.fromEntries(
    Object.entries(raw.formats).map(([ext, d]) => [ext, { ...d, parts: partsOf(d.parts), ui: partsOf(d.ui) }]),
  ),
})

/** 読む順。同じ形式を受け持とうとしたときは、先のものを使う。 */
export const BUILTIN_MANIFESTS = [image, video, audio, note].map(readManifest)

const DEFAULT_RATIO = 1.6

export interface Resolved {
  formats: Map<string, FormatInfo>
  problems: Map<string, Problem[]>
}

/**
 * 形式ごとに受け持つプラグインを決め、引き継ぎをたどる。src-tauri/src/plugin/mod.rs と同じ決まり。
 * 処理の部分や組み込み UI が本当にあるかは確かめない。
 */
export function resolveFormats(manifests: Manifest[]): Resolved {
  const problems = new Map<string, Problem[]>(manifests.map((m) => [m.id, []]))
  const add = (id: string, text: string) => problems.get(id)?.push({ level: 'error', text })
  const claim = new Map<string, Manifest>()
  for (const m of manifests)
    for (const ext of Object.keys(m.formats)) {
      const first = claim.get(ext)
      if (!first) {
        claim.set(ext, m)
        continue
      }
      add(first.id, `「${ext}」を「${m.name}」も受け持とうとしている。こちらを使う`)
      add(m.id, `「${ext}」はもう「${first.name}」が受け持っているので、受け持てない`)
    }
  const formats = new Map<string, FormatInfo>()
  for (const [ext, owner] of claim) {
    let label: string | undefined
    let ratio: number | undefined
    const parts = new Map<Part, Manifest | 'wasm'>()
    const seen = new Set<string>()
    let at: Manifest | undefined = owner
    let fmt = ext
    while (at) {
      if (seen.has(fmt)) {
        add(owner.id, `「${ext}」の引き継ぎが輪になっている`)
        break
      }
      seen.add(fmt)
      const d = at.formats[fmt]
      if (!d) break
      label ??= d.label
      ratio ??= d.ratio
      for (const p of d.parts ?? []) if (!parts.has(p)) parts.set(p, 'wasm')
      for (const p of d.ui ?? []) if (!parts.has(p) && at.ui) parts.set(p, at)
      if (!d.extends) break
      const next = claim.get(d.extends)
      if (!next) add(at.id, `「${fmt}」が引き継ぐ「${d.extends}」を受け持つプラグインがない`)
      at = next
      fmt = d.extends
    }
    const ui = parts.get('thumbnail')
    formats.set(ext, {
      ext,
      label: label ?? ext.toUpperCase(),
      ratio: ratio ?? DEFAULT_RATIO,
      plugin: owner.id,
      thumbnail: parts.has('thumbnail'),
      ...(ui && ui !== 'wasm' && ui.ui && { uiThumbnail: { plugin: ui.id, module: ui.ui } }),
    })
  }
  return { formats, problems }
}

const resolvedBuiltin = resolveFormats(BUILTIN_MANIFESTS)

/** 受け持つもの（形式をまたいでまとめる）。 */
const capsOf = (m: Manifest): Cap[] => {
  const has = (p: Part, k: 'parts' | 'ui') => Object.values(m.formats).some((d) => d[k]?.includes(p))
  return [
    ...PARTS.filter((p) => has(p, 'parts')).map((part): Cap => ({ part, by: 'wasm' })),
    ...PARTS.filter((p) => has(p, 'ui')).map((part): Cap => ({ part, by: 'ui' })),
  ]
}

const depsOf = (d?: Deps): Deps => ({ commands: d?.commands ?? [], plugins: d?.plugins ?? [] })

/** 使っているプラグインの状態。設定の項目は WASM が返すので、ここでは空にする。 */
export const statusOf = (m: Manifest, r: Resolved, builtin: boolean): PluginStatus => ({
  id: m.id,
  name: m.name,
  version: m.version,
  description: m.description ?? '',
  builtin,
  state: 'active',
  required: depsOf(m.required),
  optional: depsOf(m.optional),
  caps: capsOf(m),
  formats: [...r.formats.values()]
    .filter((f) => f.plugin === m.id)
    .map((f) => f.ext)
    .toSorted(),
  settings: [],
  problems: r.problems.get(m.id) ?? [],
})

/** 組み込みのプラグインだけのときの形式。 */
export const BUILTIN_FORMATS: ReadonlyMap<string, FormatInfo> = resolvedBuiltin.formats

/** コマンドを探さない環境での、組み込みのプラグインの一覧。 */
export const builtinReport = (): PluginReport => ({
  plugins: BUILTIN_MANIFESTS.map((m) => statusOf(m, resolvedBuiltin, true)),
})
