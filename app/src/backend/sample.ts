/* 保存先のないときの窓口。見本のライブラリを開き、書き込みは捨てる（ブラウザでの確認と Storybook 用）。 */
import { emptyNote, emptyProject } from '../model/library'
import { PINNED_PROJECTS, PINNED_TAGS, sampleLibrary } from '../samples/library'
import type { Backend } from './types'

export function sampleBackend(): Backend {
  let n = 0
  return {
    async open() {
      return { lib: sampleLibrary(), pinnedProjects: PINNED_PROJECTS, pinnedTags: PINNED_TAGS, problems: [] }
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
  }
}
