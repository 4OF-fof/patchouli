import {
  ArrowDown,
  ArrowLeftRight,
  ArrowUp,
  Check,
  ChevronLeft,
  ChevronRight,
  Copyright,
  Ellipsis,
  ExternalLink,
  FileText,
  Folder,
  Hash,
  House,
  Info,
  Keyboard,
  Library,
  List,
  Maximize,
  Minus,
  Minimize,
  Package,
  Pause,
  Pin,
  Play,
  Plus,
  Puzzle,
  Search,
  Settings,
  SunMoon,
  Volume2,
  VolumeX,
  X,
} from 'lucide-solid'
import { Dynamic } from 'solid-js/web'

const ICONS = {
  box: Package,
  chevron: ChevronRight,
  back: ChevronLeft,
  pin: Pin,
  play: Play,
  pause: Pause,
  volume: Volume2,
  muted: VolumeX,
  fullscreen: Maximize,
  unfullscreen: Minimize,
  search: Search,
  home: House,
  folder: Folder,
  hash: Hash,
  settings: Settings,
  info: Info,
  close: X,
  plus: Plus,
  minus: Minus,
  more: Ellipsis,
  external: ExternalLink,
  list: List,
  links: ArrowLeftRight,
  theme: SunMoon,
  keyboard: Keyboard,
  plugin: Puzzle,
  notices: Copyright,
  library: Library,
  note: FileText,
  check: Check,
  up: ArrowUp,
  down: ArrowDown,
}

export type IconName = keyof typeof ICONS
export const ICON_NAMES = Object.keys(ICONS).filter((n): n is IconName => n in ICONS)

export interface IconProps {
  name: IconName
  /** 一辺の大きさ。既定は 16。 */
  size?: number
  /** 置き場所の側で大きさや向きを決めるとき。 */
  class?: string
}

/** Lucide の線のアイコン。色は文字色に合わせる。小さいほど線を太くして、見た目の濃さをそろえる。 */
export function Icon(props: IconProps) {
  const size = () => props.size ?? 16
  return (
    <Dynamic
      component={ICONS[props.name]}
      size={size()}
      strokeWidth={size() <= 14 ? 2 : size() >= 20 ? 1.5 : 1.75}
      class={props.class}
      aria-hidden="true"
    />
  )
}
