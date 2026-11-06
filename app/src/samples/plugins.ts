import { BUILTIN_MANIFESTS, type RawManifest, readManifest, resolveFormats, statusOf } from '../plugins/builtin'
import type { FormatInfo, PluginReport, ScreenInfo, UiRef } from '../plugins/types'
import { EXAMPLE_PLUGINS } from './spec'

const FOUND = import.meta.glob<RawManifest>('../../../example/*/plugin.json', { eager: true, import: 'default' })
/** 例のプラグインのスクリプト。scripts/dev-library.ts が dist にビルドしたもの。 */
const BUILT = import.meta.glob<string>('../../../example/*/dist/**/*.js', {
  eager: true,
  query: '?url',
  import: 'default',
})

const EXAMPLES = EXAMPLE_PLUGINS.flatMap((dir) => {
  const raw = FOUND[`../../../example/${dir}/plugin.json`]
  return raw ? [{ dir, manifest: readManifest(raw) }] : []
})

const resolved = resolveFormats([...BUILTIN_MANIFESTS, ...EXAMPLES.map((e) => e.manifest)])

export const SAMPLE_FORMATS: ReadonlyMap<string, FormatInfo> = resolved.formats

export const SAMPLE_SCREENS: ScreenInfo[] = EXAMPLES.flatMap(({ manifest: m }) => {
  const module = m.script
  if (!module) return []
  return Object.entries(m.screens ?? {}).map(([id, d]) => ({
    id,
    label: d.label,
    icon: d.icon,
    place: d.place ?? true,
    plugin: m.id,
    module,
  }))
})

/** 例のプラグインのスクリプトの URL。ビルドしていなければ空。 */
export const sampleUiUrl = (ui: UiRef) => {
  const dir = EXAMPLES.find((e) => e.manifest.id === ui.plugin)?.dir
  return (dir && BUILT[`../../../example/${dir}/dist/${ui.module}`]) || ''
}

export const sampleReport = (): PluginReport => ({
  plugins: [
    ...BUILTIN_MANIFESTS.map((m) => statusOf(m, resolved, true)),
    ...EXAMPLES.map(({ dir, manifest }) => ({
      ...statusOf(manifest, resolved, false),
      recorded: manifest.version,
      source: { local: `example/dev-zips/${dir}.zip` },
    })),
  ],
  conflicts: resolved.conflicts,
})
