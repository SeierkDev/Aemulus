// Copy rrweb's prebuilt UMD bundle into public/ so the replay component can load
// it as a same-origin <script> at runtime. We deliberately DON'T import rrweb's
// Replayer through webpack: Next's production minifier mangles rrweb's internal
// player state machine and play() silently no-ops. The prebuilt UMD bundle works
// as-is. Runs on predev/prebuild so it always matches the installed rrweb version.
import { createRequire } from "node:module";
import { mkdirSync, copyFileSync } from "node:fs";
import path from "node:path";

const require = createRequire(import.meta.url);
// rrweb's exports map doesn't expose the UMD subpath, so resolve the package's
// main entry and reach the sibling bundle in its dist dir.
const src = path.join(
  path.dirname(require.resolve("rrweb")),
  "rrweb.umd.min.cjs",
);
const outDir = path.join(process.cwd(), "public", "vendor");
mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, "rrweb.umd.min.js");
copyFileSync(src, out);
console.log("vendored rrweb →", path.relative(process.cwd(), out));
