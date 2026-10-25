/*
 * 組み込みのプラグインの plugin.json と、そこから決めた形式。デスクトップでは Rust 側が同じ決まりで決めて渡すので、
 * ここで決めたものは見本と Storybook で使う。
 */
import audio from '../../plugins/audio/plugin.json'
import image from '../../plugins/image/plugin.json'
import note from '../../plugins/note/plugin.json'
import video from '../../plugins/video/plugin.json'
import type { FormatInfo, Manifest, Need, Part, PluginReport, Problem } from './types'

/** JSON のままの plugin.json。 */
interface RawManifest extends Omit<Manifest, 'ffmpeg' | 'formats'> {
  ffmpeg?: string
  formats: Record<string, { extends?: string; label?: string; ratio?: number; parts?: string[] }>
}

const PARTS: readonly Part[] = ['thumbnail', 'view']
const NEEDS: readonly Need[] = ['none', 'optional', 'required']

/** 知らない値は捨てる。 */
const readManifest = (raw: RawManifest): Manifest => ({
  ...raw,
  ffmpeg: NEEDS.find((n) => n === raw.ffmpeg) ?? 'none',
  formats: Object.fromEntries(
    Object.entries(raw.formats).map(([ext, d]) => [
      ext,
      { ...d, parts: (d.parts ?? []).flatMap((p) => PARTS.find((x) => x === p) ?? []) },
    ]),
  ),
})

/** 読む順。同じ形式を受け持とうとしたときは、先のものを使う。 */
export const BUILTIN_MANIFESTS = [image, video, audio, note].map(readManifest)

const DEFAULT_RATIO = 1.6

interface Resolved {
  formats: Map<string, FormatInfo>
  problems: Map<string, Problem[]>
}

/** 形式ごとに受け持つプラグインを決め、引き継ぎをたどる。src-tauri/src/plugin/mod.rs と同じ決まり。 */
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
    const parts = new Set<Part>()
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
      for (const p of d.parts ?? []) parts.add(p)
      if (!d.extends) break
      const next = claim.get(d.extends)
      if (!next) add(at.id, `「${fmt}」が引き継ぐ「${d.extends}」を受け持つプラグインがない`)
      at = next
      fmt = d.extends
    }
    formats.set(ext, {
      ext,
      label: label ?? ext.toUpperCase(),
      ratio: ratio ?? DEFAULT_RATIO,
      plugin: owner.id,
      thumbnail: parts.has('thumbnail'),
    })
  }
  return { formats, problems }
}

const builtin = resolveFormats(BUILTIN_MANIFESTS)

/** 組み込みのプラグインだけのときの形式。 */
export const BUILTIN_FORMATS: ReadonlyMap<string, FormatInfo> = builtin.formats

/** FFmpeg を探さない環境での、組み込みのプラグインの一覧。 */
export const builtinReport = (): PluginReport => ({
  plugins: BUILTIN_MANIFESTS.map((m) => ({
    id: m.id,
    name: m.name,
    version: m.version,
    description: m.description ?? '',
    builtin: true,
    state: 'active' as const,
    ffmpeg: m.ffmpeg ?? 'none',
    formats: [...builtin.formats.values()]
      .filter((f) => f.plugin === m.id)
      .map((f) => f.ext)
      .toSorted(),
    settings: [],
    problems: builtin.problems.get(m.id) ?? [],
  })),
})
