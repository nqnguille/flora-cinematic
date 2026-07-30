#!/bin/bash
# Respaldo de la D1 flora-finanzas — correr cuando se quiera un backup
# (o desde un cron de esta máquina). Los dumps NO van a git (datos de socios).
set -e
cd "$(dirname "$0")/.."
export NVM_DIR="$HOME/.nvm" && [ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
FECHA=$(date +%Y%m%d-%H%M)
npx wrangler d1 export flora-finanzas --remote --output "backups/flora-finanzas-$FECHA.sql"
# conservar los últimos 14 respaldos
ls -t backups/flora-finanzas-*.sql 2>/dev/null | tail -n +15 | xargs -r rm
echo "Respaldo listo: backups/flora-finanzas-$FECHA.sql"
