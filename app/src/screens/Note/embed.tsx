import { createResource } from 'solid-js'
import { render } from 'solid-js/web'
import type { Embed } from '../../components/editor/NoteEditor/NoteEditor'
import { Icon, type IconName } from '../../components/base/Icon/Icon'
import { AudioPlayer } from '../../components/media/AudioPlayer/AudioPlayer'
import { PluginView } from '../../components/media/PluginView/PluginView'
import { VideoPlayer } from '../../components/media/VideoPlayer/VideoPlayer'
import type { Item } from '../../model/library'
import type { FormatInfo, ItemView, Part, UiRef } from '../../plugins/types'
import type { UiApi, UiItem } from '../../plugins/ui'

export interface EmbedHost {
  format: (ext: string) => FormatInfo | undefined
  view?: (id: string) => Promise<ItemView | null>
  waveform?: (id: string) => Promise<Uint8Array | null>
  ui?: (item: UiItem, part: Part, plugin: string) => UiApi
  uiUrl?: (ui: UiRef) => string
}

function AudioEmbed(props: { it: Item; waveform?: (id: string) => Promise<Uint8Array | null> }) {
  const [wave] = createResource(async () => (await props.waveform?.(props.it.id).catch(() => null)) ?? null)
  return (
    <AudioPlayer
      src={props.it.src ?? ''}
      wave={wave.state === 'ready' ? wave() : null}
      name={props.it.name}
      look="row"
      local
    />
  )
}

const captionOf = (icon: IconName, name: string, label: string) => (el: HTMLElement) =>
  render(
    () => (
      <>
        <Icon name={icon} size={13} />
        <b>{name}</b> · {label}
      </>
    ),
    el,
  )

/**
 * ノートに埋め込んだときの表示。組み込み UI の embed、plugin.json の embed、詳細の表示の順に見る。
 * 詳細を組み込み UI で描く形式は、埋め込みには描かない。
 */
export async function embedOf(it: Item, host: EmbedHost): Promise<Embed> {
  const f = host.format(it.ext)
  const label = f?.label ?? it.ext.toUpperCase()
  const card: Embed = { kind: 'card', thumb: it.thumb, label }
  const ui = f?.uiEmbed
  const make = host.ui
  if (ui && make && host.uiUrl) {
    const url = host.uiUrl(ui)
    const item = { id: it.id, name: it.name, ext: it.ext, url: it.src }
    return {
      kind: 'mount',
      key: `ui:${url}:${it.id}:${it.name}:${it.src}`,
      mount: (el) => render(() => <PluginView url={url} api={make(item, 'embed', ui.plugin)} draw="embed" />, el),
    }
  }
  if (f?.embed === 'card') return card
  const v = await host.view?.(it.id).catch(() => null)
  if (v?.kind === 'ui') return { ...card, error: '埋め込みに対応していません' }
  // 読み解いた画像の URL は次に開いた素材で捨てられるので、本文ではサムネイルを使う
  const image = captionOf('image', it.name, label)
  if (v?.kind === 'image' && !v.url && it.src) return { kind: 'image', src: it.src, caption: image }
  if (v?.kind === 'image' && it.thumb) return { kind: 'image', src: it.thumb, caption: image }
  const src = it.src
  if (v?.kind === 'video' && src)
    return {
      kind: 'mount',
      key: `video:${src}:${it.thumb}`,
      mount: (el) =>
        render(
          () => <VideoPlayer src={src} poster={it.thumb} name={it.name} ratio={it.ratio} rate={false} local />,
          el,
        ),
      caption: captionOf('video', it.name, label),
    }
  if (v?.kind === 'audio' && src)
    return {
      kind: 'mount',
      // 波形はサムネイルと一緒にできるので、サムネイルが変わったら描き直す
      key: `audio:${src}:${it.thumb}`,
      mount: (el) => render(() => <AudioEmbed it={it} waveform={host.waveform} />, el),
      caption: captionOf('audio', it.name, label),
    }
  return card
}
