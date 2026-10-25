// 動作確認用のライブラリ（example/dev-library/）を作り直す。中身は app/src/samples/spec.ts で、画面の見本と同じ。
// 例のプラグイン（example/ の下）もビルドして example/dev-plugins/ に入れ、ライブラリに記録する。
// 取得先には、同じ中身を zip にしたもの（example/dev-zips/）を記録する。
// 開発中のアプリは、どちらも既定で使う。自動分類の候補は置き場所が決まっていないので書かない。
// 使い方: node scripts/dev-library.ts（Node 24 以上と ffmpeg、cargo と wasm32-wasip2 が要る。
// example/dev-library/ と example/dev-plugins/、example/dev-zips/ は消してから作る）
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import {
  EXAMPLE_PLUGINS,
  PINNED_PROJECTS,
  PINNED_TAGS,
  type SpecItem,
  TODAY,
  sampleSpec,
} from '../app/src/samples/spec.ts'

const ID_KEY = 'patchouli-id'
const DAY = 864e5

const example = path.resolve(import.meta.dirname, '..', 'example')
const root = path.join(example, 'dev-library')
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

/** ffmpeg のフィルタに渡すパス。: と \ を逃がす。 */
const filterPath = (p: string) => `'${p.replaceAll('\\', '/').replaceAll(':', '\\:')}'`

/** 色相と彩度（0〜100）から、ffmpeg の 0xRRGGBB。 */
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
      it.ext === 'jpg' ? ['-q:v', '3'] : it.ext === 'webp' ? ['-c:v', 'libwebp', '-quality', '80'] : ['-pix_fmt', 'rgb24']
    const vf = label(it, h)
    return [
      ...base,
      ...['-f', 'lavfi', '-i', `gradients=s=${w}x${h}:c0=${c0}:c1=${c1}:n=2:seed=${it.hue}`],
      ...(vf.length ? ['-vf', vf.join(',')] : []),
      ...['-frames:v', '1', ...codec, out],
    ]
  }
  const tone = /rain|noise/.test(it.name) ? `anoisesrc=c=pink:a=0.15:d=${sec}` : `sine=f=${220 + it.hue}:d=${sec}`
  if (it.media === 'audio') {
    const codec = it.ext === 'm4a' ? ['-c:a', 'aac'] : it.ext === 'mp3' ? ['-c:a', 'libmp3lame'] : []
    return [...base, '-f', 'lavfi', '-i', tone, ...codec, out]
  }
  // 再生できているか分かるよう、右上に経過時間を出す
  const clock = `drawtext=fontfile=FONT:text='%{pts\\:hms}':fontsize=${Math.round(h / 20)}:fontcolor=white@0.9:x=w-tw-${Math.round(h / 20)}:y=${Math.round(h / 20)}`
  const codec =
    it.ext === 'webm'
      ? ['-c:v', 'libvpx-vp9', '-b:v', '1M', '-deadline', 'realtime', '-cpu-used', '8', '-c:a', 'libopus']
      : ['-c:v', 'libx264', '-preset', 'veryfast', '-c:a', 'aac', '-movflags', '+faststart']
  const vf = label(it, h, font ? clock : '')
  return [
    ...base,
    ...['-f', 'lavfi', '-i', `gradients=s=${w}x${h}:c0=${c0}:c1=${c1}:n=2:speed=0.02:r=30:d=${sec}:seed=${it.hue}`],
    ...['-f', 'lavfi', '-i', tone],
    ...(vf.length ? ['-vf', vf.join(',')] : []),
    ...['-pix_fmt', 'yuv420p', ...codec, '-shortest', out],
  ]
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

/** dir の中身を zip にする。Node は zip を書けないので、ここで組む。作り直しても同じものになるよう、日時は 1980/1/1 にする。 */
function zip(dir: string, out: string) {
  const files = fs
    .readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => path.relative(dir, path.join(e.parentPath, e.name)).split(path.sep).join('/'))
    .sort()
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const name of files) {
    const data = fs.readFileSync(path.join(dir, name))
    const body = zlib.deflateRawSync(data)
    const n = Buffer.from(name)
    // 版 2.0・名前は UTF-8・deflate・日時・CRC・大きさ・名前の長さ・拡張なし
    const common = (b: Buffer, at: number) => {
      b.writeUInt16LE(20, at)
      b.writeUInt16LE(0x0800, at + 2)
      b.writeUInt16LE(8, at + 4)
      b.writeUInt16LE(0, at + 6)
      b.writeUInt16LE(0x21, at + 8)
      b.writeUInt32LE(zlib.crc32(data), at + 10)
      b.writeUInt32LE(body.length, at + 14)
      b.writeUInt32LE(data.length, at + 18)
      b.writeUInt16LE(n.length, at + 22)
    }
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    common(local, 4)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    common(central, 6)
    central.writeUInt32LE(offset, 42)
    locals.push(local, n, body)
    centrals.push(central, n)
    offset += local.length + n.length + body.length
  }
  const cd = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(cd.length, 12)
  end.writeUInt32LE(offset, 16)
  fs.writeFileSync(out, Buffer.concat([...locals, cd, end]))
}

/**
 * 例のプラグインをビルドし、それぞれのフォルダに plugin.wasm を置いてから、アプリのプラグインの置き場と同じ形で
 * pluginDir に入れる（<id>/ と、取得先を書いた sources.json）。取得先は、同じ中身を zipDir に zip にしたもの。
 * 返すのはライブラリに残す記録。
 */
async function installExamples() {
  await run(
    ['build', '--release', '--target', 'wasm32-wasip2', '--manifest-path', path.join(example, 'Cargo.toml')],
    'cargo',
    // example/.cargo/config.toml を効かせる
    example,
  )
  for (const d of [pluginDir, zipDir]) {
    fs.rmSync(d, { recursive: true, force: true })
    fs.mkdirSync(d)
  }
  const sources: Record<string, unknown> = {}
  const record: Record<string, unknown> = {}
  for (const dir of EXAMPLE_PLUGINS) {
    const src = path.join(example, dir)
    const m: { id: string; version: string } = JSON.parse(fs.readFileSync(path.join(src, 'plugin.json'), 'utf8'))
    const crate = /^name\s*=\s*"([^"]+)"/m.exec(fs.readFileSync(path.join(src, 'Cargo.toml'), 'utf8'))?.[1]
    if (!crate) throw new Error(`${dir}/Cargo.toml に name がない`)
    const wasm = path.join(example, 'target', 'wasm32-wasip2', 'release', `${crate.replaceAll('-', '_')}.wasm`)
    fs.copyFileSync(wasm, path.join(src, 'plugin.wasm'))
    fs.cpSync(src, path.join(pluginDir, m.id), { recursive: true })
    const local = path.join(zipDir, `${dir}.zip`)
    zip(src, local)
    sources[m.id] = { local }
    record[m.id] = { version: m.version, source: { local } }
  }
  fs.writeFileSync(path.join(pluginDir, 'sources.json'), json(sources))
  return record
}

/** ノートの本文を Markdown にする。続いた li の間は空けない。 */
function markdown(it: SpecItem) {
  const front = [
    '---',
    `${ID_KEY}: ${JSON.stringify(it.id)}`,
    `tags: ${JSON.stringify(it.tags)}`,
    `aliases: ${JSON.stringify(it.aliases ?? [])}`,
    '---',
  ]
  let body = ''
  let prev = ''
  for (const b of it.blocks ?? []) {
    const line = b.type === 'h2' ? `## ${b.text}` : b.type === 'li' ? `- ${b.text}` : b.text
    if (body) body += b.type === 'li' && prev === 'li' ? '\n' : '\n\n'
    body += line
    prev = b.type
  }
  return `${front.join('\n')}\n\n${body}\n`
}

const json = (v: unknown) => `${JSON.stringify(v, null, 2)}\n`

const spec = sampleSpec()
fs.rmSync(root, { recursive: true, force: true })
fs.mkdirSync(root, { recursive: true })

spec.projects.forEach((p, i) => {
  fs.mkdirSync(path.join(root, p.name))
  fs.writeFileSync(path.join(root, `${p.name}.meta`), json({ [ID_KEY]: `p${i + 1}`, cover: p.cover }))
})

// ピン留めとタグの表紙はライブラリ全体で 1 つ
fs.mkdirSync(path.join(root, '.patchouli'))
fs.writeFileSync(
  path.join(root, '.patchouli', 'library.json'),
  json({
    pins: spec.pins,
    pinnedProjects: PINNED_PROJECTS,
    pinnedTags: PINNED_TAGS,
    tagCovers: Object.fromEntries(spec.tagCovers),
  }),
)
fs.writeFileSync(path.join(root, '.patchouli', 'plugins.json'), json({ plugins: await installExamples() }))

const jobs: (() => Promise<void>)[] = []
const touched: { file: string; moved: number }[] = []
for (const it of spec.items) {
  const dir = it.folder ? path.join(root, it.folder) : root
  if (it.media === 'note') {
    const file = path.join(dir, `${it.name}.md`)
    fs.writeFileSync(file, markdown(it))
    touched.push({ file, moved: it.moved })
    continue
  }
  const file = path.join(dir, `${it.name}.${it.ext}`)
  const meta = `${file}.meta`
  fs.writeFileSync(meta, json({ [ID_KEY]: it.id, tags: it.tags, rating: it.rating, memo: it.memo }))
  touched.push({ file, moved: it.moved }, { file: meta, moved: it.moved })
  if (it.media === 'text') fs.writeFileSync(file, `${it.text ?? ''}\n`)
  else jobs.push(() => run(ffmpegArgs(it, file)))
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
    `プロジェクト ${spec.projects.length}、ノート ${count('note')}、画像 ${count('image')}、動画 ${count('video')}、音声 ${count('audio')}、` +
    `テキスト ${count('text')}、例のプラグイン ${EXAMPLE_PLUGINS.length}（${path.relative(process.cwd(), pluginDir)}）`,
)
