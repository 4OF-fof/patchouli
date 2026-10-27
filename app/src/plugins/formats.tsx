/* 開いているライブラリで扱える形式を、画面の部品に渡す。 */
import { createContext, useContext } from 'solid-js'
import { BUILTIN_FORMATS } from './builtin'
import type { FormatInfo } from './types'

const Formats = createContext<() => ReadonlyMap<string, FormatInfo>>(() => BUILTIN_FORMATS)

/** 渡さなければ組み込みのものだけ。プラグインを読み直すと変わるので、関数で渡す。 */
export const FormatsProvider = Formats.Provider

export const useFormats = () => useContext(Formats)
