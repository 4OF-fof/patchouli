let pending = false

/** 開く処理の中で呼ぶ。新しいタブで開いている最中なら true。 */
export const inNewTab = () => pending

/**
 * open の中で開く画面を、新しいタブに開く。
 * 「新しいタブで」を引数で渡すと、画面ごとの onOpen〜 をすべて変えることになるので、呼んでいるあいだだけ印を立てる。
 */
export function asNewTab(open: () => void) {
  pending = true
  try {
    open()
  } finally {
    pending = false
  }
}

/** 中クリックで open を新しいタブに開く。押したときの自動スクロールは止める。 */
export const middleClick = (open: () => void) => ({
  onMouseDown: (e: MouseEvent) => {
    if (e.button === 1) e.preventDefault()
  },
  onAuxClick: (e: MouseEvent) => {
    if (e.button !== 1) return
    e.preventDefault()
    asNewTab(open)
  },
})
