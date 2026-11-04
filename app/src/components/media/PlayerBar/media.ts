import { type Accessor, type Setter, createEffect, createSignal, onCleanup } from 'solid-js'

type Values = { playing: boolean; at: number; length: number; muted: boolean; volume: number; rate: number }
type Entry = { [K in keyof Values]: [Accessor<Values[K]>, Setter<Values[K]>] } & { users: number; off: () => void }

const initial: Values = { playing: false, at: 0, length: 0, muted: false, volume: 1, rate: 1 }
const EVENTS = ['play', 'pause', 'ended', 'seeked', 'timeupdate', 'durationchange', 'volumechange', 'ratechange']
const entries = new Map<HTMLMediaElement, Entry>()
let frame = 0

// timeupdate は間が空くので、再生中のものは描くたびにまとめて読む
const tick = () => {
  frame = 0
  let any = false
  for (const [m, e] of entries) {
    if (m.paused) continue
    e.at[1](m.currentTime)
    any = true
  }
  if (any) frame = requestAnimationFrame(tick)
}

const acquire = (m: HTMLMediaElement) => {
  const had = entries.get(m)
  if (had) {
    had.users++
    return had
  }
  const sync = () => {
    e.playing[1](!m.paused)
    e.at[1](m.currentTime)
    e.length[1](Number.isFinite(m.duration) ? m.duration : 0)
    e.muted[1](m.muted)
    e.volume[1](m.volume)
    e.rate[1](m.playbackRate)
    if (!m.paused && !frame) frame = requestAnimationFrame(tick)
  }
  const e: Entry = {
    playing: createSignal(initial.playing),
    at: createSignal(initial.at),
    length: createSignal(initial.length),
    muted: createSignal(initial.muted),
    volume: createSignal(initial.volume),
    rate: createSignal(initial.rate),
    users: 1,
    off: () => {
      for (const ev of EVENTS) m.removeEventListener(ev, sync)
    },
  }
  for (const ev of EVENTS) m.addEventListener(ev, sync)
  entries.set(m, e)
  sync()
  return e
}

const release = (m: HTMLMediaElement) => {
  const e = entries.get(m)
  if (!e || --e.users > 0) return
  e.off()
  entries.delete(m)
}

/** 音声や動画の再生の様子。同じ要素を見るものどうしで、読み取りを分け合う。 */
export function createMediaState(media: Accessor<HTMLMediaElement | undefined>) {
  const [entry, setEntry] = createSignal<Entry>()
  createEffect(() => {
    const m = media()
    if (!m) {
      setEntry(undefined)
      return
    }
    setEntry(acquire(m))
    onCleanup(() => release(m))
  })
  return {
    playing: () => entry()?.playing[0]() ?? initial.playing,
    at: () => entry()?.at[0]() ?? initial.at,
    length: () => entry()?.length[0]() ?? initial.length,
    muted: () => entry()?.muted[0]() ?? initial.muted,
    volume: () => entry()?.volume[0]() ?? initial.volume,
    rate: () => entry()?.rate[0]() ?? initial.rate,
  }
}
