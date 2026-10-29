import { emptyNote, emptyProject } from '../model/library'
import type { ItemView } from '../plugins/types'
import { PINNED_PROJECTS, PINNED_TAGS, sampleLibrary } from '../samples/library'
import { sampleReport } from '../samples/plugins'
import type { Backend } from './types'

const VIEW: Record<string, ItemView> = {
  'patchouli.image': { kind: 'image' },
  'patchouli.video': { kind: 'video' },
  'patchouli.audio': { kind: 'audio' },
}

export function sampleBackend(): Backend {
  let n = 0
  const lib = sampleLibrary()
  const imported = new Map<string, string>()
  return {
    async open() {
      return { lib, pinnedProjects: PINNED_PROJECTS, pinnedTags: PINNED_TAGS, problems: [] }
    },
    async saveItem() {
      return undefined
    },
    async moveItem() {
      return undefined
    },
    async renameItem() {
      return undefined
    },
    async deleteItem() {},
    async saveState() {},
    async createNote(name, folder) {
      return emptyNote(`new-${++n}`, name, folder)
    },
    async importData(file, folder) {
      const dot = file.name.lastIndexOf('.')
      const ext = dot > 0 ? file.name.slice(dot + 1).toLowerCase() : ''
      const src = URL.createObjectURL(file)
      const id = `import-${++n}`
      imported.set(id, ext)
      return {
        ...emptyNote(id, dot > 0 ? file.name.slice(0, dot) : file.name, folder),
        note: false,
        ext,
        body: undefined,
        aliases: undefined,
        src,
        thumb: file.type.startsWith('image/') ? src : undefined,
      }
    },
    async createProject(name) {
      return emptyProject(name)
    },
    async saveProject() {},
    async renameProject() {},
    async saveTagCover() {},
    async renameTag() {},
    async deleteTagCover() {},
    onThumbnail: () => () => {},
    plugins: async () => sampleReport(),
    async itemView(id) {
      const ext = lib.byId.get(id)?.ext ?? imported.get(id)
      const plugin = ext && lib.formats.get(ext)?.plugin
      return (plugin && VIEW[plugin]) || null
    },
  }
}
