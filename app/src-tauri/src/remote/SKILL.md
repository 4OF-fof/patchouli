---
name: patchouli
description: 素材とノートを管理するアプリ Patchouli のライブラリを、CLI で検索・取り込み・編集する。ユーザーが Patchouli の素材・ノート・タグ・プロジェクトを探したい、追加したい、書き換えたいときに使う。
---

# Patchouli の CLI

`{{command}}` で、動いている Patchouli のライブラリを操作する。アプリが動いていなければ、トレイに常駐する形で起動してから操作する。

- 初めて使うときは、アプリの画面に接続の許可を求めるダイアログが出る。ユーザーが許可するまで待つ。
- 出力は既定で人が読む形。結果を読み取るときは `--json` を付けて JSON で受け取る。
- 素材とノートは ID で指定する。ID は `list` や `show` で調べる。
- `--body -` のように文を受け取るオプションに `-` を渡すと、標準入力から読む。長い本文はこれで渡す。
- 削除はごみ箱への移動で、ユーザーが元に戻せる。それでも、頼まれていない削除はしない。

## 例

```sh
{{command}} list 夕焼け --tag 風景 --json
{{command}} note create 打ち合わせメモ --project 案件A --body -
{{command}} import ./photos --project 案件A --tag 参考
{{command}} update <ID> --add-tag 採用 --remove-tag 候補
```

## コマンド

```text
{{reference}}
```
