# Changelog

All notable changes to this project will be documented in this file.

## [0.3.0] - 2025-05-26

### Added

- **Hashline output format** — `ast_grep_search` now returns LINE#HASH anchors (e.g., `12#MQ:content`) compatible with pi-hashline-edit's `read()`/`edit()` tools. Results can be copied directly into `edit()` calls without manual line number lookup.
- **Hashline engine** (`src/hashline.ts`) — Custom 2-character hash algorithm using xxhashjs and a ZPMQVRWSNKTXJBYH alphabet designed to avoid hex digits, confusable characters, and English words. Graceful fallback to `??` when xxhashjs is unavailable.
- **Python support** — Search and replace in `.py` / `.py3` / `.pyi` files via `@ast-grep/lang-python`.
- **Bash support** — Search and replace in `.sh` / `.bash` / `.bats` files via `@ast-grep/lang-bash`. Also covers `.zsh` and `.ksh` (see limitations).
- **Swift support** — Search and replace in `.swift` files via `@ast-grep/lang-swift`.
- **Starlark (`.bzl`) support** — Mapped to Python grammar.
- **`hashlineAvailable` export** — Consumers can check whether hashline computation is available before relying on hash output.

### Changed

- Output format changed from `1. file.ts:12:3-14:5 preview` to `LINE#HASH:content` for improved edit workflow integration.
- Result separator changed from double-newline to single-newline between matches.

### Fixed

- Package scope corrected to `@davehardy20/pi-ast-grep-tools` (was incorrectly set to `@yourgpt/...`).
- Removed dead `computeLineHash` import from `src/index.ts`.
- Normalized `resolveLang()` return type to always return plain strings (was mixing `Lang` enum values and strings).
- Documented ESM-only constraint for hashline module (top-level `await`).
- Removed incorrect `.env` → `bash` mapping (`.env` files are not shell scripts).
- Documented `.zsh`/`.ksh` → `bash` mapping limitations.
- Replaced hardcoded local paths in smoke tests with portable fixture files.
- Modernized smoke test code (`var` → `const`/`let`, proper async/await).

## [0.2.0] - 2025-05-19

### Added

- Initial release with TypeScript, JavaScript, and TSX support.
- `ast_grep_search` and `ast_grep_replace` tools.
- `/ast-grep-status` command.

[0.3.0]: https://github.com/davehardy20/pi-ast-grep-tools/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/davehardy20/pi-ast-grep-tools/releases/tag/v0.2.0
