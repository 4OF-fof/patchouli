import { type Accessor, createContext, useContext } from 'solid-js'

/** 部品を描いている窓。タブを別のウィンドウに出しても、処理は本体の窓の JS が受け持ち、DOM だけをそちらに置く。 */
export interface Host {
  win: Window
  doc: Document
  /** 本体の窓か。外のページの WebView など、本体の窓にしか置けないものがある。 */
  main: boolean
}

export const MAIN_HOST: Host = { win: window, doc: document, main: true }

const HostContext = createContext<Accessor<Host>>(() => MAIN_HOST)

export const HostProvider = HostContext.Provider

/** タブの画面は窓のあいだを動くので、いまの窓を返す関数で受け取る。 */
export const useHost = () => useContext(HostContext)
