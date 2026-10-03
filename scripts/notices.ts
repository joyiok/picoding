import { createHash } from 'node:crypto';
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

// Offline inventory of the locked npm runtime graph and notices actually shipped
// by installed packages. Missing notice text is recorded, never manufactured.
const check = process.argv.includes('--check');
const lock = JSON.parse(await readFile('package-lock.json', 'utf8')) as { packages: Record<string, { version?: string; dev?: boolean; optional?: boolean; license?: string; integrity?: string }> };
const texts = new Map<string, { content: string; sources: string[] }>();
const supplemental = JSON.parse(await readFile('third-party/upstream-sources.json', 'utf8')) as { packages: string[]; version: string; license: string; file: string; url: string }[];
const packages: { path: string; name: string; version: string; license: string; optional: boolean; installed: boolean; integrity?: string; repository?: string; notices: { file: string; sha256: string; upstreamUrl?: string }[] }[] = [];
for (const [path, saved] of Object.entries(lock.packages).sort(([a], [b]) => a.localeCompare(b, 'en'))) {
  if (!path || saved.dev) continue;
  let manifest: { name: string; version: string; license?: string | { type?: string }; repository?: string | { url?: string } } | undefined;
  try { manifest = JSON.parse(await readFile(join(path, 'package.json'), 'utf8')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || !saved.optional) throw error; }
  if (manifest && manifest.version !== saved.version) throw new Error('Installed version does not match package-lock: ' + path);
  const noticeFiles = manifest ? (await readdir(path, { withFileTypes: true })).filter(file => file.isFile() && /^(license|licence|notice|copying|copyright)(?:$|[._-]|notice)/i.test(file.name)).map(file => file.name).sort() : [];
  const notices: { file: string; sha256: string; upstreamUrl?: string }[] = [];
  for (const file of noticeFiles) {
    const content = await readFile(join(path, file), 'utf8'), sha256 = createHash('sha256').update(content).digest('hex');
    const entry = texts.get(sha256) || { content, sources: [] }; entry.sources.push(path + '/' + file); texts.set(sha256, entry);
    notices.push({ file, sha256 });
  }
  const declared = typeof manifest?.license === 'string' ? manifest.license : manifest?.license?.type;
  for (const source of supplemental.filter(source => source.packages.includes(manifest?.name || '') && source.version === saved.version)) {
    if (source.license !== declared) throw new Error('Upstream license does not match package declaration: ' + path);
    const content = await readFile(source.file, 'utf8'), sha256 = createHash('sha256').update(content).digest('hex');
    const entry = texts.get(sha256) || { content, sources: [] }; if (!entry.sources.includes(source.url)) entry.sources.push(source.url); texts.set(sha256, entry);
    notices.push({ file: source.file, sha256, upstreamUrl: source.url });
  }
  const repository = typeof manifest?.repository === 'string' ? manifest.repository : manifest?.repository?.url;
  packages.push({ path, name: manifest?.name || path.split('node_modules/').at(-1)!, version: saved.version!, license: declared || saved.license || 'UNKNOWN', optional: !!saved.optional, installed: !!manifest, ...(saved.integrity ? { integrity: saved.integrity } : {}), ...(repository ? { repository } : {}), notices });
}
const missingNotices = packages.filter(item => item.installed && !item.notices.length);
const unknownLicenses = packages.filter(item => item.license === 'UNKNOWN');
const inventory = JSON.stringify({ schema: 1, platform: process.platform, architecture: process.arch, scope: 'Locked npm runtime graph; installed package notices and explicit upstream references; excludes operating system, Node distribution and user plugins', packages, missingNotices: missingNotices.map(item => item.path), unknownLicenses: unknownLicenses.map(item => item.path) }, null, 2) + '\n';
const cell = (value: string) => value.replace(/\|/g, '\\|').replace(/[\r\n]/g, ' ');
const parts = [
  '# Third-party npm runtime inventory and notices',
  '',
  'Generated offline by npm run notices from package-lock.json, installed package files and explicit upstream references. License names are declarations, not a commercial-use approval.',
  '',
  `Platform: ${process.platform}/${process.arch}. Locked runtime entries: ${packages.length}; installed: ${packages.filter(item => item.installed).length}.`,
  '',
  'Scope: npm runtime packages, including browser libraries. This file excludes the Node.js distribution, Docker/OS/browser packages and customer-installed pi packages. It does not set a license for PiCoding itself.',
  '',
  `Installed packages without a collected license/notice file: ${missingNotices.length}. Entries without a license declaration: ${unknownLicenses.length}. These gaps remain open for release preparation; do not treat this inventory as completed license clearance.`,
  '',
  '| Package | Version | Declared license | Installed | Bundled notice sections |',
  '| --- | --- | --- | --- | --- |',
  ...packages.map(item => `| ${cell(item.name)} | ${cell(item.version)} | ${cell(item.license)} | ${item.installed ? 'yes' : 'optional, absent'} | ${item.notices.length ? item.notices.map(notice => '[' + cell(notice.file) + '](#notice-' + notice.sha256 + ')').join(', ') : item.installed ? 'MISSING — source review needed' : 'not installed'} |`),
  '', '## Bundled notice texts', '',
];
for (const [sha, entry] of [...texts].sort(([a], [b]) => a.localeCompare(b, 'en'))) {
  parts.push('### Notice ' + sha, '', 'Sources: ' + entry.sources.map(source => '`' + source + '`').join(', '), '', '~~~~text', entry.content.replace(/\n$/, ''), '~~~~', '');
}
const notices = parts.join('\n');
for (const [file, content] of [['third-party/npm-runtime.json', inventory], ['THIRD_PARTY_NOTICES.md', notices]]) {
  if (check) {
    if (await readFile(file, 'utf8') !== content) throw new Error(file + ' is out of date. Run npm run notices after a clean npm ci on the release platform.');
  } else { await mkdir('third-party', { recursive: true }); await writeFile(file, content); }
}
console.log(JSON.stringify({ result: check ? 'Inventory matches installed packages' : 'Inventory generated', packages: packages.length, missingNotices: missingNotices.length, unknownLicenses: unknownLicenses.length }));
