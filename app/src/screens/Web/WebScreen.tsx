import type { BrowserActions } from '../../backend/types'
import { WebPage } from '../../components/media/WebPage/WebPage'
import { useBarTools } from '../AppBar'
import shared from '../screen.module.css'
import styles from './WebScreen.module.css'

export interface WebScreenProps {
  url: string
  browser?: BrowserActions
  onOpenDefault?: (url: string) => void
}

/** 内蔵ブラウザで開いた URL。 */
export function WebScreen(props: WebScreenProps) {
  const barTools = useBarTools()
  return (
    <section class={shared.screen} aria-label="ウェブページ">
      <WebPage
        url={props.url}
        browser={props.browser}
        onOpenDefault={props.onOpenDefault}
        barAt={barTools()}
        class={styles.page}
      />
    </section>
  )
}
