import { entryId } from '../model/archive'
import { emptyNote, emptyProject } from '../model/library'
import { PINNED_PROJECTS, PINNED_TAGS, sampleLibrary } from '../samples/library'
import { SAMPLE_COVERS, SAMPLE_NOTES, SAMPLE_SCREENS, sampleReport, sampleUiUrl } from '../samples/plugins'
import { sampleSpec } from '../samples/spec'
import type { SettingValue } from '../../plugins/sdk'
import type { Backend } from './types'

export function sampleBackend(): Backend {
  let n = 0
  const lib = sampleLibrary()
  const imported = new Map<string, string>()
  const data = new Map<string, string>()
  const settings = new Map<string, Record<string, SettingValue>>()
  const specs = new Map(sampleSpec().items.map((i) => [i.id, i]))
  const byName = new Map(lib.items.map((i) => [i.name, i]))
  const filesIn = (id: string) => specs.get(id)?.archive ?? {}
  const inner = (id: string, path: string) => {
    const f = filesIn(id)[path]
    return typeof f === 'object' ? byName.get(f.item) : undefined
  }
  return {
    archive: {
      entries: async (id) =>
        Object.entries(filesIn(id)).map(([path, f]) => ({
          path,
          size: typeof f === 'string' ? new Blob([f]).size : path.length * 73_000,
          encrypted: false,
        })),
      extract: async (id, path) => {
        const entry = entryId(id, path)
        const it = inner(id, path)
        if (it) imported.set(entry, it.ext)
        return { id: entry, url: it?.src ?? '' }
      },
      thumbs: async (id, paths, onThumb) => {
        for (const path of paths) {
          const it = inner(id, path)
          if (it?.thumb) onThumb({ path, url: it.thumb, width: Math.round(it.ratio * 1000), height: 1000 })
        }
      },
    },
    async open() {
      return { lib, pinnedProjects: PINNED_PROJECTS, pinnedTags: PINNED_TAGS, screens: SAMPLE_SCREENS, problems: [] }
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
    async createNote(name, place) {
      return emptyNote(`new-${++n}`, name, place)
    },
    async importData(file, place) {
      const dot = file.name.lastIndexOf('.')
      const ext = dot > 0 ? file.name.slice(dot + 1).toLowerCase() : ''
      const src = URL.createObjectURL(file)
      const id = `import-${++n}`
      imported.set(id, ext)
      return {
        ...emptyNote(id, dot > 0 ? file.name.slice(0, dot) : file.name, place),
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
    async deleteProject() {},
    async saveTagCover() {},
    async renameTag() {},
    async deleteTagCover() {},
    onThumbnail: () => () => {},
    plugins: async () => sampleReport(),
    uiUrl: sampleUiUrl,
    notes: () => SAMPLE_NOTES,
    covers: () => SAMPLE_COVERS,
    ownApi: (plugin) => ({
      settings: async () => ({ ...settings.get(plugin) }),
      setSetting: async (key, value) => void settings.set(plugin, { ...settings.get(plugin), [key]: value }),
      getData: async (key) =>
        data.get(`${plugin}
${key}`),
      setData: async (key, value) => {
        if (value === undefined)
          data.delete(`${plugin}
${key}`)
        else
          data.set(
            `${plugin}
${key}`,
            value,
          )
      },
    }),
    async itemView(id) {
      const ext = lib.byId.get(id)?.ext ?? imported.get(id)
      const media = ext && lib.formats.get(ext)?.media
      return media ? { kind: media } : null
    },
  }
}
