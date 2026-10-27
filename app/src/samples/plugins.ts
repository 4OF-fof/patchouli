import { BUILTIN_MANIFESTS, type RawManifest, readManifest, resolveFormats, statusOf } from '../plugins/builtin'
import type { FormatInfo, PluginReport } from '../plugins/types'
import { EXAMPLE_PLUGINS } from './spec'

const FOUND = import.meta.glob<RawManifest>('../../../example/*/plugin.json', { eager: true, import: 'default' })

const EXAMPLES = EXAMPLE_PLUGINS.flatMap((dir) => {
  const raw = FOUND[`../../../example/${dir}/plugin.json`]
  return raw ? [{ dir, manifest: readManifest(raw) }] : []
})

const resolved = resolveFormats([...BUILTIN_MANIFESTS, ...EXAMPLES.map((e) => e.manifest)])

export const SAMPLE_FORMATS: ReadonlyMap<string, FormatInfo> = resolved.formats

export const sampleReport = (): PluginReport => ({
  plugins: [
    ...BUILTIN_MANIFESTS.map((m) => statusOf(m, resolved, true)),
    ...EXAMPLES.map(({ dir, manifest }) => ({
      ...statusOf(manifest, resolved, false),
      recorded: manifest.version,
      source: { local: `example/dev-zips/${dir}.zip` },
    })),
  ],
})
