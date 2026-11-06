import { createSignal } from 'solid-js'
import type { ToastLevel } from '../components/overlay/Toast/Toast'
import type { Item } from '../model/library'
import { persist as queueJob } from '../model/persist'

export const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e))
/** 通知に並べる名前の数。残りは件数だけ出す。 */
const NAMED = 5
export const namesOf = (its: Item[]) =>
  its
    .slice(0, NAMED)
    .map((it) => `「${it.name}」`)
    .join('') + (its.length > NAMED ? `ほか ${its.length - NAMED} 件` : '')

/** 画面の下に出す通知と、失敗したときの知らせ方。persist は書き込みを順に並べ、失敗したら知らせる。 */
export function createNotice() {
  const [notice, setNotice] = createSignal<{ message: string; level: ToastLevel }>()
  const notify = (message: string, level: ToastLevel) => setNotice({ message, level })

  const fail = (e: unknown) => {
    notify(`保存できませんでした：${e instanceof Error ? e.message : String(e)}`, 'error')
  }
  const failLoad = (e: unknown) => {
    notify(`読み込めませんでした：${e instanceof Error ? e.message : String(e)}`, 'error')
  }
  const failOpen = (e: unknown) => {
    notify(`開けませんでした：${e instanceof Error ? e.message : String(e)}`, 'error')
  }
  const persist = (job: () => Promise<void>) => queueJob(job, fail)
  return { notice, setNotice, notify, fail, failLoad, failOpen, persist }
}
