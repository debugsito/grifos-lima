#!/usr/bin/env bash
# Regenera los datos en local y sube web/ al servidor. El servidor solo sirve archivos.
set -euo pipefail
cd "$(dirname "$0")/.."
python3 build.py
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
rsync -a --exclude '.*' web/ "$tmp/"
# Cloudflare fija su propio max-age a .js y .css: cada versión lleva su URL para no mezclar archivos viejos y nuevos.
ver=$(cat web/*.js web/*.css web/features.json | sha1sum | cut -c1-10)
sed -i -E "s#(src|href)=\"(app\.js|ruta\.js|herramientas\.js|style\.css)\"#\1=\"\2?v=$ver\"#g" "$tmp/index.html"
rsync -az --delete "$tmp/" debugsito:grifos/web/
echo "Publicado: https://grifos.debugsito.click (v=$ver)"
