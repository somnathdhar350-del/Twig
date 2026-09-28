/* ================= Twig core: a tiny Git, written from scratch ================= */

/* ---- SHA-1 (FIPS 180-4), implemented by hand so objects hash exactly like Git's ---- */
function utf8(str) { return new TextEncoder().encode(str); }

function sha1Bytes(bytes) {
  const ml = bytes.length;
  const total = Math.ceil((ml + 9) / 64) * 64;          // message + 0x80 + 64-bit length, padded to 512 bits
  const buf = new Uint8Array(total);
  buf.set(bytes);
  buf[ml] = 0x80;
  const dv = new DataView(buf.buffer);
  const bitLen = ml * 8;
  dv.setUint32(total - 8, Math.floor(bitLen / 0x100000000));
  dv.setUint32(total - 4, bitLen >>> 0);

  let h0 = 0x67452301, h1 = 0xEFCDAB89, h2 = 0x98BADCFE, h3 = 0x10325476, h4 = 0xC3D2E1F0;
  const w = new Uint32Array(80);
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 80; i++) { const x = w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16]; w[i] = (x << 1) | (x >>> 31); }
    let a = h0, b = h1, c = h2, d = h3, e = h4;
    for (let i = 0; i < 80; i++) {
      let f, k;
      if (i < 20)      { f = (b & c) | (~b & d);          k = 0x5A827999; }
      else if (i < 40) { f = b ^ c ^ d;                   k = 0x6ED9EBA1; }
      else if (i < 60) { f = (b & c) | (b & d) | (c & d); k = 0x8F1BBCDC; }
      else             { f = b ^ c ^ d;                   k = 0xCA62C1D6; }
      const t = (((a << 5) | (a >>> 27)) + f + e + k + w[i]) >>> 0;
      e = d; d = c; c = ((b << 30) | (b >>> 2)) >>> 0; b = a; a = t;
    }
    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0; h4 = (h4 + e) >>> 0;
  }
  return [h0, h1, h2, h3, h4].map(x => x.toString(16).padStart(8, '0')).join('');
}

/* Git hashes "<type> <byte length>\0<content>", not just the content */
function hashObject(type, content) {
  const body = utf8(content);
  const header = utf8(`${type} ${body.length}\0`);
  const all = new Uint8Array(header.length + body.length);
  all.set(header); all.set(body, header.length);
  return sha1Bytes(all);
}

/* ---- Longest common subsequence diff (works on any array: lines or words) ---- */
function lcsMatches(a, b) {
  const n = a.length, m = b.length;
  let pre = 0; while (pre < n && pre < m && a[pre] === b[pre]) pre++;
  let suf = 0; while (suf < n - pre && suf < m - pre && a[n - 1 - suf] === b[m - 1 - suf]) suf++;
  const N = n - pre - suf, M = m - pre - suf;
  const pairs = [];
  for (let k = 0; k < pre; k++) pairs.push([k, k]);
  if (N > 0 && M > 0) {
    // dp[i][j] = LCS length of a[pre+i..] and b[pre+j..]
    const dp = new Array(N + 1);
    for (let i = 0; i <= N; i++) dp[i] = new Int32Array(M + 1);
    for (let i = N - 1; i >= 0; i--) {
      const ai = a[pre + i], row = dp[i], next = dp[i + 1];
      for (let j = M - 1; j >= 0; j--) {
        row[j] = ai === b[pre + j] ? next[j + 1] + 1 : (next[j] >= row[j + 1] ? next[j] : row[j + 1]);
      }
    }
    let i = 0, j = 0;
    while (i < N && j < M) {
      if (a[pre + i] === b[pre + j]) { pairs.push([pre + i, pre + j]); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
      else j++;
    }
  }
  for (let k = 0; k < suf; k++) pairs.push([n - suf + k, m - suf + k]);
  return pairs;
}

function diffSeq(a, b) {
  const ops = [];
  let i = 0, j = 0;
  for (const [pi, pj] of lcsMatches(a, b)) {
    while (i < pi) ops.push({ t: 'del', v: a[i++] });
    while (j < pj) ops.push({ t: 'add', v: b[j++] });
    ops.push({ t: 'eq', v: a[i] }); i++; j++;
  }
  while (i < a.length) ops.push({ t: 'del', v: a[i++] });
  while (j < b.length) ops.push({ t: 'add', v: b[j++] });
  return ops;
}

function splitLines(text) { return text === '' ? [] : text.split('\n'); }
function words(text) { return text.split(/\s+/).filter(Boolean); }

/* Writer-friendly summary: how many words came and went */
function wordStats(oldText, newText) {
  let added = 0, removed = 0;
  for (const op of diffSeq(words(oldText), words(newText))) {
    if (op.t === 'add') added++; else if (op.t === 'del') removed++;
  }
  return { added, removed };
}

/* ---- 3-way merge (diff3): find lines stable in base, ours and theirs; resolve the gaps ---- */
function sameArr(x, y) { return x.length === y.length && x.every((v, i) => v === y[i]); }

function diff3Merge(base, ours, theirs, oursLabel, theirsLabel) {
  const ma = new Map(lcsMatches(base, ours));
  const mb = new Map(lcsMatches(base, theirs));
  const out = [];
  let conflicts = 0, i = 0, ai = 0, bi = 0;
  while (true) {
    let k = i;
    while (k < base.length && !(ma.has(k) && mb.has(k))) k++;       // next stable line
    const ea = k < base.length ? ma.get(k) : ours.length;
    const eb = k < base.length ? mb.get(k) : theirs.length;
    const O = base.slice(i, k), A = ours.slice(ai, ea), B = theirs.slice(bi, eb);
    if (O.length || A.length || B.length) {
      if (sameArr(A, O)) out.push(...B);            // only theirs changed
      else if (sameArr(B, O)) out.push(...A);       // only ours changed
      else if (sameArr(A, B)) out.push(...A);       // both made the same change
      else {                                        // both changed differently: conflict
        conflicts++;
        out.push(`<<<<<<< ${oursLabel}`, ...A, '=======', ...B, `>>>>>>> ${theirsLabel}`);
      }
    }
    if (k >= base.length) break;
    out.push(base[k]);
    i = k + 1; ai = ea + 1; bi = eb + 1;
  }
  return { lines: out, conflicts };
}

/* Find conflict blocks written by diff3Merge in a text */
function findConflicts(text) {
  const lines = text.split('\n'), blocks = [];
  let cur = null;
  lines.forEach((ln, idx) => {
    if (ln.startsWith('<<<<<<< ')) cur = { start: idx, oursLabel: ln.slice(8), ours: [], theirs: [], side: 'ours' };
    else if (cur && ln === '=======' && cur.side === 'ours') { cur.side = 'theirs'; }
    else if (cur && ln.startsWith('>>>>>>> ')) { cur.end = idx; cur.theirsLabel = ln.slice(8); blocks.push(cur); cur = null; }
    else if (cur) cur[cur.side].push(ln);
  });
  return blocks;
}

function resolveConflict(text, index, choice) {
  const blocks = findConflicts(text);
  const b = blocks[index];
  if (!b) return text;
  const lines = text.split('\n');
  const repl = choice === 'ours' ? b.ours : choice === 'theirs' ? b.theirs : [...b.ours, ...b.theirs];
  lines.splice(b.start, b.end - b.start + 1, ...repl);
  return lines.join('\n');
}

/* ---- The repository: content-addressed objects + refs + HEAD ---- */
class Repo {
  constructor(state) {
    state = state || {};
    this.objects = state.objects || {};                 // hash -> object
    this.refs = state.refs || {};                       // draft name -> commit hash
    this.head = state.head || { type: 'ref', name: 'main' };
    this.mergeHead = state.mergeHead || null;           // set while a merge is in progress
    this.seq = state.seq || 0;
    this.order = state.order || {};                     // commit -> creation sequence (for layout)
  }
  toJSON() {
    return { objects: this.objects, refs: this.refs, head: this.head, mergeHead: this.mergeHead, seq: this.seq, order: this.order };
  }

  writeBlob(text) {
    const h = hashObject('blob', text);
    if (!this.objects[h]) this.objects[h] = { type: 'blob', raw: text };
    return h;
  }

  writeCommit({ content, parents, message, author, time }) {
    const lines = [`content ${content}`];
    parents.forEach(p => lines.push(`parent ${p}`));
    lines.push(`author ${author} ${time} +0530`, '', message);
    const raw = lines.join('\n');
    const h = hashObject('commit', raw);
    if (!this.objects[h]) {
      this.objects[h] = { type: 'commit', raw, content, parents, message, author, time };
      this.order[h] = ++this.seq;
    }
    return h;
  }

  headCommit() { return this.head.type === 'ref' ? (this.refs[this.head.name] || null) : this.head.hash; }
  textOf(commit) { return commit ? this.objects[this.objects[commit].content].raw : ''; }
  headText() { return this.textOf(this.headCommit()); }
  commits() { return Object.keys(this.objects).filter(h => this.objects[h].type === 'commit'); }

  moveHead(h) {
    if (this.head.type === 'ref') this.refs[this.head.name] = h;
    else this.head = { type: 'detached', hash: h };
  }

  commit(text, message, time) {
    const content = this.writeBlob(text);
    const parents = [];
    const hc = this.headCommit();
    if (hc) parents.push(hc);
    if (this.mergeHead) parents.push(this.mergeHead);
    const h = this.writeCommit({ content, parents, message, author: 'writer', time: time ?? Math.floor(Date.now() / 1000) });
    this.moveHead(h);
    this.mergeHead = null;
    return h;
  }

  createBranch(name) {
    if (!/^[A-Za-z][\w.-]{0,39}$/.test(name)) throw new Error('Draft names start with a letter and use letters, numbers, dots, dashes or underscores.');
    if (this.refs[name] !== undefined) throw new Error(`A draft called "${name}" already exists.`);
    const hc = this.headCommit();
    if (!hc) throw new Error('Save a first version before starting a new draft.');
    this.refs[name] = hc;
    this.head = { type: 'ref', name };
  }

  ancestors(h) {
    const seen = new Set(), stack = [h];
    while (stack.length) {
      const x = stack.pop();
      if (!x || seen.has(x)) continue;
      seen.add(x);
      stack.push(...this.objects[x].parents);
    }
    return seen;
  }

  /* Best common ancestor: a common ancestor that is not an ancestor of another common ancestor */
  mergeBase(a, b) {
    const A = this.ancestors(a), B = this.ancestors(b);
    const common = [...A].filter(x => B.has(x));
    const best = common.filter(c => !common.some(o => o !== c && this.ancestors(o).has(c)));
    best.sort((x, y) => this.order[y] - this.order[x]);
    return best[0] || null;
  }

  merge(branch) {
    const ours = this.headCommit(), theirs = this.refs[branch];
    if (!theirs) throw new Error(`"${branch}" has no saved versions yet.`);
    if (!ours) { this.moveHead(theirs); return { kind: 'fastforward' }; }
    const base = this.mergeBase(ours, theirs);
    if (base === theirs) return { kind: 'uptodate' };
    if (base === ours) { this.moveHead(theirs); return { kind: 'fastforward' }; }
    const oursName = this.head.type === 'ref' ? this.head.name : ours.slice(0, 7);
    const r = diff3Merge(splitLines(this.textOf(base)), splitLines(this.textOf(ours)), splitLines(this.textOf(theirs)), oursName, branch);
    this.mergeHead = theirs;
    return { kind: r.conflicts ? 'conflict' : 'clean', text: r.lines.join('\n'), conflicts: r.conflicts, base };
  }

  verify() {
    const bad = [];
    for (const [h, o] of Object.entries(this.objects)) if (hashObject(o.type, o.raw) !== h) bad.push(h);
    return { total: Object.keys(this.objects).length, bad };
  }
}

if (typeof module !== 'undefined') module.exports = { sha1Bytes, hashObject, lcsMatches, diffSeq, splitLines, wordStats, diff3Merge, findConflicts, resolveConflict, Repo, utf8 };
