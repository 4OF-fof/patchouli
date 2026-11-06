# example_zip

拡張子のプラグインの例です。zip のサムネイルにアイコンを描き、詳細では中身をフォルダの木で見せます。

- サムネイルは WASM が描いたアイコンの PNG です。どの zip も同じ絵になります。
- 中身の一覧は WASM が zip の目次（中央ディレクトリ）だけを読んで作ります。ZIP64 も読めます。
- 詳細の表示はスクリプトが描きます。フォルダには中のファイル数と大きさの合計を添え、開いたときに中を描きます。

## 作り

| ファイル        | 中身                                                                                               |
| --------------- | -------------------------------------------------------------------------------------------------- |
| `plugin.json`   | `formats` の `zip` の `parts` に `thumbnail`・`view` を書き、`script` に `view` を書く             |
| `src/lib.rs`    | `thumbnail-role` と `call-role` を export し、`call` の `entries` で目次を JSON にして返す          |
| `src/icon.rs`   | tiny-skia でアイコンを描き、PNG にする                                                             |
| `ui.ts`         | `mount` で `api.call('entries')` を呼び、フォルダの木を描く                                        |

`node scripts/dev-library.ts` が SDK の CLI でビルドし、開発中のアプリに入れます。確認用のライブラリには見本の zip が入ります。
