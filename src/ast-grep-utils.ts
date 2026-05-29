/**
 * AST-Grep Utilities (package-local)
 *
 * Helpers for language mapping, edit application, and result formatting.
 */

import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Map a file path to an ast-grep language string.
 * Supports built-in NAPI languages (TypeScript, JavaScript, Tsx)
 * plus dynamically registered languages (python, bash, swift).
 * Returns undefined if no matching language.
 *
 * **Known limitations:**
 * - `.zsh` and `.ksh` are mapped to `bash`. Zsh/Ksh have syntax that diverges
 *   from POSIX/bash (e.g. `^(...)` glob qualifiers, `[[` differences), so
 *   valid zsh/ksh code may produce unexpected parse results.
 * - `.bzl` (Starlark) is mapped to `python`. Starlark is a Python subset but
 *   has its own semantics; results may be approximate for advanced features.
 */
export function getAstGrepLang(filePath: string): string | undefined {
  const ext = path.extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    // Built-in @ast-grep/napi languages
    ".ts": "TypeScript",
    ".tsx": "Tsx",
    ".js": "JavaScript",
    ".jsx": "Tsx",
    ".mjs": "JavaScript",
    ".cjs": "JavaScript",
    ".mts": "TypeScript",
    ".cts": "TypeScript",
    // Dynamically registered via @ast-grep/lang-* packages
    ".py": "python",
    ".py3": "python",
    ".pyi": "python",
    ".bzl": "python",
    ".sh": "bash",
    ".bash": "bash",
    ".bats": "bash",
    // NOTE: .zsh and .ksh mapped to bash — see doc above for limitations
    ".zsh": "bash",
    ".ksh": "bash",
    ".swift": "swift",
  };
  return map[ext];
}

/**
 * Get a human-readable language name from an ast-grep Lang string.
 */
export function langName(lang: string): string {
  return lang.toLowerCase();
}

/**
 * Apply a list of ast-grep Edit objects to a source string.
 * Returns the modified string.
 */
export interface AstGrepEdit {
  startPos: number;
  endPos: number;
  insertedText: string;
}

export function applyEdits(source: string, edits: AstGrepEdit[]): string {
  const sorted = [...edits].sort((a, b) => b.startPos - a.startPos);
  let result = source;
  for (const edit of sorted) {
    result =
      result.substring(0, edit.startPos) +
      edit.insertedText +
      result.substring(edit.endPos);
  }
  return result;
}

/**
 * Read a file, apply edits, and write it back.
 */
export function applyEditsToFile(
  filePath: string,
  edits: AstGrepEdit[],
): void {
  const content = fs.readFileSync(filePath, "utf-8");
  const result = applyEdits(content, edits);
  fs.writeFileSync(filePath, result, "utf-8");
}
