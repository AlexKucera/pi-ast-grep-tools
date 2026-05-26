# PR #2 Review Comments — Fix All Feedback

> **Date:** 2026-05-26
> **Type:** issue
> **Reference:** [PR #2](https://github.com/davehardy20/pi-ast-grep-tools/pull/2)

## Goal

Address all code review comments on PR #2 ("Adds editable hashline output and expanded language support to `ast_grep_search`") across critical, warning, and suggestion severity levels. The PR had 15 distinct review items from 2 reviews (1 detailed, 1 summary) plus 5 inline comments.

## What Was Done

### 🔴 Critical Fixes (2)

- **Package scope `@yourgpt` → `@davehardy20`** in `package.json` — Fixed name, repository URL, bugs URL, and homepage all to use `davehardy20` org instead of `yourgpt`. This was a breaking change for existing consumers.
- **Hardcoded local macOS paths in smoke tests** — Replaced `/Users/alex/Projects/scripting/tinkertoys/...` and `/Users/alex/Projects/ios_development/...` paths with portable fixture files under `test/fixtures/` (`sample.py`, `sample.sh`, `sample.swift`). Rewrote entire smoke test to use `__dirname`-relative fixture resolution via `fileURLToPath(import.meta.url)`.

### ⚠️ Warning Fixes (5)

- **Unused `computeLineHash` import** — Removed dead import from `src/index.ts:33`; only `formatHashlineLine` was used.
- **`resolveLang()` mixed return types** — Normalized function to always return `string | null`. The fallback path `(Lang as Record<string, Lang>)[langStr]` now goes through an explicit `typeof langEnum === "string"` check before returning.
- **Top-level `await` ESM-only constraint** — Added JSDoc documentation to `hashline.ts` module noting the ESM-only requirement and that it's safe since Pi extensions are ESM by default.
- **`.env` → `bash` mapping removed** — Deleted from extension map in `getAstGrepLang()`. `.env` files are KEY=value pairs, not shell scripts.
- **`.zsh`/`.ksh` → `bash` limitation documented** — Added JSDoc block on `getAstGrepLang()` documenting that zsh/ksh have syntax diverging from POSIX/bash and results may be approximate.

### 💡 Suggestion Fixes (4)

- **`// BUG:` comment upgraded** — Changed to `// NOTE:` with a placeholder upstream issue link (`https://github.com/ast-grep/ast-grep/issues/XXXX`) for traceability when the registerDynamicLanguage bug is fixed upstream.
- **README.md fully rewritten** — Now documents all 6 supported languages, hashline output format with examples, extension-to-language mapping table, `.zsh`/`.ksh` limitations note, and updated install instructions (removed hardcoded `/Users/dave/tools/...` paths).
- **CHANGELOG.md created** — Full v0.3.0 changelog with Added/Changed/Fixed sections covering all changes in this PR.
- **Smoke test modernized** — Replaced all `var` with `const`/`let`, fixed async handling (removed broken `new Promise()` wrappers with unresolved `.then()`, now uses native `findInFiles` Promise directly).

### Bonus Fix

- **Vitest test expectation update** — `test/index.test.ts` "returns undefined for unknown extensions" test was asserting `getAstGrepLang("file.py")` should be undefined; changed to use `.rs` and `.xyz` as unknown extensions since Python is now supported.

## Decisions & Rationale

| Decision | Rationale |
|----------|-----------|
| Use fixture files instead of skipping tests | Skipping sections 4-5 would lose valuable end-to-end hashline verification. Portable fixtures preserve full coverage while running anywhere. |
| Keep `.zsh`/`.ksh` mapped to bash rather than removing | Removing would silently ignore those files in searches. Documenting the limitation lets users make informed decisions while still getting useful (if approximate) results. |
| Remove `.env` mapping entirely vs documenting | Unlike zsh/ksh where bash grammar produces *approximate* results, `.env` files have no shell syntax at all — mapping them would produce garbage parses. Removal is safer. |
| Use native `findInFiles` Promise instead of callback-based collection | The API signature is `(lang, config, callback): Promise<number>` — the promise resolves after all callbacks fire. No need for manual Promise wrapping which caused hanging tests. |
| Pattern `$NAME() {` invalid for bash ast-grep | Bash grammar doesn't support multi-node patterns like `$NAME() {`. Changed to `echo $MSG` which is a single valid bash AST node pattern. |

## Gotchas & Fixes

| Problem | Root Cause | Fix |
|---------|------------|-----|
| Smoke test hung forever (never printed summary) | Original code wrapped `findInFiles` in `new Promise()` but never called `resolve()`. Removed the 4th argument thinking it was an onComplete callback, but the API only takes 3 args — the returned Promise resolves automatically after callbacks fire. | Removed `new Promise()` wrapper entirely; collect results in module-scoped array, `await findInFiles(...)` directly. |
| Bash pattern `$NAME() {` threw `InvalidArg: Multiple AST nodes detected` | ast-grep's bash parser doesn't support multi-statement/multi-node patterns the way TypeScript does. The `{` starts a new compound command node. | Changed to single-node pattern `echo $MSG` which matches cleanly in bash AST. |
| Python pattern `def $NAME($$$ARGS)` found 0 matches initially | Fixture file uses `def compute_content_hash(content: str) -> str:` with type annotations — the `$$$ARGS` (zero-or-more) should match but the original test used a different async pattern that didn't resolve properly due to the Promise hang. After fixing async, it worked. | Was actually the Promise hang masking real results; once async was fixed, the original Python pattern worked. |
| Partial file corruption during edit | One `replace_text` edit operation left duplicate/orphaned code in `smoke-test.mjs` because the replacement text itself contained content that matched later in the file, causing a partial merge. | Rewrote the entire file from scratch using `write` tool instead of incremental edits. |
| `replace_text` failed with "must not have additional properties" | Passed malformed JSON with extra properties in one edit call attempt. | Simplified to individual single-property edit calls. |

## Files Changed

| File | Change Summary |
|------|---------------|
| `package.json` | Scope `@yourgpt` → `@davehardy20`; repo/bugs/homepage URLs corrected |
| `src/index.ts` | Removed unused `computeLineHash` import; normalized `resolveLang()` return type; `// BUG:` → `// NOTE:` with upstream link |
| `src/hashline.ts` | Added ESM-only constraint documentation in module JSDoc |
| `src/ast-grep-utils.ts` | Removed `.env` → `bash` mapping; added JSDoc documenting `.zsh`/`.ksh`/`.bzl` limitations |
| `test/smoke-test.mjs` | Full rewrite: fixtures instead of local paths, `const`/`let`, proper async/await, fixed patterns |
| `test/fixtures/sample.py` | New file — Python fixture with functions, classes, methods |
| `test/fixtures/sample.sh` | New file — Bash fixture with functions, echo patterns |
| `test/fixtures/sample.swift` | New file — Swift fixture with structs, classes, properties |
| `test/index.test.ts` | Updated unknown-extension test: `.py` → `.rs`/`.xyz` |
| `README.md` | Full rewrite: 6 languages, hashline format docs, extension table, limitations |
| `CHANGELOG.md` | New file — v0.3.0 changelog with all changes documented |

## Open Items & Next Steps

- [ ] Replace placeholder upstream issue URL (`https://github.com/ast-grep/ast-grep/issues/XXXX`) with actual ast-grep issue number once filed
- [ ] Consider porting smoke tests from standalone `.mjs` to vitest for CI integration (review suggestion #13)
- [ ] Consider splitting hashline feature and language support into separate PRs for future work (review suggestion #9)
- [ ] Evaluate LRU cache or post-processing cleanup for unbounded `fileCache` in `formatMatch()` (review item #10 — noted, deferred)

## Verification

All checks green after fixes:

```
typecheck ✅  clean
build      ✅  success
vitest     ✅  24/24 passed
smoke-test ✅  21/21 passed
```

---

*Log written by write-log skill*
