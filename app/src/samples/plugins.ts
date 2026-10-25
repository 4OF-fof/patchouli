/*
 * 画面の見本で使うプラグイン。組み込みのものに、動作確認用のライブラリと同じ例のプラグイン（spec.ts の EXAMPLE_PLUGINS）を足す。
 * 見本では例のプラグインを動かさないので、サムネイルと詳細は代わりの絵になる。
 */
import { BUILTIN_MANIFESTS, type RawManifest, readManifest, resolveFormats, statusOf } from '../plugins/builtin'
import type { FormatInfo, PluginReport } from '../plugins/types'
import { EXAMPLE_PLUGINS } from './spec'

const FOUND = import.meta.glob<RawManifest>('../../../example/*/plugin.json', { eager: true, import: 'default' })

const EXAMPLES = EXAMPLE_PLUGINS.flatMap((dir) => {
  const raw = FOUND[`../../../example/${dir}/plugin.json`]
  return raw ? [{ dir, manifest: readManifest(raw) }] : []
})

const resolved = resolveFormats([...BUILTIN_MANIFESTS, ...EXAMPLES.map((e) => e.manifest)])

/** 見本のライブラリで扱える形式。 */
export const SAMPLE_FORMATS: ReadonlyMap<string, FormatInfo> = resolved.formats

/** 見本のプラグインの一覧。例のプラグインは、ライブラリに記録してあり、example/dev-zips/ の zip から入れたものとする。 */
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
