/**
 * Builds the static storefront that Firebase Hosting serves from dist/.
 *
 * The storefront folder is read-only and must stay that way, so nothing in it
 * is modified: its files are copied out, and the API bridge script tag is
 * added to the copy of index.html.
 *
 *   node scripts/build-static.mjs
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = path.join(ROOT, 'frontend', 'phbl_naturals_website');
const BACKEND_PUBLIC = path.join(ROOT, 'backend', 'public');
const OUT = path.join(ROOT, 'dist');
const BRIDGE = '/storefront-api.js';

// node_modules is only there for the Font Awesome package; the page loads its
// CSS from a CDN, so shipping 5,800 files to the edge would be pure waste.
const SKIP = new Set(['node_modules', '.DS_Store', 'package.json', 'package-lock.json']);

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  let count = 0;

  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;

    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);

    if (entry.isDirectory()) count += copyDir(src, dest);
    else {
      fs.copyFileSync(src, dest);
      count += 1;
    }
  }
  return count;
}

if (!fs.existsSync(path.join(SOURCE, 'index.html'))) {
  console.error(`[build] storefront not found at ${SOURCE}`);
  process.exit(1);
}

fs.rmSync(OUT, { recursive: true, force: true });
const copied = copyDir(SOURCE, OUT);

// The bridge and the admin dashboard live with the backend; publish them too.
for (const file of ['storefront-api.js', 'admin.html']) {
  fs.copyFileSync(path.join(BACKEND_PUBLIC, file), path.join(OUT, file));
}

// Inject the bridge into the copy, never into the source file.
const indexPath = path.join(OUT, 'index.html');
const html = fs.readFileSync(indexPath, 'utf8');

if (!html.includes(BRIDGE)) {
  fs.writeFileSync(
    indexPath,
    html.replace(/<\/body>/i, `  <script src="${BRIDGE}" defer></script>\n</body>`)
  );
}

console.log(`[build] ${copied + 2} files → dist/ (bridge injected, source untouched)`);
