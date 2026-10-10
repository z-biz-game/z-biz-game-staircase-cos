// The repo itself as a gate: zero dependencies, no binary assets, the three layers not bleeding
// into each other, CI's syntax step being the one `npm run check` whose globs reach every source
// file, and the two places the display name is written agreeing. Every row here is a claim someone
// could otherwise make in a README without anything checking it.

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

test('the CI syntax step IS `npm run check`, and that leg reaches every source file', () => {
  const ci = read('.github/workflows/ci.yml');
  const pkg = JSON.parse(read('package.json'));
  // 这道闸以前比的是「CI 手抄的那份通配 == package.json 里那份通配」，比的是两份抄本别漂。
  // 现在 CI 只有 `run: npm run check` 一行，没有第二份抄本可比了——所以断言换成两件仍然
  // 会坏的事：① CI 那一步必须真的是调用那条 leg（谁把手抄加回来就红），② 那条 leg 自己的
  // 通配必须盖住树上每一个源码文件（漏掉一个目录=那个目录从此没人检语法），而且每条通配
  // 都必须真的扫到东西（指向已删目录的死通配不会让任何一道闸红，除非在这里数一遍）。
  ok(/- name: Syntax\n\s+run: npm run check/.test(ci),
    'CI 的 Syntax 步骤必须是 `npm run check` 本身，不是它的手抄副本');
  const patterns = pkg.scripts.check.match(/for f in ([^;]+);/)[1].trim().split(/\s+/);
  const toRe = (p) => new RegExp('^' + p.replace(/[.+]/g, '\\$&').replace(/\*/g, '[^/]*') + '$');
  const sources = FILES.filter((f) => /\.(js|mjs|cjs)$/.test(f));
  const uncovered = sources.filter((f) => !patterns.some((p) => toRe(p).test(f)));
  const dead = patterns.filter((p) => !sources.some((f) => toRe(p).test(f)));
  eq(uncovered, [], `npm run check 的通配漏掉的源码文件（树上一共 ${sources.length} 个）`);
  eq(dead, [], `npm run check 里一条文件都扫不到的死通配（通配共 ${patterns.length} 条）`);
  ok(sources.length >= 20 && patterns.length >= 5,
    `防空转：树上 ${sources.length} 个源码文件、leg ${patterns.length} 条通配，两个数都太小就是扫描自己坏了`);
  ok(/SKIP_UNIT: 1/.test(ci), 'the browser job must not re-run the node suites');
  ok(/- name: Suites\n\s+run: npm run unit/.test(ci) && /\bnode "\$f"/.test(pkg.scripts.unit || '') && /exit 1/.test(pkg.scripts.unit || ''), 'CI 调 `npm run unit`，而那条 leg 自己逐个 node 每个测试文件、任一非零立即退（把手抄 loop 加回 CI 不会让它更真）');
});

test('pages.yml copies exactly what the page can reach, and nothing else', () => {
  const pages = read('.github/workflows/pages.yml');
  const list = read('tools/assemble-site.sh').split('\n').filter((l) => /^\s*(cp |for d in )/.test(l)).join('\n');
  ok(/run: bash tools\/assemble-site\.sh _site/.test(pages), 'workflow 只调那一份清单，不再手抄 cp 行');
  ok(/cp index\.html manifest\.webmanifest sw\.js/.test(list) && /cp -r css js/.test(list), '清单里就是 index.html + manifest + sw + css/ js');
  ok(!/tools\/|test\/|server\.cjs|electron/.test(list), 'the list must not carry tools/, tests or the server into the artifact');
  ok(!/path: \.\s*$/m.test(pages), 'never publish the whole repo as the site');
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

// ~240 `path:NN` citations across the three docs tell the reader to go look at a specific line of a
// specific file. Editing the cited file shifts them silently, so "the doc was true when written" and
// "the doc still points at real lines" are different claims. Bounds alone are not enough: a citation
// that lands inside the same file but one line sideways — on the neighbour statement instead of the one
// being described — passes every bounds check, and that is the drift this family keeps hitting. So the
// name written glued to the citation, inside backticks, has to really appear in the lines it points at.
// The parser and its controls live in tools/doctest.mjs; the rows below are what this suite bites on.
// (Imported here rather than at the top: 12 rows above this block are cited by line range in README,
// and an import line would shift every one of them.)
const D = await import('../tools/doctest.mjs');

test('every `path:NN` citation in the docs points at a real file and stays inside it', () => {
  // The input set is counted out of the directory, never typed: a hand-written list of docs silently
  // shrinks the sample while the leg keeps printing "everything in range".
  const s = D.scan();
  eq(s.docs, readdirSync(root).filter((f) => f.endsWith('.md')),
    'the audited doc set must be exactly the markdown files sitting at the repo root');
  ok(s.refs >= 200, `只扫到 ${s.refs} 条引用——少于 200 就是这条腿自己没读进文档，不是文档变干净了`);
  eq(s.outOfRange, [], `${s.outOfRange.length}/${s.refs} 条引用不在盘上、同名不唯一或漂出文件末尾`);
});

test('the name glued to a citation really appears in the lines it points at', () => {
  const s = D.scan();
  ok(s.anchored >= 12, `只有 ${s.anchored} 条引用带着指认——锚点这半边等于没跑`);
  eq(s.anchorBad, [], `${s.anchorBad.length}/${s.anchored} 条带指认的引用漂到了隔壁一行`);
});

test('the readings this leg prints are the readings the docs print', () => {
  // The docs transcribe 解析 N 条 / 认到锚点 N 条. Requiring them to equal this leg's own counts is
  // what stops the number from rotting; deleting the number must also read red, otherwise "no claim"
  // would pass as "no error".
  const s = D.scan();
  ok(s.claims.length >= 1 && s.claims.every((c) => c === s.refs),
    `文档里「解析 N 条」写了 ${s.claims.length} 处：${s.claims.join('/') || '（一处都没写）'} · 闸数到 ${s.refs}`);
  ok(s.anchorClaims.length >= 1 && s.anchorClaims.every((c) => c === s.anchored),
    `文档里「认到锚点 N 条」写了 ${s.anchorClaims.length} 处：${s.anchorClaims.join('/') || '（一处都没写）'} · 闸数到 ${s.anchored}`);
});

test('nine fabricated citations are all caught, each by its own failure mode', () => {
  const f = D.fakeCites();
  const mode = (re) => f.list.filter((x) => re.test(x)).length;
  // The last slot of the pinned array is "the blank line really was found" — if someone fills that gap,
  // blankAt goes to 0 and the fabricated set drops to eight, so this row reddens instead of quietly
  // losing a knife. The slot before it counts the whole-word knife on its own: `ACTION\b` can only hit
  // the prefix cite (the `ACTION_KINDS` rows are followed by `_`), so a matcher that slides back to
  // `.includes` shows up as 9→8 and 1→0 rather than as a row that still says "all caught".
  eq([f.caught, mode(/文件不存在/), mode(/越界/), mode(/实测/), mode(/那几行里没有/), mode(/整段是空行/), mode(/里没有 ACTION\b/), f.blankAt > 0],
    [9, 1, 1, 1, 5, 1, 1, true],
    `九把假引用（不存在 / 越界 / 行数错 / 后向锚点漂 / 前向括号漂 / 「的」漂 / 调用形式漂 / 无锚点落在空行第 ${f.blankAt} 行 / 前缀不算整词）交回 ${f.caught} 把`);
});

test('five real annotation shapes, a spaced command body and a true line count read green', () => {
  // Without this the row above could be red because the parser itself broke, not because a citation was.
  const r = D.realAnnotations();
  eq(r.bad, [], '真引用被自己的解析器判红了');
  ok(r.refs === 6, `正样本应当解析到 6 条引用（第 7 处是「N 行」那种等值断言，不是引用），实到 ${r.refs}`);
});

test('a `<placeholder>` body anchors on its literal prefix', () => {
  const t = D.templatePrefix();
  eq(t.greenBad, [], '前缀对得上的模板 body 被自己的锚点判红了');
  eq(t.redBad.length, 1, `前缀对不上的模板 body 必须红，红在 ${t.redBad.join(' | ') || '（一处都没红）'}`);
});

test('a punctuation gap is not an assertion', () => {
  // The name before `，` is just the previous list item; pinning on it reads a correct document red.
  const c = D.commaControl();
  eq(c.bad, [], '逗号那种写法被判红了：' + c.bad.join(' | '));
  ok(c.refs === 1, `应当只解析到 1 条引用，实到 ${c.refs}`);
});

test('moving a real in-range citation one line sideways turns this leg red', () => {
  // The needle is chosen from the docs and mutated in memory only — the files on disk are untouched.
  // If no citation in the docs bites when shifted, the anchor half is decoration, not a gate.
  const n = D.poisonNeedle();
  ok(n.picked, `文档里 ${n.anchored} 条带指认的引用，没有一条挪歪一格会红——锚点这半边是摆设`);
  if (n.picked) {
    ok(n.picked.bad.length >= 1 && n.picked.bad[0].includes(n.picked.anchor),
      `毒针 ${n.picked.label} → ${n.picked.shifted} 没有点到 ${n.picked.anchor}：${n.picked.bad.join(' | ') || '没红'}`);
  }
});

run();
