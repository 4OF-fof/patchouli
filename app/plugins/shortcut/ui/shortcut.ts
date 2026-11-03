/*
 * インターネットショートカット（.url）が指す URL。INI の [InternetShortcut] の URL= を読む。
 * Windows が書くものは、UTF-8 のほか、UTF-16 や、その端末の文字コード（日本語なら Shift_JIS）のこともある。
 */

import { definePlugin } from '@patchouli/plugin'

/** URL を書く行は頭のほうにあるので、それより後ろは読まない。 */
const HEAD = 64 << 10

function decode(b: Uint8Array) {
  if (b[0] === 0xff && b[1] === 0xfe) return new TextDecoder('utf-16le').decode(b)
  if (b[0] === 0xfe && b[1] === 0xff) return new TextDecoder('utf-16be').decode(b)
  const utf8 = new TextDecoder().decode(b)
  return utf8.includes('�') ? new TextDecoder('shift_jis').decode(b) : utf8
}

function urlOf(text: string) {
  let inside = false
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (line.startsWith('[')) inside = line.toLowerCase() === '[internetshortcut]'
    else if (inside && /^url\s*=/i.test(line)) return line.slice(line.indexOf('=') + 1).trim()
  }
  return undefined
}

export default definePlugin({
  async link(api) {
    return urlOf(decode(await api.read(0, HEAD))) || undefined
  },
})
