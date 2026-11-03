import type { BrowserActions } from '../../backend/types'
import { WebPage } from '../../components/media/WebPage/WebPage'
import shared from '../screen.module.css'
import styles from './WebScreen.module.css'

export interface WebScreenProps {
  url: string
  browser?: BrowserActions
  onOpenDefault?: (url: string) => void
}

/** 内蔵ブラウザで開いた URL。 */
export function WebScreen(props: WebScreenProps) {
  return (
    <section class={shared.screen} aria-label="ウェブページ">
      <WebPage url={props.url} browser={props.browser} onOpenDefault={props.onOpenDefault} class={styles.page} />
    </section>
  )
}
