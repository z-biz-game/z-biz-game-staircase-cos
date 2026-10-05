// The repo itself as a gate: zero dependencies, the shipped images being real images the
import { spawnSync } from 'node:child_process';
// generator can reproduce, the three layers not bleeding into each other, the CI file set
// matching `npm run check`, and the two places the display name is written agreeing.
// Every row here is a claim someone could otherwise make in a README without anything
// checking it.

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { test, run, eq, ok } from '../tools/harness.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const buf = (p) => readFileSync(join(root, p));

function walk(dir, out = []) {
  for (const name of readdirSync(join(root, dir))) {
    const rel = join(dir, name);
    const st = statSync(join(root, rel));
    if (st.isDirectory()) walk(rel, out);
    else out.push(rel);
  }
  return out;
}

const CODE = [...walk('js'), ...walk('css'), ...walk('tools'), ...walk('test'), ...walk('electron'),
  'index.html', 'server.cjs', 'sw.js', 'manifest.webmanifest', 'package.json', 'README.md',
  'DESIGN.md', 'deliverable.md', 'LICENSE', '.gitignore'].filter((f) => !f.endsWith('.DS_Store'));
const IMAGES = [...walk('icons'), ...walk('assets/art')].filter((f) => f.endsWith('.png'));
const FILES = [...CODE, ...IMAGES];

// IHDR is at a fixed offset, so this is the whole of what "the file is that size" means.
function pngHeader(p) {
  const b = buf(p);
  eq(b.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `${p} is not a PNG`);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), depth: b.readUInt8(24), color: b.readUInt8(25) };
}

test('package.json really has zero dependencies and zero devDependencies', () => {
  const pkg = JSON.parse(read('package.json'));
  eq(pkg.dependencies, {});
  eq(pkg.devDependencies, {});
  eq(pkg.type, 'module');
  eq(pkg.main, 'electron/main.cjs');
  ok(pkg.scripts.check.includes('node --check'));
  ok(pkg.scripts.verify.includes('tools/verify.sh'));
});

test('every shipped file has bytes in it, and nothing pretends to be an asset', () => {
  for (const f of FILES) ok(statSync(join(root, f)).size > 0, `${f} is 0 bytes`);
  const BANNED = ['.jpg', '.jpeg', '.gif', '.webp', '.mp3', '.wav', '.ogg', '.woff', '.woff2', '.ttf', '.eot', '.pdf', '.zip'];
  const hits = FILES.filter((f) => BANNED.includes(extname(f).toLowerCase()));
  eq(hits, [], 'these asset types have no business in a zero-dependency repo');
  // PNGs are allowed only where the generator writes them; a blob anywhere else is unexplained.
  const stray = IMAGES.filter((f) => !f.startsWith('icons/') && !f.startsWith('assets/art/'));
  eq(stray, [], 'images must live in icons/ or assets/art/');
  // Text stays text: a 400kB source file means something got baked that should be generated.
  const big = CODE.filter((f) => statSync(join(root, f)).size > 400000);
  eq(big, [], 'a shipped source file over 400kB needs a reason and a generator');
});

test('the icons are real PNGs of the size their filename claims', () => {
  ok(IMAGES.length >= 10, `only ${IMAGES.length} icons shipped`);
  for (const f of IMAGES.filter((x) => x.startsWith('icons/'))) {
    const m = f.match(/(16|32|48|64|96|180|192|512|1024)/);
    const { w, h } = pngHeader(f);
    if (m) eq([w, h], [Number(m[1]), Number(m[1])], `${f} is ${w}x${h} but named for ${m[1]}`);
    ok(w === h, `${f} is not square`);
  }
  // The two numbers a store listing is judged on: an icon that can be installed, and a
  // favicon big enough to be one.
  const touch = pngHeader('icons/apple-touch-icon.png');
  ok(Math.min(touch.w, touch.h) >= 180, `apple-touch-icon is ${touch.w}x${touch.h}`);
  ok(pngHeader('icons/icon-1024.png').w === 1024, 'no 1024 master means every store resizes itself');
  const og = pngHeader('assets/art/og-cover-1200x630.png');
  eq([og.w, og.h], [1200, 630], 'a share card at any other ratio gets cropped by every linker');
  for (const f of ['assets/art/felt-256.png', 'assets/art/cardback-128.png', 'assets/art/glow-256.png']) {
    ok(pngHeader(f).w >= 128, `${f} is too small to tile as a texture`);
  }
});

test('the desktop bundle ships real icons, and the containers say the sizes they carry', () => {
  const pkg = JSON.parse(read('package.json'));
  const shell = read('electron/main.cjs');
  const DESKTOP = ['assets/build/icon-256.png', 'assets/build/icon.icns', 'assets/build/icon.ico'];
  const gen = read('assets/gen/gen_art.py');
  for (const f of DESKTOP) {
    ok(statSync(join(root, f)).size > 0, `${f} is 0 bytes`);
    ok(gen.includes(`'${f}'`), `${f} is shipped but the generator does not write it`);
  }
  eq([pkg.build.mac.icon, pkg.build.win.icon, pkg.build.linux.icon],
    ['assets/build/icon.icns', 'assets/build/icon.ico', 'assets/build/icon-256.png'],
    'every packaging target must point at an icon, not at Electron artwork');
  for (const p of [pkg.build.mac.icon, pkg.build.win.icon, pkg.build.linux.icon]) {
    ok(existsSync(join(root, p)), `package.json build points at ${p}, which is not on disk`);
  }
  ok(/icon: ICON/.test(shell) && /assets', 'build', 'icon-256\.png'/.test(shell), 'the window must be handed the repo icon');
  ok(/app\.dock[\s\S]{0,40}setIcon/.test(shell), 'a bare `electron .` on macOS needs the dock icon set explicitly');

  const master = pngHeader('assets/build/icon-256.png');
  eq([master.w, master.h], [256, 256], 'the window icon is what taskbars actually scale from');

  // ICNS: 'icns' + BE total, then per-entry fourcc + BE length + payload. The fourcc does not
  // carry the size, so the only real check is the IHDR inside each payload.
  const icns = buf('assets/build/icon.icns');
  eq(icns.subarray(0, 4).toString('ascii'), 'icns', 'not an ICNS');
  eq(icns.readUInt32BE(4), icns.length, 'ICNS header length disagrees with the file size');
  const icnsSizes = [];
  for (let i = 8; i < icns.length;) {
    const n = icns.readUInt32BE(i + 4);
    ok(n >= 8, `ICNS entry ${icns.subarray(i, i + 4).toString('ascii')} claims ${n} bytes`);
    const pay = icns.subarray(i + 8, i + n);
    if (pay.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') icnsSizes.push(pay.readUInt32BE(16));
    i += n;
  }
  eq(icnsSizes.sort((a, b) => a - b), [16, 32, 64, 128, 256, 512, 1024],
    'the ICNS must carry the whole retina ladder, one PNG per size');

  // ICO: 6-byte header, 16 bytes per entry, 256 encoded as 0.
  const ico = buf('assets/build/icon.ico');
  eq([ico.readUInt16LE(0), ico.readUInt16LE(2)], [0, 1], 'ICO must declare reserved=0, type=1 (icon)');
  const count = ico.readUInt16LE(4);
  ok(count >= 6, `ICO carries only ${count} sizes`);
  const icoSizes = [];
  for (let e = 0; e < count; e++) {
    const at = 6 + 16 * e;
    const w = ico.readUInt8(at) || 256;
    const h = ico.readUInt8(at + 1) || 256;
    const size = ico.readUInt32LE(at + 8);
    const off = ico.readUInt32LE(at + 12);
    ok(off + size <= ico.length, `ICO entry ${e} runs past the file`);
    const pay = ico.subarray(off, off + size);
    eq(pay.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `ICO entry ${e} is not a PNG`);
    eq([pay.readUInt32BE(16), pay.readUInt32BE(20)], [w, h], `ICO entry ${e} says ${w}x${h} in its directory`);
    icoSizes.push(w);
  }
  eq(icoSizes.sort((a, b) => a - b), [16, 24, 32, 48, 64, 128, 256], 'the ICO ladder is the one Windows asks for');
});

test('every image the shell points at exists, and the generator can reproduce it', () => {
  const html = read('index.html');
  const refs = [...html.matchAll(/(?:href|src|content)="((?:icons|assets)\/[^"]+)"/g)].map((m) => m[1]);
  ok(refs.length >= 5, `only ${refs.length} image references in the shell`);
  // js/view.js loads its texture layer by path; a typo there is invisible until the table is flat.
  const textures = [...read('js/view.js').matchAll(/'(assets\/art\/[^']+)'/g)].map((m) => m[1]);
  eq(textures.length, 3, 'the TEXTURES table should name felt, card and glow');
  for (const r of [...refs, ...textures]) ok(existsSync(join(root, r)), `the page references ${r}, which is not on disk`);
  const gen = read('assets/gen/gen_art.py');
  for (const f of IMAGES) ok(gen.includes(`'${f}'`), `${f} is shipped but not in the generator's ASSETS table`);
  ok(/def write_png|zlib\.compress/.test(gen), 'the generator must hand-write PNGs with stdlib only');
  ok(!/import PIL|import numpy|require\(/.test(gen), 'the generator must not need a dependency this repo does not have');
});

// 名字里的"can reproduce"必须真的重画一遍：只看生成器源码有没有点名这张图，
// 是字符串检查，图内容与源码分家时它照样绿。gen_art.py --verify 会把 19 张资产
// 逐字节重画并与盘上比（本机实测 12.8s，一次性的）。
test('the generator redraws every shipped image byte-for-byte', () => {
  const py = spawnSync('python3', [join(root, 'assets/gen/gen_art.py'), '--verify'], { encoding: 'utf8', timeout: 180000 });
  ok(!py.error, `python3 不在 PATH 上，资产可复现这条就无法复核：${py.error && py.error.code}`);
  eq(py.status, 0, `gen_art.py --verify 退出码 ${py.status}:\n${py.stdout}\n${py.stderr}`);
  const lines = py.stdout.split('\n');
  for (const f of [...IMAGES, 'assets/build/icon.icns', 'assets/build/icon.ico']) {
    const row = lines.find((l) => l.trim().startsWith(f));
    ok(row && row.includes('一致'), `${f} 没有"可复现"的读数：${row || '(生成器没提到它)'}`);
  }
});

test('the manifest and the worker describe the same installable app that is on disk', () => {
  const html = read('index.html');
  ok(/<link rel="manifest" href="manifest\.webmanifest">/.test(html), 'no manifest link');
  ok(/rel="apple-touch-icon"/.test(html), 'no apple-touch-icon link');
  ok(/property="og:image"/.test(html), 'no share card');
  const mf = JSON.parse(read('manifest.webmanifest'));
  ok(mf.start_url && mf.display && mf.name && mf.short_name, 'a manifest without start_url/display is not installable');
  ok(mf.icons.length >= 4, 'need 192/512 plus maskable variants');
  for (const icon of mf.icons) {
    ok(existsSync(join(root, icon.src)), `manifest promises ${icon.src}`);
    const { w, h } = pngHeader(icon.src);
    eq(icon.sizes, `${w}x${h}`, `${icon.src} is labelled ${icon.sizes}`);
    ok(/\d{3,}x\d{3,}/.test(icon.sizes), `${icon.src} is too small to install with`);
  }
  const pwa = read('js/pwa.js');
  ok(/navigator\.serviceWorker/.test(pwa) && /\.register\(/.test(pwa), 'nothing registers the worker');
  ok(/typeof sw\.register !== 'function'/.test(pwa),
    'a webview that hands back navigator.serviceWorker === null must be skipped, not thrown through startup');
  ok(/here !== 'http:' && here !== 'https:'/.test(pwa), 'file:// must skip registration');
  ok(/if \(!res\.ok\) return \{ ok: false, reason: `http /.test(pwa),
    'a 404 manifest must report its own status, not the icons check verdict');
  const sw = read('sw.js');
  ok(/caches\.open\(/.test(sw) && /VERSION/.test(sw), 'the worker must own a versioned cache');
  ok(/url\.origin !== self\.location\.origin/.test(sw), 'the worker must not intercept third-party requests');
});

test('the favicon is a real PNG file, not the empty data:, trick', () => {
  const html = read('index.html');
  ok(!/href="data:,"/.test(html), 'href="data:," is what the contract forbids');
  const links = [...html.matchAll(/<link rel="icon" href="([^"]+)" sizes="(\d+)x\2"[^>]*type="image\/png"/g)];
  ok(links.length >= 3, `only ${links.length} sized PNG favicon links`);
  for (const [, href, size] of links) {
    const { w } = pngHeader(href);
    eq(w, Number(size), `${href} is ${w}px but declared ${size}px`);
  }
});

test('js/core is pure: no window, no document, except the one guarded storage accessor', () => {
  for (const f of FILES.filter((x) => x.startsWith('js/core/'))) {
    const src = read(f);
    if (f.endsWith('storage.js')) {
      ok(/typeof localStorage === 'undefined'/.test(src) && /throw new Error/.test(src),
        'storage.js must guard localStorage AND throw, not return null');
      ok(/localStorage\.setItem/.test(src) && /localStorage\.getItem/.test(src),
        'a save that is written but never read back is not a save');
      ok(/JSON\.parse/.test(src) && /catch/.test(src) && /for \(/.test(src),
        'storage.js must decode in two stages: parse the envelope, then audit each record');
      ok(!/document\./.test(src), 'storage.js may read localStorage but never the DOM');
      continue;
    }
    ok(!/\bwindow\./.test(src), `${f} reaches for window`);
    ok(!/\bdocument\./.test(src), `${f} reaches for document`);
    ok(!/localStorage/.test(src), `${f} touches storage; that is storage.js's job`);
  }
});

test('the view never decides legality and the shell never draws', () => {
  const view = read('js/view.js');
  ok(!/from '\.\/core\/(solve|game)\.js'/.test(view), 'js/view.js must not import the rules');
  // It may *talk about* legality in a comment; what it must not do is call into it.
  ok(!/\bapplyAction\s*\(/.test(view) && !/\billegalReason\s*\(/.test(view) && !/\bact\s*\(/.test(view),
    'js/view.js should emit wants, not verdicts');
  const main = read('js/main.js');
  ok(!/getContext\('2d'\)/.test(main), 'js/main.js must not draw; that is js/view.js');
  ok(/window\.stair = window\.staircase =/.test(main), 'the test hook is attached in the shell');
});

test('the CI syntax step covers exactly the file set `npm run check` covers', () => {
  const ci = read('.github/workflows/ci.yml');
  const pkg = JSON.parse(read('package.json'));
  const globOf = (s) => [...s.matchAll(/[\w./]*\*\.[\w]+/g)].map((x) => x[0]).sort();
  eq(globOf(ci.match(/- name: Syntax\n\s+run: (.+)/)[1]), globOf(pkg.scripts.check),
    'CI and npm run check must disagree about nothing');
  ok(/SKIP_UNIT: 1/.test(ci), 'the browser job must not re-run the node suites');
  ok(ci.includes('node "$f"'), 'CI runs each test file, so a failing row fails the job');
});

test('pages.yml copies exactly what the page can reach, and nothing else', () => {
  const pages = read('.github/workflows/pages.yml');
  const build = pages.split('Assemble static site')[1].split('uses: actions/configure-pages')[0];
  ok(/cp index.html manifest\.webmanifest sw\.js _site\//.test(build), 'the install trio must be published');
  ok(/cp -r css js icons _site\//.test(build), 'css, js and icons must be published');
  ok(/cp -r assets\/art _site\/assets\//.test(build), 'the texture layer must be published');
  ok(!/path: \.\s*$/m.test(pages), 'never publish the whole repo as the site');
  ok(!/tools|test\/|server\.cjs|electron|assets\/gen/.test(build),
    'the build step must not carry tools/, tests, the server or the generator into the artifact');
  // Every path the copy names has to exist, or CI fails at `cp` instead of here.
  for (const p of ['index.html', 'manifest.webmanifest', 'sw.js', 'css', 'js', 'icons', 'assets/art']) {
    ok(existsSync(join(root, p)), `pages.yml copies ${p}, which is not in the repo`);
  }
});

test('this repo owns its own ports and says so', () => {
  const sh = read('tools/verify.sh');
  ok(/CDP_PORT=\$\{CDP_PORT:-9353\}/.test(sh), 'CDP port must be 9353');
  ok(/WEB_PORT=\$\{WEB_PORT:-5212\}/.test(sh), 'web port must be 5212');
  ok(/mktemp -d/.test(sh) && /trap cleanup EXIT/.test(sh), 'a shared Chrome profile is how orphan processes happen');
  ok(/wait \$CPID/.test(sh) && /wait \$SPID/.test(sh), 'the trap must reap both background PIDs');
  ok(/readiness is polled, not slept|json\/version/.test(sh), 'devtools readiness must be polled');
  // The launch line, not the prose: the comment above it is allowed to name the flags.
  const launch = sh.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
  ok(!/use-angle=swiftshader/.test(launch), 'software rasterisation saturates the cores and hangs the run');
  const driver = read('tools/playtest.mjs');
  ok(/waitShell/.test(driver) && !/Page\.navigate[\s\S]{0,120}sleep\(\d{4,}\)/.test(driver),
    'after navigation the shell is polled; a fixed sleep leaves the canvas at 300x150');
  ok(/json\.loads/.test(read('tools/verify.sh')) || /depth/.test(sh), 'the result JSON is cut by brace counting');
});

test('the display name is the same string in README and deliverable', () => {
  const readme = read('README.md').split('\n')[0];
  const report = read('deliverable.md').split('\n')[0];
  eq(readme, '# 保加利亚梯 · BULGARIAN');
  eq(report, '# 保加利亚梯 - 交付报告');
  const zh = readme.replace(/^# /, '').split(' · ')[0];
  const row = read('deliverable.md').split('\n').find((l) => l.includes('**App 名称**'));
  ok(row.includes(`| ${zh} |`), `App 名称 row says "${row}" but README says "${zh}"`);
});

test('LICENSE and .gitignore are the ones the series uses', () => {
  const lic = read('LICENSE');
  ok(lic.startsWith('MIT License'), 'LICENSE must be MIT');
  ok(/Copyright \(c\) 2026 z-biz-game/.test(lic));
  const gi = read('.gitignore').split('\n');
  ok(gi.includes('node_modules/') && gi.includes('_site/'), `gitignore is ${gi.join(' ')}`);
});

test('the shipped data file is generated, and says who generated it', () => {
  const lots = read('js/data/lots.js');
  ok(lots.startsWith('// Generated by tools/bake.mjs'), 'js/data/lots.js must declare its generator');
  ok(/export const LOTS = \[/.test(lots));
  ok(/export const TIERS_META =/.test(lots));
  const rows = lots.split('\n').filter((l) => l.startsWith('  {"id"'));
  ok(rows.length >= 24, `only ${rows.length} lots shipped`);
  for (const r of rows) {
    const obj = JSON.parse(r.trim().replace(/,$/, ''));
    ok(obj.spec && obj.spec.start && obj.spec.target, `${obj.id}: a lot without a serialised spec cannot be re-solved`);
    ok(typeof obj.par === 'number' && typeof obj.steps === 'number', `${obj.id}: missing measured numbers`);
  }
});

run();
