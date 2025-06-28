param(
    [string]$Command = ""
)

if ($Command -eq "install") {
    Write-Host "依存関係を一括インストールします..." -ForegroundColor Cyan
    foreach ($dir in @("frontend", "mcp", "discord")) {
        Write-Host "→ $dir で pnpm i 実行中..." -ForegroundColor Yellow
        Start-Process -NoNewWindow -Wait -WorkingDirectory $dir pnpm -ArgumentList "install"
    }
    Write-Host "全ての依存関係のインストールが完了しました。" -ForegroundColor Green
    exit
}

# mcpのビルド（完了まで待機）
Start-Process -NoNewWindow -Wait -WorkingDirectory "mcp" pnpm -ArgumentList "build"

# frontendの開発サーバーを起動（バックグラウンド）
Start-Process pnpm -ArgumentList "dev" -WorkingDirectory "frontend" -WindowStyle Hidden -RedirectStandardOutput "$env:TEMP\frontend.log" -RedirectStandardError "$env:TEMP\frontend.err"

# backend (Rust) を起動（バックグラウンド）
Start-Process cargo -ArgumentList "run" -WorkingDirectory "core" -WindowStyle Hidden -RedirectStandardOutput "$env:TEMP\core.log" -RedirectStandardError "$env:TEMP\core.err"

# discord (Node.js) を起動（バックグラウンド）
Start-Process pnpm -ArgumentList "dev" -WorkingDirectory "discord" -WindowStyle Hidden -RedirectStandardOutput "$env:TEMP\discord.log" -RedirectStandardError "$env:TEMP\discord.err"

Write-Host "Frontend, Backend, Discordを並列で起動しました。" -ForegroundColor Green

# ユーザー入力待機ループ
while ($true) {
    $input = Read-Host "終了するには 'q' または 'exit' を入力してください"
    if ($input -eq 'q' -or $input -eq 'exit') {
        Write-Host "プロセスを終了します..." -ForegroundColor Yellow
        Get-Process pnpm, node, cargo, patchouli -ErrorAction SilentlyContinue | Stop-Process -Force
        Write-Host "Frontend, Backend, Discordのプロセスを終了しました。"
        break
    }
}
