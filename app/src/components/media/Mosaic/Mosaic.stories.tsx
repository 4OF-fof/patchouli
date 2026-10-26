import type { Meta, StoryObj } from 'storybook-solidjs-vite'
import { Mosaic } from './Mosaic'

/** プラグインが作るサムネイルの代わり。例のテキストのプラグインと同じく、縦長の紙に頭から数行を描く。 */
function textThumb(lines: string[]) {
  const c = document.createElement('canvas')
  c.width = 410
  c.height = 512
  const g = c.getContext('2d')
  if (!g) return undefined
  g.fillStyle = '#f7f5ef'
  g.fillRect(0, 0, c.width, c.height)
  g.fillStyle = '#3a3a36'
  g.font = '22px monospace'
  lines.forEach((line, i) => g.fillText(line, 24, 48 + i * 26))
  return c.toDataURL()
}

/** 横長の画像の代わり。 */
function wideThumb(hue: number) {
  const c = document.createElement('canvas')
  c.width = 512
  c.height = 256
  const g = c.getContext('2d')
  if (!g) return undefined
  const grad = g.createLinearGradient(0, 0, c.width, 0)
  grad.addColorStop(0, `hsl(${hue} 40% 40%)`)
  grad.addColorStop(1, `hsl(${hue + 40} 40% 70%)`)
  g.fillStyle = grad
  g.fillRect(0, 0, c.width, c.height)
  return c.toDataURL()
}

const README = textThumb(['読み方のメモ', '', '1 行目', '2 行目はとても長い行で', '3 行目', '', '4 行目', '5 行目'])
const LOG = textThumb([
  '0.2.0',
  '- 詳細の表示を組み込み UI で',
  '- サムネイルを canvas で',
  '',
  '0.1.0',
  '- はじめての版',
])
const WIDE = wideThumb(196)

const meta = {
  title: '部品/media/Mosaic',
  component: Mosaic,
  args: {
    tiles: [{ hue: 205 }, { hue: 20 }, { hue: 150 }, { hue: 40 }, { hue: 260 }],
    height: 220,
  },
  decorators: [
    (Story) => (
      <div style={{ width: '320px' }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Mosaic>
export default meta
type Story = StoryObj<typeof meta>

export const Five: Story = {}
export const Three: Story = { args: { tiles: [{ hue: 205 }, { hue: 20 }, { hue: 150 }] } }
const DIARY = '午前：リファレンス整理。素材を 20 件プロジェクトに入れた。午後は配色を見直し、差し色を一点に絞った。'

/** ノートだけ。名前は切らずに折り返し、本文は枠に入るところまで出す。 */
export const Notes: Story = {
  args: {
    tiles: ['2026-10-22', '2026-10-21', '2026-10-20', '2026-10-19', '2026-10-18'].map((title) => ({
      note: true,
      title,
      excerpt: DIARY,
    })),
  },
}
/** 素材とノートが混ざったもの。素材が先に並ぶ。 */
export const Mixed: Story = {
  args: {
    tiles: [
      { hue: 205 },
      { hue: 20 },
      { hue: 150 },
      { note: true, title: '配色メモ：秋の企画', excerpt: '彩度を落としたセージと、差し色の朱。' },
      { note: true, title: '進め方', excerpt: '10 月中に配色を決め、11 月にポスターの下書きをつくる。' },
    ],
  },
}
/** プラグインが作ったサムネイル。枠に合わないものは、形式ごとの収め方（fit）で入れる。 */
export const PluginThumbnails: Story = {
  args: {
    tiles: [
      { src: README, fit: 'top' },
      { src: WIDE },
      { src: LOG, fit: 'top' },
      { src: README, fit: 'contain' },
      { src: LOG },
    ],
  },
}
