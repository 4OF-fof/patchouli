/*
 * 音声の波形。WebView のデコーダーで読む。
 * まとめてデコードさせると、長いものでは元の細かさの音を丸ごと持つのでメモリを大きく使う（60 分の mp3 で 3 GB 余り）。
 * そこで、区切ってよい位置でファイルを分け、頭（形式の情報）を付け直した小さなファイルにして 1 つずつデコードする。
 */

/** 一度に読む長さの目安（バイト）。 */
const STEP = { mp3: 2 << 20, flac: 8 << 20, wav: 8 << 20 }

const ascii = (a, i, s) => [...s].every((c, k) => a[i + k] === c.charCodeAt(0))
const u32le = (a, i) => (a[i] | (a[i + 1] << 8) | (a[i + 2] << 16) | (a[i + 3] << 24)) >>> 0
const u16le = (a, i) => a[i] | (a[i + 1] << 8)
const concat = (...parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) {
    out.set(p, at)
    at += p.length
  }
  return out
}

/** 素材を offset から length バイト読む。終わりに近ければ短くなる。 */
const reader = (api) => async (offset, length) => new Uint8Array(await api.read(offset, length))

/* ---- mp3 ---- */

const MP3_KBPS = [
  // MPEG-1 Layer III
  [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  // MPEG-2 / 2.5 Layer III
  [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
]
const MP3_RATES = [
  [11025, 12000, 8000],
  [0, 0, 0],
  [22050, 24000, 16000],
  [44100, 48000, 32000],
]

/** i から始まる Layer III のフレームの長さと標本化周波数。フレームの頭でなければ null。 */
function mp3Frame(a, i) {
  if (a[i] !== 0xff || (a[i + 1] & 0xe0) !== 0xe0) return null
  const version = (a[i + 1] >> 3) & 3
  const layer = (a[i + 1] >> 1) & 3
  const br = a[i + 2] >> 4
  const sr = (a[i + 2] >> 2) & 3
  if (version === 1 || layer !== 1 || br === 0 || br === 15 || sr === 3) return null
  const rate = MP3_RATES[version][sr]
  const v1 = version === 3
  const kbps = MP3_KBPS[v1 ? 0 : 1][br]
  const pad = (a[i + 2] >> 1) & 1
  return { len: Math.floor(((v1 ? 144 : 72) * kbps * 1000) / rate) + pad, rate }
}

/** a の中で、i から始まるフレームが本物らしいか（次のフレームも続いているか）。 */
const mp3At = (a, i) => {
  const f = mp3Frame(a, i)
  if (!f) return null
  const j = i + f.len
  return j + 4 > a.length || mp3Frame(a, j) ? f : null
}

async function mp3(read) {
  const h = await read(0, 10)
  let start = 0
  if (ascii(h, 0, 'ID3')) start = 10 + ((h[6] << 21) | (h[7] << 14) | (h[8] << 7) | h[9]) + (h[5] & 0x10 ? 10 : 0)
  const probe = await read(start, 64 << 10)
  let rate = 44100
  for (let i = 0; i + 4 < probe.length; i++) {
    const f = mp3At(probe, i)
    if (f) {
      rate = f.rate
      start += i
      break
    }
  }
  return {
    start,
    rate,
    head: () => new Uint8Array(0),
    /** a の終わり近くの、最後のフレームの頭。 */
    cut(a) {
      for (let i = a.length - 4; i > 0; i--) if (mp3At(a, i)) return i
      return a.length
    },
  }
}

/* ---- flac ---- */

const crc8 = (a, from, to) => {
  let c = 0
  for (let i = from; i < to; i++) {
    c ^= a[i]
    for (let k = 0; k < 8; k++) c = c & 0x80 ? ((c << 1) ^ 0x07) & 0xff : (c << 1) & 0xff
  }
  return c
}

/** i から始まるのが FLAC のフレームの頭か（頭の CRC-8 まで確かめる）。 */
function flacFrame(a, i) {
  if (a[i] !== 0xff || (a[i + 1] & 0xfe) !== 0xf8) return false
  const bs = a[i + 2] >> 4
  const sr = a[i + 2] & 0xf
  const ch = a[i + 3] >> 4
  const ss = (a[i + 3] >> 1) & 7
  if (bs === 0 || sr === 15 || ch > 10 || ss === 3 || a[i + 3] & 1) return false
  // フレームの番号（UTF-8 と同じ形の可変長）
  let j = i + 4
  const lead = a[j]
  const n =
    lead < 0x80
      ? 0
      : lead >= 0xfe
        ? 6
        : lead >= 0xfc
          ? 5
          : lead >= 0xf8
            ? 4
            : lead >= 0xf0
              ? 3
              : lead >= 0xe0
                ? 2
                : lead >= 0xc0
                  ? 1
                  : -1
  if (n < 0) return false
  j += 1 + n
  if (bs === 6) j += 1
  else if (bs === 7) j += 2
  if (sr === 12) j += 1
  else if (sr === 13 || sr === 14) j += 2
  return j < a.length && crc8(a, i, j) === a[j]
}

async function flac(read) {
  const h = await read(0, 42)
  if (!ascii(h, 0, 'fLaC') || (h[4] & 0x7f) !== 0) throw new Error('FLAC の頭（STREAMINFO）が見つかりません')
  const info = h.slice(8, 42)
  // 全体の長さは、分けたものでは合わないので「不明」にする
  info[13] &= 0xf0
  info.fill(0, 14, 18)
  const rate = (info[10] << 12) | (info[11] << 4) | (info[12] >> 4)
  // ジャケットなど、ほかの情報は読み飛ばす
  let at = 4
  for (;;) {
    const b = await read(at, 4)
    if (b.length < 4) throw new Error('FLAC の情報が途中で終わっています')
    at += 4 + ((b[1] << 16) | (b[2] << 8) | b[3])
    if (b[0] & 0x80) break
  }
  const head = concat(new Uint8Array([0x66, 0x4c, 0x61, 0x43, 0x80, 0, 0, 34]), info)
  return {
    start: at,
    rate,
    head: () => head,
    cut(a) {
      for (let i = a.length - 16; i > 0; i--) if (flacFrame(a, i)) return i
      return a.length
    },
  }
}

/* ---- wav ---- */

async function wav(read) {
  const h = await read(0, 12)
  if (!ascii(h, 0, 'RIFF') || !ascii(h, 8, 'WAVE')) throw new Error('WAV の頭（RIFF）が見つかりません')
  let fmt
  let at = 12
  for (;;) {
    const c = await read(at, 8)
    if (c.length < 8) throw new Error('WAV の data チャンクが見つかりません')
    const size = u32le(c, 4)
    if (ascii(c, 0, 'fmt ')) fmt = await read(at + 8, size)
    else if (ascii(c, 0, 'data')) {
      if (!fmt) throw new Error('WAV の fmt チャンクが見つかりません')
      const align = u16le(fmt, 12) || 1
      const rate = u32le(fmt, 4)
      const start = at + 8
      // 長さが書けていない（書き出し途中のものなど）ときは、ファイルの終わりまで
      const end = size === 0 || size === 0xffffffff ? Infinity : start + size
      const head = (n) => {
        const b = new Uint8Array(12 + 8 + fmt.length + 8)
        const v = new DataView(b.buffer)
        b.set([0x52, 0x49, 0x46, 0x46], 0)
        v.setUint32(4, b.length - 8 + n, true)
        b.set([0x57, 0x41, 0x56, 0x45, 0x66, 0x6d, 0x74, 0x20], 8)
        v.setUint32(16, fmt.length, true)
        b.set(fmt, 20)
        b.set([0x64, 0x61, 0x74, 0x61], 20 + fmt.length)
        v.setUint32(24 + fmt.length, n, true)
        return b
      }
      return { start, end, rate, align, head, cut: (a) => a.length - (a.length % align) }
    }
    at += 8 + size + (size & 1)
  }
}

const LAYOUTS = { mp3, flac, wav }

/** 区間ごとの最大を、細かい区間で溜めていく。溜まりすぎたら隣どうしをまとめて半分にする。 */
class Envelope {
  constructor(points) {
    this.limit = points * 4
    this.vals = []
    this.size = 64
    this.cur = 0
    this.n = 0
  }

  push(channels) {
    const len = channels[0]?.length ?? 0
    let { cur, n, size } = this
    for (let i = 0; i < len; i++) {
      for (const c of channels) {
        const v = c[i] < 0 ? -c[i] : c[i]
        if (v > cur) cur = v
      }
      if (++n >= size) {
        this.vals.push(cur)
        cur = 0
        n = 0
        if (this.vals.length >= this.limit) {
          const v = this.vals
          this.vals = []
          for (let k = 0; k < v.length; k += 2) this.vals.push(Math.max(v[k], v[k + 1] ?? 0))
          this.size = size *= 2
        }
      }
    }
    Object.assign(this, { cur, n })
  }

  finish(points) {
    const vals = this.n ? [...this.vals, this.cur] : this.vals
    const out = new Float32Array(points)
    const len = vals.length
    if (!len) return out
    for (let p = 0; p < points; p++) {
      const from = Math.floor((p * len) / points)
      const to = Math.max(from + 1, Math.floor(((p + 1) * len) / points))
      let m = 0
      for (let k = from; k < to && k < len; k++) if (vals[k] > m) m = vals[k]
      out[p] = m
    }
    return out
  }
}

export async function waveform(api) {
  const ext = api.item.ext
  const layout = LAYOUTS[ext]
  if (!layout) return null
  const read = reader(api)
  const f = await layout(read)
  const rate = Math.min(192000, Math.max(8000, f.rate || 44100))
  const env = new Envelope(api.points)
  const step = STEP[ext] - (f.align ? STEP[ext] % f.align : 0)
  let pos = f.start
  let carry = new Uint8Array(0)
  let decoded = 0
  for (;;) {
    if (api.signal.aborted) throw api.signal.reason
    const want = Math.min(step, (f.end ?? Infinity) - pos)
    const got = want > 0 ? await read(pos, want) : new Uint8Array(0)
    pos += got.length
    const last = got.length < want || want <= 0
    const a = concat(carry, got)
    const cut = last ? a.length : f.cut(a)
    carry = a.slice(cut)
    const body = a.subarray(0, cut)
    if (body.length) {
      try {
        const buf = await new OfflineAudioContext(1, 1, rate).decodeAudioData(concat(f.head(body.length), body).buffer)
        env.push(Array.from({ length: buf.numberOfChannels }, (_, i) => buf.getChannelData(i)))
        decoded++
      } catch (e) {
        // 途中の一切れが読めなくても、ほかは描く
        if (!decoded && last) throw e
      }
    }
    if (last) break
  }
  if (!decoded) throw new Error('音声のデコードに失敗しました')
  return env.finish(api.points)
}
