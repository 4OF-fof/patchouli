import {
  ArrowDown,
  ArrowLeftRight,
  ArrowUp,
  AudioWaveform,
  Bold,
  Check,
  CircleStop,
  ChevronLeft,
  ChevronRight,
  Code,
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
  Heading1,
  Heading2,
  Heading3,
  House,
  Image,
  Import,
  Info,
  Italic,
  Keyboard,
  LayoutGrid,
  Library,
  Link,
  List,
  ListOrdered,
  ListTodo,
  Maximize,
  Minus,
  Minimize,
  Package,
  Pause,
  Pin,
  Play,
  Plus,
  Puzzle,
  Quote,
  Search,
  SeparatorHorizontal,
  Settings,
  SquareCode,
  Strikethrough,
  SunMoon,
  Table,
  Volume2,
  VolumeX,
  Workflow,
  X,
} from 'lucide-solid'
import { Dynamic } from 'solid-js/web'
import styles from './Icon.module.css'

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
  bold: Bold,
  italic: Italic,
  strike: Strikethrough,
  code: Code,
  link: Link,
  h1: Heading1,
  h2: Heading2,
  h3: Heading3,
  bullets: List,
  numbers: ListOrdered,
  tasks: ListTodo,
  quote: Quote,
  codeBlock: SquareCode,
  table: Table,
  rule: SeparatorHorizontal,
  diagram: Workflow,
}

export type IconName = keyof typeof ICONS
export const ICON_NAMES = Object.keys(ICONS).filter((n): n is IconName => n in ICONS)

export interface IconProps {
  name: IconName
  size?: number
  class?: string
  /** 文字と横に並べる。字面の高さに合わせて少し下げる */
  withText?: boolean
}

export function Icon(props: IconProps) {
  const size = () => props.size ?? 16
  return (
    <Dynamic
      component={ICONS[props.name]}
      size={size()}
      strokeWidth={size() <= 14 ? 2 : size() >= 20 ? 1.5 : 1.75}
      class={[props.withText && styles.withText, props.class].filter(Boolean).join(' ') || undefined}
      aria-hidden="true"
    />
  )
}
