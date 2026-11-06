import { For, Show, createSignal } from 'solid-js'
import { Portal } from 'solid-js/web'
import { ENOUGH_CONTRAST, contrast, parseColor, toHex } from '../../../model/color'
import {
  COLOR_GROUPS,
  type ColorKey,
  type ColorScheme,
  type Mode,
  colorOf,
  newSchemeId,
  parseSchemeJson,
  schemeJson,
  uniqueName,
} from '../../../model/colorScheme'
import { Icon } from '../../base/Icon/Icon'
import { Kbd } from '../../base/Kbd/Kbd'
import { Button } from '../../controls/Button/Button'
import { ColorField } from '../../controls/ColorField/ColorField'
import { IconButton } from '../../controls/IconButton/IconButton'
import { Select } from '../../controls/Select/Select'
import { Tabs } from '../../controls/Tabs/Tabs'
import { NavMenu } from '../../nav/NavMenu/NavMenu'
import { ContextMenu } from '../../overlay/ContextMenu/ContextMenu'
import { ConfirmDialog } from '../ConfirmDialog/ConfirmDialog'
import styles from './SchemeEditor.module.css'

export const STANDARD_ID = 'standard'

export interface SchemeEditorProps {
  schemes: ColorScheme[]
  /** 使っている配色の id。 */
  value: string
  /** いま画面に出ているテーマ。はじめは、これを編集する。 */
  theme: Mode
  onSelect: (id: string) => void
  onSchemesChange: (list: ColorScheme[]) => void
  /** 書き出したファイルの場所を返す。選ぶのをやめたら undefined。省くと、ブラウザのダウンロードにする。 */
  onExport?: (name: string, data: string) => Promise<string | undefined>
  onMessage: (m: { error?: string; done?: string }) => void
}

const MODES: { key: Mode; label: string }[] = [
  { key: 'light', label: 'ライト' },
  { key: 'dark', label: 'ダーク' },
]

const download = (name: string, data: string) => {
  const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

/** ファイル名に使えない文字を外す。 */
const fileNameOf = (name: string) => `${name.replace(/[\\/:*?"<>|]/g, '').trim() || '配色'}.json`

/** 設定の表示ページの、配色を選んで編集するところ。 */
export function SchemeEditor(props: SchemeEditorProps) {
  let file!: HTMLInputElement
  let more!: HTMLButtonElement
  let row!: HTMLDivElement
  const [mode, setMode] = createSignal<Mode>(props.theme)
  const [menu, setMenu] = createSignal<{ x: number; y: number }>()
  const [renaming, setRenaming] = createSignal(false)
  const [deleting, setDeleting] = createSignal(false)
  const [openGroups, setOpenGroups] = createSignal(new Set<string>())
  const current = () => props.schemes.find((s) => s.id === props.value)

  const add = (s: Omit<ColorScheme, 'id'>) => {
    const next = { ...s, id: newSchemeId(), name: uniqueName(s.name, props.schemes) }
    props.onSchemesChange([...props.schemes, next])
    props.onSelect(next.id)
    return next
  }
  const update = (patch: Partial<ColorScheme>) => {
    const c = current()
    if (c) props.onSchemesChange(props.schemes.map((s) => (s.id === c.id ? { ...s, ...patch } : s)))
  }
  const setColor = (key: ColorKey, value: string | undefined) => {
    const c = current()
    if (!c) return
    const colors = { ...c[mode()] }
    if (value === undefined) delete colors[key]
    else colors[key] = value
    update({ [mode()]: colors })
  }
  const create = () => {
    add({ name: '新しい配色', light: {}, dark: {} })
    props.onMessage({})
  }
  const duplicate = () => {
    const c = current()
    if (c) add({ name: c.name, light: { ...c.light }, dark: { ...c.dark } })
    props.onMessage({})
  }
  const importFile = async (f: File) => {
    try {
      const s = add(parseSchemeJson(await f.text(), f.name.replace(/\.json$/i, '')))
      props.onMessage({ done: `「${s.name}」を読み込みました` })
    } catch (e) {
      props.onMessage({ error: `「${f.name}」の読み込みに失敗しました：${e instanceof Error ? e.message : String(e)}` })
    }
  }
  const exportCurrent = async () => {
    const c = current()
    if (!c) return
    const name = fileNameOf(c.name)
    try {
      if (!props.onExport) return download(name, schemeJson(c))
      const to = await props.onExport(name, schemeJson(c))
      if (to) props.onMessage({ done: `「${to}」に書き出しました` })
    } catch (e) {
      props.onMessage({ error: `書き出しに失敗しました：${e instanceof Error ? e.message : String(e)}` })
    }
  }
  const remove = () => {
    const c = current()
    setDeleting(false)
    if (!c) return
    props.onSelect(STANDARD_ID)
    props.onSchemesChange(props.schemes.filter((s) => s.id !== c.id))
  }
  const commitName = (v: string) => {
    setRenaming(false)
    const c = current()
    const name = v.trim()
    if (!c || !name || name === c.name) return
    update({
      name: uniqueName(
        name,
        props.schemes.filter((s) => s.id !== c.id),
      ),
    })
  }
  const focusSelect = () => queueMicrotask(() => row.querySelector<HTMLElement>('[aria-label="配色"]')?.focus())
  const toggleGroup = (label: string) => {
    const next = new Set(openGroups())
    if (next.has(label)) next.delete(label)
    else next.add(label)
    setOpenGroups(next)
  }

  return (
    <>
      <div ref={row} class={styles.row}>
        <span class={styles.name}>配色</span>
        <div class={styles.actions}>
          <Show
            when={renaming() && current()}
            fallback={
              <Select
                class={styles.select}
                aria-label="配色"
                value={current()?.id ?? STANDARD_ID}
                options={[
                  { value: STANDARD_ID, label: '標準' },
                  ...props.schemes.map((s) => ({ value: s.id, label: s.name })),
                ]}
                onChange={props.onSelect}
              />
            }
          >
            {(c) => (
              <input
                class={styles.rename}
                aria-label="配色の名前"
                value={c().name}
                ref={(el) => queueMicrotask(() => el.select())}
                onBlur={(e) => commitName(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.isComposing) return
                  if (e.key !== 'Enter' && e.key !== 'Escape') return
                  e.preventDefault()
                  if (e.key === 'Enter') commitName(e.currentTarget.value)
                  else setRenaming(false)
                  focusSelect()
                }}
              />
            )}
          </Show>
          <Button size="sm" variant="ghost" onClick={create}>
            新規作成
          </Button>
          <Button size="sm" variant="ghost" onClick={() => file.click()}>
            読み込み
          </Button>
          <input
            ref={file}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(e) => {
              const f = e.currentTarget.files?.[0]
              e.currentTarget.value = ''
              if (f) void importFile(f)
            }}
          />
          <Show when={current()}>
            <IconButton
              ref={more}
              label="その他"
              onClick={() => {
                const r = more.getBoundingClientRect()
                setMenu(menu() ? undefined : { x: r.left, y: r.bottom + 4 })
              }}
            >
              <Icon name="more" />
            </IconButton>
          </Show>
        </div>
      </div>
      <Show when={menu()}>
        {(m) => (
          <ContextMenu x={m().x} y={m().y} anchor={more} onClose={() => setMenu(undefined)}>
            <NavMenu
              items={[
                { id: 'rename', icon: 'rename', label: '名前を変更' },
                { id: 'duplicate', icon: 'copy', label: '複製' },
                { id: 'export', icon: 'export', label: '書き出し' },
                'separator',
                { id: 'delete', icon: 'trash', label: '削除', danger: true },
              ]}
              focusFirst
              onSelect={(id) => {
                setMenu(undefined)
                if (id === 'rename') setRenaming(true)
                else if (id === 'duplicate') duplicate()
                else if (id === 'export') void exportCurrent()
                else setDeleting(true)
              }}
              onClose={() => setMenu(undefined)}
            />
          </ContextMenu>
        )}
      </Show>
      <div class={styles.editor}>
        <Tabs label="編集するテーマ" items={MODES} value={mode()} onChange={setMode} />
        <For each={COLOR_GROUPS}>
          {(g, i) => {
            const folded = () => i() === COLOR_GROUPS.length - 1 && !openGroups().has(g.label)
            return (
              <section class={styles.group}>
                <div class={styles.head}>
                  <Show when={i() === COLOR_GROUPS.length - 1} fallback={<h4 class={styles.label}>{g.label}</h4>}>
                    <button
                      type="button"
                      class={`${styles.label} ${styles.fold}`}
                      aria-expanded={!folded()}
                      onClick={() => toggleGroup(g.label)}
                    >
                      {g.label}（{g.entries.length} 色）
                      <Icon name={folded() ? 'chevron' : 'chevronDown'} size={12} withText />
                    </button>
                  </Show>
                  <Show when={!folded()}>
                    <span class={styles.headCol}>カラーコード</span>
                    <Show when={g.entries.some((e) => e.against)}>
                      <span
                        class={styles.headCol}
                        data-tip={
                          g.entries.some((e) => e.against === 'side')
                            ? 'サイドバーとのコントラスト比'
                            : '背景とのコントラスト比'
                        }
                      >
                        コントラスト比
                      </span>
                    </Show>
                  </Show>
                </div>
                <Show when={!folded()}>
                  <For each={g.entries}>
                    {(e) => {
                      const value = () => colorOf(current(), mode(), e.key)
                      const against = () => e.against && colorOf(current(), mode(), e.against)
                      const ratio = () => {
                        const a = against()
                        return a && contrast(value(), a)
                      }
                      const changed = () => current()?.[mode()][e.key] !== undefined
                      const commitHex = (el: HTMLInputElement) => {
                        const t = el.value.trim().toLowerCase()
                        const hex = t.startsWith('#') ? t : `#${t}`
                        if (parseColor(hex) && hex !== toHex(value())) setColor(e.key, hex)
                        el.value = toHex(value())
                      }
                      return (
                        <div class={styles.color}>
                          <ColorField
                            label={e.label}
                            value={value()}
                            disabled={!current()}
                            onChange={(v) => setColor(e.key, v)}
                          />
                          <span class={styles.colorName}>{e.label}</span>
                          <input
                            class={styles.hex}
                            value={toHex(value())}
                            aria-label={`${e.label}のカラーコード`}
                            spellcheck={false}
                            disabled={!current()}
                            onChange={(ev) => commitHex(ev.currentTarget)}
                            onKeyDown={(ev) => ev.key === 'Enter' && commitHex(ev.currentTarget)}
                          />
                          <span class={styles.ratio} data-low={(ratio() ?? 99) < ENOUGH_CONTRAST}>
                            {ratio()?.toFixed(1)}
                          </span>
                          <span class={styles.reset}>
                            <Show when={changed()}>
                              <IconButton label="標準の色に戻す" onClick={() => setColor(e.key, undefined)}>
                                <Icon name="undo" size={14} />
                              </IconButton>
                            </Show>
                          </span>
                        </div>
                      )
                    }}
                  </For>
                </Show>
              </section>
            )
          }}
        </For>
      </div>
      <Show when={deleting() && current()}>
        {(c) => (
          // 設定のダイアログの上に重ねる
          <Portal mount={file.closest<HTMLElement>('[aria-modal="true"]') ?? undefined}>
            <ConfirmDialog
              label="削除の確認"
              title={`「${c().name}」を削除しますか？`}
              onClose={() => setDeleting(false)}
              onEnter={remove}
              footer={
                <>
                  <Button variant="ghost" onClick={() => setDeleting(false)}>
                    キャンセル <Kbd>Esc</Kbd>
                  </Button>
                  <Button variant="danger" onClick={remove}>
                    削除 <Kbd>Enter</Kbd>
                  </Button>
                </>
              }
            >
              <p>削除すると、標準の配色に戻ります。</p>
            </ConfirmDialog>
          </Portal>
        )}
      </Show>
    </>
  )
}
