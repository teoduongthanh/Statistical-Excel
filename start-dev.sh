#!/usr/bin/env bash
# Robust dev server launcher.
# Fully detaches the Next.js dev server into its own session/process group
# so it survives after the launching shell exits (the sandbox bash tool
# kills its process group on return — setsid + double-fork avoids that).
set -e
cd /home/z/my-project

# Kill any existing dev server on port 3000.
pkill -f "next-server" 2>/dev/null || true
pkill -f "next dev" 2>/dev/null || true
sleep 1

# Unset the inherited SQLite DATABASE_URL so Next.js loads MongoDB URL from .env.
unset DATABASE_URL

# Launch fully detached: new session, no controlling tty, all stdio redirected.
setsid bash -c 'env -u DATABASE_URL bun run dev > dev.log 2>&1' < /dev/null > /dev/null 2>&1 &
DEV_PID=$!
disown $DEV_PID 2>/dev/null || true

# Wait for the server to come up.
for i in $(seq 1 30); do
  if curl -sf -o /dev/null --max-time 2 http://localhost:3000/ 2>/dev/null; then
    echo "OK: dev server up (pid=$DEV_PID) after ${i}s"
    exit 0
  fi
  sleep 1
done
echo "WARN: dev server did not respond after 30s"
tail -20 dev.log 2>/dev/null || true
exit 0
