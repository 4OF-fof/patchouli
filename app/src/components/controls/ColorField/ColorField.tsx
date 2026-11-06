import { For, Show, createSignal, onMount } from 'solid-js'
import { type Oklch, formatOklch, inSrgb, parseColor, toHex } from '../../../model/color'
import { usePopover } from '../../overlay/usePopover'
import styles from './ColorField.module.css'

export interface ColorFieldProps {
  label: string
  value: Oklch
  /** `oklch(...)` か、手で入れた `#rrggbb` を渡す。 */
  onChange: (value: string) => void
  disabled?: boolean
}

/** 色見本のボタン。押すと、明るさ・鮮やかさ・色相を動かす層を出す。 */
export function ColorField(props: ColorFieldProps) {
  let button!: HTMLButtonElement
  const [open, setOpen] = createSignal(false)
  return (
    <>
      <button
        ref={button}
        type="button"
        class={styles.swatch}
        style={{ background: formatOklch(props.value) }}
        aria-label={`${props.label}の色を選択`}
        aria-expanded={open()}
        disabled={props.disabled}
        onClick={() => setOpen(!open())}
      />
      <Show when={open()}>
        <ColorPopover
          {...props}
          anchor={button}
          onClose={(focus) => {
            setOpen(false)
            if (focus) button.focus()
          }}
        />
      </Show>
    </>
  )
}

const SLIDERS = [
  { key: 'l', label: '明るさ', max: 1, step: 0.005, digits: 2 },
  { key: 'c', label: '鮮やかさ', max: 0.3, step: 0.001, digits: 3 },
  { key: 'h', label: '色相', max: 360, step: 1, digits: 0 },
] as const

const track = (o: Oklch, key: 'l' | 'c' | 'h') => {
  // 暗い色や明るい色でも、鮮やかさと色相の帯が見分けられるようにする
  const base = key === 'l' ? o : { ...o, l: Math.min(0.8, Math.max(0.55, o.l)) }
  const at = (v: number) => formatOklch({ ...base, [key]: v })
  const stops = key === 'h' ? [0, 60, 120, 180, 240, 300, 360] : key === 'l' ? [0, 0.5, 1] : [0, 0.15, 0.3]
  return `linear-gradient(to right, ${stops.map(at).join(', ')})`
}

function ColorPopover(props: ColorFieldProps & { anchor: HTMLElement; onClose: (focus: boolean) => void }) {
  let el!: HTMLDivElement
  const r = props.anchor.getBoundingClientRect()
  const up = r.bottom + 230 > window.innerHeight && r.top > window.innerHeight - r.bottom
  const left = Math.max(8, Math.min(r.left, window.innerWidth - 288))
  const [hex, setHex] = createSignal(toHex(props.value))
  const [bad, setBad] = createSignal(false)
  const [want, setWant] = createSignal(props.value.c)
  usePopover({ pop: () => el, anchor: () => props.anchor, onClose: () => props.onClose(false), move: true })
  onMount(() => el.querySelector('input')?.focus())

  const setPart = (key: 'l' | 'c' | 'h', v: number) => {
    if (key === 'c') setWant(v)
    // 色相や明るさを動かして sRGB の外に出ても、入るところへ戻れば元の鮮やかさに戻す
    const next = inSrgb({ ...props.value, c: want(), [key]: v })
    setHex(toHex(next))
    setBad(false)
    props.onChange(formatOklch(next))
  }
  const commitHex = () => {
    const t = hex().trim().toLowerCase()
    const v = parseColor(t.startsWith('#') ? t : `#${t}`)
    setBad(!v)
    if (!v) return
    setWant(v.c)
    const h = t.startsWith('#') ? t : `#${t}`
    setHex(h)
    if (h !== toHex(props.value)) props.onChange(h)
  }

  return (
    // ダイアログの中で Tab を回せるよう、Portal にせず置いた場所に描く。Esc は中の入力欄から上がってくる
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <div
      ref={el}
      class={styles.pop}
      role="dialog"
      aria-label={`${props.label}の色`}
      data-up={up}
      style={{ left: `${left}px`, top: `${up ? r.top - 6 : r.bottom + 6}px` }}
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return
        // Esc で設定のダイアログまで閉じない
        e.preventDefault()
        e.stopPropagation()
        props.onClose(true)
      }}
    >
      <div class={styles.head}>
        <span class={styles.big} style={{ background: formatOklch(props.value) }} />
        <div class={styles.what}>
          <span class={styles.name}>{props.label}</span>
          <input
            class={styles.hex}
            value={hex()}
            aria-label="カラーコード"
            aria-invalid={bad()}
            spellcheck={false}
            onInput={(e) => setHex(e.currentTarget.value)}
            onChange={commitHex}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitHex()
            }}
          />
        </div>
      </div>
      <div class={styles.sliders}>
        <For each={SLIDERS}>
          {(s) => (
            <label class={styles.slider}>
              <span>{s.label}</span>
              <input
                type="range"
                class={styles.range}
                min={0}
                max={s.max}
                step={s.step}
                value={props.value[s.key]}
                style={{ '--track': track(props.value, s.key) }}
                onInput={(e) => setPart(s.key, Number(e.currentTarget.value))}
              />
              <span class={styles.num}>{props.value[s.key].toFixed(s.digits)}</span>
            </label>
          )}
        </For>
      </div>
    </div>
  )
}
