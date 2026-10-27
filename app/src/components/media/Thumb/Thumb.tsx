import { createContext, useContext } from 'solid-js'
import type { Fit } from '../../../plugins/types'
import { Spinner } from '../../base/Spinner/Spinner'
import styles from './Thumb.module.css'

const Making = createContext<(id: string) => boolean>(() => false)

export const ThumbMakingProvider = Making.Provider

export interface ThumbProps {
  note?: boolean
  hue?: number
  sat?: number
  src?: string
  id?: string
  fit?: Fit
  title?: string
  excerpt?: string
  height?: number
  selected?: boolean
  dirty?: boolean
  class?: string
}

export function Thumb(props: ThumbProps) {
  const making = useContext(Making)
  const waiting = () => !props.src && !props.note && !!props.id && making(props.id)
  return (
    <span
      class={`${styles.root} ${props.class ?? ''}`}
      data-note={!!props.note}
      data-fit={props.src ? (props.fit ?? 'center') : undefined}
      data-selected={props.selected}
      style={{
        '--h': props.hue ?? 210,
        '--s': props.sat != null ? `${props.sat}%` : undefined,
        height: props.height ? `${props.height}px` : undefined,
        'background-image': props.src ? `url(${props.src})` : undefined,
      }}
    >
      {props.note && (
        <>
          {props.title && <b>{props.title}</b>}
          {props.excerpt}
        </>
      )}
      {waiting() && <Spinner class={styles.making} />}
      {props.dirty && <span class={styles.dirty} title="未保存" />}
    </span>
  )
}
