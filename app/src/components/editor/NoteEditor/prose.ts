import { codeBlockSchema, imageSchema, linkSchema } from '@milkdown/kit/preset/commonmark'
import type { Mounted } from 'pele/lazy'
import type { Node } from '@milkdown/kit/prose/model'
import { type EditorState, Plugin, PluginKey, TextSelection } from '@milkdown/kit/prose/state'
import { Decoration, DecorationSet, type EditorView, type NodeView } from '@milkdown/kit/prose/view'
import { $prose, $view } from '@milkdown/kit/utils'
import { LINK_SCHEME } from '../../../model/library'

export const idOfHref = (href: unknown) =>
  typeof href === 'string' && href.startsWith(LINK_SCHEME) ? href.slice(LINK_SCHEME.length) : undefined

export interface At {
  left: number
  top: number
  bottom: number
}

export interface Slash extends At {
  query: string
  from: number
  to: number
}

export interface Selected extends At {
  marks: string[]
}

export type Embed = { kind: 'image' | 'video' | 'audio'; src: string } | { kind: 'card'; thumb?: string }

export interface Hooks {
  onLinkTrigger: (from: number, to: number) => void
  onSlash: (s: Slash | undefined) => void
  onSelect: (s: Selected | undefined) => void
  /** `/` の一覧が開いているときのキー。受け持ったら true。 */
  onMenuKey: (e: KeyboardEvent) => boolean
  onOpenRef: (id: string) => void
  nameOf: (id: string) => string | undefined
  embedOf: (id: string) => Promise<Embed | undefined>
  classes: { link: string; missing: string; embed: string; card: string; diagram: string; editing: string }
}

const at = (view: EditorView, pos: number): At => {
  const c = view.coordsAtPos(pos)
  return { left: c.left, top: c.top, bottom: c.bottom }
}

function marksIn(state: EditorState) {
  const { from, to } = state.selection
  const out = new Set<string>()
  state.doc.nodesBetween(from, to, (n) => {
    for (const m of n.marks) out.add(m.type.name)
  })
  return [...out]
}

export const triggers = (hooks: () => Hooks) =>
  $prose(
    () =>
      new Plugin({
        key: new PluginKey('patchouli-triggers'),
        view: () => {
          let slashFrom: number | undefined
          return {
            update(view, prev) {
              const h = hooks()
              const { state } = view
              const sel = state.selection
              h.onSelect(
                !sel.empty && sel instanceof TextSelection && view.hasFocus()
                  ? { ...at(view, sel.from), marks: marksIn(state) }
                  : undefined,
              )
              if (view.composing) return
              const close = () => {
                slashFrom = undefined
                h.onSlash(undefined)
              }
              const { $from } = sel
              if (!sel.empty || !$from.parent.isTextblock || $from.parent.type.spec.code) return close()
              const typed = !prev.doc.eq(state.doc)
              const before = $from.parent.textBetween(0, $from.parentOffset, undefined, '￼')
              if (typed && before.endsWith('[[')) {
                close()
                h.onLinkTrigger(sel.from - 2, sel.from)
                return
              }
              const m = /(?:^|\s)\/([^\s/]*)$/.exec(before)
              const from = m ? sel.from - (m[1]?.length ?? 0) - 1 : undefined
              if (from === undefined || (slashFrom !== from && !(typed && m?.[1] === ''))) return close()
              slashFrom = from
              h.onSlash({ ...at(view, from), query: m?.[1] ?? '', from, to: sel.from })
            },
          }
        },
        props: {
          handleKeyDown: (view, e) => !view.composing && !e.isComposing && hooks().onMenuKey(e),
          handleDOMEvents: {
            blur: () => {
              hooks().onSelect(undefined)
              return false
            },
          },
        },
      }),
  )

/** Milkdown は知らないスキームの href を描くときに消すので、patchouli: のリンクだけはそのまま残す。 */
export const patchouliLink = linkSchema.extendSchema((prev) => (ctx) => {
  const s = prev(ctx)
  return {
    ...s,
    toDOM: (mark, inline) =>
      idOfHref(mark.attrs.href) ? ['a', { ...mark.attrs }] : (s.toDOM?.(mark, inline) ?? ['a']),
  }
})

/** 題のない画像は title が null で届き、属性の検査に通らず消えるので、空の文字にする。 */
export const patchouliImage = imageSchema.extendSchema((prev) => (ctx) => {
  const s = prev(ctx)
  return {
    ...s,
    parseMarkdown: {
      ...s.parseMarkdown,
      runner: (state, node, type) =>
        state.addNode(type, {
          src: node.url ?? '',
          alt: node.alt ?? '',
          title: node.title ?? '',
        }),
    },
  }
})

const linkKey = new PluginKey<DecorationSet>('patchouli-links')

/** 名前や素材が変わったときに、リンクの見た目を作り直す。 */
export const refreshLinks = (view: EditorView) => view.dispatch(view.state.tr.setMeta(linkKey, true))

function linkMarks(doc: Node, { classes, nameOf }: Hooks) {
  const out: Decoration[] = []
  doc.descendants((node, pos) => {
    if (!node.isText) return
    for (const m of node.marks) {
      const id = m.type.name === 'link' ? idOfHref(m.attrs.href) : undefined
      if (!id) continue
      out.push(
        Decoration.inline(
          pos,
          pos + node.nodeSize,
          nameOf(id) === undefined
            ? { class: classes.missing, 'data-id': id, title: 'リンク先が見つかりません' }
            : { class: classes.link },
        ),
      )
    }
  })
  return DecorationSet.create(doc, out)
}

export const links = (hooks: () => Hooks) =>
  $prose(
    () =>
      new Plugin({
        key: linkKey,
        state: {
          init: (_, s) => linkMarks(s.doc, hooks()),
          apply: (tr, old) => (tr.docChanged || tr.getMeta(linkKey) ? linkMarks(tr.doc, hooks()) : old),
        },
        props: {
          decorations: (s) => linkKey.getState(s),
          handleDOMEvents: {
            click: (view, e) => {
              const t = e.target instanceof Element ? e.target : null
              const task = t?.closest<HTMLElement>('li[data-item-type="task"]')
              if (task && t === task && e.clientX < task.getBoundingClientRect().left) {
                const pos = view.posAtDOM(task, 0) - 1
                const n = view.state.doc.nodeAt(pos)
                if (n)
                  view.dispatch(view.state.tr.setNodeMarkup(pos, undefined, { ...n.attrs, checked: !n.attrs.checked }))
                return true
              }
              const a = t?.closest('a')
              if (!a) return false
              e.preventDefault()
              const id = idOfHref(a.getAttribute('href'))
              if (id) hooks().onOpenRef(id)
              return true
            },
          },
        },
      }),
  )

const isDiagram = (n: Node) => n.type.name === 'code_block' && n.attrs.language === 'mermaid'

/** カーソルのある図のブロックにだけ、元の文を見せる印を付ける。 */
export const diagramEditing = (hooks: () => Hooks) =>
  $prose(
    () =>
      new Plugin({
        props: {
          decorations: (s) => {
            const { $head } = s.selection
            const n = $head.parent
            if (!isDiagram(n) || $head.depth === 0) return null
            const from = $head.before()
            return DecorationSet.create(s.doc, [
              Decoration.node(from, from + n.nodeSize, { class: hooks().classes.editing }),
            ])
          },
        },
      }),
  )

let pele: Promise<typeof import('pele/lazy')> | undefined

export const codeBlocks = (hooks: () => Hooks) =>
  $view(codeBlockSchema.node, () => (initial, view, getPos): NodeView => {
    let node = initial
    const pre = document.createElement('pre')
    const code = document.createElement('code')
    pre.append(code)
    const setLanguage = (l: unknown) => {
      if (typeof l === 'string' && l) pre.dataset.language = l
      else delete pre.dataset.language
    }
    setLanguage(node.attrs.language)
    if (!isDiagram(node))
      return {
        dom: pre,
        contentDOM: code,
        update: (n) => {
          if (n.type !== node.type || isDiagram(n)) return false
          node = n
          setLanguage(n.attrs.language)
          return true
        },
      }

    const dom = document.createElement('div')
    dom.className = hooks().classes.diagram
    const shown = document.createElement('div')
    shown.contentEditable = 'false'
    dom.append(pre, shown)
    let mounted: Mounted | undefined
    let gone = false
    let loading = false
    const draw = () => {
      const src = node.textContent
      if (!src.trim()) {
        mounted?.destroy()
        mounted = undefined
        shown.replaceChildren()
        return
      }
      if (mounted) {
        if (mounted.source !== src) mounted.update(src)
        return
      }
      if (loading) return
      loading = true
      void (pele ??= import('pele/lazy'))
        .then((p) => p.mountAsync(shown, src))
        .then((m) => {
          loading = false
          if (gone) return m.destroy()
          mounted = m
          if (m.source !== node.textContent) draw()
        })
    }
    draw()
    // 図を押したら、元の文の終わりにカーソルを置く
    shown.addEventListener('mousedown', (e) => {
      const pos = getPos()
      if (pos === undefined) return
      e.preventDefault()
      const end = pos + 1 + node.content.size
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, end)))
      view.focus()
    })
    return {
      dom,
      contentDOM: code,
      update: (n) => {
        if (n.type !== node.type || !isDiagram(n)) return false
        node = n
        draw()
        return true
      },
      stopEvent: (e) => e.target instanceof globalThis.Node && shown.contains(e.target),
      ignoreMutation: (m) => m.type !== 'selection' && shown.contains(m.target),
      destroy: () => {
        gone = true
        mounted?.destroy()
      },
    }
  })

const text = (cls: string, s: string) => {
  const el = document.createElement('span')
  el.className = cls
  el.textContent = s
  return el
}

export const embeds = (hooks: () => Hooks) =>
  $view(imageSchema.node, () => (node): NodeView => {
    const { classes, nameOf, embedOf } = hooks()
    const dom = document.createElement('span')
    dom.className = classes.embed
    const id = idOfHref(node.attrs.src)
    const label = String(node.attrs.alt || '')
    const put = (el: HTMLElement) => dom.replaceChildren(el)
    if (!id) {
      const img = document.createElement('img')
      img.src = String(node.attrs.src)
      img.alt = label
      put(img)
    } else if (nameOf(id) === undefined) {
      const el = text(classes.missing, label || id)
      el.dataset.id = id
      el.title = '埋め込む素材が見つかりません'
      put(el)
    } else {
      put(text(classes.card, nameOf(id) ?? label))
      void embedOf(id).then((e) => {
        if (!e) return
        if (e.kind === 'card') {
          const card = text(classes.card, nameOf(id) ?? label)
          if (e.thumb) {
            const img = document.createElement('img')
            img.src = e.thumb
            img.alt = ''
            card.prepend(img)
          }
          put(card)
          return
        }
        const el = document.createElement(e.kind === 'image' ? 'img' : e.kind)
        el.setAttribute('src', e.src)
        if (el instanceof HTMLImageElement) el.alt = nameOf(id) ?? label
        else if (el instanceof HTMLMediaElement) {
          el.controls = true
          el.preload = 'metadata'
        }
        put(el)
      })
    }
    return {
      dom,
      ignoreMutation: () => true,
      stopEvent: (e) => e.target instanceof HTMLMediaElement,
    }
  })
