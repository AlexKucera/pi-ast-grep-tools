/**
 * AST-Grep Tools Extension for Pi
 *
 * Registers structural code search and replace tools:
 * - ast_grep_search: Find code patterns using AST matching
 * - ast_grep_replace: Find and replace code patterns using AST matching
 *
 * Uses @ast-grep/napi for fast native AST parsing, with dynamically registered
 * languages (Python, Bash, Swift) via @ast-grep/lang-* packages.
 *
 * Package status command:
 * - /ast-grep-status: show package name, version, source path, and status
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { findInFiles, Lang, registerDynamicLanguage } from "@ast-grep/napi";
import langPython from "@ast-grep/lang-python";
import langBash from "@ast-grep/lang-bash";
import langSwift from "@ast-grep/lang-swift";
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
import { formatHashlineLine } from "./hashline.js";

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

// ── Output caps and language helpers ───────────────────────────────────

const DEFAULT_MATCH_LIMIT = 50;
const DEFAULT_MAX_CHARS = 6000;
const DEFAULT_REPLACE_REPORT_FILE_LIMIT = 50;

// All supported language names (built-in enum + dynamically registered)
const SUPPORTED_LANGUAGES = [
  // Built-in @ast-grep/napi Lang enum values
  "TypeScript", "JavaScript", "Tsx",
  // Dynamically registered via @ast-grep/lang-* packages
  "python", "bash", "swift",
] as const;

type SupportedLang = (typeof SUPPORTED_LANGUAGES)[number];

function normalizeLimit(value: number | undefined, fallback: number): number {
  return value === undefined ? fallback : Math.max(0, Math.floor(value));
}

function normalizeMaxChars(value: number | undefined): number {
  return value === undefined ? DEFAULT_MAX_CHARS : Math.max(0, Math.floor(value));
}

function capText(text: string, maxChars: number, recoveryHint: string): {
  text: string;
  cappedByChars: boolean;
} {
  if (maxChars === 0 || text.length <= maxChars) {
    return { text, cappedByChars: false };
  }

  const marker = `\n\n... output truncated to ${maxChars} chars. ${recoveryHint}`;
  const suffix = marker.length > maxChars ? marker.slice(0, maxChars) : marker;
  const keep = Math.max(0, maxChars - suffix.length);
  return {
    text: `${text.slice(0, keep).trimEnd()}${suffix}`,
    cappedByChars: true,
  };
}

function capStringDetailsByChars(items: string[], maxChars: number): string[] {
  if (maxChars === 0) return items;
  const capped: string[] = [];
  for (const item of items) {
    const next = [...capped, item];
    if (JSON.stringify(next).length > maxChars) break;
    capped.push(item);
  }
  return capped;
}

function resolveLang(filePath: string): string | null {
  const langStr = getAstGrepLang(filePath);
  if (!langStr) return null;
  // Accept both built-in Lang enum values and dynamic language strings
  if (SUPPORTED_LANGUAGES.includes(langStr as any)) return langStr;
  // Also check the Lang enum for built-in languages — normalize to string
  const langEnum = (Lang as Record<string, Lang>)[langStr];
  return typeof langEnum === "string" ? langEnum : null;
}
/**
 * Format an ast-grep match as a hashline-anchored line compatible
 * with pi-hashline-edit's read()/edit() tools.
 *
 * Output format: "  12#MQ:actual source line content"
 * (matches pi-hashline-edit's formatHashlineRegion exactly)
 */
function formatMatch(
  node: {
    text(): string;
    range(): {
      start: { line: number; column: number };
      end: { line: number; column: number };
    };
  },
  filePath: string,
  fileCache: Map<string, string[]>,
): string {
  const range = node.range();
  const startLine = range.start.line + 1;
  const endLine = range.end.line + 1;

  // Read file lines from cache (or load and cache)
  let lines = fileCache.get(filePath);
  if (!lines) {
    try {
      const raw = fs.readFileSync(filePath, "utf8");
      lines = raw.split("\n");
      // Remove trailing empty line caused by trailing newline
      if (raw.endsWith("\n")) lines.pop();
      fileCache.set(filePath, lines);
    } catch {
      // Fallback if file can't be read — return plain text format
      const text = node.text().replace(/\s+/g, " ").trim();
      const preview = text.length > 80 ? text.substring(0, 80) + "..." : text;
      return `${startLine}:${range.start.column + 1}-${endLine}:${range.end.column + 1}\n   ${preview}`;
    }
  }

  // Format each matched line as a hashline anchor
  const lineWidth = String(Math.max(startLine, endLine)).length;
  const parts: string[] = [];
  for (let ln = startLine; ln <= endLine; ln++) {
    if (ln <= lines.length) {
      parts.push(formatHashlineLine(ln, lines[ln - 1], lineWidth));
    } else {
      // Line out of range (shouldn't happen but be safe)
      parts.push(`${String(ln).padStart(lineWidth)}??:${node.text().trim()}`);
    }
  }
  return parts.join("\n");
}

export function formatSearchReport(
  pattern: string,
  formattedMatches: string[],
  limit = DEFAULT_MATCH_LIMIT,
  maxChars = DEFAULT_MAX_CHARS,
): {
  text: string;
  matches: string[];
  total: number;
  capped: boolean;
  cappedByChars: boolean;
} {
  const normalizedLimit = normalizeLimit(limit, DEFAULT_MATCH_LIMIT);
  const cappedByCount = normalizedLimit > 0 && formattedMatches.length > normalizedLimit;
  const display = normalizedLimit > 0 ? formattedMatches.slice(0, normalizedLimit) : formattedMatches;
  let text = `Found ${formattedMatches.length} match(es) for "${pattern}":\n\n${display.join("\n\n")}`;
  if (cappedByCount) {
    text += `\n\n... and ${formattedMatches.length - normalizedLimit} more match(es) (use limit:0 for all)`;
  }
  const normalizedMaxChars = normalizeMaxChars(maxChars);
  const cappedText = capText(
    text,
    normalizedMaxChars,
    "Use maxChars:0 or a higher maxChars for raw search output.",
  );
  return {
    text: cappedText.text,
    matches: cappedText.cappedByChars
      ? capStringDetailsByChars(display, normalizedMaxChars)
      : display,
    total: formattedMatches.length,
    capped: cappedByCount || cappedText.cappedByChars,
    cappedByChars: cappedText.cappedByChars,
  };
}

export function formatReplaceReport(
  matchCount: number,
  fileCount: number,
  results: string[],
  modifiedFiles: string[],
  maxReportFiles = DEFAULT_REPLACE_REPORT_FILE_LIMIT,
  maxChars = DEFAULT_MAX_CHARS,
): {
  text: string;
  results: string[];
  modifiedFiles: string[];
  totalModifiedFiles: number;
  capped: boolean;
  cappedByChars: boolean;
  displayModifiedFiles: string[];
} {
  const normalizedLimit = normalizeLimit(maxReportFiles, DEFAULT_REPLACE_REPORT_FILE_LIMIT);
  const cappedByCount = normalizedLimit > 0 && results.length > normalizedLimit;
  const displayResults = normalizedLimit > 0 ? results.slice(0, normalizedLimit) : results;
  const displayModifiedFiles = normalizedLimit > 0
    ? modifiedFiles.slice(0, normalizedLimit)
    : modifiedFiles;
  const lines = [
    `Replaced ${matchCount} match(es) in ${fileCount} file(s):`,
    "",
    displayResults.join("\n"),
  ];
  if (cappedByCount) {
    lines.push(
      `\n... and ${results.length - normalizedLimit} more modified file report(s) (use maxReportFiles:0 for all)`,
    );
  }
  lines.push(
    "",
    `Modified files (${modifiedFiles.length}${cappedByCount ? `, showing ${displayModifiedFiles.length}` : ""}):`,
    ...displayModifiedFiles.map((file) => `  ${file}`),
  );
  if (cappedByCount) {
    lines.push("  ... use maxReportFiles:0 for the full modified-file list");
  }
  const normalizedMaxChars = normalizeMaxChars(maxChars);
  const cappedText = capText(
    lines.join("\n"),
    normalizedMaxChars,
    "Use maxChars:0 or a higher maxChars for the full replace report.",
  );
  return {
    text: cappedText.text,
    results: cappedText.cappedByChars
      ? capStringDetailsByChars(displayResults, normalizedMaxChars)
      : displayResults,
    modifiedFiles,
    displayModifiedFiles: cappedText.cappedByChars
      ? capStringDetailsByChars(displayModifiedFiles, normalizedMaxChars)
      : displayModifiedFiles,
    totalModifiedFiles: modifiedFiles.length,
    capped: cappedByCount || cappedText.cappedByChars,
    cappedByChars: cappedText.cappedByChars,
  };
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
): string {
  if (explicitLanguage) {
    const normalized = explicitLanguage.trim();
    // Accept both built-in Lang enum values and dynamic language strings
    if ((Lang as Record<string, Lang>)[normalized]) return normalized;
    if (SUPPORTED_LANGUAGES.includes(normalized as any)) return normalized;
    throw new Error(
      `Unknown language "${normalized}". Supported: ${[...SUPPORTED_LANGUAGES].join(", ")}.`,
    );
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
    `No supported language detected in search paths. Supported: ${[...SUPPORTED_LANGUAGES].join(", ")}.`,
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
  // Register all dynamically-loaded languages in a SINGLE call.
  // NOTE: @ast-grep/napi's registerDynamicLanguage only honors the first call;
  // subsequent calls are silently ignored. All dynamic languages must be
  // registered in one object literal.
  // See: https://github.com/ast-grep/ast-grep/issues/XXXX
  try {
    registerDynamicLanguage({ python: langPython, bash: langBash, swift: langSwift });
  } catch (e) {
    console.warn("[pi-ast-grep-tools] Failed to register dynamic languages:", e);
  }
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
          `supported: TypeScript, JavaScript, TSX, Python, Bash, Swift`,
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
      "Search for code patterns using AST (abstract syntax tree) matching. More precise than text search. Supports TypeScript, JavaScript, TSX, Python, Bash, Swift. Pattern syntax is language-specific AST pattern syntax (e.g. `console.log($A)` matches any console.log call, `def $NAME($$$ARGS):` matches any Python function).",
    promptSnippet: "Use ast_grep_search to find structural code patterns.",
    promptGuidelines: [
      "Use ast_grep_search when you need structural code matching that text search (grep) cannot reliably find.",
      "Use ast_grep_search for language-specific patterns like function calls, imports, or class definitions.",
      "Start with a narrow path. Broad patterns across entire repos can produce excessive output. Results are capped at 50 by default.",
    ],
    parameters: Type.Object({
      pattern: Type.String({
        description:
          "AST pattern to match (e.g. 'console.log($A)', 'function $NAME() { }', 'def $NAME($$$ARGS):', 'echo $CMD')",
      }),
      paths: Type.Array(Type.String(), {
        description:
          "File or directory paths to search (defaults to current directory if empty)",
        default: [],
      }),
      language: Type.Optional(
        Type.String({
          description:
            "Language override: TypeScript, JavaScript, Tsx, python, bash, swift. Auto-detected from file extensions if not specified.",
        }),
      ),
      limit: Type.Optional(
        Type.Number({
          description: "Maximum matches to return (0 = unlimited)",
          default: DEFAULT_MATCH_LIMIT,
        }),
      ),
      maxChars: Type.Optional(
        Type.Number({
          description: "Maximum characters in the text output (0 = unlimited)",
          default: DEFAULT_MAX_CHARS,
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
        maxChars?: number;
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

      const fileCache = new Map<string, string[]>();
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
            results.push(formatMatch(node, file, fileCache));
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

      const report = formatSearchReport(
        params.pattern,
        results,
        params.limit,
        params.maxChars,
      );

      return {
        content: [{ type: "text", text: report.text }],
        details: {
          count: matchCount,
          matches: report.matches,
          total: report.total,
          capped: report.capped,
          cappedByChars: report.cappedByChars,
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
      "Replace reports and modified-file lists are capped at 50 files and 6000 characters by default. Use maxReportFiles:0 and/or maxChars:0 for full reports.",
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
          description:
            "Language override: TypeScript, JavaScript, Tsx, python, bash, swift. Auto-detected from file extensions if not specified.",
        }),
      ),
      maxReportFiles: Type.Optional(
        Type.Number({
          description: "Maximum modified-file report entries to return (0 = unlimited)",
          default: DEFAULT_REPLACE_REPORT_FILE_LIMIT,
        }),
      ),
      maxChars: Type.Optional(
        Type.Number({
          description: "Maximum characters in the replace report (0 = unlimited)",
          default: DEFAULT_MAX_CHARS,
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
        maxReportFiles?: number;
        maxChars?: number;
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
      const report = formatReplaceReport(
        matchCount,
        editsByFile.size,
        results,
        modifiedFiles,
        params.maxReportFiles,
        params.maxChars,
      );
      return {
        content: [{ type: "text", text: report.text }],
        details: {
          count: matchCount,
          files: editsByFile.size,
          results: report.results,
          modifiedFiles: report.modifiedFiles,
          displayModifiedFiles: report.displayModifiedFiles,
          totalModifiedFiles: report.totalModifiedFiles,
          capped: report.capped,
          cappedByChars: report.cappedByChars,
        },
      };
    },
  });
}
