import { createSignal } from 'solid-js'
import { Kbd } from '../../base/Kbd/Kbd'
import { Button } from '../../controls/Button/Button'
import { ConfirmDialog } from '../ConfirmDialog/ConfirmDialog'
import styles from './PluginAddDialog.module.css'

export interface PluginAddDialogProps {
  /** GitHub のリポジトリの URL を入れて取得する。 */
  onGithub?: (url: string) => void
  /** ZIP ファイルを選択する。 */
  onZip?: () => void
  onClose?: () => void
}

/** プラグインを追加する。GitHub のリリースか、手元の ZIP ファイルから入れる。 */
export function PluginAddDialog(props: PluginAddDialogProps) {
  const [url, setUrl] = createSignal('')
  const go = () => url().trim() && props.onGithub?.(url().trim())
  return (
    <ConfirmDialog
      label="プラグインを追加"
      title="プラグインを追加"
      class={styles.root}
      onClose={props.onClose}
      footer={
        <>
          <Button variant="ghost" onClick={() => props.onClose?.()}>
            キャンセル <Kbd>Esc</Kbd>
          </Button>
          <Button variant="primary" disabled={!url().trim() || !props.onGithub} onClick={go}>
            取得 <Kbd>Enter</Kbd>
          </Button>
        </>
      }
    >
      <p>GitHub のリポジトリの URL を入力すると、最新のリリースの ZIP ファイルを取得します。</p>
      <input
        class={styles.url}
        type="url"
        aria-label="GitHub のリポジトリの URL"
        placeholder="https://github.com/owner/name"
        value={url()}
        autofocus
        onInput={(e) => setUrl(e.currentTarget.value)}
        onKeyDown={(e) => {
          if (e.key !== 'Enter' || e.isComposing) return
          e.preventDefault()
          go()
        }}
      />
      <div class={styles.local}>
        <span>手元の ZIP ファイルからインストール</span>
        <Button size="sm" disabled={!props.onZip} onClick={() => props.onZip?.()}>
          ZIP ファイルを選択
        </Button>
      </div>
    </ConfirmDialog>
  )
}
