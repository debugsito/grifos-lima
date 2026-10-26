#!/usr/bin/env bash
# Muestra las sugerencias y los votos que dejaron los usuarios.
set -euo pipefail
ssh debugsito 'cat ~/grifos/api-data/sugerencias.jsonl 2>/dev/null' | jq -r '"\(.fecha[:16])  \(.texto)\(if .contacto != "" then "  [" + .contacto + "]" else "" end)"'
echo "--- votos"
curl -s https://grifos.debugsito.click/api/votos | jq -r '.votos | to_entries | sort_by(-.value)[] | "\(.value)\t\(.key)"'
