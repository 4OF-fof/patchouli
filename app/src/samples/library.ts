import { type Library, buildLibrary } from '../model/library'
import { SAMPLE_FORMATS } from './plugins'
import { TODAY, sampleSpec } from './spec'

export { PINNED_PROJECTS, PINNED_TAGS, TODAY } from './spec'

export function sampleLibrary(): Library {
  const s = sampleSpec()
  const items = s.items.map((i) => ({ ...i, fit: SAMPLE_FORMATS.get(i.ext)?.fit }))
  return buildLibrary(items, s.projects, TODAY, s.tagCovers, s.pins, SAMPLE_FORMATS)
}
