# Aemulus runs real Chromium for every skill run, so the runtime image must
# ship the browser + all its system libraries. Microsoft's Playwright image
# does exactly that (Chromium/Firefox/WebKit + deps preinstalled under
# /ms-playwright) and bundles Node 22 — pinned to match the "playwright"
# dependency version so the driver and browsers stay in lockstep.
FROM mcr.microsoft.com/playwright:v1.61.1-noble

WORKDIR /app

# Install ALL dependencies first (a build needs the dev deps: next + typescript).
# Copied separately from the source so this layer is cached across code changes.
COPY package.json package-lock.json ./
RUN npm ci

# Build the Next.js app (prebuild vendors rrweb, then `next build`).
COPY . .
ENV NODE_ENV=production
RUN npm run build

# Every run executes steps somebody else published, so Chromium's own OS sandbox
# is the last line between a compromised renderer and this container. That
# sandbox is silently disabled when Chromium runs as root — which is the default
# in this image — and the usual "fix" is to paste in --no-sandbox, which throws
# the protection away instead of earning it. So drop to the non-root user the
# Playwright image already ships, and give it the two paths the app writes to.
#
# .next is fixed here because it is baked into the image. .data is NOT, because
# a mounted volume replaces this directory at runtime with one owned by root,
# and no build-time chown can reach it. The entrypoint repairs that on every
# boot and drops to pwuser itself — which is why there is no `USER pwuser` here.
RUN mkdir -p /app/.data && chown -R pwuser:pwuser /app/.data /app/.next
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]

# Railway injects PORT; `next start` binds it on 0.0.0.0. 3000 is the fallback.
ENV PORT=3000
EXPOSE 3000

# Starts the web server; instrumentation.ts boots the in-process background
# workers (scheduler, Merkle batcher, reconciler) on the same instance.
# Exec form (not `npm run start`) so `next` is PID 1 and receives SIGTERM
# directly — Next shuts down cleanly (exit 0) on a stop/redeploy instead of npm
# swallowing the signal and exiting non-zero, which Railway would read as a crash.
CMD ["node_modules/.bin/next", "start"]
