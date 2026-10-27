#!/usr/bin/env bash
# Una vez (o para rotar la llave): llave de deploy que solo puede sincronizar ~/grifos/web,
# secrets del repo, primera corrida en GitHub Actions y baja del timer local.
set -euo pipefail
cd "$(dirname "$0")/.."
export GH_CONFIG_DIR="${GH_CONFIG_DIR:-$HOME/.config/gh-personal}"
SERVIDOR=debugsito
REPO=debugsito/grifos-lima
COMENTARIO=grifos-lima-github-actions

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
host=$(ssh -G "$SERVIDOR" | awk '$1 == "hostname" {print $2}')
user=$(ssh -G "$SERVIDOR" | awk '$1 == "user" {print $2}')
ssh-keygen -F "$host" | grep -v '^#' > "$tmp/known_hosts" || { echo "Conéctate una vez a $SERVIDOR para tener su huella en known_hosts" >&2; exit 1; }
ssh-keygen -q -t ed25519 -N "" -C "$COMENTARIO" -f "$tmp/key"

echo "Instalando la llave en $SERVIDOR (solo rsync dentro de grifos/web)..."
ruta=$(ssh "$SERVIDOR" 'echo $HOME')/grifos/web
linea="command=\"/usr/bin/rrsync $ruta\",restrict $(cat "$tmp/key.pub")"
ssh "$SERVIDOR" "set -e; cd ~/.ssh; cp authorized_keys authorized_keys.bak-\$(date +%Y%m%d%H%M)
  { grep -v '$COMENTARIO' authorized_keys || true; echo '$linea'; } > authorized_keys.tmp
  chmod 600 authorized_keys.tmp; mv authorized_keys.tmp authorized_keys"

conexion=(ssh -i "$tmp/key" -o IdentitiesOnly=yes -o BatchMode=yes -o UserKnownHostsFile="$tmp/known_hosts")
rsync -e "${conexion[*]}" --list-only "$user@$host:./" | grep -q index.html || { echo "La llave nueva no puede listar grifos/web" >&2; exit 1; }
if "${conexion[@]}" "$user@$host" true 2>/dev/null; then echo "La llave nueva abre una shell: revisa authorized_keys" >&2; exit 1; fi
echo "Llave verificada: sincroniza grifos/web y no abre shell."

gh secret set DEPLOY_KEY -R "$REPO" < "$tmp/key"
gh secret set DEPLOY_KNOWN_HOSTS -R "$REPO" < "$tmp/known_hosts"
gh secret set DEPLOY_HOST -R "$REPO" --body "$host"
gh secret set DEPLOY_USER -R "$REPO" --body "$user"

echo "Primera corrida en GitHub Actions..."
gh workflow run publicar.yml -R "$REPO"
sleep 8
id=$(gh run list -R "$REPO" --workflow publicar.yml --limit 1 --json databaseId -q '.[0].databaseId')
gh run watch "$id" -R "$REPO" --exit-status
systemctl --user disable --now grifos-publicar.timer 2>/dev/null || true
echo "Listo: GitHub publica a las 13:30 y 19:30 (Lima) y el timer local quedó apagado."
