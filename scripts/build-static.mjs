/**
 * Builds the static storefront that Vercel serves from dist/.
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

// Everything below edits the COPY of index.html in dist/, never the source.
const indexPath = path.join(OUT, 'index.html');
let html = fs.readFileSync(indexPath, 'utf8');

/**
 * Replaces `pattern` in the page, or stops the build. The storefront is owned
 * by someone else, so if its markup changes and an injection point vanishes,
 * shipping a site that silently lacks its legal links is worse than a failed
 * build (Vercel keeps serving the previous deployment when a build fails).
 */
function inject(label, pattern, replacement) {
  if (!pattern.test(html)) {
    console.error(`[build] cannot find the ${label} in index.html; the storefront markup changed.`);
    process.exit(1);
  }
  html = html.replace(pattern, replacement);
}

// 1. The API bridge.
if (!html.includes(BRIDGE)) {
  inject('closing </body> tag', /<\/body>/i, `  <script src="${BRIDGE}" defer></script>\n</body>`);
}

// 2. Styles for the footer credit, the checkout note and the policy pages.
inject('closing </head> tag', /<\/head>/i, `  <link rel="stylesheet" href="/site.css">\n</head>`);

// 3. The footer's policy links point at sections that do not exist (#privacy
//    and friends), so send them to the real pages.
const POLICY_LINKS = {
  '#returns': '/refund-policy.html',
  '#privacy': '/privacy-policy.html',
  '#terms': '/terms-and-conditions.html'
};
for (const [anchor, page] of Object.entries(POLICY_LINKS)) {
  inject(`footer link ${anchor}`, new RegExp(`href="${anchor}"`), `href="${page}"`);
}

// 4. The developer credit, in the footer's bottom bar.
inject(
  'footer bottom bar',
  /(<div class="footer-bottom">[\s\S]*?)(<\/div>\s*<\/footer>)/,
  `$1<span class="dev-credit">Developed by <a href="https://ad-venture.in" target="_blank" rel="noopener">Ad-Venture (ad-venture.in)</a></span>$2`
);

// 5. Consent line under the checkout button.
inject(
  'checkout form',
  /(<form id="checkoutForm">[\s\S]*?)(<\/form>)/,
  `$1<p class="legal-note">By placing your order you agree to our ` +
    `<a href="/terms-and-conditions.html" target="_blank" rel="noopener">Terms &amp; Conditions</a>, ` +
    `<a href="/refund-policy.html" target="_blank" rel="noopener">Refund Policy</a> and ` +
    `<a href="/privacy-policy.html" target="_blank" rel="noopener">Privacy Policy</a>.</p>$2`
);

fs.writeFileSync(indexPath, html);

// ---------------------------------------------------------------- policy pages

const SITE = path.join(ROOT, 'site');
const business = JSON.parse(fs.readFileSync(path.join(SITE, 'business.json'), 'utf8'));

const escapeHtml = value =>
  String(value).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

const brand = business.brandName;
const days = Number(business.returnWindowDays) || 2;

// The contact block is built only from details that were actually filled in.
// Nothing is invented: a missing field is left out and reported below.
function contactBlock() {
  const rows = [];
  if (business.legalName) rows.push(`<li><strong>${escapeHtml(business.legalName)}</strong></li>`);
  if (business.email) {
    const email = escapeHtml(business.email);
    rows.push(`<li>Email: <a href="mailto:${email}">${email}</a></li>`);
  }
  if (business.phone) rows.push(`<li>Phone: ${escapeHtml(business.phone)}</li>`);
  if (business.address) rows.push(`<li>Address: ${escapeHtml(business.address)}</li>`);
  if (business.grievanceOfficer) {
    rows.push(`<li>Grievance Officer: ${escapeHtml(business.grievanceOfficer)}</li>`);
  }

  return rows.length
    ? `      <ul>\n        ${rows.join('\n        ')}\n      </ul>`
    : `      <p>Please use the contact details published in the footer of our website.</p>`;
}

const tokens = {
  brand: escapeHtml(brand),
  legal: escapeHtml(business.legalName || brand),
  days: String(days),
  hours: String(days * 24),
  region: escapeHtml(business.dataRegion || 'our hosting region'),
  updated: escapeHtml(business.lastUpdated),
  year: String(new Date().getFullYear()),
  contact: contactBlock()
};

const fill = (template, extra = {}) =>
  template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    const value = { ...tokens, ...extra }[key];
    if (value === undefined) {
      console.error(`[build] unknown placeholder ${match} in a policy page`);
      process.exit(1);
    }
    return value;
  });

const layout = fs.readFileSync(path.join(SITE, 'layout.html'), 'utf8');

const PAGES = [
  {
    file: 'privacy-policy.html',
    content: 'privacy.html',
    title: 'Privacy Policy',
    description: `How ${brand} collects, uses and protects your personal information.`
  },
  {
    file: 'refund-policy.html',
    content: 'refund.html',
    title: 'Refund Policy',
    description: `${brand} refund and return policy: tell us within ${days} days of delivery.`
  },
  {
    file: 'terms-and-conditions.html',
    content: 'terms.html',
    title: 'Terms & Conditions',
    description: `The terms that apply when you shop with ${brand}.`
  }
];

for (const page of PAGES) {
  const body = fill(fs.readFileSync(path.join(SITE, 'content', page.content), 'utf8'));
  const rendered = fill(layout, {
    title: escapeHtml(page.title),
    description: escapeHtml(page.description),
    body
  });
  fs.writeFileSync(path.join(OUT, page.file), rendered);
}

fs.copyFileSync(path.join(SITE, 'site.css'), path.join(OUT, 'site.css'));

for (const [field, label] of [
  ['email', 'the contact email'],
  ['phone', 'the contact phone number'],
  ['address', 'the business address'],
  ['grievanceOfficer', 'the grievance officer']
]) {
  if (!business[field]) {
    console.warn(`[build] warning: site/business.json is missing ${label}; the policies leave it out.`);
  }
}

console.log(
  `[build] ${copied + 2 + PAGES.length + 1} files → dist/ ` +
    `(bridge, footer links, credit and ${PAGES.length} policy pages added; source untouched)`
);
