import { For, Match, Show, Switch, createResource, createSignal } from 'solid-js'
import { ScrollArea } from '../../components/base/ScrollArea/ScrollArea'
import { Chip } from '../../components/controls/Chip/Chip'
import { FloatingCard } from '../../components/overlay/FloatingCard/FloatingCard'
import { FloatingPill } from '../../components/controls/FloatingPill/FloatingPill'
import { LinkNone, LinkRow } from '../../components/overlay/LinkRow/LinkRow'
import { MediaView } from '../../components/media/MediaView/MediaView'
import { PluginFrame } from '../../components/media/PluginFrame/PluginFrame'
import { Thumb } from '../../components/media/Thumb/Thumb'
import { TopBar } from '../../components/overlay/TopBar/TopBar'
import { type Library, relDay, thumbOf } from '../../model/library'
import type { ItemView } from '../../plugins/types'
import shared from '../screen.module.css'
import styles from './AssetScreen.module.css'

/** 詳細に出すものを受け持つプラグインに聞き、プラグインの画面とやりとりする窓口。 */
export interface AssetViewHost {
  view: (id: string) => Promise<ItemView | null>
  read?: (id: string, offset: number, length: number) => Promise<ArrayBuffer>
  call?: (id: string, method: string, args: string) => Promise<string>
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
  /** 本体が描くもの。中身の URL がなければ（見本など）描かない。 */
  const media = () => {
    const v = view.latest
    const src = it()?.src
    return v && v.kind !== 'page' && src ? { kind: v.kind, src } : undefined
  }
  const page = () => {
    const v = view.latest
    return v?.kind === 'page' ? v.url : undefined
  }
  return (
    <section class={`${shared.screen} ${styles.root}`} data-idle={!!props.idle} aria-label="素材">
      <Show when={it()}>
        {(a) => (
          <>
            <div class={styles.stage}>
              <Switch fallback={<Thumb {...thumbOf(a(), 'L')} class={styles.box} />}>
                <Match when={page()}>
                  {(url) => (
                    <PluginFrame
                      url={url()}
                      file={{ name: a().name, ext: a().ext }}
                      onRead={props.host?.read && ((o, n) => props.host!.read!(a().id, o, n))}
                      onCall={props.host?.call && ((m, args) => props.host!.call!(a().id, m, args))}
                      class={styles.page}
                    />
                  )}
                </Match>
                <Match when={media()}>
                  {(m) => (
                    <MediaView kind={m().kind} src={m().src} thumb={a().thumb} name={a().name} class={styles.view} />
                  )}
                </Match>
              </Switch>
            </div>
            <TopBar class={styles.bar} backLabel={props.backLabel} onBack={props.onBack}>
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
