# Hashline Integration for Editable Search Results

> **Date:** 2026-05-20
> **Type:** slice
> **Reference:** Phase of pi-ast-grep-tools multi-language extension development

## Goal

Integrate `pi-hashline-edit`'s hashline algorithm into `ast_grep_search` output so that search results produce **directly editable `LINE#HASH:content` anchors** — eliminating the need for a separate `read()` call before each `edit()`. Target: save ~5K–20K tokens per session by removing intermediate re-reads.

## What Was Done

### New file: `src/hashline.ts` (~93 lines)
- Implemented exact replica of `pi-hashline-edit`'s hashing algorithm (MIT, coctostan fork)
- Custom alphabet: `"ZPMQVRWSNKTXJBYH"` (16 chars, excludes hex A-F, confusable letters, vowels)
- Precomputed 256-entry DICT lookup table: `DICT[i] = ALPHABET[i >>> 4] + ALPHABET[i & 0x0F]`
- **`computeLineHash(lineNumber, line)`** — strips `\r`, `trimEnd()` only, seeds blank lines with line number, returns 2-char hash from DICT
- **`formatHashlineLine(ln, content, lineWidth)`** — produces `"  12#MQ:actual content"` format
- **`formatHashlineRegion(lines, startLine)`** — formats a block of consecutive lines
- **`hashlineAvailable`** export — boolean flag indicating whether xxhashjs loaded successfully
- **Graceful fallback**: if `xxhashjs` import fails, all hashes return `"??"` placeholder; extension still loads and searches work normally

### Modified: `src/index.ts` (+108/-72 net)
- Added import of `formatHashlineLine`, `computeLineHash`, `hashlineAvailable` from `./hashline.js`
- **Replaced `formatMatch()` function** entirely:
  - Old signature: `(node, filePath, index)` → collapsed text preview like `"1. file.ts:12:3-14:5   console.log(...)"`
  - New signature: `(node, filePath, fileCache)` → reads actual file lines into cache, outputs hashline anchors like `" 12#MQ:console.log(...)"`
  - Falls back to plain text format if file is unreadable
- **Updated `ast_grep_search` execute handler**: creates `fileCache: Map<string, string[]>`, passes it to `formatMatch()`
- Result-limiting logic preserved (default cap of 50)

### Modified: `package.json`
- Added `"xxhashjs": "^0.2.2"` to dependencies (pure JS hash library, ~15KB)
- Added `"@types/xxhashjs": "^0.2.4"` to devDependencies (resolves TS7016 declaration error)
- Reordered dependencies for readability

### New test: `test/smoke-test.mjs` (~289 lines)
- **5 sections**, **12/12 tests passing**:
  1. Dynamic Language Registration (Python, Bash, Swift in single call)
  2. Hash Algorithm self-test (alphabet verification, blank-line uniqueness, significant-line consistency)
  3. Output Format validation (`N#XX:content` structure)
  4. Cross-check against real files (Python, Bash, Swift) — validates hashline structure
  5. End-to-end search → editable anchor production (all 3 languages)

## Decisions & Rationale

| Decision | Rationale |
|----------|-----------|
| Use `xxhashjs` (pure JS) not `xxhash-wasm` (WASM) | Matches what `pi-hashline-edit` actually uses; avoids native build step failures across platforms |
| Self-contained algorithm (copy, don't import) | Extension must work even when `pi-hashline-edit` is not installed — zero runtime dependency on other Pi extensions |
| Graceful fallback with `"??"` placeholder | Better than crashing the entire extension if xxhashjs is missing/corrupted; LLM can see hashes are unavailable |
| Dynamic import with try/catch for xxhashjs | Allows TypeScript compilation without requiring xxhashjs at build time; catches import failure gracefully |
| `trimEnd()` only (not full whitespace collapse) | Must match `pi-hashline-edit` exactly — it preserves internal indentation, unlike `pi-hashline-readmap` which collapses all whitespace |
| Blank lines seeded by line number | Ensures each blank line gets a unique hash (prevents edit ambiguity when multiple blank lines exist) |

## Gotchas & Fixes

| Problem | Root Cause | Fix |
|---------|------------|-----|
| TS7016: Could not find declaration file for `xxhashjs` | `xxhashjs` ships without bundled types | Installed `@types/xxhashjs` v0.2.4 as devDependency |
| Smoke test SyntaxError: `missing ) after argument list` at line 65/69 | Node.js v25.8.1 parser chokes on `]` inside single-quoted string concatenation like `"[" + var + "]"` | Switched to backtick template literals: `` `[${var}]` `` |
| Smoke test SyntaxError: `Unexpected reserved word` for `await` | Used `(await function() { ... })()` IIFE pattern which isn't valid top-level syntax in ESM modules | Changed to `(async function() { ... })()` pattern |
| Working directory interference with `npm run build` | Assistant's CWD was `/Users/alex/Projects/scripting/pi-extensions/knowledge-scan` not the project dir | User ran builds manually from correct directory; assistant should use absolute paths or `cd` consistently |
| Two conflicting hashline algorithms discovered | Both `pi-hashline-readmap` (v0.8.12) and `pi-hashline-edit` (v0.6.1) were installed but used fundamentally different algorithms (hex vs custom alphabet, WASM vs pure JS, different whitespace handling) | User confirmed `pi-hashline-edit` is the actually loaded extension; implemented its algorithm exactly |

## Files Changed

| File | Change Summary |
|------|---------------|
| `src/hashline.ts` | **NEW** — Hashline engine with pi-hashline-edit compatible algorithm, graceful fallback |
| `src/index.ts` | Replaced `formatMatch()` with hashline-based version; added file caching in search handler |
| `package.json` | Added `xxhashjs` dep + `@types/xxhashjs` devDep |
| `package-lock.json` | Lockfile updated for new deps |
| `test/smoke-test.mjs` | **NEW** — Comprehensive smoke test with 5 sections / 12 assertions |

## Open Items & Next Steps

- [ ] **Bump version to 0.3.0** and commit — current package.json still says 0.2.0
- [ ] **Byte-for-byte verification against actual `pi-hashline-edit read()` output** — structural tests pass but haven't yet imported the actual compiled module to confirm identical hashes (importing compiled dist failed in test; may need dynamic require or separate verification script)
- [ ] **Consider file-grouped output formatting** with visual separators between matches from different files (partially attempted earlier, simplified to flat join for now)
- [ ] **End-to-end validation** in a live Pi session — confirm that `ast_grep_search` output can be piped directly into `pi-hashline-edit`'s `edit()` tool without an intermediate `read()` call

---

*Log written by write-log skill*
