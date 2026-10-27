// プラグインのテンプレート（plugin-template/）に、SDK（app/plugins/sdk/）を写して plugin-template/patchouli/ にする。
// SDK を直したら動かす。plugin-template/patchouli/ は作り直すたびに消えるので、手で直さない。
// 使い方: node scripts/plugin-template.ts
import fs from 'node:fs'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const sdk = path.join(root, 'app', 'plugins', 'sdk')
const dest = path.join(root, 'plugin-template', 'patchouli')

fs.rmSync(dest, { recursive: true, force: true })
fs.cpSync(sdk, dest, { recursive: true })
console.log(`${path.relative(process.cwd(), sdk)} を ${path.relative(process.cwd(), dest)} に写した`)
