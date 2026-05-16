/**
 * Path utilities (package-local)
 *
 * Minimal path normalization helpers extracted from the shared path-utils
 * module. Only includes what this package actually uses to avoid unnecessary
 * code duplication.
 */

import * as path from "node:path";

const MULTIPLE_SLASHES = /\/+/g;

/**
 * Normalize a file path for use as a Map key or in comparisons.
 *
 * - Runs `path.normalize()` to resolve `.` and `..` segments.
 * - Converts backslashes to forward slashes.
 * - Collapses multiple consecutive slashes.
 * - Strips trailing slashes (except for root `/`).
 */
export function normalizePath(filePath: string): string {
  let normalized = filePath.replace(/\\/g, "/");
  normalized = path.normalize(normalized);
  normalized = normalized.replace(/\\/g, "/");
  normalized = normalized.replace(MULTIPLE_SLASHES, "/");
  normalized = path.normalize(normalized);
  normalized = normalized.replace(MULTIPLE_SLASHES, "/");
  if (normalized.length > 1 && normalized.endsWith("/")) {
    normalized = normalized.slice(0, -1);
  }
  return normalized;
}
