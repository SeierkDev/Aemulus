#!/bin/sh
set -e

# Repair the data directory's ownership, then drop privileges.
#
# The image creates /app/.data, chowns it to pwuser and switches to that user —
# all at BUILD time. A platform volume mounted at the same path arrives at RUN
# time, owned by root, and shadows the directory the chown fixed. Everything the
# app writes then fails with EACCES: recordings never start, run screenshots
# never land, and the missing screenshots surface much later as a receipt that
# verifies as "altered" because its evidence is gone.
#
# A build-time chown cannot repair a runtime mount. It has to happen here, on
# every boot, while we still have the privileges to do it.
if [ "$(id -u)" = "0" ]; then
  mkdir -p /app/.data
  # Best-effort: a platform that hands over a volume we may not chown should not
  # stop the container from booting. The health probe reports the condition, and
  # a degraded instance still serves every read path.
  chown -R pwuser:pwuser /app/.data 2>/dev/null || true

  # exec, so the app keeps PID 1 and receives SIGTERM directly. A wrapper that
  # swallows the signal makes every ordinary redeploy look like a crash.
  #
  # Chromium's OS sandbox is the reason any of this matters: it refuses to start
  # as root, and the usual workaround is --no-sandbox, which throws the
  # protection away rather than earning it. So we drop to pwuser here instead.
  if command -v setpriv >/dev/null 2>&1; then
    exec setpriv --reuid=pwuser --regid=pwuser --init-groups "$@"
  fi
  if command -v gosu >/dev/null 2>&1; then
    exec gosu pwuser "$@"
  fi
  # Last resort. "--" lands in $0 so the real arguments start at $1.
  exec su -s /bin/sh -c 'exec "$@"' pwuser -- "$@"
fi

# Already unprivileged — nothing to drop, and the chown above was never ours to
# make. Whether .data is writable is reported by /api/health either way.
exec "$@"
