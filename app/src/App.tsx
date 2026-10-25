import { Match, Switch, createSignal, onCleanup, onMount } from 'solid-js'
import { type Backend, type LibraryState, sampleBackend } from './backend'
import { Toast } from './components/overlay/Toast/Toast'
import {
  type Library,
  newNoteName,
  newProjectName,
  retag,
  retaggedItems,
  toggled,
  withItem,
  withProject,
  withRenamedTag,
  withThumbs,
  withToggledPin,
} from './model/library'
import { PINNED_PROJECTS, PINNED_TAGS } from './samples/library'
import { AppDock, type Place } from './screens/AppDock'
import { AssetScreen } from './screens/Asset/AssetScreen'
import { EditionScreen } from './screens/Edition/EditionScreen'
import { NoteScreen } from './screens/Note/NoteScreen'
import { ProjectScreen } from './screens/Project/ProjectScreen'
import { ProjectListScreen } from './screens/ProjectList/ProjectListScreen'
import { ScreenFrame } from './screens/ScreenFrame'
import { TagScreen } from './screens/Tag/TagScreen'
import { TagListScreen } from './screens/TagList/TagListScreen'
import { TidyScreen } from './screens/Tidy/TidyScreen'

type View =
  | { s: 'edition' }
  | { s: 'project'; name: string; editing?: boolean }
  | { s: 'plist' }
  | { s: 'tlist' }
  | { s: 'tag'; tag: string }
  | { s: 'note'; id: string }
  | { s: 'asset'; list: string[]; index: number }
  | { s: 'tidy'; id?: string }

const LABEL: Record<View['s'], string> = {
  edition: 'ホーム',
  project: 'プロジェクト',
  plist: 'プロジェクト一覧',
  tlist: 'タグ一覧',
  tag: 'タグ',
  note: 'ノート',
  asset: '素材',
  tidy: '整理',
}

export interface AppProps {
  lib: Library
  /** 変更を書き込む先。省略すると書き込まない（見本）。 */
  backend?: Backend
  pinnedProjects?: string[]
  pinnedTags?: string[]
  /** 開いたライブラリの場所（設定に出す）。 */
  location?: string
  /** 開いたときに出す知らせ。 */
  notice?: string
}

/** 画面をつないで行き来できるようにしたもの。変更は backend に書き込む。 */
export function App(props: AppProps) {
  const backend = props.backend ?? sampleBackend()
  const [lib, setLib] = createSignal(props.lib)
  const [stack, setStack] = createSignal<View[]>([{ s: 'edition' }])
  const [pinnedProjects, setPinnedProjects] = createSignal(props.pinnedProjects ?? PINNED_PROJECTS)
  const [pinnedTags, setPinnedTags] = createSignal(props.pinnedTags ?? PINNED_TAGS)
  const [notice, setNotice] = createSignal(props.notice)
  const view = () => stack().at(-1) ?? { s: 'edition' }
  const back = () => {
    const prev = stack().at(-2)
    if (!prev) return 'ホーム'
    return prev.s === 'project' ? prev.name : prev.s === 'tag' ? `# ${prev.tag}` : LABEL[prev.s]
  }
  const go = (v: View) => setStack([...stack(), v])
  const goBack = () => setStack(stack().length > 1 ? stack().slice(0, -1) : stack())
  const openItem = (id: string, list?: string[]) => {
    const it = lib().byId.get(id)
    if (!it) return
    if (it.kind === 'note') {
      go({ s: 'note', id })
      return
    }
    const l = (list ?? [id]).filter((x) => lib().byId.get(x)?.kind !== 'note')
    go({ s: 'asset', list: l, index: Math.max(0, l.indexOf(id)) })
  }
  const openRef = (name: string) => {
    const it = lib().byName.get(name)
    if (it) openItem(it.id)
  }
  // メニューから行く所は一番上の画面として開き、戻る先を持たない
  const onGo = (to: Place) => {
    if (to === 'tidy') go({ s: 'tidy' })
    else setStack([{ s: to === 'tags' ? 'tlist' : to === 'projects' ? 'plist' : 'edition' }])
  }

  // 書き込みは出した順に 1 つずつ流し、失敗したら知らせる
  let queue = Promise.resolve()
  const fail = (e: unknown) => {
    setNotice(`保存できませんでした: ${e instanceof Error ? e.message : String(e)}`)
  }
  const persist = (job: () => Promise<void>) => {
    queue = queue.then(job).catch(fail)
  }
  const state = (): LibraryState => ({
    pins: lib().pins,
    pinnedProjects: pinnedProjects(),
    pinnedTags: pinnedTags(),
    tagCovers: Object.fromEntries(lib().tagCovers),
  })
  const saveState = () => {
    const s = state()
    persist(() => backend.saveState(s))
  }

  const createProject = async () => {
    const name = newProjectName(lib())
    try {
      setLib(withProject(lib(), await backend.createProject(name)))
      go({ s: 'project', name, editing: true })
    } catch (e) {
      fail(e)
    }
  }
  const createNote = async (name?: string) => {
    try {
      const it = await backend.createNote(newNoteName(lib(), name), null)
      setLib(withItem(lib(), it))
      go({ s: 'note', id: it.id })
    } catch (e) {
      fail(e)
    }
  }
  const renameTag = (from: string, to: string) => {
    const re = retag(from, to)
    const before = lib()
    const after = withRenamedTag(before, from, to)
    setLib(after)
    setPinnedTags([...new Set(pinnedTags().map(re))])
    setStack(stack().map((v) => (v.s === 'tag' ? { ...v, tag: re(v.tag) } : v)))
    for (const it of retaggedItems(before, after)) persist(() => backend.saveItem(it.id, { tags: it.tags }))
    saveState()
  }
  // ライブラリを替えたら、画面の状態ごと開き直す
  const chooseLibrary =
    backend.chooseLibrary &&
    (async () => {
      try {
        if (await backend.chooseLibrary?.()) window.location.reload()
      } catch (e) {
        setNotice(`ライブラリを選べませんでした: ${e instanceof Error ? e.message : String(e)}`)
      }
    })
  const togglePin = (id: string) => {
    setLib(withToggledPin(lib(), id))
    saveState()
  }
  const toggleProjectPin = (name: string) => {
    setPinnedProjects(toggled(pinnedProjects(), name))
    saveState()
  }
  const toggleTagPin = (tag: string) => {
    setPinnedTags(toggled(pinnedTags(), tag))
    saveState()
  }
  const here = (): Place | undefined =>
    view().s === 'edition' ? 'home' : view().s === 'tlist' ? 'tags' : view().s === 'plist' ? 'projects' : undefined
  const hasDock = () => ['edition', 'project', 'plist', 'tlist', 'tag'].includes(view().s)

  const onKey = (e: KeyboardEvent) => {
    if (e.target instanceof HTMLElement && e.target.closest('input, textarea, select, [role="dialog"], [role="menu"]'))
      return
    if (e.key === 'Escape') goBack()
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'u') {
      e.preventDefault()
      go({ s: 'tidy' })
    }
  }
  onMount(() => window.addEventListener('keydown', onKey))
  onCleanup(() => window.removeEventListener('keydown', onKey))

  // サムネイルは 1 枚ずつ届くので、少し溜めてからまとめて付ける
  let thumbs = new Map<string, string>()
  let flush = 0
  const stopThumbs = backend.onThumbnail((id, url) => {
    thumbs.set(id, url)
    flush ||= window.setTimeout(() => {
      setLib(withThumbs(lib(), thumbs))
      thumbs = new Map()
      flush = 0
    }, 150)
  })
  onCleanup(() => {
    stopThumbs()
    clearTimeout(flush)
  })

  return (
    <ScreenFrame toast={notice() && <Toast message={notice()} onClose={() => setNotice(undefined)} />}>
      <Switch>
        <Match when={view().s === 'edition'}>
          <EditionScreen
            lib={lib()}
            pinnedProjects={pinnedProjects()}
            pinnedTags={pinnedTags()}
            onTogglePin={togglePin}
            onOpenItem={(id) => openItem(id)}
            onOpenProject={(name) => go({ s: 'project', name })}
            onOpenTag={(tag) => go({ s: 'tag', tag })}
            onTidy={(id) => go({ s: 'tidy', id })}
          />
        </Match>
        <Match when={view().s === 'project' && view()} keyed>
          {(v) =>
            v.s === 'project' && (
              <ProjectScreen
                lib={lib()}
                name={v.name}
                editing={v.editing}
                backLabel={back()}
                onBack={goBack}
                onTogglePin={togglePin}
                onOpenItem={openItem}
              />
            )
          }
        </Match>
        <Match when={view().s === 'plist'}>
          <ProjectListScreen
            lib={lib()}
            pinned={pinnedProjects()}
            onOpenProject={(name) => go({ s: 'project', name })}
            onTogglePin={toggleProjectPin}
            onCreate={createProject}
          />
        </Match>
        <Match when={view().s === 'tlist'}>
          <TagListScreen
            lib={lib()}
            pinned={pinnedTags()}
            onOpenTag={(tag) => go({ s: 'tag', tag })}
            onTogglePin={toggleTagPin}
          />
        </Match>
        <Match when={view().s === 'tag' && view()} keyed>
          {(v) =>
            v.s === 'tag' && (
              <TagScreen
                lib={lib()}
                tag={v.tag}
                pinned={pinnedTags().includes(v.tag)}
                backLabel={back()}
                onBack={goBack}
                onOpenItem={openItem}
                onOpenTag={(tag) => go({ s: 'tag', tag })}
                onTogglePin={togglePin}
                onToggleTagPin={() => toggleTagPin(v.tag)}
                onRename={(to) => renameTag(v.tag, to)}
              />
            )
          }
        </Match>
        <Match when={view().s === 'note' && view()} keyed>
          {(v) =>
            v.s === 'note' && (
              <NoteScreen lib={lib()} noteId={v.id} backLabel={back()} onBack={goBack} onOpenRef={openRef} />
            )
          }
        </Match>
        <Match when={view().s === 'asset' && view()} keyed>
          {(v) =>
            v.s === 'asset' && (
              <AssetScreen
                lib={lib()}
                list={v.list}
                index={v.index}
                backLabel={back()}
                onBack={goBack}
                onOpenNote={(id) => openItem(id)}
              />
            )
          }
        </Match>
        <Match when={view().s === 'tidy' && view()} keyed>
          {(v) =>
            v.s === 'tidy' && (
              <TidyScreen
                lib={lib()}
                currentId={v.id}
                backLabel={back()}
                onBack={goBack}
                onOpenItem={(id) => openItem(id)}
              />
            )
          }
        </Match>
      </Switch>
      <AppDock
        hidden={!hasDock()}
        lib={lib()}
        here={here()}
        onGo={onGo}
        onOpenProject={(name) => go({ s: 'project', name })}
        onOpenItem={(id) => openItem(id)}
        onCreate={createNote}
        library={props.location}
        onChooseLibrary={chooseLibrary}
      />
    </ScreenFrame>
  )
}
