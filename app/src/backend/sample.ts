import { emptyNote, emptyProject } from '../model/library'
import { PINNED_PROJECTS, PINNED_TAGS, sampleLibrary } from '../samples/library'
import { SAMPLE_SCREENS, sampleReport, sampleUiUrl } from '../samples/plugins'
import type { SettingValue } from '../../plugins/sdk'
import type { Backend } from './types'

export function sampleBackend(): Backend {
  let n = 0
  const lib = sampleLibrary()
  const imported = new Map<string, string>()
  const data = new Map<string, string>()
  const settings = new Map<string, Record<string, SettingValue>>()
  return {
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
