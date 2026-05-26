# @davehardy20/pi-ast-grep-tools

Structural code search and replace for Pi using AST matching via [ast-grep](https://ast-grep.github.io/).

## What it adds

- **`ast_grep_search`** tool — Find code patterns using AST matching. More precise than text search. Supports TypeScript, JavaScript, TSX, Python, Bash, and Swift. Output uses **LINE#HASH anchors** compatible with pi-hashline-edit's `read()`/`edit()` tools for direct editing.
- **`ast_grep_replace`** tool — Find and replace code patterns using AST matching. Safer than text replace because it respects syntax boundaries. Applies changes to files.
- **`/ast-grep-status`** command — Show package name, version, source path, and supported languages.

### Pattern syntax

Pattern syntax is language-specific AST pattern syntax:

- `console.log($A)` matches any `console.log` call (TypeScript/JavaScript)
- `function $NAME() { }` matches empty function declarations
- `$FUNC($$$ARGS)` matches any function call
- `def $NAME($$$ARGS):` matches any Python function definition
- `echo $MSG` matches any bash echo statement
- `var $NAME: $TYPE` matches any Swift property declaration

See the [ast-grep pattern guide](https://ast-grep.github.io/guide/pattern-syntax.html) for full details.

### Hashline output format

Search results are returned as LINE#HASH anchors:

```
12#MQ:  def hello(): pass
13#XY:    pass
```

The `#MQ` / `#XY` hashes are content-based 2-character identifiers computed by the same algorithm as pi-hashline-edit. This means you can copy a result line directly into an `edit()` tool call — no need to look up line numbers or manually transcribe content.

If xxhashjs is unavailable (e.g., in minimal installs), hashes fall back to `??`.

## Install

From npm:

```bash
pi install npm:@davehardy20/pi-ast-grep-tools
```

From git:

```bash
pi install git:github.com/davehardy20/pi-ast-grep-tools
```

From a local checkout during development:

```bash
pi install /path/to/pi-ast-grep-tools
```

For one run only:

```bash
pi -e /path/to/pi-ast-grep-tools
```

## Settings

No special settings required. The extension auto-detects the target language from file extensions. You can override the language explicitly with the `language` parameter.

Supported languages: **TypeScript**, **JavaScript**, **TSX**, **Python**, **Bash**, **Swift**.

| Extension | Language | Notes |
|-----------|----------|-------|
| `.ts`, `.mts`, `.cts` | TypeScript | Built-in |
| `.js`, `.jsx`, `.mjs`, `.cjs` | JavaScript / Tsx | Built-in |
| `.tsx`, `.jsx` | Tsx | Built-in |
| `.py`, `.py3`, `.pyi` | Python | Via @ast-grep/lang-python |
| `.sh`, `.bash`, `.bats` | Bash | Via @ast-grep/lang-bash |
| `.zsh`, `.ksh` | Bash (approximate) | See limitations below |
| `.swift` | Swift | Via @ast-grep/lang-swift |
| `.bzl` | Python (approximate) | Starlark mapped to python |

> **Note on `.zsh` / `.ksh`:** These are mapped to the bash grammar. Zsh and Ksh have syntax that diverges from POSIX/bash (e.g., `^(...)` glob qualifiers, `[[` differences), so valid zsh/ksh code may produce unexpected parse results.

## Troubleshooting

Run `/ast-grep-status` to confirm:

- package name
- package version
- loaded source path

If commands appear twice, Pi may be loading both the package and the old local extension. Disable or remove the old local auto-discovered extension (`ast-grep-tools.ts` in `~/.pi/agent/extensions/`) before reload verification.

## Update flow

1. Update the package repo
2. Push to GitHub
3. Run `pi update --extensions` or reinstall the package
4. Run `/reload`

`/reload` alone does not fetch newer package commits.

## Build and test

```bash
npm run typecheck
npm run build
npm test
node test/smoke-test.mjs   # hashline integration smoke tests
```
