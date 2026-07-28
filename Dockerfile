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

# Railway injects PORT; `next start` binds it on 0.0.0.0. 3000 is the fallback.
ENV PORT=3000
EXPOSE 3000

# Starts the web server; instrumentation.ts boots the in-process background
# workers (scheduler, Merkle batcher, reconciler) on the same instance.
CMD ["npm", "run", "start"]
