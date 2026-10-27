/*
 * プラグインをビルドし、アプリに入れられる形（plugin.json・plugin.wasm・組み込み UI の .js）を out に並べる。zip はそれを固める。
 * 使い方: node cli.ts build [フォルダ] [--out <dir>] [--no-wasm]
 *         node cli.ts zip [フォルダ] [--out <file>]
 * フォルダの既定はいまの場所、out の既定は <フォルダ>/dist と <フォルダ>/<id>-<版>.zip。
 * Node 22.18 以上と esbuild（プラグインのフォルダから見つかるもの）が要る。Cargo.toml があれば、cargo と wasm32-wasip2 も要る。
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import zlib from 'node:zlib'
import type { Manifest } from './manifest.ts'

type Esbuild = typeof import('esbuild')

const SDK = path.join(import.meta.dirname, 'index.ts')

/** plugin.json を読み、入れるときに確かめられることを先に確かめる。 */
function readManifest(dir: string): Manifest {
  const file = path.join(dir, 'plugin.json')
  const m: Partial<Manifest> = JSON.parse(fs.readFileSync(file, 'utf8'))
  const { id, name, version, formats, ui } = m
  const missing = (k: string) => new Error(`${file}: 「${k}」が指定されていません`)
  if (!id) throw missing('id')
  if (!name) throw missing('name')
  if (!version) throw missing('version')
  if (!formats || typeof formats !== 'object') throw missing('formats')
  if (ui !== undefined && !ui.endsWith('.js'))
    throw new Error(`${file}: 「ui」には .js のパスを指定してください（${ui}）`)
  return { ...m, id, name, version, formats }
}

/** esbuild を、プラグインのフォルダから、なければこのファイルの場所から探す。 */
async function loadEsbuild(dir: string): Promise<Esbuild> {
  for (const from of [dir, import.meta.dirname]) {
    let found: string
    try {
      found = createRequire(path.join(from, 'package.json')).resolve('esbuild')
    } catch {
      continue
    }
    const mod: Esbuild & { default?: Esbuild } = await import(pathToFileURL(found).href)
    return mod.default ?? mod
  }
  throw new Error('esbuild が見つかりません')
}

/** cargo で WASM のコンポーネントを作り、そのパスを返す。 */
function cargo(dir: string): Promise<string> {
  const manifest = path.join(dir, 'Cargo.toml')
  const args = ['build', '--release', '--target', 'wasm32-wasip2', '--message-format=json-render-diagnostics']
  return new Promise((resolve, reject) => {
    // .cargo/config.toml を効かせるため、プラグインのフォルダで動かす
    const p = spawn('cargo', [...args, '--manifest-path', manifest], {
      cwd: dir,
      stdio: ['ignore', 'pipe', 'inherit'],
    })
    let out = ''
    p.stdout.on('data', (d) => (out += d))
    p.on('error', (e) => reject(new Error(`cargo の起動に失敗しました：${e.message}`)))
    p.on('close', (code) => {
      if (code !== 0) return reject(new Error(`cargo のビルドに失敗しました（終了コード ${code}）`))
      const wasm = out
        .split('\n')
        .flatMap((line) => {
          if (!line.startsWith('{')) return []
          const msg: { reason?: string; manifest_path?: string; filenames?: string[] } = JSON.parse(line)
          if (msg.reason !== 'compiler-artifact' || path.resolve(msg.manifest_path ?? '') !== path.resolve(manifest))
            return []
          return (msg.filenames ?? []).filter((f) => f.endsWith('.wasm'))
        })
        .at(-1)
      if (wasm) resolve(wasm)
      else reject(new Error(`${manifest}: .wasm ファイルが出力されませんでした`))
    })
  })
}

/** 組み込み UI（ui の拡張子を .ts にしたもの）を、1 つの ES モジュールにまとめる。 */
async function bundle(dir: string, ui: string, out: string) {
  const entry = path.join(dir, ui.replace(/\.js$/, '.ts'))
  if (!fs.existsSync(entry)) throw new Error(`組み込み UI の元（${path.relative(dir, entry)}）が見つかりません`)
  const esbuild = await loadEsbuild(dir)
  await esbuild.build({
    entryPoints: [entry],
    outfile: path.join(out, ui),
    absWorkingDir: dir,
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2023',
    minify: true,
    charset: 'utf8',
    logLevel: 'warning',
    plugins: [
      {
        name: 'patchouli',
        setup(b) {
          b.onResolve({ filter: /^@patchouli\/plugin$/ }, () => ({ path: SDK }))
        },
      },
    ],
  })
}

export interface BuildOptions {
  /** 並べる先。中は消してから作る。 */
  out?: string
  /** WASM を作らない（組み込みのプラグインは、アプリのビルドがまとめて作る）。 */
  wasm?: boolean
}

/** dir のプラグインをビルドし、入れられる形を out に並べる。 */
export async function build(dir: string, opts: BuildOptions = {}) {
  const m = readManifest(dir)
  const out = path.resolve(opts.out ?? path.join(dir, 'dist'))
  fs.rmSync(out, { recursive: true, force: true })
  fs.mkdirSync(out, { recursive: true })
  if (opts.wasm !== false && fs.existsSync(path.join(dir, 'Cargo.toml')))
    fs.copyFileSync(await cargo(dir), path.join(out, 'plugin.wasm'))
  if (m.ui) await bundle(dir, m.ui, out)
  fs.copyFileSync(path.join(dir, 'plugin.json'), path.join(out, 'plugin.json'))
  return { manifest: m, out }
}

/** dir の中身を zip にする。Node は zip を書けないので、ここで組む。作り直しても同じものになるよう、日時は 1980/1/1 にする。 */
export function zipDir(dir: string, out: string) {
  const files = fs
    .readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => path.relative(dir, path.join(e.parentPath, e.name)).split(path.sep).join('/'))
    .toSorted()
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
  fs.mkdirSync(path.dirname(out), { recursive: true })
  fs.writeFileSync(out, Buffer.concat([...locals, cd, end]))
}

/** dir のプラグインをビルドし、アプリの「インストール」で選べる zip にする。 */
export async function zip(dir: string, opts: { out?: string } = {}) {
  const { manifest: m, out: dist } = await build(dir)
  const out = path.resolve(opts.out ?? path.join(dir, `${m.id}-${m.version}.zip`))
  zipDir(dist, out)
  return { manifest: m, out }
}

const rel = (p: string) => path.relative(process.cwd(), p) || '.'

async function main(argv: string[]) {
  const [cmd, ...rest] = argv
  let dir = '.'
  let out: string | undefined
  let wasm = true
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]
    if (a === '--out') out = rest[++i]
    else if (a === '--no-wasm') wasm = false
    else if (a?.startsWith('-')) throw new Error(`不明なオプションです：${a}`)
    else if (a) dir = a
  }
  dir = path.resolve(dir)
  if (cmd === 'build') {
    const r = await build(dir, { out, wasm })
    console.log(`${r.manifest.id} ${r.manifest.version} を ${rel(r.out)} に出力しました`)
  } else if (cmd === 'zip') {
    const r = await zip(dir, { out })
    console.log(`${r.manifest.id} ${r.manifest.version} を ${rel(r.out)} に出力しました`)
  } else {
    throw new Error(
      '使い方: node cli.ts build [フォルダ] [--out <dir>] [--no-wasm] / node cli.ts zip [フォルダ] [--out <file>]',
    )
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await main(process.argv.slice(2)).catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : e)
    process.exit(1)
  })
