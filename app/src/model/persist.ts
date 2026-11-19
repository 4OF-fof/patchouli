/* 書き込みを積んだ順に流す。窓を閉じるときや読み込み直すときは、flush で積んだものが終わるのを待つ。 */

let queue = Promise.resolve()
const waiting = new Set<() => void>()

/** job を前のものが終わってから流す。失敗したら fail に渡す。 */
export function persist(job: () => Promise<void>, fail: (e: unknown) => void) {
  queue = queue.then(job).catch(fail)
}

/** 書くのを待っているもの（入力のあいだ待つものなど）を、flush のときにすぐ書かせる。返した関数で外す。 */
export function onFlush(write: () => void): () => void {
  waiting.add(write)
  return () => waiting.delete(write)
}

export async function flush(): Promise<void> {
  for (const write of waiting) write()
  await queue
}
