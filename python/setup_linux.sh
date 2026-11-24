#!/bin/sh
# Sets a Linux machine up to train: .NET 8 under ~/.dotnet (no root needed), the
# server built in Release, and a Python environment with PyTorch in .venv.
#   sh python/setup_linux.sh
set -eu
cd "$(dirname "$0")/.."
export DOTNET_CLI_TELEMETRY_OPTOUT=1

if command -v dotnet >/dev/null 2>&1 && dotnet --list-sdks | grep -q '^8\.'; then
    DOTNET=$(command -v dotnet)
else
    if [ ! -x "$HOME/.dotnet/dotnet" ]; then
        echo "Installing .NET 8 SDK into ~/.dotnet ..."
        curl -sSL https://dot.net/v1/dotnet-install.sh -o /tmp/dotnet-install.sh
        bash /tmp/dotnet-install.sh --channel 8.0 --install-dir "$HOME/.dotnet"
    fi
    DOTNET="$HOME/.dotnet/dotnet"
fi
echo "Using $DOTNET ($("$DOTNET" --version))"
"$DOTNET" build Server.Console/Server.Console.csproj -c Release -v q --nologo | grep -E " error |Warn|Error|Elapsed" | tail -8

if [ ! -x .venv/bin/python ]; then
    if command -v uv >/dev/null 2>&1; then
        uv venv --python 3.12 .venv
        uv pip install --python .venv/bin/python numpy torch
    else
        python3 -m venv .venv
        .venv/bin/pip install -q --upgrade pip
        .venv/bin/pip install -q numpy torch
    fi
fi
.venv/bin/python -c "import torch; print('torch', torch.__version__, '| cuda', torch.cuda.is_available(), '|', torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'no GPU')"

echo "Checking the bridge (a few seconds) ..."
PYTHONPATH=python .venv/bin/python python/bench.py --agents 100 --steps 3000 | tail -3
echo "Ready. Cores: $(nproc). Start a long run inside tmux, for example:"
echo "  tmux new -s train 'sh python/long_run.sh h100 --worlds $(( $(nproc) > 34 ? 32 : $(nproc) - 2 ))'"
