#!/usr/bin/env bash
# Regenera los datos en local y sube web/ al servidor. El servidor solo sirve archivos.
set -euo pipefail
cd "$(dirname "$0")/.."
python3 build.py
rsync -az --delete --exclude '.*' web/ debugsito:grifos/web/
echo "Publicado: https://grifos.debugsito.click"
