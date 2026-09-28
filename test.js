const c = require('./core.js');
const { execSync } = require('child_process');
const crypto = require('crypto');
let fail = 0; const ok = (cond, msg) => { if (!cond) { fail++; console.log('FAIL', msg); } };

// 1. SHA-1 against node crypto on random inputs of many lengths (padding edge cases 55,56,63,64...)
for (let len = 0; len < 300; len++) {
  const b = crypto.randomBytes(len);
  ok(c.sha1Bytes(new Uint8Array(b)) === crypto.createHash('sha1').update(b).digest('hex'), 'sha1 len ' + len);
}
// 2. Blob hashes identical to real git, including unicode
for (const s of ['hello', '', 'line1\nline2\n', 'नमस्ते வணக்கம் 🌿', 'x'.repeat(1000)]) {
  require('fs').writeFileSync('/tmp/b.txt', s);
  const g = execSync('git hash-object /tmp/b.txt').toString().trim();
  ok(c.hashObject('blob', s) === g, 'git blob ' + JSON.stringify(s.slice(0, 10)));
}
// 3. diff reconstructs
for (let t = 0; t < 200; t++) {
  const A = Array.from({ length: Math.random() * 15 | 0 }, () => 'abc'[Math.random() * 3 | 0]);
  const B = Array.from({ length: Math.random() * 15 | 0 }, () => 'abc'[Math.random() * 3 | 0]);
  const ops = c.diffSeq(A, B);
  ok(JSON.stringify(ops.filter(o => o.t !== 'add').map(o => o.v)) === JSON.stringify(A), 'diff old');
  ok(JSON.stringify(ops.filter(o => o.t !== 'del').map(o => o.v)) === JSON.stringify(B), 'diff new');
}
// 4. diff3
const base = ['p1', '', 'p2', '', 'p3', '', 'end'];
let r = c.diff3Merge(base, ['p1', '', 'P2 edited', '', 'p3', '', 'end'], ['p1', '', 'p2', '', 'p3', '', 'END dark'], 'main', 'dark');
ok(r.conflicts === 0 && r.lines.join('|') === 'p1||P2 edited||p3||END dark', 'clean merge ' + r.lines.join('|'));
r = c.diff3Merge(base, ['p1', '', 'p2', '', 'p3', '', 'END hope'], ['p1', '', 'p2', '', 'p3', '', 'END dark'], 'main', 'dark');
ok(r.conflicts === 1, 'conflict');
console.log(r.lines.join('\n'));
const txt = r.lines.join('\n');
ok(c.resolveConflict(txt, 0, 'theirs').endsWith('END dark') && !c.resolveConflict(txt, 0, 'theirs').includes('<<<'), 'resolve');
ok(c.resolveConflict(txt, 0, 'both').endsWith('END hope\nEND dark'), 'resolve both');
// insertions on both sides at different spots
r = c.diff3Merge(['a', 'b', 'c'], ['x', 'a', 'b', 'c'], ['a', 'b', 'c', 'y'], 'o', 't');
ok(r.lines.join('') === 'xabcy' && !r.conflicts, 'inserts ' + r.lines.join(''));
// deletion vs untouched
r = c.diff3Merge(['a', 'b', 'c'], ['a', 'c'], ['a', 'b', 'c', 'd'], 'o', 't');
ok(r.lines.join('') === 'acd' && !r.conflicts, 'delete ' + r.lines.join(''));

// 5. Repo flow
const repo = new c.Repo();
const c1 = repo.commit('A\n\nB\n\nC', 'first', 1);
const c2 = repo.commit('A\n\nB\n\nC tight', 'second', 2);
repo.createBranch('dark');
const d1 = repo.commit('A\n\nB\n\nC tight DARK', 'dark end', 3);
repo.head = { type: 'ref', name: 'main' };
const c3 = repo.commit('A\n\nB fixed\n\nC tight', 'fix B', 4);
repo.createBranch('hope');
repo.commit('A\n\nB fixed\n\nC tight HOPE', 'hope end', 5);
repo.head = { type: 'ref', name: 'main' };
ok(repo.mergeBase(c3, d1) === c2, 'merge base');
let m = repo.merge('dark');
ok(m.kind === 'clean' && m.text === 'A\n\nB fixed\n\nC tight DARK', 'repo clean ' + JSON.stringify(m));
const mc = repo.commit(m.text, 'merge dark', 6);
ok(repo.objects[mc].parents.length === 2, 'two parents');
m = repo.merge('hope');
ok(m.kind === 'conflict', 'repo conflict ' + m.kind);
repo.mergeHead = null;
ok(repo.merge('dark').kind === 'uptodate', 'uptodate');
// fast forward: new branch ahead of main
repo.mergeHead = null;
repo.createBranch('ff'); repo.commit('zzz', 'ff', 7); repo.head = { type: 'ref', name: 'main' };
ok(repo.merge('ff').kind === 'fastforward' && repo.headText() === 'zzz', 'ff');
ok(repo.verify().bad.length === 0, 'verify');
repo.objects[c1].raw = 'tampered'; ok(repo.verify().bad.includes(c1), 'tamper detect');
console.log(fail ? fail + ' failures' : 'ALL PASS', repo.verify().total, 'objects');
