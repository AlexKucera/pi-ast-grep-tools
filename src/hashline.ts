/**
 * Hashline engine — produces LINE#HASH:content anchors compatible with
 * pi-hashline-edit's read()/edit() tools.
 *
 * Algorithm replicated verbatim from pi-hashline-edit (MIT, coctostan fork).
 * Uses xxhashjs (pure JS) and the custom ZPMQVRWSNKTXJBYH alphabet.
 *
 * **Format verified** against pi-hashline-edit@latest source:
 *   - Separator: `:` (colon) — identical to pi-hashline-edit line 989
 *   - Regex:   `^(\d+)#([A-Z]{2}):(.*)$` — matches parseAnchorRef()
 *   - Hash:    `xxh32(line, seed) & 0xFF` — byte-for-byte identical
 *
 * **ESM-only**: This module uses top-level `await` for dynamic xxhashjs import.
 * It cannot be loaded via `require()` / CommonJS. Pi extensions are ESM by default,
 * so this is safe in the intended context.
 */

let XXH: typeof import("xxhashjs") | null = null;
try {
  XXH = (await import("xxhashjs")).default ?? (await import("xxhashjs"));
} catch {
  // xxhashjs not available — hashline output will be disabled
}

// ── Hash alphabet ──────────────────────────────────────────────────────

/**
 * Custom 16-character hash alphabet. Deliberately excludes:
 * - Hex digits A–F (prevents confusion with hex literals in code)
 * - Visually confusable letters: D, G, I, L, O (look like digits 0, 6, 1, 1, 0)
 * - Common vowels A, E, I, O, U (prevents accidental English words)
 */
const NIBBLE_STR = "ZPMQVRWSNKTXJBYH";

const DICT = Array.from({ length: 256 }, (_, i) => {
  const h = i >>> 4;
  const l = i & 0x0f;
  return `${NIBBLE_STR[h]}${NIBBLE_STR[l]}`;
});

/** Lines containing no alphanumeric chars (only punctuation/symbols/whitespace). */
const RE_SIGNIFICANT = /[\p{L}\p{N}]/u;

function xxh32(input: string, seed = 0): number {
  if (!XXH) return 0;
  return XXH.h32(seed).update(input).digest().toNumber() >>> 0;
}

/** Whether hashline computation is available (xxhashjs loaded successfully). */
export const hashlineAvailable = XXH !== null;

// ── Public API ────────────────────────────────────────────────────────

/**
 * Compute a 2-char hash for a line, matching pi-hashline-edit's algorithm exactly.
 *
 * Rules:
 * - Strip \r, then trimEnd() only (internal whitespace preserved)
 * - Blank/non-significant lines use line index as seed (unique per line)
 * - Significant lines use seed=0
 * - Low byte of xxh32 is looked up in the ZPMQVRWSNKTXJBYH dictionary
 */
export function computeLineHash(lineNumber: number, line: string): string {
  if (!XXH) {
    return "??"; // xxhashjs not available — fallback placeholder
  }
  const cleaned = line.replace(/\r/g, "").trimEnd();
  let seed = 0;
  if (!RE_SIGNIFICANT.test(cleaned)) {
    seed = lineNumber;
  }
  return DICT[xxh32(cleaned, seed) & 0xff];
}

/**
 * Format a single line in pi-hashline-edit's read() output format:
 *   "  12#MQ:actual line content here"
 *
 * Uses `:` (colon) separator — verified identical to pi-hashline-edit
 * formatHashlineRegion() output (hashline.ts:989).
 *
 * lineNumber is left-padded to match the width of the last line number.
 */
export function formatHashlineLine(
  lineNumber: number,
  content: string,
  lineWidth: number,
): string {
  const paddedLineNumber = String(lineNumber).padStart(lineWidth, " ");
  const hash = computeLineHash(lineNumber, content);
  return `${paddedLineNumber}#${hash}:${content}`;
}

/**
 * Format an array of consecutive lines as a hashline region,
 * matching pi-hashline-edit's formatHashlineRegion() output exactly.
 * Output: "  12#MQ:content" with colon separator.
 */
export function formatHashlineRegion(
  lines: string[],
  startLine: number,
): string {
  const lineWidth = String(startLine + Math.max(0, lines.length - 1)).length;
  return lines
    .map((line, index) => formatHashlineLine(startLine + index, line, lineWidth))
    .join("\n");
}
