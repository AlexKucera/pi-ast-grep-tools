# Migrate hashline format to match @davehardy20/pi-hashline-tools

> **Date:** 2026-06-01
> **Type:** issue
> **Reference:** [PR #2 re-review](https://github.com/davehardy20/pi-ast-grep-tools/pull/2#pullrequestreview-4366067906), [@davehardy20/pi-hashline-tools](https://github.com/davehardy20/pi-hashline-tools)

## Goal

Address the PR #2 re-review's critical finding: our hashline implementation targeted `pi-hashline-edit` (colon separator, xxhashjs) but the repo **owner** has their own `pi-hashline-tools` package that uses a **pipe (`|`) separator** and **FNV-1a hashing**. The owner made their repo public during the review conversation. We needed to migrate byte-for-byte to match the owner's algorithm so `ast_grep_search` output is directly usable with `hashline_edit()`.

## What Was Done

### 1. Investigated owner's pi-hashline-tools source code
- Cloned and read all source files from `davehardy20/pi-hashline-tools`
- Key files: `src/hashline-constants.ts`, `src/hashline-utils.ts`, `src/index.ts`
- Documented every difference between our impl and the owner's (see table below)

### 2. Rewrote `src/hashline.ts` — complete algorithm migration
- **Hash function**: Replaced xxhashjs `xxh32 & 0xFF` with FNV-1a 32-bit → `% 256` (ported verbatim from owner's `fnv1a32()`)
- **Separator**: Changed `:` (colon) to `|` (pipe) in `formatHashlineLine()`
- **Blank lines**: Now return empty string hash → renders as `LINE|content` (no `#HASH`), matching owner's convention that blank lines aren't valid edit anchors
- **Line numbers**: Removed left-padding (owner doesn't pad)
- **ESM constraint**: Removed top-level `await` — no external dependencies means no ESM limitation
- **`hashlineAvailable`**: Now always `true` (no optional dependency)
- **Exported `NIBBLE_STR`**: For test/consumer access

### 3. Updated `src/index.ts` callers
- Removed `lineWidth` parameter from `formatHashlineLine()` calls in `formatMatch()`
- Updated JSDoc to reference `@davehardy20/pi-hashline-tools` instead of `pi-hashline-edit`
- Changed fallback out-of-range format from `???:` to `?|`

### 4. Rewrote smoke tests (`test/smoke-test.mjs`)
- Added **Section 4: Blank Line Format** — verifies `"LINE|content"` output for blank/whitespace-only lines
- Updated Section 2: Blank line assertions now expect empty string (not `"??"`)
- Updated Section 3: Added pipe-separator assertion, added no-padding assertion
- Updated Section 5: Regex changed to `/^\d+(?:#[A-Z]{2})?\|/` (allows missing hash)
- Updated Section 6: Anchor regex changed to `/^(\d+)#([A-Z]{2})\|/`
- Total: **24/24 passing** (up from 21, +3 new test sections)

### 5. Updated documentation
- **README.md**: Complete rewrite of compatibility section — now references `@davehardy20/pi-hashline-tools`, all examples use `\|`, 6-row compat table (added blank-lines and padding rows)
- **CHANGELOG.md**: Updated 5 entries to reflect pi-hashline-tools target, FNV-1a, removed ESM note
- **package.json**: Removed `xxhashjs` and `@types/xxhashjs` dependencies

### 6. Filed upstream ast-grep issue
- Created [ast-grep/ast-grep#2669](https://github.com/ast-grep/ast-grep/issues/2669) documenting `registerDynamicLanguage` single-call requirement
- Updated `src/index.ts` NOTE comment to link to real issue (was placeholder `XXXX`)

## Decisions & Rationale

| Decision | Rationale |
|----------|-----------|
| Match owner's FNV-1a exactly (not keep xxhashjs) | User chose "Match owner exactly" — Pi runs on Node.js not Bun, so FNV-1a path always taken anyway; removes external dep |
| Omit hash on blank lines (not show `??`) | User chose "Omit hash (match owner)" — blank lines render as `LINE|content`, can't be edit anchors. Matches owner's behavior exactly |
| Remove xxhashjs dependency entirely | No longer needed — FNV-1a is pure JS, zero deps. Simplifies install, removes ESM constraint |
| Keep `NIBBLE_STR` exported | Useful for consumers who want to validate or display hash alphabet info |

## Gotchas & Fixes

| Problem | Root Cause | Fix |
|---------|------------|-----|
| **False positive in first review response** | I claimed `pi-hashline-tools` didn't exist because it returned 404. Owner hadn't made it public yet. | Owner made it public mid-review. Cloned actual source, did real comparison. Full mea culpa in commit. |
| **Corrupted `formatHashlineLine` declaration** | Multiple sequential edits to `hashline.ts` introduced duplicate/mangled function signatures (missing `export function`, duplicated params). TypeScript couldn't find the symbol. | Rewrote entire `hashline.ts` file cleanly with `write()` tool instead of incremental edits. |
| **JSON parse error in package.json** | Removing `xxhashjs` entries via string replace left trailing comma + extra newline inside the `devDependencies` object. | Fixed trailing comma syntax with another edit. Validated JSON with `node -e "JSON.parse(...)"`. |
| **Edit tool rejecting content with hashlines** | The `edit()` tool's `[E_INVALID_PATCH]` guard rejects any payload containing patterns like `12#MQ:` because they look like LINE:HASH anchors. | Used `write()` tool for README.md which contains hashline example output. |

## Files Changed

| File | Change Summary |
|------|---------------|
| `src/hashline.ts` | Complete rewrite — FNV-1a hash, pipe separator, blank-line handling, no padding, no ESM constraint |
| `src/index.ts` | Updated `formatMatch()` caller — removed lineWidth, updated fallback format and JSDoc |
| `test/smoke-test.mjs` | Major update — new blank-line section, pipe separator assertions, no-padding check (24 tests) |
| `README.md` | Compatibility section rewritten for pi-hashline-tools target, all examples use `\|` |
| `CHANGELOG.md` | 5 entries updated: pi-hashline-tools references, FNV-1a, removed ESM note |
| `package.json` | Removed `xxhashjs` and `@types/xxhashjs` dependencies |

## Algorithm Migration Details

```
BEFORE (pi-hashline-edit compatible):    AFTER (pi-hashline-tools compatible):
─────────────────────────────────────   ─────────────────────────────────────────
Hash:   xxhashjs xxh32 & 0xFF           Hash:   FNV-1a 32-bit % 256
Sep:    : (colon)                       Sep:    | (pipe)
Format: "  12#MQ:content"               Format: "12#MQ|content"
Blank:  "  7??:content"                  Blank:  "7|content"
Pad:    left-padded line numbers         Pad:    not padded
Deps:   xxhashjs (external)              Deps:   none (pure JS)
ESM:    top-level await required         ESM:    no constraints
```

## Open Items & Next Steps

- [ ] Commit and push these changes to PR #2
- [ ] Respond to PR review comments confirming the migration is complete
- [ ] Consider adding an integration test that pipes `ast_grep_search` output into a mock `hashline_edit` validator (reviewer suggestion from earlier round)

---

*Log written by write-log skill*
