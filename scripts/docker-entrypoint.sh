#!/bin/sh
# Prepares the data directory (a Render disk mounts here, owned by root), optionally creates
# the first admin, then runs the server as the unprivileged "node" user.
set -e
cd /app
mkdir -p data
[ -f data/saved_recipes.json ] || echo '[]' > data/saved_recipes.json
chown -R node:node data

# Optional first-admin bootstrap: only when both variables are set. An existing account is
# left alone (the script reports it and the server still starts). Remove ADMIN_PASSWORD
# from the environment afterwards.
if [ -n "$BOOTSTRAP_ADMIN_USERNAME" ] && [ -n "$ADMIN_PASSWORD" ]; then
  setpriv --reuid=node --regid=node --init-groups \
    node scripts/create-admin.js "$BOOTSTRAP_ADMIN_USERNAME" || echo "Admin bootstrap skipped (see message above)."
fi

exec setpriv --reuid=node --regid=node --init-groups node backend/server.js
