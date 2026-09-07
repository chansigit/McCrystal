#!/bin/bash
set -euo pipefail
WEB_ROOT="$(cd "$(dirname "$0")" && pwd)"
if [[ -x /opt/homebrew/opt/dotnet@8/bin/dotnet ]]; then
    export PATH="/opt/homebrew/opt/dotnet@8/bin:/opt/homebrew/bin:$PATH"
fi
command -v dotnet >/dev/null || { echo "Install the .NET 8 SDK first." >&2; exit 1; }
command -v npm >/dev/null || { echo "Install Node.js 20+ first." >&2; exit 1; }
cd "$WEB_ROOT"
npm ci
npm run build
dotnet build Client.Web.csproj

web_running=false
if curl -fsS http://127.0.0.1:5080/health >/dev/null 2>&1; then web_running=true; fi

# Only start the game server when this checkout has no listener of its own.
SERVER_ROOT="$(cd ../Build/Server/Debug && pwd)"
server_running=false
for pid in $(lsof -t -iTCP:7000 -sTCP:LISTEN 2>/dev/null || true); do
    process_directory="$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' || true)"
    if [[ "$process_directory" == "$SERVER_ROOT" ]]; then server_running=true; break; fi
done
server_pid=""
cleanup() {
    if [[ -n "$server_pid" ]]; then
        kill -INT "$server_pid" 2>/dev/null || true
        wait "$server_pid" 2>/dev/null || true
    fi
}
trap cleanup EXIT
if [[ "$server_running" != true ]]; then
    dotnet build ../Server.Console/Server.Console.csproj
    (cd "$SERVER_ROOT" && exec dotnet Server.Console.dll) &
    server_pid=$!
    for ((attempt=0; attempt<60; attempt++)); do
        kill -0 "$server_pid" 2>/dev/null || { echo "Game server exited." >&2; exit 1; }
        if lsof -nP -a -p "$server_pid" -iTCP -sTCP:LISTEN >/dev/null 2>&1; then break; fi
        if [[ "$attempt" == 59 ]]; then echo "Game server startup timed out." >&2; exit 1; fi
        sleep 1
    done
fi
echo "Open http://127.0.0.1:5080 in your browser. Press Ctrl+C to stop."
if [[ "$web_running" == true ]]; then
    echo "Reusing the existing Crystal Web gateway."
    if [[ -n "$server_pid" ]]; then wait "$server_pid"; fi
    exit 0
fi
dotnet run --no-build --project Client.Web.csproj
