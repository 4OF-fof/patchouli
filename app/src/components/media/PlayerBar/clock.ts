const two = (n: number) => String(n).padStart(2, '0')

export function clock(sec: number) {
  if (!Number.isFinite(sec) || sec < 0) return '--:--'
  const s = Math.floor(sec)
  const h = Math.floor(s / 3600)
  const m = Math.floor(s / 60) % 60
  return h ? `${h}:${two(m)}:${two(s % 60)}` : `${m}:${two(s % 60)}`
}
