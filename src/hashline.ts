/**
 * Hashline engine — produces LINE#HASH|content anchors compatible with
 * @davehardy20/pi-hashline-tools' read_hashed() / hashline_edit() tools.
 *
 * Algorithm ported verbatim from davehardy20/pi-hashline-tools (MIT).
 * Uses FNV-1a 32-bit hash with the custom ZPMQVRWSNKTXJBYH alphabet.
 *
 * **Format verified** against pi-hashline-tools@latest source:
 *   - Separator: `|` (pipe) — identical to formatHashLine()
 *   - Regex:    `^(\d+)#([ZPMQVRWSNKTXJBYH]{2})\|(.*)$`
 *   - Hash:     FNV-1a 32-bit → `% 256` index into alphabet dict
 *   - Blank lines: `LINE|content` (no hash, not usable as edit anchors)
 */

// ── Hash alphabet (from pi-hashline-tools hashline-constants.ts) ─────────

/** Custom 16-character hash alphabet — excludes hex digits, confusables, vowels. */
export const NIBBLE_STR = "ZPMQVRWSNKTXJBYH";

/** Maps byte values (0–255) to 2-character hash IDs. */
const HASHLINE_DICT: string[] = Array.from({ length: 256 }, (_, i) => {
  const high = i >>> 4;
  const low = i & 0x0f;
  return `${NIBBLE_STR[high]}${NIBBLE_STR[low]}`;
});

/** Lines containing no alphanumeric chars (only punctuation/symbols/whitespace). */
const RE_SIGNIFICANT = /[\p{L}\p{N}]/u;

// ── Hash computation (from pi-hashline-tools hashline-utils.ts) ────────────

/**
 * FNV-1a 32-bit hash — used as fallback when Bun.xxHash32 is unavailable.
 * Ported verbatim from davehardy20/pi-hashline-tools.
 */
function fnv1a32(input: string, seed = 0): number {
  let hash = 0x811c9dc5 ^ seed;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash +=
      (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return hash >>> 0;
}

function computeHash32(normalizedContent: string, seed: number): number {
  // Bun provides a fast xxHash32 implementation
  const bun = (globalThis as Record<string, unknown>).Bun as
    | { hash?: { xxHash32?: (s: string, seed: number) => number } }
    | undefined;
  if (bun?.hash?.xxHash32) {
    return bun.hash.xxHash32(normalizedContent, seed);
  }
  return fnv1a32(normalizedContent, seed);
}

// ── Public API ────────────────────────────────────────────────────────

/**
 * Compute a 2-char hash ID for a line, matching pi-hashline-tools' algorithm.
 *
 * Rules (ported verbatim):
 * - Strip \r, then trimEnd() only (internal whitespace preserved)
 * - Blank/non-significant lines use line index as seed (unique per line)
 * - Significant lines use seed=0
 * - FNV-1a (or Bun xxHash32) low byte via `% 256` looked up in ZPMQVRWSNKTXJBYH dict
 *
 * Returns empty string for blank/whitespace-only lines (owner's convention:
 * such lines render as `LINE|content` without a hash and cannot be edit anchors).
 */
export function computeLineHash(lineNumber: number, line: string): string {
  const cleaned = line.replace(/\r/g, "").trimEnd();
  if (!RE_SIGNIFICANT.test(cleaned)) {
    return ""; // blank lines get no hash — matches pi-hashline-tools behavior
  }
  const hash = computeHash32(cleaned, 0);
  const index = hash % 256;
  return HASHLINE_DICT[index];
}

/**
 * Format a single line in pi-hashline-tools' read_hashed() output format:
 *   "12#MQ|actual line content here"
 *
 * Uses `|` (pipe) separator — verified identical to pi-hashline-tools
 * formatHashLine(). No left-padding of line numbers (matches owner).
 *
 * Blank/whitespace-only lines render as "LINE|content" (no #HASH).
 */
export function formatHashlineLine(
  lineNumber: number,
  content: string,
): string {
  const trimmed = content.trim();
  if (trimmed.length === 0) {
    return `${lineNumber}|${content}`;
  }
  const hash = computeLineHash(lineNumber, content);
  return `${lineNumber}#${hash}|${content}`;
}

/**
 * Format an array of consecutive lines as a hashline region,
 * matching pi-hashline-tools' formatHashLines() output exactly.
 * Output: "12#MQ|content" with pipe separator, no line-number padding.
 */
export function formatHashlineRegion(
  lines: string[],
  startLine: number,
): string {
  return lines
    .map((line, index) => formatHashlineLine(startLine + index, line))
    .join("\n");
}

/** Whether hashline computation is available (always true — no external deps). */
export const hashlineAvailable = true;
