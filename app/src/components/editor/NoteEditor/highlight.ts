import { syntaxHighlighting } from '@codemirror/language'
import { type Tag, tagHighlighter, tags as t } from '@lezer/highlight'

/** Base16 の役割ごとの、コードの字句。色は tokens.css の --base03〜--base0f。 */
const SLOTS: Record<string, Tag[]> = {
  base03: [t.comment, t.lineComment, t.blockComment, t.docComment],
  base04: [t.punctuation, t.separator, t.bracket],
  base08: [t.tagName, t.self, t.deleted, t.invalid, t.special(t.variableName)],
  base09: [t.number, t.integer, t.float, t.bool, t.null, t.atom, t.unit, t.constant(t.variableName)],
  base0a: [t.typeName, t.className, t.namespace, t.attributeName, t.standard(t.typeName)],
  base0b: [t.string, t.docString, t.character, t.attributeValue, t.inserted, t.special(t.string)],
  base0c: [t.regexp, t.escape, t.color, t.url],
  base0d: [t.function(t.variableName), t.function(t.propertyName), t.macroName, t.labelName],
  base0e: [t.keyword, t.controlKeyword, t.definitionKeyword, t.moduleKeyword, t.operatorKeyword, t.modifier, t.changed],
  base0f: [t.meta, t.annotation, t.processingInstruction, t.documentMeta],
}

/** コードブロックの中に色を付ける。クラスはどこにでも付くが、色が付くのはコードの行の中だけ。 */
export const codeHighlight = (classes: Record<string, string | undefined>) =>
  syntaxHighlighting(tagHighlighter(Object.entries(SLOTS).map(([slot, tag]) => ({ tag, class: classes[slot] ?? '' }))))
