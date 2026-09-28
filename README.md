# Twig: version control for writers

**Inspired by:** "Build your own Git" from [codecrafters-io/build-your-own-x](https://github.com/codecrafters-io/build-your-own-x)

Twig takes Git's internals and points them at a different problem: drafting prose. A writer can branch an essay or story into alternate drafts ("darker ending", "shorter intro"), compare them paragraph by paragraph and word by word, and merge the best parts back together. Underneath, it is a real, from-scratch implementation of Git's core ideas. It is not a wrapper around a Git library.

## The problem

Writers already version their work, badly: `essay_final.docx`, `essay_final_v2_REAL.docx`. "Track changes" is linear, so you can't try two directions at once and then combine them. Git solves exactly this for code, but it's hostile to writers. It thinks in lines, speaks in hashes, and lives in a terminal.

Twig keeps Git's model and changes the surface:

| Git concept | What a writer sees in Twig |
|---|---|
| commit | Save version |
| branch | Draft |
| merge | Merge a draft in |
| merge conflict | "Both drafts rewrote this passage": pick one, keep both, or edit |
| line diff | Paragraph diff, with word-level highlights inside edited paragraphs |
| `git diff --stat` | +12 words −3 words |

## What's built from scratch (no libraries)

The full engine is in `core.js`, about 250 lines with no dependencies.

1. **SHA-1** is implemented by hand from the FIPS 180-4 spec, including message padding, the 80-word schedule, and the four round functions.
2. **Content-addressed object store.** Objects are named by SHA-1 of `"<type> <byte-length>\0<content>"`, exactly like Git. Blob hashes are byte-for-byte identical to `git hash-object`, and this is verified in the tests, including Unicode such as Tamil, Hindi and emoji. Identical text is stored once and shared between versions.
3. **Commits and the commit graph (DAG).** Each commit records its content hash, its parent(s), an author and a timestamp. Merge commits have two parents.
4. **Refs and HEAD.** Drafts are just pointers to commits. HEAD is either a draft name or, when you open an old version, a "detached" commit hash.
5. **LCS diff** (dynamic programming), with common-prefix/suffix trimming so the DP table stays small for typical edits. The same function diffs paragraphs and words.
6. **Merge base** finds the *best* common ancestor: the common ancestors that aren't ancestors of another common ancestor.
7. **3-way merge (diff3).** It finds lines that are stable in the base and both drafts, then resolves each gap between them. If only one side changed, it takes that side. If both made the same change, it takes it once. If they changed it differently, it records a conflict with Git-style `<<<<<<< / ======= / >>>>>>>` markers. It also handles fast-forward and already-up-to-date merges.
8. **Integrity check.** This re-hashes every stored object and reports any that don't match their names. It demonstrates *why* content addressing makes tampering detectable.
9. **Graph layout.** It assigns lanes by walking each draft's first-parent chain, then draws branch-off and merge curves as SVG.

## What's original (not in the Git tutorial)

- **Prose-aware diff.** Changed paragraphs are paired, then word-diffed inline, with deletions struck and insertions highlighted. If a paragraph was rewritten too heavily (less than 40% of words shared), it's shown as old and new blocks instead, because an inline diff would be unreadable.
- **Conflict resolution UI.** Each conflict is a card showing both drafts side by side, with Keep mine, Keep theirs, and Keep both buttons. Saving is blocked while any conflict markers remain.
- **Word-count deltas** replace line counts, because writers think in words.
- **"How Twig stored this version"** reveals the raw commit and blob objects, their headers, and their hashes. The app teaches its own internals.
- **A sample story** with branches arranged so that one merge is clean and the next one conflicts, so a judge sees both paths in under a minute.

## Try it (60-second demo path)

1. Open the app. The sample story loads with `main`, `darker-ending` and `hopeful-ending`.
2. **Merge a draft in → darker-ending.** The merge is clean because main changed paragraph 2 and darker-ending changed the last paragraph.
3. **Merge a draft in → hopeful-ending.** This conflicts because both endings rewrote the same paragraph. Resolve it with the card buttons, then click **Save merge**.
4. Edit any sentence and watch the word-level diff update live.
5. Click any version in the history, then open **How Twig stored this version**.
6. Click **Check integrity**.

## Testing

`test.js` (run with `node test.js`) checks the following:
- SHA-1 against Node's crypto for every input length from 0 to 299 bytes. This covers the padding edge cases at 55, 56 and 64 bytes.
- Blob hashes against the real `git hash-object`.
- 200 randomized diffs, each of which must reconstruct both inputs exactly.
- Clean merges, conflicts, insert-at-both-ends, and delete-vs-untouched cases in diff3.
- Merge base, two-parent merge commits, fast-forward, up-to-date, and tamper detection.

The UI was driven end to end in headless Chromium: merge, conflict, resolve, save, edit, persistence across reload, and mobile and dark mode.

## Honest simplifications

- **One file per repo.** Commits point straight at a blob, using a `content <hash>` line, rather than a tree object. Adding trees is the obvious next step toward multi-chapter projects.
- **No compression or packfiles.** Real Git zlib-compresses objects. Twig stores them as JSON in the browser's local storage.
- The merge-base search is O(n²) over common ancestors. That's fine for hundreds of versions, but not for Linux-kernel-sized histories.
- Diffs work on paragraphs (lines), so moving a paragraph shows up as a delete plus an add. Move detection would be a good extension.

## What I'd build next

- Tree objects so that one project can hold multiple chapters.
- Sentence-level merging, so two edits to different sentences of the same paragraph don't conflict.
- Moved-paragraph detection in diffs.
- Export and import of repos, and eventually syncing with a real Git remote, since the object format already matches.

## What I learned

*(Write this part in your own words. Judges can tell. Some prompts:)*
- Why does Git hash the header along with the content, and what would break if it didn't?
- What surprised you about how merge conflicts are *actually* detected?
- Why is a branch "just a pointer", and why does that make branching so cheap?
- Which bug or edge case taught you the most?
