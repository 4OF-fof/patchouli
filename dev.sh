#!/bin/sh
# 一時ディレクトリは常に /tmp を使用

# mcpのビルド（完了まで待機）
cd mcp && pnpm build && cd ..

# frontendの開発サーバーを起動（バックグラウンド）
(cd frontend && nohup pnpm dev > "/tmp/frontend.log" 2> "/tmp/frontend.err" &)

# backend (Rust) を起動（バックグラウンド）
(cd core && nohup cargo run > "/tmp/core.log" 2> "/tmp/core.err" &)

# discord (Node.js) を起動（バックグラウンド）
(cd discord && nohup pnpm dev > "/tmp/discord.log" 2> "/tmp/discord.err" &)

printf '\033[0;32mFrontend, Backend, Discordを並列で起動しました。\033[0m\n'

# ユーザー入力待機ループ
while true; do
    read -p "終了するには 'q' または 'exit' を入力してください: " input
    if [ "$input" = "q" ] || [ "$input" = "exit" ]; then
        printf '\033[0;33mプロセスを終了します...\033[0m\n'
        pkill -f "pnpm dev"
        pkill -f "cargo run"
        pkill -f "patchouli"
        pkill -f "node"
        printf 'Frontend, Backend, Discordのプロセスを終了しました。\n'
        break
    fi
done
