/* @refresh reload */
import { render } from 'solid-js/web'
import { App } from './App'
import { sampleLibrary } from './samples/library'
import './index.css'

// 保存先を読む処理はまだないので、見本のライブラリで画面を出す
render(() => <App lib={sampleLibrary()} />, document.getElementById('root')!)
