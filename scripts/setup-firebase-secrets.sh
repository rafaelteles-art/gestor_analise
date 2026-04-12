#!/bin/bash
# Configura os secrets do Firebase App Hosting
# Execute após: firebase login && firebase use SEU_PROJETO_ID
#
# Uso: bash scripts/setup-firebase-secrets.sh

set -e

echo "=== Configurando secrets no Firebase Secret Manager ==="
echo ""
echo "Você precisará colar os valores quando solicitado."
echo ""

# Lê valores do .env.local se existir
if [ -f .env.local ]; then
  source .env.local
fi

# META_ACCESS_TOKEN
echo ">>> meta-access-token"
if [ -n "$META_ACCESS_TOKEN" ]; then
  echo "$META_ACCESS_TOKEN" | firebase apphosting:secrets:set meta-access-token --data-file -
else
  firebase apphosting:secrets:set meta-access-token
fi

# REDTRACK_API_KEY
echo ">>> redtrack-api-key"
if [ -n "$REDTRACK_API_KEY" ]; then
  echo "$REDTRACK_API_KEY" | firebase apphosting:secrets:set redtrack-api-key --data-file -
else
  firebase apphosting:secrets:set redtrack-api-key
fi

# DATABASE_URL
echo ">>> database-url"
if [ -n "$DATABASE_URL" ]; then
  echo "$DATABASE_URL" | firebase apphosting:secrets:set database-url --data-file -
else
  firebase apphosting:secrets:set database-url
fi

# META_PROFILES (JSON)
echo ">>> meta-profiles"
if [ -n "$META_PROFILES" ]; then
  echo "$META_PROFILES" | firebase apphosting:secrets:set meta-profiles --data-file -
else
  firebase apphosting:secrets:set meta-profiles
fi

echo ""
echo "=== Secrets configurados com sucesso! ==="
echo ""
echo "Próximo passo: configure as variáveis públicas no Firebase Console"
echo "  NEXT_PUBLIC_SUPABASE_URL = $NEXT_PUBLIC_SUPABASE_URL"
echo "  NEXT_PUBLIC_SUPABASE_ANON_KEY = [sua chave anon]"
