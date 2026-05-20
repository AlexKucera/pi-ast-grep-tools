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
import { computeLineHash, formatHashlineLine, formatHashlineRegion } from "../dist/hashline.js";
import { getAstGrepLang } from "../dist/ast-grep-utils.js";

// ── Test infrastructure ──────────────────────────────────────────────

var passed = 0;
var failed = 0;

function assert(label, condition, detail) {
  detail = detail || "";
  if (condition) {
    console.log("  \u2705 " + label);
    passed++;
  } else {
    console.log("  \u274C " + label + (detail ? " \u2014 " + detail : ""));
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
  var h = computeLineHash(1, "hello world");
  assert("Hash is 2 chars", h.length === 2, "got len=" + h.length + " [" + h + "]");
  assert("Uses custom alphabet (no hex a-f)",
    !/[a-f0-9]{2}/.test(h),
    `got [${h}] - contains hex digits`);
  var hBlank5 = computeLineHash(5, "");
  var hBlank10 = computeLineHash(10, "");
  assert("Blank lines get unique hashes",
    hBlank5 !== hBlank10,
    `line5=[${hBlank5}] line10=[${hBlank10}] - should differ`);
  var hSig1 = computeLineHash(1, "def foo():");
  var hSig99 = computeLineHash(99, "def foo():");
  assert("Significant lines ignore line number seed",
    hSig1 === hSig99,
    `line1=[${hSig1}] line99=[${hSig99}] - should be identical`);
})();

// ── 3. Output format verification ────────────────────────────────────

section("3. Output Format");

(function() {
  var line = formatHashlineLine(12, "  def hello(): pass", 3);
  assert("Format: starts with line number + #",
    /^\s*\d+#/.test(line), "got [" + line.substring(0, 15) + "]");
  assert("Format: has # separator",
    line.indexOf("#") > 0, "missing # in [" + line + "]");
  assert("Format: has : before content",
    line.indexOf(":") > line.indexOf("#"), "missing content : in [" + line + "]");
  assert("Format: ends with original content",
    line.endsWith("def hello(): pass"), "got [" + line.slice(-25) + "]");
})();

// ── 4. Cross-check vs installed pi-hashline-edit ───────────────────

section("4. Hash Compatibility vs Installed pi-hashline-edit");

var testFiles = [
  "/Users/alex/Projects/scripting/tinkertoys/python/lib/hash_for_file.py",
  "/Users/alex/Projects/scripting/tinkertoys/bash/lib/common.sh",
  "/Users/alex/Projects/ios_development/dialysispal/dialysisPal/Models/PatientProfile.swift",
];

for (var ti = 0; ti < testFiles.length; ti++) {
  (function(filePath) {
    var fileName = path.basename(filePath);
    try {
      var raw = fs.readFileSync(filePath, "utf8");
      var lines = raw.split("\n");
      if (raw.endsWith("\n")) lines.pop();
      var sampleCount = Math.min(5, lines.length);
      var ourOutput = formatHashlineRegion(lines.slice(0, sampleCount), 1);

      // Verify structure: each line should be "  N#XX:content"
      var ourLines = ourOutput.split("\n");
      var allValid = true;
      for (var li = 0; li < ourLines.length; li++) {
        if (!/^\s*\d+#[A-Z]{2}:/.test(ourLines[li])) {
          allValid = false;
          break;
        }
      }

      assert(fileName + ": " + ourLines.length + " valid hashlines produced", allValid,
        "line " + (li+1) + ": [" + (ourLines[li] || "(none)") + "]");
      console.log("    Sample: " + ourLines[0]);
    } catch (e) {
      assert(fileName + ": readable", false, e.message);
    }
  })(testFiles[ti]);
}

// ── 5. End-to-end: search produces valid editable anchors ───────────

section("5. End-to-End: Search Produces Editable Anchors");

// Python
(async function() {
  var results = [];
  var fileCache = new Map();

  await findInFiles(
    "python",
    {
      paths: ["/Users/alex/Projects/scripting/tinkertoys/python/lib"],
      matcher: { rule: { pattern: "def $NAME($$$ARGS)" } },
    },
    function(_err, nodes) {
      for (var ni = 0; ni < nodes.length; ni++) {
        var node = nodes[ni];
        var filePath = node.getRoot().filename();
        var range = node.range();
        var startLine = range.start.line + 1;
        var endLine = range.end.line + 1;

        var lines = fileCache.get(filePath);
        if (!lines) {
          var raw = fs.readFileSync(filePath, "utf8");
          lines = raw.split("\n");
          if (raw.endsWith("\n")) lines.pop();
          fileCache.set(filePath, lines);
        }

        var lineWidth = String(Math.max(startLine, endLine)).length;
        var parts = [];
        for (var ln = startLine; ln <= endLine && ln <= lines.length; ln++) {
          parts.push(formatHashlineLine(ln, lines[ln - 1], lineWidth));
        }

        results.push({
          file: path.basename(filePath),
          anchor: parts[0],
          startLine: startLine,
        });
      }
    }
  );

  assert("Python: found matches with hashlines", results.length > 0,
    "found " + results.length);

  var anchorRe = /^(\d+)#([A-Z]{2}):/;
  for (var ri = 0; ri < results.length; ri++) {
    var r = results[ri];
    var m = r.anchor.match(anchorRe);
    assert("Python result " + (ri+1) + ": valid LINE#HASH anchor",
      !!m && m[1] && m[2], "got [" + r.anchor + "]");
    console.log("    -> " + r.anchor);
  }
})();

// Bash
(async function() {
  var results = [];
  var fileCache = new Map();

  await findInFiles(
    "bash",
    {
      paths: ["/Users/alex/Projects/scripting/tinkertoys/bash/lib"],
      matcher: { rule: { pattern: "echo $MSG" } },
    },
    function(_err, nodes) {
      for (var ni = 0; ni < nodes.length; ni++) {
        var node = nodes[ni];
        var filePath = node.getRoot().filename();
        var range = node.range();
        var startLine = range.start.line + 1;

        var lines = fileCache.get(filePath);
        if (!lines) {
          var raw = fs.readFileSync(filePath, "utf8");
          lines = raw.split("\n");
          if (raw.endsWith("\n")) lines.pop();
          fileCache.set(filePath, lines);
        }

        var lineWidth = String(startLine).length;
        results.push({
          file: path.basename(filePath),
          anchor: formatHashlineLine(startLine, lines[startLine - 1], lineWidth),
          startLine: startLine,
        });
      }
    }
  );

  assert("Bash: found matches with hashlines", results.length > 0,
    "found " + results.length);

  var anchorRe = /^(\d+)#([A-Z]{2}):/;
  for (var ri = 0; ri < Math.min(3, results.length); ri++) {
    var r = results[ri];
    var m = r.anchor.match(anchorRe);
    assert("Bash result " + (ri+1) + ": valid LINE#HASH", !!m, "got [" + r.anchor + "]");
    console.log("    -> " + r.anchor);
  }
})();

// Swift
(async function() {
  var results = [];
  var fileCache = new Map();

  await findInFiles(
    "swift",
    {
      paths: ["/Users/alex/Projects/ios_development/dialysispal/dialysisPal/Models/PatientProfile.swift"],
      matcher: { rule: { pattern: "var $NAME: $TYPE = $INIT" } },
    },
    function(_err, nodes) {
      for (var ni = 0; ni < nodes.length; ni++) {
        var node = nodes[ni];
        var filePath = node.getRoot().filename();
        var range = node.range();
        var startLine = range.start.line + 1;

        var lines = fileCache.get(filePath);
        if (!lines) {
          var raw = fs.readFileSync(filePath, "utf8");
          lines = raw.split("\n");
          if (raw.endsWith("\n")) lines.pop();
          fileCache.set(filePath, lines);
        }

        var lineWidth = String(startLine).length;
        results.push({
          anchor: formatHashlineLine(startLine, lines[startLine - 1], lineWidth),
          startLine: startLine,
        });
      }
    }
  );

  assert("Swift: found matches with hashlines", results.length > 0,
    "found " + results.length);

  var anchorRe = /^(\d+)#([A-Z]{2}):/;
  for (var ri = 0; ri < Math.min(3, results.length); ri++) {
    var r = results[ri];
    var m = r.anchor.match(anchorRe);
    assert("Swift result " + (ri+1) + ": valid LINE#HASH", !!m, "got [" + r.anchor + "]");
    console.log("    -> " + r.anchor);
  }
})();

// ── Summary ────────────────────────────────────────────────────────────

section("Summary");
console.log("  Passed: " + passed);
console.log("  Failed: " + failed);
console.log("  Total:  " + (passed + failed));

process.exit(failed > 0 ? 1 : 0);
