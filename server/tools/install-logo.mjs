#!/usr/bin/env node
/**
 * Install the brand logo.
 *
 *   npm run logo -- /path/to/logo.png
 *   npm run logo -- ~/Downloads/phbl-logo.png --footer ~/Downloads/phbl-logo-white.png
 *
 * Copies the file into web/assets/img/, points site.json at it, and checks it is really an
 * image. Pass --height 52 to change how tall it sits in the header.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB = path.join(__dirname, '..', '..', 'web');
const IMG = path.join(WEB, 'assets', 'img');
const SITE = path.join(WEB, 'data', 'site.json');

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i !== -1 ? args[i + 1] : null;
};
const source = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--footer' && args[args.indexOf(a) - 1] !== '--height');

if (!source) {
  console.error(`
Usage: npm run logo -- <path-to-logo> [--footer <path-to-white-logo>] [--height 44]

Example:
  npm run logo -- ~/Downloads/phbl-logo.png

Tip: in Finder, right-click the image > "Copy as Pathname", then paste it after the command.
`);
  process.exit(1);
}

/* ---- identify the file type from its first bytes, not its extension ---- */
const SIGNATURES = [
  { ext: '.png', test: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { ext: '.jpg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: '.webp', test: (b) => b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP' },
  { ext: '.gif', test: (b) => b.slice(0, 3).toString() === 'GIF' },
  { ext: '.svg', test: (b) => /<svg|<\?xml/i.test(b.slice(0, 200).toString()) },
];

function install(srcPath, destName) {
  const resolved = path.resolve(srcPath.replace(/^~/, process.env.HOME || '~'));
  if (!fs.existsSync(resolved)) {
    console.error(`Could not find: ${resolved}`);
    process.exit(1);
  }
  const buffer = fs.readFileSync(resolved);
  const match = SIGNATURES.find((s) => s.test(buffer));
  if (!match) {
    console.error(`${path.basename(resolved)} does not look like an image file (PNG, JPG, WEBP, GIF or SVG).`);
    process.exit(1);
  }
  const sizeKb = Math.round(buffer.length / 1024);
  const dest = path.join(IMG, destName + match.ext);
  fs.mkdirSync(IMG, { recursive: true });
  fs.writeFileSync(dest, buffer);
  console.log(`  ✓ ${path.basename(dest)}  (${sizeKb} KB)`);
  if (sizeKb > 300) {
    console.log(`    note: ${sizeKb} KB is large for a logo. Export it around 600px wide to keep pages fast.`);
  }
  return `assets/img/${path.basename(dest)}`;
}

console.log('\nInstalling logo…');
const site = JSON.parse(fs.readFileSync(SITE, 'utf8'));
site.brand.logo = install(source, 'logo');

const footer = flag('footer');
if (footer) {
  site.brand.logoFooter = install(footer, 'logo-white');
  site.brand.logoFooterOnChip = false;
} else {
  // No white version supplied: show the colour logo on a white chip so it stays legible
  // on the dark green footer instead of disappearing into it.
  site.brand.logoFooter = site.brand.logo;
  site.brand.logoFooterOnChip = true;
}

const height = Number(flag('height'));
if (Number.isFinite(height) && height > 0) site.brand.logoHeight = height;

fs.writeFileSync(SITE, JSON.stringify(site, null, 2) + '\n');

console.log(`  ✓ site.json updated (header height ${site.brand.logoHeight}px)`);
console.log(`
Done. Reload the site to see it — no restart needed.
If it looks too big or small:  npm run logo -- ${source} --height 52
`);
