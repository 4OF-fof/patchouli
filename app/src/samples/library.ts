/* 画面を確かめるための見本。中身は spec.ts にあり、動作確認用のライブラリ（example/dev-library/）と同じ。 */
import { type Library, buildLibrary } from '../model/library'
import { SAMPLE_FORMATS } from './plugins'
import { TODAY, sampleSpec } from './spec'

export { PINNED_PROJECTS, PINNED_TAGS, TODAY } from './spec'

/** 見本のライブラリを作る。呼ぶたびに同じ中身の新しいものを返す。 */
export function sampleLibrary(): Library {
  const s = sampleSpec()
  const items = s.items.map((i) => ({ ...i, fit: SAMPLE_FORMATS.get(i.ext)?.fit }))
  return buildLibrary(items, s.projects, TODAY, s.tagCovers, s.pins, SAMPLE_FORMATS)
}
