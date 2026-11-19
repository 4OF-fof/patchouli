import { createSignal } from 'solid-js'

/** 失敗したときに見せる文。 */
export const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** 1 つずつ行う操作の、いま行っているものの名前と、失敗したときの文。 */
export function createBusy(onError?: () => void) {
  const [busy, setBusy] = createSignal<string>()
  const [error, setError] = createSignal<string>()
  const run = async (label: string, job: () => Promise<unknown>) => {
    setBusy(label)
    setError(undefined)
    try {
      await job()
    } catch (e) {
      setError(message(e))
      onError?.()
    } finally {
      setBusy(undefined)
    }
  }
  return { busy, error, setError, run }
}
