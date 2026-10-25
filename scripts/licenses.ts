// アプリと、アプリに同梱するもののうち権利表示が要るものの一覧（app/src/notices/third-party.json）を作り直す。
// 設定の「権利表示」で出す。
// 対象は、フロントの dependencies のうち JS を持つものと、Rust のふつうの依存のうちビルド先に入るもの（ビルドだけに使うものと proc-macro は除く）。
// 複数のライセンスから選べるものは、義務のいちばん軽いものを選ぶ。選んだライセンスで権利表示が要らないものは載せない。
// 使い方: node scripts/licenses.ts [ビルド先のターゲット]（省略するとこの PC。依存を足したり上げたりしたら流し直す）
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const app = path.resolve(import.meta.dirname, '..', 'app')
const out = path.join(app, 'src', 'notices', 'third-party.json')
const target =
  process.argv[2] ??
  /^host: (.+)$/m.exec(execSync('rustc -vV', { encoding: 'utf8' }))?.[1] ??
  (() => {
    throw new Error('ビルド先のターゲットがわからない')
  })()

interface Entry {
  name: string
  version: string
  /** 選んだライセンス。 */
  license: string
  /** 文面が見つからないときに見に行く先。 */
  url?: string
  /** texts の中の位置。同じ文面は 1 つにまとめる。 */
  texts: number[]
}

/**
 * ライセンスごとの、アプリに入れて配るときの義務の重さ。0 は権利表示が要らない。
 * 載っていないものは重いとみなし、文面をすべて載せる。
 */
const WEIGHT: Record<string, number> = {
  '0BSD': 0,
  'BSL-1.0': 0,
  'CC0-1.0': 0,
  'MIT-0': 0,
  Unlicense: 0,
  WTFPL: 0,
  Zlib: 0,
  'Apache-2.0 WITH LLVM-exception': 0,
  MIT: 1,
  ISC: 1,
  'BSD-2-Clause': 1,
  'BSD-3-Clause': 1,
  'Unicode-3.0': 1,
  'Unicode-DFS-2016': 1,
  'Apache-2.0': 2,
  'MPL-2.0': 3,
}
const UNKNOWN = 9
const weightOf = (id: string) => WEIGHT[id] ?? UNKNOWN

/** 文面がどのライセンスのものか。 */
const KIND_OF_TEXT: [string, RegExp][] = [
  ['MIT', /Permission is hereby granted, free of charge/i],
  ['Apache-2.0', /Apache License[\s\S]*Version 2\.0/i],
  ['BSD-2-Clause', /Redistribution and use in source and binary forms/i],
  ['BSD-3-Clause', /Redistribution and use in source and binary forms/i],
  ['ISC', /Permission to use, copy, modify, and(\/or)? distribute this software/i],
  ['Unicode-3.0', /UNICODE LICENSE|Unicode, Inc/i],
  ['Unicode-DFS-2016', /UNICODE LICENSE|Unicode, Inc/i],
  ['MPL-2.0', /Mozilla Public License/i],
]

/**
 * SPDX の式から、義務のいちばん軽い組み合わせを選ぶ。AND は全部、OR は 1 つ。
 * 古い書き方の「MIT/Apache-2.0」も OR とみなす。
 */
function choose(expr: string): string[] {
  const s = expr.replaceAll(/[()]/g, ' ').replaceAll('/', ' OR ').trim()
  return s.split(/\s+AND\s+/).flatMap((clause) => {
    const options = clause.split(/\s+OR\s+/).map((o) => o.trim().replaceAll(/\s+/g, ' '))
    return [options.reduce((a, b) => (weightOf(b) < weightOf(a) ? b : a))]
  })
}

const texts: string[] = []
const textAt = new Map<string, number>()
const NOTICE_FILE = /^(licen[cs]e|copying|notice)/i

const readText = (file: string) => fs.readFileSync(file, 'utf8').replaceAll('\r\n', '\n').trim()
const keep = (t: string) => {
  let i = textAt.get(t)
  if (i === undefined) {
    i = texts.push(t) - 1
    textAt.set(t, i)
  }
  return i
}

/** パッケージのフォルダにある文面のうち、選んだライセンスのものと NOTICE。どれとも決められなければ全部。 */
function noticesIn(dir: string, chosen: string[]) {
  if (!fs.existsSync(dir)) return []
  const files = fs
    .readdirSync(dir)
    .filter((f) => NOTICE_FILE.test(f) && fs.statSync(path.join(dir, f)).isFile())
    .toSorted()
    .map((f) => ({ f, t: readText(path.join(dir, f)) }))
  const wanted = files.filter(
    ({ f, t }) =>
      (/^notice/i.test(f) && chosen.includes('Apache-2.0')) ||
      KIND_OF_TEXT.some(([id, re]) => chosen.includes(id) && re.test(t)),
  )
  return (wanted.length ? wanted : files).map(({ t }) => keep(t))
}

/** 権利表示が要るなら、載せる形にする。 */
function entry(name: string, version: string, license: string, dir: string, url?: string): Entry[] {
  const chosen = choose(license)
  if (chosen.every((id) => weightOf(id) === 0)) return []
  return [{ name, version, license: chosen.join(' AND '), url, texts: noticesIn(dir, chosen) }]
}

const run = (cmd: string) => execSync(cmd, { cwd: app, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })

/** JS のファイルがない（型だけの）パッケージは、アプリに入らない。 */
const hasScript = (dir: string): boolean =>
  fs
    .readdirSync(dir, { withFileTypes: true })
    .some((d) =>
      d.isDirectory()
        ? d.name !== 'node_modules' && hasScript(path.join(dir, d.name))
        : /\.(c|m)?js$/.test(d.name),
    )

function npm(): Entry[] {
  const list: Record<
    string,
    { name: string; versions: string[]; paths: string[]; license: string; homepage?: string }[]
  > = JSON.parse(run('pnpm licenses list --prod --json'))
  return Object.values(list)
    .flat()
    .flatMap((p) =>
      p.versions.flatMap((v, i) => {
        const dir = p.paths[i] ?? ''
        return hasScript(dir) ? entry(p.name, v, p.license, dir, p.homepage) : []
      }),
    )
}

interface CargoPackage {
  id: string
  name: string
  version: string
  license: string | null
  repository: string | null
  homepage: string | null
  manifest_path: string
  targets: { kind: string[] }[]
}
interface CargoNode {
  id: string
  deps: { pkg: string; dep_kinds: { kind: string | null }[] }[]
}

function cargo(): Entry[] {
  const meta: { packages: CargoPackage[]; resolve: { root: string; nodes: CargoNode[] } } = JSON.parse(
    run(`cargo metadata --format-version 1 --filter-platform ${target} --manifest-path src-tauri/Cargo.toml`),
  )
  const pkgs = new Map(meta.packages.map((p) => [p.id, p]))
  const nodes = new Map(meta.resolve.nodes.map((n) => [n.id, n]))
  const seen = new Set<string>()
  const walk = (id: string) => {
    for (const d of nodes.get(id)?.deps ?? []) {
      if (seen.has(d.pkg) || !d.dep_kinds.some((k) => k.kind === null)) continue
      if (pkgs.get(d.pkg)?.targets.every((t) => t.kind.includes('proc-macro'))) continue
      seen.add(d.pkg)
      walk(d.pkg)
    }
  }
  walk(meta.resolve.root)
  return [...seen].flatMap((id) => {
    const p = pkgs.get(id)
    if (!p) return []
    const url = p.repository ?? p.homepage ?? undefined
    return entry(p.name, p.version, p.license ?? '不明', path.dirname(p.manifest_path), url)
  })
}

const byName = (a: Entry, b: Entry) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version)
const all = [...npm(), ...cargo()].toSorted(byName)
const self = { name: 'Patchouli', license: 'MIT', text: readText(path.join(app, '..', 'LICENSE')) }
fs.mkdirSync(path.dirname(out), { recursive: true })
fs.writeFileSync(out, JSON.stringify({ self, target, entries: all, texts }) + '\n')
console.log(`${target}: ${all.length} 件、文面 ${texts.length} 種類`)
const missing = all.filter((e) => !e.texts.length)
if (missing.length) console.warn(`文面が見つからないもの: ${missing.map((e) => `${e.name}@${e.version}`).join(', ')}`)
const unknown = all.filter((e) => e.license.split(' AND ').some((id) => weightOf(id) === UNKNOWN))
if (unknown.length) console.warn(`扱いを決めていないライセンス: ${unknown.map((e) => `${e.name} (${e.license})`).join(', ')}`)
