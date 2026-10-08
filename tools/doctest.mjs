// tools/doctest.mjs — the doc-citation leg (zero deps), driven by test/repo.test.mjs.
//
// The three docs carry ~300 `path:NN` citations: the reader is told to go look at a specific line of
// a specific file. Editing the cited file shifts those numbers silently, so "the doc was true when it
// was written" and "the doc still points at real lines" are different claims — only a machine reading
// the citations back tells them apart.
//
// Range alone is not enough. A citation that lands inside the same file but one line sideways — on
// the neighbour statement instead of the one being described — passes every bounds check, and that is
// exactly the drift this family keeps hitting. So the second half: the name written *glued* to the
// citation, inside backticks, must literally appear in the lines it points at.
//
// Rules (the same rule set every other doc-citation leg in this fleet runs):
//   · only `path:NN` / `path:NN-MM` inside backticks are citations;
//   · five annotation shapes produce an anchor: `name`（`path:NN`）, `path:NN`（`name`）,
//     `path:NN` 的 `name`, `path:NN`（`fn(a, b)`）, `path:NN`（`dir/file.js::symbol`）;
//   · the `::` split happens BEFORE the `/` rejection, otherwise a directory-qualified symbol loses
//     its anchor;
//   · a body containing `<placeholder>` anchors on its literal prefix (`daily:<date>:<tier>` is about
//     the key `daily`), and only when a placeholder is really written — otherwise `test:docs` would
//     chop down to `test`;
//   · a body with spaces is a command line (`npm test`), not a name: anchoring on its first word is
//     a fabricated false red;
//   · a gap of pure punctuation (`，`, `、`) is NOT an assertion — the previous name is just the
//     previous list item;
//   · a citation whose lines are entirely whitespace is a MISS, not a hit — bounds and anchors both wave
//     an unannotated `path:NN` through when it lands on a blank stretch.
//   · an anchor matches a WHOLE identifier, not a substring: `ACTION` sitting on the line that declares
//     `ACTION_KINDS` is a miss. Substring matching is weaker than the hand-typed list it replaced, and a
//     short name would "appear inside" any identifier that happens to contain it.
//
// What this leg does NOT cover is written in README's 「没有覆盖」 column. It proves that printed line
// numbers still sit inside the lines they describe; it does not prove the sentences around them.
//
// Two ways to run it: `npm test` executes it through test/repo.test.mjs (one row per rule), and
// `node tools/doctest.mjs` prints this round's readings so the leg can be re-run on its own.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_DIRS = new Set(['.git', 'node_modules', '_scratch', '_site', '_tmp']);

const PATH_SRC = '[\\w./@-]+?\\.[A-Za-z][A-Za-z0-9]{0,11}'; // 后缀不许写死：写死成某一族的语言时，本腿在那种仓里是哑的，而「0 条引用」读起来和「全核过」一模一样
const CITE = new RegExp('^(' + PATH_SRC + '):([0-9]+(?:[,-][0-9]+)*)$');
// An anchor may be a member path (`view.cellCenter`) but never a file path: a body with `/` in it is
// another citation, and searching for it as a string in the cited lines only invents a false red.
const ID = /^[A-Za-z_$][A-Za-z0-9_$]{2,}(?:\.[A-Za-z_$][A-Za-z0-9_$]+)*$/;

export function tokOf(body) {
  const seg = body.includes('::') ? body.slice(body.lastIndexOf('::') + 2) : body;
  if (seg.includes('/')) return '';
  const tpl = /^([^<>]+?)<[^<>\s]+>/.exec(seg);
  if (tpl && ID.test(tpl[1].split(':')[0].trim())) return tpl[1].split(':')[0].trim();
  const head = seg.split('(')[0].trim();
  if (ID.test(head)) return head;
  const lhs = head.split(/[=:]\s/)[0].trim();
  return ID.test(lhs) ? lhs : '';
}

let tree = null;
function theTree() {
  if (tree) return tree;
  const out = [];
  (function dig(dir) {
    for (const name of fs.readdirSync(path.join(ROOT, dir))) {
      if (SKIP_DIRS.has(name)) continue;
      const rel = dir ? `${dir}/${name}` : name;
      if (fs.statSync(path.join(ROOT, rel)).isDirectory()) dig(rel);
      else out.push(rel);
    }
  })('');
  tree = out;
  return tree;
}

// Resolve a written path: exact match wins, else a bare filename is resolvable only when it is unique.
export function resolvePath(p) {
  const clean = p.replace(/^\.\//, '');
  if (fs.existsSync(path.join(ROOT, clean))) return clean;
  const hits = theTree().filter((f) => f === clean || f.endsWith('/' + clean));
  return hits.length === 1 ? hits[0] : null;
}

const lineCache = new Map();
export function linesOf(p) {
  const rel = resolvePath(p);
  if (!rel) return null;
  if (!lineCache.has(rel)) {
    const arr = fs.readFileSync(path.join(ROOT, rel), 'utf8').split('\n');
    if (arr[arr.length - 1] === '') arr.pop();
    lineCache.set(rel, arr);
  }
  return lineCache.get(rel);
}

export function parseRefs(text) {
  const spans = [];
  const spanRe = /`([^`\n]+)`/g;
  let m;
  while ((m = spanRe.exec(text))) spans.push({ body: m[1], s: m.index, end: m.index + m[0].length });
  const out = [];
  for (let i = 0; i < spans.length; i++) {
    const c = spans[i].body.match(CITE);
    if (!c) continue;
    let anchor = '';
    let consumed = false;
    const next = spans[i + 1];
    const gA = next ? text.slice(spans[i].end, next.s) : null;
    if (gA !== null && gA.length <= 4 && !gA.includes('\n')) {
      const gN = gA.replace(/\s+/g, '');
      if (/^[（(]/.test(gN) || gN === '的') { consumed = true; anchor = tokOf(next.body); }
    }
    // Backward only when the forward gap was not an annotation shape. Hanging it on `else if` of the
    // forward *condition* (instead of the *result*) silences the backward half for
    // 「`elapsed` 在 `js/main.js:1`、」 — a short forward gap that yields no anchor.
    if (!consumed && i > 0) {
      const prev = spans[i - 1];
      const gap = text.slice(prev.end, spans[i].s);
      const gT = gap.replace(/\s+/g, '');
      const shaped = /^[（(]/.test(gT) || /[\w一-鿿]/.test(gT);
      if (shaped && !/\s/.test(prev.body) && gap.length <= 4 && !gap.includes('\n')) anchor = tokOf(prev.body);
    }
    for (const seg of c[2].split(',')) {
      const parts = seg.split('-').map(Number);
      out.push({ path: c[1], from: parts[0], to: parts[parts.length - 1] || parts[0], anchor });
    }
  }
  return out;
}

// Whole word, not substring: `ACTION` "appears in" the line declaring `ACTION_KINDS`, and a short name
// matches inside any identifier that happens to contain it — so a substring matcher is weaker than the
// hand-typed list it replaces, and it turns a real drift into a green.
const wordCache = new Map();
function hasWord(text, name) {
  if (!wordCache.has(name)) {
    wordCache.set(name, new RegExp('(^|[^A-Za-z0-9_$])' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^A-Za-z0-9_$])'));
  }
  return wordCache.get(name).test(text);
}

export function audit(text) {
  const refs = parseRefs(text);
  const outOfRange = [];
  const anchorBad = [];
  for (const r of refs) {
    const label = `${r.path}:${r.from}${r.to !== r.from ? '-' + r.to : ''}`;
    const lines = linesOf(r.path);
    if (!lines) { outOfRange.push(`${label} 文件不存在或同名不唯一`); continue; }
    if (r.from < 1 || r.from > r.to || r.to > lines.length) {
      outOfRange.push(`${label} 越界（${label.split(':')[0]} 共 ${lines.length} 行）`);
      continue;
    }
    // "Inside the file" is not "pointing at code": an anchor-free citation whose lines are all whitespace
    // passed both checks above, so it was reading a gap between statements as a real reference. One
    // knife prints exactly one FAIL row, which is what makes "N fabricated cites caught" a coverage.
    if (lines.slice(r.from - 1, r.to).join('').trim() === '') {
      outOfRange.push(`${label} 那几行整段是空行`);
      continue;
    }
    if (r.anchor && !hasWord(lines.slice(r.from - 1, r.to).join('\n'), r.anchor)) {
      anchorBad.push(`${label} 那几行里没有 ${r.anchor}`);
    }
  }
  // `` `file`（N 行）`` is a measured value: it is collected with an equals sign, not a floor.
  const cntRe = new RegExp('`(' + PATH_SRC + ')`（([0-9]+) 行）', 'g');
  let k;
  while ((k = cntRe.exec(text))) {
    const lines = linesOf(k[1]);
    if (!lines) outOfRange.push(`${k[1]}（${k[2]} 行）文件不存在或同名不唯一`);
    else if (lines.length !== Number(k[2])) outOfRange.push(`${k[1]} 实测 ${lines.length} 行，文档写的是 ${k[2]}`);
  }
  return { refs, outOfRange, anchorBad };
}

// The input set is counted out of the directory, never typed: a hand-written list of docs silently
// shrinks the sample while the leg keeps printing "everything in range".
export function scan() {
  const docs = fs.readdirSync(ROOT).filter((f) => f.endsWith('.md') && fs.statSync(path.join(ROOT, f)).isFile());
  let docText = '';
  const outOfRange = [];
  const anchorBad = [];
  let refs = 0;
  for (const f of docs) {
    const t = fs.readFileSync(path.join(ROOT, f), 'utf8');
    docText += t + '\n';
    const a = audit(t);
    refs += a.refs.length;
    for (const b of a.outOfRange) outOfRange.push(`${f} · ${b}`);
    for (const b of a.anchorBad) anchorBad.push(`${f} · ${b}`);
  }
  const anchored = parseRefs(docText).filter((r) => r.anchor).length;
  const claims = [...docText.matchAll(/解析 (\d+) 条/g)].map((x) => Number(x[1]));
  const anchorClaims = [...docText.matchAll(/认到锚点 (\d+) 条/g)].map((x) => Number(x[1]));
  return { docs, docText, refs, anchored, outOfRange, anchorBad, claims, anchorClaims };
}

// ---- controls: the leg has to prove it can bite, and prove it is not biting on its own bugs ----

// Eight fabricated citations, one per failure mode. All eight must be caught by name. The eighth points
// at a BLANK line, and that line is measured here at run time instead of being hardcoded: write "16"
// down and the day someone fills that gap the knife silently stops testing anything — `blankAt > 0` in
// the pinned row turns that day into a red instead.
export function fakeCites() {
  const probe = linesOf('js/core/solve.js') || [];
  let blankAt = 0;
  for (let i = 1; i < probe.length; i++) if (String(probe[i]).trim() === '') { blankAt = i + 1; break; }
  // The last knife is the whole-word one: `ACTION` on the line declaring `ACTION_KINDS` can only ever be
  // a prefix, so this is the knife that dies first if the anchor check slides back to `.includes`.
  const f = audit('出处 `js/core/nope.js:1`、`js/core/solve.js:99999`、`NO_SUCH_NAME` 在 `js/core/solve.js:25`、' +
    '`package.json`（999 行）、`js/core/solve.js:25`（`ACTION_KINDS`）、`js/core/solve.js:25` 的 `ACTION_KINDS`、' +
    '`js/core/solve.js:25`（`Math.max(2, 3)`）' + (blankAt ? '、`js/core/solve.js:' + blankAt + '`' : '') +
    '、`js/core/solve.js:20`（`ACTION`）');
  const all = [...f.outOfRange, ...f.anchorBad];
  return { caught: all.length, list: all, refs: f.refs.length, blankAt };
}

// Positive controls: five real annotation shapes, a spaced command body and a real line count must all
// read GREEN under the same parser — otherwise the row above may just be a broken parser.
// The targets are lines of `js/core/solve.js`, which this leg never edits: a fixture that points inside
// its own file rots the moment the file grows.
export function realAnnotations() {
  const pkg = linesOf('package.json');
  const t = audit('`ACTION_KINDS`（`js/core/solve.js:20`）、`js/core/solve.js:20`（`ACTION_KINDS`）、' +
    '`js/core/solve.js:20` 的 `ACTION_KINDS`、`js/core/solve.js:97`（`solve(start, target, opts)`）、' +
    '`js/core/solve.js:134`（`js/core/solve.js::buildGraph`）、`js/core/solve.js:20`（`npm test`） 与 ' +
    '`package.json`（' + (pkg ? pkg.length : 0) + ' 行）');
  return { bad: [...t.outOfRange, ...t.anchorBad], refs: t.refs.length };
}

// `name:<placeholder>` anchors on the literal prefix: one green, one red.
export function templatePrefix() {
  const g = audit('`js/core/solve.js:20`（`ACTION_KINDS:<占位>`）');
  const r = audit('`js/core/solve.js:20`（`NOPE:<占位>`）');
  return { greenBad: g.anchorBad, redBad: r.anchorBad, refs: g.refs.length };
}

// A pure-punctuation gap is not an assertion: the name before it is only the previous list item.
// Anchoring on it would read a correct document red.
export function commaControl() {
  const t = audit('`NO_SUCH_NAME`，`js/core/solve.js:20`');
  return { bad: [...t.outOfRange, ...t.anchorBad], refs: t.refs.length };
}

// A real citation shifted one line sideways — still inside the file, so the bounds half cannot see it.
// The needle is chosen from the docs themselves and only mutated in memory; nothing on disk changes.
export function poisonNeedle() {
  const s = scan();
  const anchored = parseRefs(s.docText).filter((r) => r.anchor);
  let picked = null;
  for (const r of anchored) {
    const lines = linesOf(r.path) || [];
    const to = r.to + 1;
    if (to > lines.length) continue;
    const label = `${r.path}:${r.from}${r.to !== r.from ? '-' + r.to : ''}`;
    const shifted = `${r.path}:${r.from + 1}-${to}`;
    const poisoned = audit(s.docText.split('`' + label + '`').join('`' + shifted + '`'));
    if (poisoned.anchorBad.length >= 1) { picked = { label, shifted, anchor: r.anchor, bad: poisoned.anchorBad }; break; }
  }
  return { anchored: anchored.length, picked };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const s = scan();
  console.log(`docs scanned: ${s.docs.length} files · citations parsed: ${s.refs} · anchored: ${s.anchored}`);
  console.log(`out of range: ${s.outOfRange.length}${s.outOfRange.length ? '\n  ' + s.outOfRange.join('\n  ') : ''}`);
  console.log(`anchor misses: ${s.anchorBad.length}${s.anchorBad.length ? '\n  ' + s.anchorBad.join('\n  ') : ''}`);
  console.log(`printed claims: 解析 ${s.claims.join('/')} · 认到锚点 ${s.anchorClaims.join('/')} (counted ${s.refs}/${s.anchored})`);
  const n = poisonNeedle();
  console.log(`poison needle: anchored=${n.anchored} picked=${n.picked ? n.picked.bad.join(' | ') : 'NONE'}`);
}
