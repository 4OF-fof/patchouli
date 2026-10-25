// アプリと、アプリに同梱するもののうち権利表示が要るものの一覧（app/src/notices/third-party.json）を作り直す。
// 設定の「権利表示」で出す。
// 対象は、フロントの dependencies のうち JS を持つものと、Rust のふつうの依存のうちビルド先に入るもの（ビルドだけに使うものと proc-macro は除く）。
// Rust は、アプリと、組み込みのプラグインの処理部分（app/plugins、WASM）の両方。
// 複数のライセンスから選べるものは、義務のいちばん軽いものを選ぶ。選んだライセンスで権利表示が要らないものは載せない。
// 選んだライセンスごとにまとめる。文面はライセンスごとの標準のものを 1 つだけ持ち、パッケージごとには著作権の行だけを持つ。
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

/** 同梱している文面の 1 つ。 */
interface Notice {
  /** どのライセンスの文面か。NOTICE など、決められないものはない。 */
  kind?: string
  copyright: string[]
  /** 著作権の行と題の行を除いた残り。 */
  body: string
}

interface Entry {
  name: string
  version: string
  /** 選んだライセンス。 */
  license: string
  /** 標準の文面で済ませられないときに見に行く先。 */
  url?: string
  notices: Notice[]
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

const NOTICE_FILE = /^(licen[cs]e|copying|notice)/i
/** 頭のほうの著作権の行。 */
const COPYRIGHT = /^(copyright\b|\(c\)|©|all rights reserved)/i
/** 文面の途中の著作権の行。「Copyright [yyyy] [name of copyright owner]」のような雛形の行は除く。 */
const COPYRIGHT_IN_BODY = /^(copyright\s*(\(c\)|©|\d)|\(c\)\s*\d|©\s*\d)/i
const RESERVED = /^all rights reserved\.?$/i
const TITLE = /^(the )?mit license( \(mit\))?\s*/i

const readText = (file: string) => fs.readFileSync(file, 'utf8').replaceAll('\r\n', '\n').trim()

/** 著作権の行を分ける。題の行は、グループの名前で足りるので落とす。 */
function split(raw: string, kind?: string): Notice {
  const lines = raw.split('\n')
  const copyright: string[] = []
  let i = 0
  for (; i < lines.length; i++) {
    const l = lines[i].trim().replace(TITLE, '')
    if (COPYRIGHT.test(l)) copyright.push(l)
    else if (l) break
  }
  const body: string[] = []
  let after = false
  for (const line of lines.slice(i)) {
    const l = line.trim()
    after = COPYRIGHT_IN_BODY.test(l) || (after && RESERVED.test(l))
    if (after) copyright.push(l)
    else body.push(line)
  }
  return { kind, copyright, body: body.join('\n').trim() }
}

/** 文面を比べるときの形。空白や記号、大文字小文字の違いは見ない。 */
const shape = (body: string) => body.toLowerCase().replaceAll(/[^a-z0-9]/g, '')

/** パッケージのフォルダにある文面のうち、選んだライセンスのものと NOTICE。どれとも決められなければ全部。 */
function noticesIn(dir: string, chosen: string[]): Notice[] {
  if (!fs.existsSync(dir)) return []
  const files = fs
    .readdirSync(dir)
    .filter((f) => NOTICE_FILE.test(f) && fs.statSync(path.join(dir, f)).isFile())
    .toSorted()
    .map((f) => ({ f, t: readText(path.join(dir, f)) }))
  const kindOf = (t: string) => KIND_OF_TEXT.find(([id, re]) => chosen.includes(id) && re.test(t))?.[0]
  const wanted = files.filter(({ f, t }) => (/^notice/i.test(f) && chosen.includes('Apache-2.0')) || kindOf(t))
  return (wanted.length ? wanted : files).map(({ f, t }) => split(t, /^notice/i.test(f) ? undefined : kindOf(t)))
}

/** 権利表示が要るなら、載せる形にする。 */
function entry(name: string, version: string, license: string, dir: string, url?: string): Entry[] {
  const chosen = choose(license)
  if (chosen.every((id) => weightOf(id) === 0)) return []
  return [{ name, version, license: chosen.toSorted().join(' AND '), url, notices: noticesIn(dir, chosen) }]
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

function cargo(manifest: string, platform: string): Entry[] {
  const meta: {
    packages: CargoPackage[]
    workspace_members: string[]
    resolve: { root: string | null; nodes: CargoNode[] }
  } = JSON.parse(run(`cargo metadata --format-version 1 --filter-platform ${platform} --manifest-path ${manifest}`))
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
  for (const root of meta.resolve.root ? [meta.resolve.root] : meta.workspace_members) walk(root)
  return [...seen].flatMap((id) => {
    const p = pkgs.get(id)
    if (!p) return []
    const url = p.repository ?? p.homepage ?? undefined
    return entry(p.name, p.version, p.license ?? '不明', path.dirname(p.manifest_path), url)
  })
}

const byName = (a: Entry, b: Entry) => a.name.localeCompare(b.name) || a.version.localeCompare(b.version)
const own = new Set(['patchouli', 'patchouli-plugin-image', 'patchouli-plugin-video', 'patchouli-plugin-audio'])
const unique = (es: Entry[]) => [...new Map(es.map((e) => [`${e.name}@${e.version}`, e])).values()]
const all = unique([
  ...npm(),
  ...cargo('src-tauri/Cargo.toml', target),
  ...cargo('plugins/Cargo.toml', 'wasm32-wasip2'),
])
  .filter((e) => !own.has(e.name))
  .toSorted(byName)

/**
 * ライセンスごとの標準の文面。そのライセンスの文面のうち、いちばん多い形のもの。
 * 同じ形の文面を持つものは著作権の行だけを、違う形のもの（ほかの表記を足してあるものなど）と見つからないものは見に行く先を載せる。
 */
function standards(es: Entry[]) {
  const forms = new Map<string, Map<string, { body: string; n: number }>>()
  for (const { kind, body } of es.flatMap((e) => e.notices)) {
    if (!kind) continue
    const of = forms.get(kind) ?? new Map<string, { body: string; n: number }>()
    forms.set(kind, of)
    const f = of.get(shape(body)) ?? { body, n: 0 }
    of.set(shape(body), { ...f, n: f.n + 1 })
  }
  return new Map([...forms].map(([kind, of]) => [kind, [...of.values()].reduce((a, b) => (b.n > a.n ? b : a)).body]))
}

const texts = standards(all)
const isStandard = (n: Notice) => !!n.kind && shape(n.body) === shape(texts.get(n.kind) ?? '')

/** リポジトリの根元。中のファイルやフォルダを指す部分と、.git・#readme などは落とす。 */
const repoUrl = (url: string) =>
  /^(?:git\+)?(https?:\/\/[^/]+\/[^/?#]+\/[^/?#]+?)(?:\.git)?(?:[/?#].*)?$/.exec(url)?.[1] ?? url

/** ライセンスごとにまとめる。件数の多い順。 */
function group(es: Entry[]) {
  const groups = new Map<string, object[]>()
  for (const { license, notices, url, ...e } of es) {
    const entries = groups.get(license) ?? []
    groups.set(license, entries)
    // 標準と違う文面の著作権の行は、先で文面と一緒に読めるので抜き出さない
    const linked = !notices.length || !notices.every(isStandard)
    entries.push({
      ...e,
      copyright: [...new Set(notices.filter(isStandard).flatMap((n) => n.copyright))],
      ...(linked && url ? { url: repoUrl(url) } : {}),
    })
  }
  return [...groups]
    .map(([license, entries]) => ({ license, entries }))
    .toSorted((a, b) => b.entries.length - a.entries.length || a.license.localeCompare(b.license))
}

const self = { name: 'Patchouli', license: 'MIT', text: readText(path.join(app, '..', 'LICENSE')) }
const groups = group(all)
fs.mkdirSync(path.dirname(out), { recursive: true })
fs.writeFileSync(out, JSON.stringify({ self, target, texts: Object.fromEntries(texts), groups }) + '\n')
const raw = all.filter((e) => e.notices.some((n) => !isStandard(n)))
console.log(`${target}: ${all.length} 件、${groups.length} グループ、標準の文面 ${texts.size} 種類`)
if (raw.length) console.log(`標準と違う文面なので、先を出すもの: ${raw.map((e) => `${e.name}@${e.version}`).join(', ')}`)
const missing = all.filter((e) => !e.notices.length)
if (missing.length) console.warn(`文面が見つからないもの: ${missing.map((e) => `${e.name}@${e.version}`).join(', ')}`)
const unknown = all.filter((e) => e.license.split(' AND ').some((id) => weightOf(id) === UNKNOWN))
if (unknown.length) console.warn(`扱いを決めていないライセンス: ${unknown.map((e) => `${e.name} (${e.license})`).join(', ')}`)
