import { Match, Switch } from 'solid-js'
import { Button } from '../../controls/Button/Button'
import styles from './ReloadOverlay.module.css'

export interface ReloadOverlayProps {
  /** ask 裏の処理が残っていて、待つか中止するかを選ぶ / wait 処理が終わるのを待っている / load 読み直している */
  step: 'ask' | 'wait' | 'load'
  /** 裏の処理の、残りの数。 */
  work?: number
  onWait?: () => void
  onStop?: () => void
  onCancel?: () => void
}

/** プラグインを読み直すあいだ、窓全体を覆って操作できなくする。 */
export function ReloadOverlay(props: ReloadOverlayProps) {
  const left = () => (props.work ? `（残り ${props.work} 件）` : '')
  return (
    <div class={styles.root} role="alertdialog" aria-modal="true" aria-label="プラグインの再読み込み">
      <div class={styles.box}>
        <Switch>
          <Match when={props.step === 'ask'}>
            <b>プラグインの処理を実行中です</b>
            <p>サムネイルや波形の作成が {props.work ?? 0} 件残っています。</p>
            <div class={styles.actions}>
              <Button variant="ghost" onClick={() => props.onCancel?.()}>
                キャンセル
              </Button>
              <Button onClick={() => props.onStop?.()}>処理を中止</Button>
              <Button variant="primary" onClick={() => props.onWait?.()}>
                完了まで待機
              </Button>
            </div>
          </Match>
          <Match when={props.step === 'wait'}>
            <b class={styles.busy} role="status">
              <span class={styles.spin} aria-hidden="true" />
              処理の完了を待っています…{left()}
            </b>
            <div class={styles.actions}>
              <Button onClick={() => props.onStop?.()}>処理を中止</Button>
            </div>
          </Match>
          <Match when={props.step === 'load'}>
            <b class={styles.busy} role="status">
              <span class={styles.spin} aria-hidden="true" />
              プラグインを読み込んでいます…
            </b>
          </Match>
        </Switch>
      </div>
    </div>
  )
}
