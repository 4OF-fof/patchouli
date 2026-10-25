/* 保存先のないときの窓口。見本のライブラリを開き、書き込みは捨てる（ブラウザでの確認と Storybook 用）。 */
import { emptyNote, emptyProject } from '../model/library'
import type { ItemView } from '../plugins/types'
import { PINNED_PROJECTS, PINNED_TAGS, sampleLibrary } from '../samples/library'
import { sampleReport } from '../samples/plugins'
import type { Backend } from './types'

/** 組み込みのプラグインが詳細に出すもの（WASM が返すものと同じ）。 */
const VIEW: Record<string, ItemView> = {
  'patchouli.image': { kind: 'image' },
  'patchouli.video': { kind: 'video' },
  'patchouli.audio': { kind: 'audio' },
}

export function sampleBackend(): Backend {
  let n = 0
  const lib = sampleLibrary()
  return {
    async open() {
      return { lib, pinnedProjects: PINNED_PROJECTS, pinnedTags: PINNED_TAGS, problems: [] }
    },
    async saveItem() {},
    async saveState() {},
    async createNote(name, folder) {
      return emptyNote(`new-${++n}`, name, folder)
    },
    async createProject(name) {
      return emptyProject(name)
    },
    async saveProject() {},
    onThumbnail: () => () => {},
    plugins: async () => sampleReport(),
    async itemView(id) {
      const ext = lib.byId.get(id)?.ext
      const plugin = ext && lib.formats.get(ext)?.plugin
      return (plugin && VIEW[plugin]) || null
    },
  }
}
