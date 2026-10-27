import {
  ArrowDown,
  ArrowLeftRight,
  ArrowUp,
  AudioWaveform,
  Check,
  CircleStop,
  ChevronLeft,
  ChevronRight,
  Copyright,
  Ellipsis,
  ExternalLink,
  File,
  FilePlus,
  FileQuestionMark,
  FileText,
  Folder,
  FolderSync,
  Hash,
  House,
  Image,
  Import,
  Info,
  Keyboard,
  LayoutGrid,
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
  newNote: FilePlus,
  unknownFile: FileQuestionMark,
  image: Image,
  import: Import,
  grid: LayoutGrid,
  sync: FolderSync,
  stop: CircleStop,
  audio: AudioWaveform,
  file: File,
  check: Check,
  up: ArrowUp,
  down: ArrowDown,
}

export type IconName = keyof typeof ICONS
export const ICON_NAMES = Object.keys(ICONS).filter((n): n is IconName => n in ICONS)

export interface IconProps {
  name: IconName
  size?: number
  class?: string
}

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
