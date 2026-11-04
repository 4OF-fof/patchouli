import { Show, createResource, createSignal } from 'solid-js'
import type { LibraryActions } from '../../backend/types'
import { Icon } from '../../components/base/Icon/Icon'
import { Button } from '../../components/controls/Button/Button'
import { LibrariesDialog } from '../../components/dialog/LibrariesDialog/LibrariesDialog'
import { TitleBar } from '../../components/nav/TitleBar/TitleBar'
import { ScreenFrame } from '../ScreenFrame'
import styles from './LibraryErrorScreen.module.css'

export interface LibraryErrorScreenProps {
  /** 開けなかった理由 */
  reason: string
  libraries?: LibraryActions
  /** フォルダを選択して開く。選択したら true */
  onChoose?: () => Promise<boolean>
  /** 切り替えたあとに読み込み直す */
  onReopen?: () => void
}

/** ライブラリを開けなかったときに、アプリの代わりに出す画面。 */
export function LibraryErrorScreen(props: LibraryErrorScreenProps) {
  const [picking, setPicking] = createSignal(false)
  const [known, { refetch }] = createResource(
    () => (picking() && props.libraries) || undefined,
    (l) => l.list(),
  )
  const choose = async () => {
    if (await props.onChoose?.()) props.onReopen?.()
  }
  return (
    <ScreenFrame bar={<TitleBar />}>
      <section class={styles.root} aria-label="ライブラリを開けませんでした">
        <Icon name="library" class={styles.icon} />
        <b class={styles.title}>ライブラリを開けませんでした</b>
        <p class={styles.reason}>{props.reason}</p>
        <Show when={props.libraries || props.onChoose}>
          <Button onClick={() => (props.libraries ? setPicking(true) : void choose())}>ライブラリを切り替え</Button>
        </Show>
      </section>
      <Show when={picking() && props.libraries}>
        {(l) => (
          <LibrariesDialog
            libraries={known.latest}
            onOpen={async (path) => {
              await l().switch(path)
              props.onReopen?.()
            }}
            onForget={async (path) => {
              await l().forget(path)
              await refetch()
            }}
            onChoose={props.onChoose && choose}
            onClose={() => setPicking(false)}
          />
        )}
      </Show>
    </ScreenFrame>
  )
}
