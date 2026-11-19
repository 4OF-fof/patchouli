import { createSignal } from 'solid-js'
import type { Backend, LibraryState } from '../backend'
import type { Library } from '../model/library'
import type { ScreenInfo } from '../plugins/types'

export interface StateDeps {
  lib: Library
  screens?: ScreenInfo[]
  pinnedProjects?: string[]
  pinnedTags?: string[]
  backend: Backend
  persist: (job: () => Promise<void>) => void
}

/** 開いているライブラリ、プラグインが足す画面、ピン留め。 */
export function createLibraryState(d: StateDeps) {
  const { backend, persist } = d
  const [lib, setLib] = createSignal(d.lib)
  const [screens, setScreens] = createSignal(d.screens ?? [])

  const [pinnedProjects, setPinnedProjects] = createSignal(d.pinnedProjects ?? [])
  const [pinnedTags, setPinnedTags] = createSignal(d.pinnedTags ?? [])

  const state = (): LibraryState => ({
    pins: lib().pins,
    pinnedProjects: pinnedProjects(),
    pinnedTags: pinnedTags(),
  })
  const saveState = () => {
    const s = state()
    persist(() => backend.saveState(s))
  }
  return { lib, setLib, screens, setScreens, pinnedProjects, setPinnedProjects, pinnedTags, setPinnedTags, saveState }
}
