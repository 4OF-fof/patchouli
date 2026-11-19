---
name: patchouli
description: 素材とノートを管理するアプリ Patchouli のライブラリを CLI で検索・取り込み・編集する。ユーザーが Patchouli の素材・ノート・タグ・プロジェクトを検索・追加・編集したいときに使う。
---

# Patchouli CLI

`{{command}}` で起動中の Patchouli のライブラリを操作する。アプリが起動していない場合はタスクトレイ常駐モードで自動起動してから操作する。

- 初回接続時はアプリ画面に接続許可ダイアログが表示されるため、ユーザーが許可するまで待機する。
- 標準の出力形式は人間向けのテキスト表示。プログラムから結果を読み取る場合は `--json` を付けて JSON で取得する。
- 素材とノートは ID で指定する。ID は `list` や `show` で確認できる。
- `--body -` のようにテキストを受け取るオプションに `-` を指定すると標準入力から読み取る。長文を渡す際に使用する。
- 削除操作はごみ箱への移動であり復元可能だが、ユーザーから指示されていない削除は行わない。

## 使用例

```sh
{{command}} list 夕焼け --tag 風景 --json
{{command}} note create 打ち合わせメモ --project 案件A --body -
{{command}} import ./photos --project 案件A --tag 参考
{{command}} update <ID> --add-tag 採用 --remove-tag 候補
```

## コマンド一覧

```text
{{reference}}
```
