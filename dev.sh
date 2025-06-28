#!/bin/sh
# 一時ディレクトリは常に /tmp を使用

if [ "$1" = "install" ]; then
  echo '依存関係を一括インストールします...'
  for dir in frontend mcp discord; do
    echo "> $dir で pnpm i 実行中..."
    (cd "$dir" && pnpm install)
  done
  echo '全ての依存関係のインストールが完了しました。'
  exit 0
fi

# PIDファイルを保存するディレクトリを作成
mkdir -p /tmp/patchouli_dev

# クリーンアップ関数
cleanup() {
    printf 'プロセスを終了します...\n'
    
    # PIDファイルから各プロセスを終了
    for pidfile in /tmp/patchouli_dev/*.pid; do
        if [ -f "$pidfile" ]; then
            pid=$(cat "$pidfile")
            if kill -0 "$pid" 2>/dev/null; then
                # プロセスグループ全体を終了
                kill -- -"$pid" 2>/dev/null || kill "$pid" 2>/dev/null
            fi
            rm -f "$pidfile"
        fi
    done
    
    # 念のため、関連プロセスも終了
    pkill -f "pnpm.*dev" 2>/dev/null || true
    pkill -f "cargo run" 2>/dev/null || true
    # Rustバイナリも明示的に終了
    pkill -f "patchouli" 2>/dev/null || true
    
    printf 'Frontend, Backend, Discordのプロセスを終了しました。\n'
    exit 0
}

# シグナルハンドラを設定
trap cleanup INT TERM EXIT

# mcpのビルド（完了まで待機）
cd mcp && pnpm build && cd ..

# frontendの開発サーバーを起動（バックグラウンド）
(cd frontend && pnpm dev > "/tmp/frontend.log" 2> "/tmp/frontend.err" &)
echo $! > /tmp/patchouli_dev/frontend.pid

# backend (Rust) を起動（バックグラウンド）
(cd core && exec cargo run > "/tmp/core.log" 2> "/tmp/core.err" &)
echo $! > /tmp/patchouli_dev/core.pid

# discord (Node.js) を起動（バックグラウンド）
(cd discord && pnpm dev > "/tmp/discord.log" 2> "/tmp/discord.err" &)
echo $! > /tmp/patchouli_dev/discord.pid

printf 'Frontend, Backend, Discordを並列で起動しました。\n'

# ユーザー入力待機ループ
while true; do
    read -p "終了するには 'q' または 'exit' を入力してください: " input
    if [ "$input" = "q" ] || [ "$input" = "exit" ]; then
        cleanup
    fi
done
