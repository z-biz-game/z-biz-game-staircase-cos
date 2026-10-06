// The repo itself as a gate: zero dependencies, no binary assets, the three layers not bleeding
// into each other, CI's syntax step being the one `npm run check` whose globs reach every source
// file, and the two places the display name is written agreeing. Every row here is a claim someone
// could otherwise make in a README without anything checking it.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { test, run, eq, ok } from '../tools/harness.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');

function walk(dir, out = []) {
  for (const name of readdirSync(join(root, dir))) {
    const rel = join(dir, name);
    const st = statSync(join(root, rel));
    if (st.isDirectory()) walk(rel, out);
    else out.push(rel);
  }
  return out;
}

const FILES = [...walk('js'), ...walk('css'), ...walk('tools'), ...walk('test'), ...walk('electron'),
  'index.html', 'server.cjs', 'package.json', 'README.md', 'DESIGN.md', 'deliverable.md', 'LICENSE', '.gitignore']
  .filter((f) => !f.endsWith('.DS_Store'));

test('package.json really has zero dependencies and zero devDependencies', () => {
  const pkg = JSON.parse(read('package.json'));
  eq(pkg.dependencies, {});
  eq(pkg.devDependencies, {});
  eq(pkg.type, 'module');
  eq(pkg.main, 'electron/main.cjs');
  ok(pkg.scripts.check.includes('node --check'));
  ok(pkg.scripts.verify.includes('tools/verify.sh'));
});

test('the repo has no binary assets of any kind', () => {
  const BANNED = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.mp3', '.wav', '.ogg', '.woff', '.woff2', '.ttf', '.eot', '.pdf', '.zip'];
  const hits = FILES.filter((f) => BANNED.includes(extname(f).toLowerCase()));
  eq(hits, [], 'these assets should not exist');
  // And nothing is pretending to be an asset by being untextably large.
  const big = FILES.filter((f) => statSync(join(root, f)).size > 400000);
  eq(big, [], 'a shipped file over 400kB needs a reason and a generator');
});

test('the favicon is an inline SVG data URI, not the empty data:, trick', () => {
  const html = read('index.html');
  const m = html.match(/<link rel="icon" href="([^"]+)"/);
  ok(m, 'index.html must carry a favicon link');
  ok(m[1].startsWith('data:image/svg+xml,'), `favicon is ${m[1].slice(0, 32)}`);
  ok(!/href="data:,"/.test(html), 'href="data:," is what the contract forbids');
  ok(!/<img|\.png|\.jpg/i.test(html), 'no image references in the shell');
});

test('js/core is pure: no window, no document, except the one guarded storage accessor', () => {
  for (const f of FILES.filter((x) => x.startsWith('js/core/'))) {
    const src = read(f);
    if (f.endsWith('storage.js')) {
      ok(/typeof window === 'undefined'/.test(src) && /throw new Error/.test(src),
        'storage.js must guard window.localStorage AND throw, not return null');
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

test('pages.yml copies only what the page can reach', () => {
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

run();
