import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { zipDir as zipFiles, zip as zipPlugin } from '../app/plugins/sdk/cli.ts'
import { EXAMPLE_PLUGINS, type SpecItem, TODAY, sampleSpec, stressSpec } from '../app/src/samples/spec.ts'

const ID_KEY = 'patchouli-id'
const TYPE_KEY = 'patchouli-type'
const DAY = 864e5

// --stress を付けると、負荷を調べるための大きなライブラリを作る
const stress = process.argv.includes('--stress')
const example = path.resolve(import.meta.dirname, '..', 'example')
const root = path.join(example, stress ? 'stress-library' : 'dev-library')
const pluginDir = path.join(example, 'dev-plugins')
const zipDir = path.join(example, 'dev-zips')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'patchouli-dev-library-'))

const FONTS = [
  'C:/Windows/Fonts/YuGothM.ttc',
  'C:/Windows/Fonts/meiryo.ttc',
  '/System/Library/Fonts/ヒラギノ角ゴシック W3.ttc',
  '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
  '/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc',
]
const font = FONTS.find((f) => fs.existsSync(f))
if (!font) console.warn('日本語のフォントが見つからないので、絵に名前を入れない')

const filterPath = (p: string) => `'${p.replaceAll('\\', '/').replaceAll(':', '\\:')}'`

function hex(h: number, s: number, l: number) {
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100)
  const f = (n: number) => {
    const k = (n + h / 30) % 12
    const v = l / 100 - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))
    return Math.round(v * 255)
      .toString(16)
      .padStart(2, '0')
  }
  return `0x${f(0)}${f(8)}${f(4)}`
}

/** 名前と大きさを左下に書くフィルタ。textfile は tmp からの相対パスで渡す。 */
function label(it: SpecItem, h: number, extra = '') {
  if (!font) return extra ? [extra] : []
  const txt = `${it.id}.txt`
  const size = it.size ? `${it.size[0]}×${it.size[1]}` : ''
  fs.writeFileSync(path.join(tmp, txt), `${it.name}\n${[size, it.ext].filter(Boolean).join(' · ')}`)
  const fs1 = Math.round(h / 20)
  return [
    `drawtext=fontfile=${filterPath(font)}:textfile=${txt}:fontsize=${fs1}:line_spacing=${Math.round(fs1 / 3)}:fontcolor=white@0.9:x=${fs1}:y=h-th-${fs1}`,
    ...(extra ? [extra.replace('FONT', filterPath(font))] : []),
  ]
}

function ffmpegArgs(it: SpecItem, out: string): string[] {
  const sat = Math.min(90, it.sat * 2.5)
  const c0 = hex(it.hue, sat, 58)
  const c1 = hex(it.hue + 40, sat, 24)
  const [w, h] = it.size ?? [0, 0]
  const sec = String(it.sec ?? 4)
  const base = ['-v', 'error', '-y']
  if (it.media === 'image') {
    const codec =
      it.ext === 'jpg'
        ? ['-q:v', '3']
        : it.ext === 'webp'
          ? ['-c:v', 'libwebp', '-quality', '80']
          : it.ext === 'psd'
            ? ['-f', 'rawvideo', '-pix_fmt', 'rgb24']
            : ['-pix_fmt', 'rgb24']
    const vf = label(it, h)
    return [
      ...base,
      ...['-f', 'lavfi', '-i', `gradients=s=${w}x${h}:c0=${c0}:c1=${c1}:n=2:seed=${it.hue}`],
      ...(vf.length ? ['-vf', vf.join(',')] : []),
      ...['-frames:v', '1', ...codec, out],
    ]
  }
  // 波形で見分けられるよう、音の大きさを揺らす。重いものは、長くても場所ごとに形が変わるよう分単位でも揺らす
  const tone = it.heavy
    ? `aevalsrc=0.4*sin(2*PI*220*t)*abs(sin(PI*t/7))*(0.3+0.7*abs(sin(PI*t/97)))+0.2*sin(2*PI*(330+110*sin(t/30))*t)` +
      `|0.4*sin(2*PI*277*t)*abs(cos(PI*t/5))*(0.3+0.7*abs(cos(PI*t/61))):s=${it.heavy.rate ?? 48000}:d=${sec}`
    : /rain|noise/.test(it.name)
      ? `anoisesrc=c=pink:a=0.15:d=${sec}`
      : `aevalsrc=sin(2*PI*${220 + it.hue}*t)*(0.15+0.85*abs(sin(PI*t/${3 + (it.hue % 5)}))):d=${sec}`
  if (it.media === 'audio') {
    const codec =
      it.ext === 'mp3'
        ? ['-c:a', 'libmp3lame']
        : it.ext === 'flac' && it.heavy
          ? ['-sample_fmt', 's32', '-bits_per_raw_sample', '24']
          : []
    if (!it.jacket) return [...base, '-f', 'lavfi', '-i', tone, ...codec, out]
    const side = it.heavy ? 3000 : 600
    const vf = label(it, side)
    return [
      ...base,
      ...['-f', 'lavfi', '-i', tone],
      // -frames:v で絵を 1 枚にすると音声も切れるので、入力を 1 枚にする
      ...['-f', 'lavfi', '-i', `gradients=s=${side}x${side}:c0=${c0}:c1=${c1}:n=2:seed=${it.hue}:r=1:d=1`],
      ...(vf.length ? ['-filter:v', vf.join(',')] : []),
      ...['-map', '0:a', '-map', '1:v', ...codec, '-c:v', 'mjpeg', '-q:v', '3'],
      ...['-disposition:v', 'attached_pic', '-id3v2_version', '3', '-metadata:s:v', 'comment=Cover (front)', out],
    ]
  }
  // 再生できているか分かるよう、右上に経過時間を出す
  const clock = `drawtext=fontfile=FONT:text='%{pts\\:hms}':fontsize=${Math.round(h / 20)}:fontcolor=white@0.9:x=w-tw-${Math.round(h / 20)}:y=${Math.round(h / 20)}`
  // 重いものは、長くてもファイルが大きくなりすぎないよう、ふつうの動画くらいのビットレートに抑える
  const rate = it.heavy ? `${Math.ceil((w * h * (it.heavy.fps ?? 30)) / 4e7)}M` : undefined
  const codec =
    it.ext === 'webm'
      ? ['-c:v', 'libvpx-vp9', '-b:v', rate ?? '1M', '-deadline', 'realtime', '-cpu-used', '8', '-c:a', 'libopus']
      : ['-c:v', 'libx264', '-preset', 'veryfast', ...(rate ? ['-b:v', rate] : []), '-c:a', 'aac', '-movflags', '+faststart']
  const vf = label(it, h, font ? clock : '')
  // 重いものは、動きの多い絵にする
  const picture = it.heavy
    ? `testsrc2=s=${w}x${h}:r=${it.heavy.fps ?? 30}:d=${sec}`
    : `gradients=s=${w}x${h}:c0=${c0}:c1=${c1}:n=2:speed=0.02:r=30:d=${sec}:seed=${it.hue}`
  return [
    ...base,
    ...['-f', 'lavfi', '-i', picture],
    ...['-f', 'lavfi', '-i', tone],
    ...(vf.length ? ['-vf', vf.join(',')] : []),
    ...['-pix_fmt', 'yuv420p', ...codec, '-shortest', out],
  ]
}

/** PackBits で 1 行を縮める。 */
function packBits(row: Uint8Array) {
  const out: number[] = []
  let i = 0
  while (i < row.length) {
    let same = 1
    while (i + same < row.length && same < 128 && row[i + same] === row[i]) same++
    if (same >= 2) {
      out.push(257 - same, row[i] ?? 0)
      i += same
      continue
    }
    let j = i + 1
    while (j < row.length && j - i < 128 && row[j] !== row[j + 1]) j++
    out.push(j - i - 1, ...row.subarray(i, j))
    i = j
  }
  return Buffer.from(out)
}

/**
 * rgb（rgb24 の画素）を背景のレイヤーにし、左上に四角いレイヤーを重ねた PSD を書く。
 * 合成画像は PackBits、レイヤーは圧縮しないで入れる。
 */
function writePsd(file: string, rgb: Buffer, it: SpecItem) {
  const [w, h] = it.size ?? [0, 0]
  const box = { top: Math.round(h / 8), left: Math.round(w / 8), bottom: Math.round(h / 3), right: Math.round(w / 3) }
  const color = Number(hex(it.hue + 180, 60, 50))
  const shape = [16, 8, 0].map((s) => (color >> s) & 0xff)
  const plane = (c: number, x0: number, y0: number, x1: number, y1: number, fill?: number) => {
    const out = Buffer.alloc((x1 - x0) * (y1 - y0))
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) out[(y - y0) * (x1 - x0) + x - x0] = fill ?? rgb[(y * w + x) * 3 + c] ?? 0
    return out
  }
  const u16 = (v: number) => Buffer.from([v >> 8, v & 0xff])
  const u32 = (v: number) => {
    const b = Buffer.alloc(4)
    b.writeUInt32BE(v)
    return b
  }
  const layers = [
    { name: 'background', top: 0, left: 0, bottom: h, right: w, planes: [0, 1, 2].map((c) => plane(c, 0, 0, w, h)) },
    {
      name: 'shape',
      ...box,
      planes: shape.map((v) => plane(0, box.left, box.top, box.right, box.bottom, v)),
    },
  ]
  const records = layers.map((l) => {
    const name = Buffer.from(l.name, 'latin1')
    const padded = Buffer.alloc(Math.ceil((name.length + 1) / 4) * 4)
    padded[0] = name.length
    name.copy(padded, 1)
    return Buffer.concat([
      ...[l.top, l.left, l.bottom, l.right].map(u32),
      u16(3),
      ...l.planes.flatMap((p, c) => [u16(c), u32(p.length + 2)]),
      Buffer.from('8BIMnorm'),
      Buffer.from([255, 0, 0, 0]),
      u32(8 + padded.length),
      u32(0),
      u32(0),
      padded,
    ])
  })
  const data = layers.flatMap((l) => l.planes.flatMap((p) => [u16(0), p]))
  let info = Buffer.concat([u16(layers.length), ...records, ...data])
  if (info.length % 2) info = Buffer.concat([info, Buffer.alloc(1)])
  const masks = Buffer.concat([u32(info.length), info, u32(0)])
  // 合成画像は、背景に四角を描いたもの
  const merged = [0, 1, 2].map((c) => {
    const p = plane(c, 0, 0, w, h)
    for (let y = box.top; y < box.bottom; y++) p.fill(shape[c] ?? 0, y * w + box.left, y * w + box.right)
    return p
  })
  const rows = merged.flatMap((p) => Array.from({ length: h }, (_, y) => packBits(p.subarray(y * w, (y + 1) * w))))
  fs.writeFileSync(
    file,
    Buffer.concat([
      Buffer.from('8BPS'),
      u16(1),
      Buffer.alloc(6),
      u16(3),
      u32(h),
      u32(w),
      u16(8),
      u16(3),
      u32(0),
      u32(0),
      u32(masks.length),
      masks,
      u16(1),
      ...rows.map((r) => u16(r.length)),
      ...rows,
    ]),
  )
}

function run(args: string[], cmd = 'ffmpeg', cwd = tmp) {
  return new Promise<void>((resolve, reject) => {
    const p = spawn(cmd, args, { cwd, stdio: ['ignore', 'ignore', 'pipe'] })
    let err = ''
    p.stderr.on('data', (d) => (err += d))
    p.on('error', (e) => reject(new Error(`${cmd} を起動できない: ${e.message}`)))
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} が失敗した (${code}): ${err}`))))
  })
}

async function installExamples() {
  for (const d of [pluginDir, zipDir]) {
    fs.rmSync(d, { recursive: true, force: true })
    fs.mkdirSync(d)
  }
  const record: Record<string, unknown> = {}
  for (const dir of EXAMPLE_PLUGINS) {
    const src = path.join(example, dir)
    const local = path.join(zipDir, `${dir}.zip`)
    const { manifest: m } = await zipPlugin(src, { out: local })
    fs.cpSync(path.join(src, 'dist'), path.join(pluginDir, m.id), { recursive: true })
    const hash = `sha256:${createHash('sha256').update(fs.readFileSync(local)).digest('hex')}`
    record[m.id] = { version: m.version, source: { local }, hash }
  }
  return record
}

function markdown(it: SpecItem) {
  const front = [
    '---',
    `${ID_KEY}: ${JSON.stringify(it.id)}`,
    `tags: ${JSON.stringify(it.tags)}`,
    `aliases: ${JSON.stringify(it.aliases ?? [])}`,
    ...(it.url ? [`url: ${JSON.stringify(it.url)}`] : []),
    '---',
  ]
  return `${front.join('\n')}\n\n${it.body ?? ''}`
}

const json = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`

// アプリ（src-tauri/src/cover.rs）と同じ形。説明は .md、ほかは .json、中身のないカードは並びにだけ書く
function writeCards(dir: string, cards: ({ id: string; type: string } & Record<string, unknown>)[]) {
  fs.mkdirSync(dir, { recursive: true })
  for (const { id, ...card } of cards) {
    if (card.type === 'desc') fs.writeFileSync(path.join(dir, `${id}.md`), String(card.text))
    else if (Object.keys(card).length > 1) fs.writeFileSync(path.join(dir, `${id}.json`), json(card))
  }
  fs.writeFileSync(path.join(dir, 'layout.json'), json(cards.map((c) => c.id)))
}

const spec = stress ? stressSpec() : sampleSpec()
fs.rmSync(root, { recursive: true, force: true })
fs.mkdirSync(root, { recursive: true })

const state = path.join(root, '.patchouli')
spec.projects.forEach((p, i) => {
  const id = `p${i + 1}`
  fs.mkdirSync(path.join(root, p.name))
  fs.writeFileSync(path.join(root, `${p.name}.meta`), json({ [ID_KEY]: id, [TYPE_KEY]: 'project' }))
  if (p.cover.length) writeCards(path.join(state, 'projects', id), p.cover)
})

// 照合用の値（patchouli-print）は、アプリが最初に読んだときに書く
const groupDir = new Map<string, string>()
const dirOf = (place: { project: string | null; group: string | null }): string =>
  (place.group && groupDir.get(place.group)) || (place.project ? path.join(root, place.project) : root)
for (const g of spec.groups) {
  const dir = path.join(dirOf({ project: g.project, group: g.parent }), g.name)
  groupDir.set(g.id, dir)
  fs.mkdirSync(dir)
  fs.writeFileSync(`${dir}.meta`, json({ [ID_KEY]: g.id }))
}

const tagIds = Object.fromEntries([...spec.tagCovers.keys()].map((t, i) => [t, `t${i + 1}`]))
for (const [t, cover] of spec.tagCovers) writeCards(path.join(state, 'tags', tagIds[t] ?? t), cover)
fs.mkdirSync(path.join(state, 'tags'), { recursive: true })
fs.writeFileSync(path.join(state, 'tags', 'index.json'), json(tagIds))

fs.writeFileSync(
  path.join(state, 'library.json'),
  json({
    pins: spec.pins,
    pinnedProjects: spec.pinnedProjects,
    pinnedTags: spec.pinnedTags,
    plugins: await installExamples(),
  }),
)

const jobs: (() => Promise<void>)[] = []
const touched: { file: string; moved: number }[] = []
const archives: { it: SpecItem; file: string }[] = []
// 負荷を調べるライブラリでは、形の同じ素材を 1 つだけ作り、ほかはそれを複製する
const bases = new Map<string, string>()
const copies: { from: string; to: string }[] = []
for (const it of spec.items) {
  const dir = dirOf(it)
  if (it.media === 'note') {
    const file = path.join(dir, `${it.name}.md`)
    fs.writeFileSync(file, markdown(it))
    touched.push({ file, moved: it.moved })
    continue
  }
  const file = path.join(dir, `${it.name}.${it.ext}`)
  const meta = `${file}.meta`
  const url = it.media !== 'link' && it.url ? { url: it.url } : {}
  fs.writeFileSync(meta, json({ [ID_KEY]: it.id, tags: it.tags, memo: it.memo, ...url }))
  touched.push({ file, moved: it.moved }, { file: meta, moved: it.moved })
  if (it.media === 'other') fs.writeFileSync(file, '')
  else if (it.media === 'archive') archives.push({ it, file })
  else if (it.media === 'link') fs.writeFileSync(file, `[InternetShortcut]\r\nURL=${it.link ?? ''}\r\n`)
  else if (it.ext === 'psd')
    jobs.push(async () => {
      const raw = path.join(tmp, `${it.id}.rgb`)
      await run(ffmpegArgs(it, raw))
      writePsd(file, fs.readFileSync(raw), it)
    })
  else if (stress && !it.heavy) {
    const key = [it.ext, it.size, it.sec, it.jacket].join(' ')
    let from = bases.get(key)
    if (!from) {
      const id = `base${bases.size + 1}`
      const out = path.join(tmp, `${id}.${it.ext}`)
      bases.set(key, out)
      jobs.push(() => run(ffmpegArgs({ ...it, id, name: '複製した素材' }, out)))
      from = out
    }
    copies.push({ from, to: file })
  } else jobs.push(() => run(ffmpegArgs(it, file)))
}

const width = Math.max(2, Math.floor(os.availableParallelism() / 2))
let next = 0
let done = 0
await Promise.all(
  Array.from({ length: width }, async () => {
    while (next < jobs.length) {
      await jobs[next++]?.()
      process.stdout.write(`\r素材 ${++done} / ${jobs.length}`)
    }
  }),
)
process.stdout.write('\n')
copies.forEach(({ from, to }, i) => {
  fs.copyFileSync(from, to)
  if (i % 500 === 499 || i === copies.length - 1) process.stdout.write(`\r複製 ${i + 1} / ${copies.length}`)
})
if (copies.length) process.stdout.write('\n')

// zip は、中に入れる素材ができてから作る
for (const { it, file } of archives) {
  const stage = path.join(tmp, `archive-${it.id}`)
  for (const [at, from] of Object.entries(it.archive ?? {})) {
    const to = path.join(stage, at)
    fs.mkdirSync(path.dirname(to), { recursive: true })
    if (typeof from === 'string') fs.writeFileSync(to, from)
    else {
      const src = spec.items.find((i) => i.name === from.item)
      if (!src) throw new Error(`${it.name}.zip に入れる「${from.item}」が見本にない`)
      fs.copyFileSync(path.join(dirOf(src), `${src.name}.${src.ext}`), to)
    }
  }
  zipFiles(stage, file)
}

// 更新日時は「いま」から、見本で動いた日数だけ戻す
const now = Date.now()
for (const { file, moved } of touched) {
  const t = new Date(now - moved * DAY)
  fs.utimesSync(file, t, t)
}
fs.rmSync(tmp, { recursive: true, force: true })

const count = (k: string) => spec.items.filter((i) => i.media === k).length
console.log(
  `${path.relative(process.cwd(), root) || root} を作った（見本の今日 ${TODAY.toLocaleDateString('ja-JP')}）: ` +
    `プロジェクト ${spec.projects.length}、グループ ${spec.groups.length}、ノート ${count('note')}、画像 ${count('image')}、動画 ${count('video')}、音声 ${count('audio')}、ショートカット ${count('link')}、zip ${count('archive')}、` +
    `未対応 ${count('other')}、例のプラグイン ${EXAMPLE_PLUGINS.length}（${path.relative(process.cwd(), pluginDir)}）`,
)
