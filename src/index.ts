/**
 * AST-Grep Tools Extension for Pi
 *
 * Registers structural code search and replace tools:
 * - ast_grep_search: Find code patterns using AST matching
 * - ast_grep_replace: Find and replace code patterns using AST matching
 *
 * Uses @ast-grep/napi for fast native AST parsing.
 *
 * Package status command:
 * - /ast-grep-status: show package name, version, source path, and status
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { findInFiles, Lang } from "@ast-grep/napi";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  applyEditsToFile,
  getAstGrepLang,
  langName,
} from "./ast-grep-utils.js";
import { normalizePath } from "./path-utils.js";

// ── Package metadata ──────────────────────────────────────────────────

interface PackageMetadata {
  name: string;
  version: string;
  packageRoot: string;
  sourcePath: string;
}

const sourcePath = fileURLToPath(import.meta.url);
const packageRoot = path.resolve(path.dirname(sourcePath), "..");
let cachedPackageMetadata: PackageMetadata | null = null;

function getPackageMetadata(): PackageMetadata {
  if (cachedPackageMetadata) return cachedPackageMetadata;

  let name = "pi-ast-grep-tools";
  let version = "0.1.0";

  try {
    const packageJson = JSON.parse(
      fs.readFileSync(path.join(packageRoot, "package.json"), "utf8"),
    ) as { name?: string; version?: string };
    name = packageJson.name ?? name;
    version = packageJson.version ?? version;
  } catch {
    // Best-effort metadata only.
  }

  cachedPackageMetadata = { name, version, packageRoot, sourcePath };
  return cachedPackageMetadata;
}

// ── Language helpers ───────────────────────────────────────────────────

function resolveLang(filePath: string): Lang | null {
  const langStr = getAstGrepLang(filePath);
  if (!langStr) return null;
  return (Lang as Record<string, Lang>)[langStr] ?? null;
}

function formatMatch(
  node: {
    text(): string;
    range(): {
      start: { line: number; column: number };
      end: { line: number; column: number };
    };
  },
  filePath: string,
  index: number,
): string {
  const range = node.range();
  const startLine = range.start.line + 1;
  const startCol = range.start.column + 1;
  const endLine = range.end.line + 1;
  const endCol = range.end.column + 1;
  const text = node.text().replace(/\s+/g, " ").trim();
  const preview = text.length > 80 ? `${text.substring(0, 80)}...` : text;
  return `${index + 1}. ${filePath}:${startLine}:${startCol}-${endLine}:${endCol}\n   ${preview}`;
}

// ── Shared helpers (exported for testability) ─────────────────────────

export function resolveSearchPaths(
  paths: string[],
  cwd: string,
): string[] {
  return paths.length > 0 ? paths.map((p) => path.resolve(cwd, p)) : [cwd];
}

export function detectLanguage(
  searchPaths: string[],
  explicitLanguage?: string,
): Lang {
  if (explicitLanguage) {
    const lang = (Lang as Record<string, Lang>)[explicitLanguage] ?? null;
    if (lang) return lang;
  }

  for (const sp of searchPaths) {
    const stat = fs.statSync(sp);
    if (stat.isFile()) {
      const lang = resolveLang(sp);
      if (lang) return lang;
    } else {
      const entries = fs.readdirSync(sp);
      for (const entry of entries) {
        const lang = resolveLang(path.join(sp, entry));
        if (lang) return lang;
      }
    }
  }

  throw new Error(
    "No supported language detected in search paths. ast-grep supports: TypeScript, JavaScript, TSX.",
  );
}

export function collectSourceFiles(searchPaths: string[]): string[] {
  const filePaths: string[] = [];

  for (const sp of searchPaths) {
    const stat = fs.statSync(sp);
    if (stat.isFile()) {
      filePaths.push(sp);
    } else {
      collectDir(sp, filePaths);
    }
  }

  return filePaths;
}

function collectDir(dir: string, out: string[]): void {
  for (const entry of fs.readdirSync(dir)) {
    const full = path.join(dir, entry);
    const s = fs.statSync(full);
    if (s.isDirectory()) {
      if (entry !== "node_modules" && entry !== ".git") {
        collectDir(full, out);
      }
    } else if (getAstGrepLang(full)) {
      out.push(full);
    }
  }
}

// ── Extension ──────────────────────────────────────────────────────────

export default function astGrepToolsExtension(pi: ExtensionAPI) {
  function sendVisibleMessage(
    content: string,
    details?: Record<string, unknown>,
  ) {
    pi.sendMessage({
      customType: "ast-grep-status",
      content,
      details,
      display: true,
    });
  }

  // ── Status command ──────────────────────────────────────────────────

  pi.registerCommand("ast-grep-status", {
    description: "Show ast-grep-tools package status",
    handler: async (_args, _ctx: ExtensionContext) => {
      const metadata = getPackageMetadata();
      sendVisibleMessage(
        [
          `${metadata.name} v${metadata.version}`,
          `source: ${metadata.sourcePath}`,
          `supported: TypeScript, JavaScript, TSX`,
        ].join("\n"),
        {
          packageName: metadata.name,
          version: metadata.version,
          sourcePath: metadata.sourcePath,
          packageRoot: metadata.packageRoot,
        },
      );
    },
  });

  // ── Search tool ─────────────────────────────────────────────────────

  pi.registerTool({
    name: "ast_grep_search",
    label: "AST Grep Search",
    description:
      "Search for code patterns using AST (abstract syntax tree) matching. More precise than text search. Supports TypeScript, JavaScript, TSX. Pattern syntax is language-specific AST pattern syntax (e.g. `console.log($A)` matches any console.log call).",
    promptSnippet: "Use ast_grep_search to find structural code patterns.",
    promptGuidelines: [
      "Use ast_grep_search when you need structural code matching that text search (grep) cannot reliably find.",
      "Use ast_grep_search for language-specific patterns like function calls, imports, or class definitions.",
      "Start with a narrow path. Broad patterns across entire repos can produce excessive output. Results are capped at 50 by default.",
    ],
    parameters: Type.Object({
      pattern: Type.String({
        description:
          "AST pattern to match (e.g. 'console.log($A)', 'function $NAME() { }')",
      }),
      paths: Type.Array(Type.String(), {
        description:
          "File or directory paths to search (defaults to current directory if empty)",
        default: [],
      }),
      language: Type.Optional(
        Type.String({
          description:
            "Language override: TypeScript, JavaScript, or Tsx. Auto-detected from file extensions if not specified.",
        }),
      ),
      limit: Type.Optional(
        Type.Number({
          description: "Maximum matches to return (0 = unlimited)",
          default: 50,
        }),
      ),
    }),
    async execute(
      _toolCallId: string,
      params: {
        pattern: string;
        paths: string[];
        language?: string;
        limit?: number;
      },
      _signal: AbortSignal,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      _onUpdate: ((partialResult: any) => void) | undefined,
      ctx: ExtensionContext,
    ): Promise<{ content: Array<{ type: "text"; text: string }>; details: Record<string, unknown> }> {
      const searchPaths = resolveSearchPaths(params.paths, ctx.cwd);
      const lang = detectLanguage(searchPaths, params.language);
      const filePaths = collectSourceFiles(searchPaths);

      if (filePaths.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: "No supported source files found in search paths.",
            },
          ],
          details: {},
        };
      }

      const results: string[] = [];
      let matchCount = 0;

      await findInFiles(
        lang,
        {
          paths: filePaths,
          matcher: { rule: { pattern: params.pattern } },
        },
        (_err, nodes) => {
          for (const node of nodes) {
            const file = node.getRoot().filename() ?? "unknown";
            results.push(formatMatch(node, file, matchCount));
            matchCount++;
          }
        },
      );

      if (matchCount === 0) {
        return {
          content: [
            {
              type: "text",
              text: `No matches found for pattern "${params.pattern}" in ${langName(lang)} files.`,
            },
          ],
          details: { count: 0, matches: [] },
        };
      }

      const limit = params.limit ?? 50;
      const capped = limit > 0 && results.length > limit;
      const display = limit > 0 ? results.slice(0, limit) : results;
      let text = `Found ${matchCount} match(es) for "${params.pattern}":\n\n${display.join("\n\n")}`;
      if (capped) {
        text += `\n\n... and ${results.length - limit} more (use limit:0 for all)`;
      }

      return {
        content: [{ type: "text", text }],
        details: {
          count: matchCount,
          matches: display,
          total: matchCount,
          capped,
        },
      };
    },
  });

  // ── Replace tool ────────────────────────────────────────────────────

  pi.registerTool({
    name: "ast_grep_replace",
    label: "AST Grep Replace",
    description:
      "Find and replace code patterns using AST matching. SAFER than text replace because it respects syntax boundaries. APPLIES changes to files.",
    promptSnippet:
      "Use ast_grep_replace for safe structural code replacements.",
    promptGuidelines: [
      "Use ast_grep_replace instead of plain text replace when changing code patterns across multiple files to avoid syntax boundary violations.",
      "Use ast_grep_replace when the replacement must respect AST structure (e.g., renaming variables, wrapping expressions).",
    ],
    parameters: Type.Object({
      pattern: Type.String({
        description: "AST pattern to match",
      }),
      replacement: Type.String({
        description:
          "Replacement text (can use $CAPTURE for captured variables)",
      }),
      paths: Type.Array(Type.String(), {
        description: "File or directory paths to search/replace",
        default: [],
      }),
      language: Type.Optional(
        Type.String({
          description: "Language override: TypeScript, JavaScript, or Tsx",
        }),
      ),
    }),
    async execute(
      _toolCallId: string,
      params: {
        pattern: string;
        replacement: string;
        paths: string[];
        language?: string;
      },
      _signal: AbortSignal,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      _onUpdate: ((partialResult: any) => void) | undefined,
      ctx: ExtensionContext,
    ): Promise<{ content: Array<{ type: "text"; text: string }>; details: Record<string, unknown> }> {
      const searchPaths = resolveSearchPaths(params.paths, ctx.cwd);
      const lang = detectLanguage(searchPaths, params.language);
      const filePaths = collectSourceFiles(searchPaths);

      if (filePaths.length === 0) {
        return {
          content: [
            {
              type: "text",
              text: "No supported source files found in search paths.",
            },
          ],
          details: {},
        };
      }

      const editsByFile = new Map<
        string,
        Array<{
          startPos: number;
          endPos: number;
          insertedText: string;
        }>
      >();
      let matchCount = 0;

      await findInFiles(
        lang,
        {
          paths: filePaths,
          matcher: { rule: { pattern: params.pattern } },
        },
        (_err, nodes) => {
          for (const node of nodes) {
            const rawFile = node.getRoot().filename() ?? "unknown";
            if (rawFile === "unknown") continue;
            const file = normalizePath(path.resolve(rawFile));
            const edit = node.replace(params.replacement);
            let fileEdits = editsByFile.get(file);
            if (!fileEdits) {
              fileEdits = [];
              editsByFile.set(file, fileEdits);
            }
            fileEdits.push(edit);
            matchCount++;
          }
        },
      );

      if (matchCount === 0) {
        return {
          content: [
            {
              type: "text",
              text: `No matches found for pattern "${params.pattern}".`,
            },
          ],
          details: { count: 0, files: 0 },
        };
      }

      // Apply edits
      const results: string[] = [];
      const modifiedFiles: string[] = [];
      for (const [file, edits] of editsByFile) {
        try {
          applyEditsToFile(file, edits);
          results.push(`  ✓ ${file} (${edits.length} replacement(s))`);
          modifiedFiles.push(file);
        } catch (err) {
          results.push(
            `  ✗ ${file}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
      return {
        content: [
          {
            type: "text",
            text: `Replaced ${matchCount} match(es) in ${editsByFile.size} file(s):\n\n${results.join("\n")}`,
          },
        ],
        details: {
          count: matchCount,
          files: editsByFile.size,
          results,
          modifiedFiles,
        },
      };
    },
  });
}
