/**
 * AST-Grep Utilities (package-local)
 *
 * Helpers for language mapping, edit application, and result formatting.
 * Duplicated from ~/.pi/agent/extensions/shared/ast-grep-utils.ts to
 * eliminate the cross-package shared import.
 */

import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Map a file path to an ast-grep Lang enum value.
 * Returns undefined if no matching language.
 */
export function getAstGrepLang(filePath: string): string | undefined {
  const ext = path.extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    ".ts": "TypeScript",
    ".tsx": "Tsx",
    ".js": "JavaScript",
    ".jsx": "Tsx",
    ".mjs": "JavaScript",
    ".cjs": "JavaScript",
    ".mts": "TypeScript",
    ".cts": "TypeScript",
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
