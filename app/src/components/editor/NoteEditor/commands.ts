import type { IconName } from '../../base/Icon/Icon'

export type SlashAction =
  | { type: 'heading'; level: number }
  | {
      type:
        | 'bullets'
        | 'numbers'
        | 'tasks'
        | 'quote'
        | 'code'
        | 'table'
        | 'rule'
        | 'diagram'
        | 'math'
        | 'link'
        | 'embed'
    }

export interface SlashItem {
  label: string
  icon: IconName
  keys: string
  action: SlashAction
}

export const SLASH_ITEMS: SlashItem[] = [
  { label: '見出し 1', icon: 'h1', keys: 'h1 heading midashi', action: { type: 'heading', level: 1 } },
  { label: '見出し 2', icon: 'h2', keys: 'h2 heading midashi', action: { type: 'heading', level: 2 } },
  { label: '見出し 3', icon: 'h3', keys: 'h3 heading midashi', action: { type: 'heading', level: 3 } },
  { label: '箇条書き', icon: 'bullets', keys: 'list bullet ul kajou', action: { type: 'bullets' } },
  { label: '番号付きリスト', icon: 'numbers', keys: 'list number ol bangou', action: { type: 'numbers' } },
  { label: 'チェックリスト', icon: 'tasks', keys: 'todo task check', action: { type: 'tasks' } },
  { label: '引用', icon: 'quote', keys: 'quote blockquote inyou', action: { type: 'quote' } },
  { label: 'コード', icon: 'codeBlock', keys: 'code block ko-do', action: { type: 'code' } },
  { label: '表', icon: 'table', keys: 'table hyou', action: { type: 'table' } },
  { label: '区切り線', icon: 'rule', keys: 'hr rule divider line', action: { type: 'rule' } },
  { label: '図（Mermaid）', icon: 'diagram', keys: 'mermaid diagram zu', action: { type: 'diagram' } },
  { label: '数式', icon: 'math', keys: 'math tex katex suushiki', action: { type: 'math' } },
  { label: 'リンク', icon: 'link', keys: 'link rinku', action: { type: 'link' } },
  { label: '素材を埋め込む', icon: 'image', keys: 'embed image video audio umekomi', action: { type: 'embed' } },
]

export const slashMatches = (q: string) => {
  const t = q.trim().toLowerCase()
  return t ? SLASH_ITEMS.filter((i) => i.label.toLowerCase().includes(t) || i.keys.includes(t)) : SLASH_ITEMS
}
