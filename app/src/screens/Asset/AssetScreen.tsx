import { For, Show, createSignal } from 'solid-js'
import { Chip } from '../../components/Chip/Chip'
import { FloatingCard } from '../../components/FloatingCard/FloatingCard'
import { FloatingPill } from '../../components/FloatingPill/FloatingPill'
import { LinkNone, LinkRow } from '../../components/LinkRow/LinkRow'
import { Thumb } from '../../components/Thumb/Thumb'
import { type Library, extOf, relDay, thumbOf } from '../../model/library'
import shared from '../screen.module.css'
import styles from './AssetScreen.module.css'

const KIND_LABEL = { image: '画像', audio: '音声', video: '動画', note: 'ノート' }

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
}

/** 04 素材。暗い舞台に 1 つだけ大きく出し、操作は浮かべる。 */
export function AssetScreen(props: AssetScreenProps) {
  const lib = () => props.lib
  const [i, setI] = createSignal(props.index ?? 0)
  const [info, setInfo] = createSignal(!!props.infoOpen)
  const it = () => lib().byId.get(props.list[i()] ?? '')
  const step = (d: number) => setI((i() + d + props.list.length) % props.list.length)
  return (
    <section class={`${shared.screen} ${styles.root}`} data-idle={!!props.idle} aria-label="素材">
      <Show when={it()}>
        {(a) => (
          <>
            <div class={styles.stage}>
              <Thumb {...thumbOf(a(), 'L')} class={styles.view} />
            </div>
            <div class={styles.bar}>
              <FloatingPill onClick={() => props.onBack?.()}>‹ {props.backLabel ?? 'ホーム'}</FloatingPill>
              <b>{a().name}</b>
              <span class={styles.meta}>
                {a().folder ?? 'プロジェクトなし'}
                {props.list.length > 1 && ` · ${i() + 1} / ${props.list.length}`}
              </span>
              <span class={styles.sp} />
              <FloatingPill class={styles.more} aria-label="その他">
                ⋯
              </FloatingPill>
            </div>
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
                        {KIND_LABEL[a().kind]} · {extOf(a())}
                      </span>
                      <span>場所</span>
                      <span>
                        {a().folder ?? '（直下）'}/{a().name}.{extOf(a())}
                      </span>
                      <span>属性</span>
                      <span>
                        {a().name}.{extOf(a())}.meta
                      </span>
                      <span>動いた</span>
                      <span>{relDay(lib(), a().moved)}</span>
                    </div>
                  </details>
                </FloatingCard>
              </aside>
            </Show>
          </>
        )}
      </Show>
    </section>
  )
}
