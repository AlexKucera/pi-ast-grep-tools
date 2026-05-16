# @davehardy20/pi-ast-grep-tools

Structural code search and replace for Pi using AST matching via [ast-grep](https://ast-grep.github.io/).

## What it adds

- **`ast_grep_search`** tool — Find code patterns using AST matching. More precise than text search. Supports TypeScript, JavaScript, and TSX.
- **`ast_grep_replace`** tool — Find and replace code patterns using AST matching. Safer than text replace because it respects syntax boundaries. Applies changes to files.
- **`/ast-grep-status`** command — Show package name, version, source path, and supported languages.

### Pattern syntax

Pattern syntax is language-specific AST pattern syntax:

- `console.log($A)` matches any `console.log` call
- `function $NAME() { }` matches empty function declarations
- `$FUNC($$$ARGS)` matches any function call

See the [ast-grep pattern guide](https://ast-grep.github.io/guide/pattern-syntax.html) for full details.

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
pi install /Users/dave/tools/pi-ast-grep-tools
```

For one run only:

```bash
pi -e /Users/dave/tools/pi-ast-grep-tools
```

## Settings

No special settings required. The extension auto-detects the target language from file extensions. You can override the language explicitly with the `language` parameter.

Supported languages: TypeScript, JavaScript, TSX.

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
```
