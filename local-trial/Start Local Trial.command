#!/bin/zsh
cd "$(dirname "$0")/.." || exit 1
exec .venv/bin/python local-trial/serve.py --port 8091
