import { Match, Switch, createSignal, onCleanup, onMount } from 'solid-js'
import { type Library, retag, withEmptyNote, withEmptyProject, withRenamedTag } from './model/library'
import { PINNED_ITEMS, PINNED_PROJECTS, PINNED_TAGS } from './samples/library'
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

/** 画面をつないで行き来できるようにしたもの。保存や読み込みはまだなく、中身は渡したライブラリだけ。 */
export function App(props: { lib: Library }) {
  const [lib, setLib] = createSignal(props.lib)
  const [stack, setStack] = createSignal<View[]>([{ s: 'edition' }])
  const [pinnedTags, setPinnedTags] = createSignal(PINNED_TAGS)
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
  const createProject = () => {
    const r = withEmptyProject(lib())
    setLib(r.lib)
    go({ s: 'project', name: r.name, editing: true })
  }
  const createNote = (name?: string) => {
    const r = withEmptyNote(lib(), name)
    setLib(r.lib)
    go({ s: 'note', id: r.id })
  }
  const renameTag = (from: string, to: string) => {
    const re = retag(from, to)
    setLib(withRenamedTag(lib(), from, to))
    setPinnedTags([...new Set(pinnedTags().map(re))])
    setStack(stack().map((v) => (v.s === 'tag' ? { ...v, tag: re(v.tag) } : v)))
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

  return (
    <ScreenFrame>
      <Switch>
        <Match when={view().s === 'edition'}>
          <EditionScreen
            lib={lib()}
            pinnedProjects={PINNED_PROJECTS}
            pinnedTags={pinnedTags()}
            pinnedItems={PINNED_ITEMS}
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
                onOpenItem={openItem}
              />
            )
          }
        </Match>
        <Match when={view().s === 'plist'}>
          <ProjectListScreen
            lib={lib()}
            pinned={PINNED_PROJECTS}
            onOpenProject={(name) => go({ s: 'project', name })}
            onCreate={createProject}
          />
        </Match>
        <Match when={view().s === 'tlist'}>
          <TagListScreen lib={lib()} pinned={pinnedTags()} onOpenTag={(tag) => go({ s: 'tag', tag })} />
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
      {hasDock() && (
        <AppDock
          lib={lib()}
          here={here()}
          onGo={onGo}
          onOpenProject={(name) => go({ s: 'project', name })}
          onOpenItem={(id) => openItem(id)}
          onCreate={createNote}
        />
      )}
    </ScreenFrame>
  )
}
