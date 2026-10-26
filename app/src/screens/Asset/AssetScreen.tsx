import { For, Match, Show, Switch, createResource, createSignal } from 'solid-js'
import { ScrollArea } from '../../components/base/ScrollArea/ScrollArea'
import { Chip } from '../../components/controls/Chip/Chip'
import { FloatingCard } from '../../components/overlay/FloatingCard/FloatingCard'
import { FloatingPill } from '../../components/controls/FloatingPill/FloatingPill'
import { PinToggle } from '../../components/controls/PinToggle/PinToggle'
import { LinkNone, LinkRow } from '../../components/overlay/LinkRow/LinkRow'
import { MediaView } from '../../components/media/MediaView/MediaView'
import { PluginView } from '../../components/media/PluginView/PluginView'
import { Thumb } from '../../components/media/Thumb/Thumb'
import { TopBar } from '../../components/overlay/TopBar/TopBar'
import { type Library, relDay, thumbOf } from '../../model/library'
import type { ItemView, Part } from '../../plugins/types'
import type { UiApi, UiItem } from '../../plugins/ui'
import shared from '../screen.module.css'
import styles from './AssetScreen.module.css'

/** 詳細に出すものを受け持つプラグインに聞き、組み込み UI に窓口を渡す。 */
export interface AssetViewHost {
  view: (id: string) => Promise<ItemView | null>
  ui?: (item: UiItem, part: Part, plugin: string) => UiApi
}

export interface AssetScreenProps {
  lib: Library
  /** 前後に送れる並び（開いた所の並び）。 */
  list: string[]
  /** list の何番目を見ているか。 */
  index?: number
  /** 情報のカードを開いている。 */
  infoOpen?: boolean
  /** しばらく触っていない。上の帯と矢印を隠す。 */
  idle?: boolean
  backLabel?: string
  onBack?: () => void
  onOpenNote?: (id: string) => void
  /** ピン留めを切り替える。プロジェクトに入っていればその上に、入っていなければホームに出る。 */
  onTogglePin?: (id: string) => void
  /** 省略すると、サムネイルを大きく出す。 */
  host?: AssetViewHost
}

/** 04 素材。暗い舞台に 1 つだけ大きく出し、操作は浮かべる。 */
export function AssetScreen(props: AssetScreenProps) {
  const lib = () => props.lib
  const [i, setI] = createSignal(props.index ?? 0)
  const [info, setInfo] = createSignal(!!props.infoOpen)
  const it = () => lib().byId.get(props.list[i()] ?? '')
  const step = (d: number) => setI((i() + d + props.list.length) % props.list.length)
  const [view] = createResource(
    () => (props.host ? it()?.id : undefined),
    async (id) => (await props.host?.view(id).catch(() => null)) ?? null,
  )
  /** いまの素材について決まったもの。決まるまでは、前の素材のものもサムネイルも出さない。 */
  const settled = () => !props.host || view.state === 'ready'
  const current = () => (view.state === 'ready' ? view() : undefined)
  /** 本体が描くもの。中身の URL がなければ（見本など）描かない。 */
  const media = () => {
    const v = current()
    const src = (v?.kind === 'image' && v.url) || it()?.src
    return v && v.kind !== 'ui' && src ? { kind: v.kind, src } : undefined
  }
  const ui = () => {
    const v = current()
    const a = it()
    const make = props.host?.ui
    if (v?.kind !== 'ui' || !a || !make) return undefined
    return { url: v.url, api: make({ id: a.id, name: a.name, ext: a.ext, url: a.src }, 'view', v.plugin) }
  }
  return (
    <section class={`${shared.screen} ${styles.root}`} data-idle={!!props.idle} aria-label="素材">
      <Show when={it()}>
        {(a) => (
          <>
            <div class={styles.stage}>
              <Switch
                fallback={
                  <Show when={settled()}>
                    <Thumb {...thumbOf(a(), 'L')} class={styles.box} />
                  </Show>
                }
              >
                <Match when={ui()} keyed>
                  {(u) => <PluginView url={u.url} api={u.api} class={styles.page} />}
                </Match>
                <Match when={media()}>
                  {(m) => (
                    <MediaView kind={m().kind} src={m().src} thumb={a().thumb} name={a().name} class={styles.view} />
                  )}
                </Match>
              </Switch>
            </div>
            <TopBar
              class={styles.bar}
              backLabel={props.backLabel}
              onBack={props.onBack}
              actions={
                <PinToggle
                  look="float"
                  pressed={lib().pins.includes(a().id)}
                  onClick={() => props.onTogglePin?.(a().id)}
                />
              }
            >
              <b>{a().name}</b>
              <span class={styles.meta}>
                {a().folder ?? 'プロジェクトなし'}
                {props.list.length > 1 && ` · ${i() + 1} / ${props.list.length}`}
              </span>
            </TopBar>
            <Show when={props.list.length > 1}>
              <button type="button" class={`${styles.arw} ${styles.l}`} aria-label="前へ" onClick={() => step(-1)}>
                ‹
              </button>
              <button type="button" class={`${styles.arw} ${styles.r}`} aria-label="次へ" onClick={() => step(1)}>
                ›
              </button>
            </Show>
            <Show
              when={info()}
              fallback={
                <FloatingPill class={styles.pill} kbd="I" aria-expanded={false} onClick={() => setInfo(true)}>
                  ⓘ 情報
                </FloatingPill>
              }
            >
              <aside class={styles.info} aria-label="情報">
                <ScrollArea viewClass={styles.infoView}>
                  <FloatingCard title="ⓘ 情報" onClose={() => setInfo(false)}>
                    <label class={styles.fl}>
                      <span class={styles.k}>プロジェクト</span>
                      <select>
                        <option value="">プロジェクトなし</option>
                        <For each={lib().projects}>
                          {(p) => <option selected={p.name === a().folder}>{p.name}</option>}
                        </For>
                      </select>
                    </label>
                    <div class={styles.fl}>
                      <span class={styles.k}>タグ</span>
                      <div class={styles.tags}>
                        <For each={a().tags}>{(t) => <Chip aria-label={`# ${t} を外す`}># {t} ✕</Chip>}</For>
                        <input type="text" placeholder="＋ タグ" aria-label="タグを足す" />
                      </div>
                    </div>
                    <label class={styles.fl}>
                      <span class={styles.k}>メモ</span>
                      <textarea placeholder="メモ" value={a().memo} />
                    </label>
                    <div class={styles.fl}>
                      <span class={styles.k}>この素材を使っているノート {lib().backOf(a()).length}</span>
                      <Show when={lib().backOf(a()).length} fallback={<LinkNone>まだありません</LinkNone>}>
                        <For each={lib().backOf(a())}>
                          {(n) => <LinkRow mark="←" label={n.name} onClick={() => props.onOpenNote?.(n.id)} />}
                        </For>
                      </Show>
                    </div>
                    <details>
                      <summary class={styles.sum}>ファイルの詳細</summary>
                      <div class={styles.fi}>
                        <span>種類</span>
                        <span>
                          {lib().formatLabel(a())} · {a().ext}
                        </span>
                        <span>場所</span>
                        <span>
                          {a().folder ?? '（直下）'}/{a().name}.{a().ext}
                        </span>
                        <span>属性</span>
                        <span>
                          {a().name}.{a().ext}.meta
                        </span>
                        <span>動いた</span>
                        <span>{relDay(lib(), a().moved)}</span>
                      </div>
                    </details>
                  </FloatingCard>
                </ScrollArea>
              </aside>
            </Show>
          </>
        )}
      </Show>
    </section>
  )
}
