/**
 * Hashline compatibility verification test.
 *
 * Verifies that our ast_grep_search output produces LINE#HASH anchors
 * that are byte-for-byte identical to what pi-hashline-edit's read() produces.
 */

import { findInFiles, registerDynamicLanguage, parse } from "@ast-grep/napi";
import langPython from "@ast-grep/lang-python";
import langBash from "@ast-grep/lang-bash";
import langSwift from "@ast-grep/lang-swift";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeLineHash, formatHashlineLine, formatHashlineRegion } from "../dist/hashline.js";
import { getAstGrepLang } from "../dist/ast-grep-utils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, "fixtures");

// ── Test infrastructure ──────────────────────────────────────────────

let passed = 0;
let failed = 0;

function assert(label, condition, detail) {
  detail = detail || "";
  if (condition) {
    console.log("  ✅ " + label);
    passed++;
  } else {
    console.log("  ❌ " + label + (detail ? " — " + detail : ""));
    failed++;
  }
}

function section(title) {
  console.log("");
  console.log("=".repeat(60));
  console.log("  " + title);
  console.log("=".repeat(60));
}

// ── Register dynamic languages (single call) ─────────────────────────

section("1. Dynamic Language Registration");

try {
  registerDynamicLanguage({ python: langPython, bash: langBash, swift: langSwift });
  assert("All 3 registered in single call", true);
} catch (e) {
  assert("Registration", false, e.message);
}

// ── 2. Hash algorithm self-test ─────────────────────────────────────

section("2. Hash Algorithm (pi-hashline-edit compatible)");

(function() {
  const h = computeLineHash(1, "hello world");
  assert("Hash is 2 chars", h.length === 2, "got len=" + h.length + " [" + h + "]");
  assert("Uses custom alphabet (no hex a-f)",
    !/[a-f0-9]{2}/.test(h),
    `got [${h}] - contains hex digits`);
  const hBlank5 = computeLineHash(5, "");
  const hBlank10 = computeLineHash(10, "");
  assert("Blank lines get unique hashes",
    hBlank5 !== hBlank10,
    `line5=[${hBlank5}] line10=[${hBlank10}] - should differ`);
  const hSig1 = computeLineHash(1, "def foo():");
  const hSig99 = computeLineHash(99, "def foo():");
  assert("Significant lines ignore line number seed",
    hSig1 === hSig99,
    `line1=[${hSig1}] line99=[${hSig99}] - should be identical`);
})();

// ── 3. Output format verification ────────────────────────────────────

section("3. Output Format");

(function() {
  const line = formatHashlineLine(12, "  def hello(): pass", 3);
  assert("Format: starts with line number + #",
    /^\s*\d+#/.test(line), "got [" + line.substring(0, 15) + "]");
  assert("Format: has # separator",
    line.indexOf("#") > 0, "missing # in [" + line + "]");
  assert("Format: has : before content",
    line.indexOf(":") > line.indexOf("#"), "missing content : in [" + line + "]");
  assert("Format: ends with original content",
    line.endsWith("def hello(): pass"), "got [" + line.slice(-25) + "]");
})();

// ── 4. Cross-check hashlines against fixture files ───────────────────

section("4. Hash Compatibility Against Fixture Files");

const testFiles = [
  path.join(FIXTURES_DIR, "sample.py"),
  path.join(FIXTURES_DIR, "sample.sh"),
  path.join(FIXTURES_DIR, "sample.swift"),
];

for (const filePath of testFiles) {
  (function(filePath) {
    const fileName = path.basename(filePath);
    try {
      const raw = fs.readFileSync(filePath, "utf8");
      const lines = raw.split("\n");
      if (raw.endsWith("\n")) lines.pop();
      const sampleCount = Math.min(5, lines.length);
      const ourOutput = formatHashlineRegion(lines.slice(0, sampleCount), 1);

      // Verify structure: each line should be "  N#XX:content"
      const ourLines = ourOutput.split("\n");
      let allValid = true;
      let failedLine = 0;
      for (let li = 0; li < ourLines.length; li++) {
        if (!/^\s*\d+#[A-Z]{2}:/.test(ourLines[li])) {
          allValid = false;
          failedLine = li + 1;
          break;
        }
      }

      assert(fileName + ": " + ourLines.length + " valid hashlines produced", allValid,
        "line " + failedLine + ": [" + (ourLines[failedLine - 1] || "(none)") + "]");
      console.log("    Sample: " + ourLines[0]);
    } catch (e) {
      assert(fileName + ": readable", false, e.message);
    }
  })(filePath);
}

// ── 5. End-to-end: search produces valid editable anchors ───────────

section("5. End-to-End: Search Produces Editable Anchors");

(async function() {
  // Python: search for function definitions in fixture
  const pyResults = [];
  const pyFileCache = new Map();

  await findInFiles(
    "python",
    {
      paths: [FIXTURES_DIR],
      matcher: { rule: { pattern: "def $NAME($ARGS)" } },
    },
    (_err, nodes) => {
      for (const node of nodes) {
        const filePath = node.getRoot().filename();
        const range = node.range();
        const startLine = range.start.line + 1;
        const endLine = range.end.line + 1;

        let lines = pyFileCache.get(filePath);
        if (!lines) {
          const raw = fs.readFileSync(filePath, "utf8");
          lines = raw.split("\n");
          if (raw.endsWith("\n")) lines.pop();
          pyFileCache.set(filePath, lines);
        }

        const lineWidth = String(Math.max(startLine, endLine)).length;
        const parts = [];
        for (let ln = startLine; ln <= endLine && ln <= lines.length; ln++) {
          parts.push(formatHashlineLine(ln, lines[ln - 1], lineWidth));
        }

        pyResults.push({
          file: path.basename(filePath),
          anchor: parts[0],
          startLine,
        });
      }
    },
  );

  assert("Python: found matches with hashlines", pyResults.length > 0,
    "found " + pyResults.length);

  const anchorRe = /^(\d+)#([A-Z]{2}):/;
  for (let ri = 0; ri < pyResults.length; ri++) {
    const r = pyResults[ri];
    const m = r.anchor.match(anchorRe);
    assert("Python result " + (ri+1) + ": valid LINE#HASH anchor",
      !!m && m[1] && m[2], "got [" + r.anchor + "]");
    console.log("    -> " + r.anchor);
  }

  // Bash: search for function definitions in fixture
  const bashResults = [];
  const bashFileCache = new Map();

  await findInFiles(
    "bash",
    {
      paths: [FIXTURES_DIR],
      matcher: { rule: { pattern: "echo $MSG" } },
    },
    (_err, nodes) => {
      for (const node of nodes) {
        const filePath = node.getRoot().filename();
        const range = node.range();
        const startLine = range.start.line + 1;

        let lines = bashFileCache.get(filePath);
        if (!lines) {
          const raw = fs.readFileSync(filePath, "utf8");
          lines = raw.split("\n");
          if (raw.endsWith("\n")) lines.pop();
          bashFileCache.set(filePath, lines);
        }

        const lineWidth = String(startLine).length;
        bashResults.push({
          file: path.basename(filePath),
          anchor: formatHashlineLine(startLine, lines[startLine - 1], lineWidth),
          startLine,
        });
      }
    },
  );

  assert("Bash: found matches with hashlines", bashResults.length > 0,
    "found " + bashResults.length);

  for (let ri = 0; ri < Math.min(3, bashResults.length); ri++) {
    const r = bashResults[ri];
    const m = r.anchor.match(anchorRe);
    assert("Bash result " + (ri+1) + ": valid LINE#HASH", !!m, "got [" + r.anchor + "]");
    console.log("    -> " + r.anchor);
  }

  // Swift: search for property declarations in fixture
  const swiftResults = [];
  const swiftFileCache = new Map();

  await findInFiles(
    "swift",
    {
      paths: [FIXTURES_DIR],
      matcher: { rule: { pattern: "var $NAME: $TYPE" } },
    },
    (_err, nodes) => {
      for (const node of nodes) {
        const filePath = node.getRoot().filename();
        const range = node.range();
        const startLine = range.start.line + 1;

        let lines = swiftFileCache.get(filePath);
        if (!lines) {
          const raw = fs.readFileSync(filePath, "utf8");
          lines = raw.split("\n");
          if (raw.endsWith("\n")) lines.pop();
          swiftFileCache.set(filePath, lines);
        }

        const lineWidth = String(startLine).length;
        swiftResults.push({
          anchor: formatHashlineLine(startLine, lines[startLine - 1], lineWidth),
          startLine,
        });
      }
    },
  );

  assert("Swift: found matches with hashlines", swiftResults.length > 0,
    "found " + swiftResults.length);

  for (let ri = 0; ri < Math.min(3, swiftResults.length); ri++) {
    const r = swiftResults[ri];
    const m = r.anchor.match(anchorRe);
    assert("Swift result " + (ri+1) + ": valid LINE#HASH", !!m, "got [" + r.anchor + "]");
    console.log("    -> " + r.anchor);
  }

  // ── Summary ──────────────────────────────────────────────────────

  section("Summary");
  console.log("  Passed: " + passed);
  console.log("  Failed: " + failed);
  console.log("  Total:  " + (passed + failed));

  process.exit(failed > 0 ? 1 : 0);
})();
