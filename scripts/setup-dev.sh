#!/usr/bin/env bash
set -euo pipefail

COGNITION_DIR="core/cognition"

echo "Initializing development environment for Glimmer Cradle"

echo "Installing Python dependencies for Cognition (via uv)..."
cd "$COGNITION_DIR"
uv sync --extra dev
cd -

echo "Installing node dependencies via pnpm..."
pnpm install

echo "Bootstrap complete. Activate Cognition with: source $COGNITION_DIR/.venv/bin/activate"
# Note: Python package name is glimmer-cradle-cognition; source lives in core/cognition.
