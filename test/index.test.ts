import * as fs from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, it, vi } from "vitest";

const { default: astGrepExtension } = await import("../src/index.js");

// ── Mock Pi ────────────────────────────────────────────────────────────

interface ToolDefinition {
  name: string;
  execute: (
    toolCallId: string,
    params: Record<string, unknown>,
    signal: AbortSignal | undefined,
    onUpdate: ((partialResult: unknown) => void) | undefined,
    ctx: unknown,
  ) => Promise<unknown>;
}

interface CommandDefinition {
  description?: string;
  handler: (args: string, ctx: unknown) => Promise<void>;
}

interface MockPi {
  registerCommand: ReturnType<typeof vi.fn>;
  registerTool: ReturnType<typeof vi.fn>;
  sendMessage: ReturnType<typeof vi.fn>;
  commands: Map<string, CommandDefinition>;
  tools: Map<string, ToolDefinition>;
}

function createMockPi(): MockPi {
  const commands = new Map<string, CommandDefinition>();
  const tools = new Map<string, ToolDefinition>();

  return {
    registerCommand: vi.fn((name: string, definition: CommandDefinition) => {
      commands.set(name, definition);
    }),
    registerTool: vi.fn((definition: ToolDefinition) => {
      tools.set(definition.name, definition);
    }),
    sendMessage: vi.fn(),
    commands,
    tools,
  };
}

// ── Package manifest tests ─────────────────────────────────────────────

describe("@davehardy20/pi-ast-grep-tools", () => {
  it("declares the pi-package keyword and extension manifest", () => {
    const packageJson = JSON.parse(
      fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as {
      keywords?: string[];
      pi?: { extensions?: string[] };
      peerDependencies?: Record<string, string>;
      dependencies?: Record<string, string>;
    };

    expect(packageJson.keywords).toContain("pi-package");
    expect(packageJson.pi?.extensions).toEqual(["./src/index.ts"]);
    expect(packageJson.peerDependencies).toMatchObject({
      "@earendil-works/pi-coding-agent": "*",
      typebox: "*",
    });
    // No pi-tui dependency — headless extension
    expect(
      packageJson.peerDependencies?.["@earendil-works/pi-tui"],
    ).toBeUndefined();
    // @ast-grep/napi is a runtime dependency
    expect(packageJson.dependencies?.["@ast-grep/napi"]).toBeDefined();
  });

  it("registers ast-grep-status command and ast_grep_search + ast_grep_replace tools", () => {
    const pi = createMockPi();
    astGrepExtension(pi as unknown as ExtensionAPI);

    expect(pi.commands.has("ast-grep-status")).toBe(true);
    expect(pi.tools.has("ast_grep_search")).toBe(true);
    expect(pi.tools.has("ast_grep_replace")).toBe(true);
  });

  it("ast-grep-status reports package metadata", async () => {
    const pi = createMockPi();
    astGrepExtension(pi as unknown as ExtensionAPI);

    const statusCommand = pi.commands.get("ast-grep-status");
    expect(statusCommand).toBeDefined();

    await statusCommand!.handler("", {});

    expect(pi.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        customType: "ast-grep-status",
        display: true,
        content: expect.stringContaining("@davehardy20/pi-ast-grep-tools"),
        details: expect.objectContaining({
          packageName: "@davehardy20/pi-ast-grep-tools",
        }),
      }),
    );
  });

  it("ast_grep_search returns no files when path with explicit language has no sources", async () => {
    const pi = createMockPi();
    astGrepExtension(pi as unknown as ExtensionAPI);

    const tool = pi.tools.get("ast_grep_search")!;
    const tmpDir = fs.mkdtempSync("/tmp/pi-ast-grep-test-");
    const ctx = { cwd: tmpDir } as never;
    try {
      const result = (await tool.execute(
        "tc1",
        { pattern: "console.log($A)", paths: [tmpDir], language: "TypeScript" },
        new AbortController().signal,
        undefined,
        ctx,
      )) as {
        content: Array<{ type: string; text: string }>;
        details: Record<string, unknown>;
      };

      expect(result.content[0].text).toContain(
        "No supported source files found",
      );
    } finally {
      fs.rmdirSync(tmpDir);
    }
  });

  it("ast_grep_search finds matches in a TypeScript file", async () => {
    const pi = createMockPi();
    astGrepExtension(pi as unknown as ExtensionAPI);

    // Create a temp TypeScript file
    const tmpDir = fs.mkdtempSync("/tmp/pi-ast-grep-test-");
    const tmpFile = `${tmpDir}/sample.ts`;
    try {
      fs.writeFileSync(tmpFile, 'console.log("hello");\nconsole.log("world");\n', "utf-8");

      const tool = pi.tools.get("ast_grep_search")!;
      const ctx = { cwd: tmpDir } as never;
      const result = (await tool.execute(
        "tc1",
        { pattern: "console.log($A)", paths: [tmpFile] },
        new AbortController().signal,
        undefined,
        ctx,
      )) as {
        content: Array<{ type: string; text: string }>;
        details: { count: number; capped: boolean };
      };

      expect(result.details.count).toBe(2);
      expect(result.content[0].text).toContain("Found 2 match(es)");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("ast_grep_search respects the limit parameter", async () => {
    const pi = createMockPi();
    astGrepExtension(pi as unknown as ExtensionAPI);

    const tmpDir = fs.mkdtempSync("/tmp/pi-ast-grep-test-");
    const tmpFile = `${tmpDir}/sample.ts`;
    try {
      fs.writeFileSync(tmpFile, 'console.log("a");\nconsole.log("b");\nconsole.log("c");\n', "utf-8");

      const tool = pi.tools.get("ast_grep_search")!;
      const ctx = { cwd: tmpDir } as never;
      const result = (await tool.execute(
        "tc1",
        { pattern: "console.log($A)", paths: [tmpFile], limit: 2 },
        new AbortController().signal,
        undefined,
        ctx,
      )) as {
        content: Array<{ type: string; text: string }>;
        details: { count: number; capped: boolean };
      };

      expect(result.details.count).toBe(3);
      expect(result.details.capped).toBe(true);
      expect(result.content[0].text).toContain("more");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("ast_grep_search caps long text with explicit maxChars recovery", async () => {
    const pi = createMockPi();
    astGrepExtension(pi as unknown as ExtensionAPI);

    const tmpDir = fs.mkdtempSync("/tmp/pi-ast-grep-test-");
    const tmpFile = `${tmpDir}/sample.ts`;
    try {
      fs.writeFileSync(
        tmpFile,
        `console.log("${"x".repeat(300)}");\nconsole.log("${"y".repeat(300)}");\n`,
        "utf-8",
      );

      const tool = pi.tools.get("ast_grep_search")!;
      const ctx = { cwd: tmpDir } as never;
      const result = (await tool.execute(
        "tc1",
        { pattern: "console.log($A)", paths: [tmpFile], maxChars: 160 },
        new AbortController().signal,
        undefined,
        ctx,
      )) as {
        content: Array<{ type: string; text: string }>;
        details: { cappedByChars: boolean; matches: string[] };
      };

      expect(result.details.cappedByChars).toBe(true);
      expect(JSON.stringify(result.details.matches).length).toBeLessThanOrEqual(160);
      expect(result.content[0].text.length).toBeLessThanOrEqual(160);
      expect(result.content[0].text).toContain("Use maxChars:0");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("ast_grep_search never exceeds very small maxChars when marker is longer than the cap", async () => {
    const pi = createMockPi();
    astGrepExtension(pi as unknown as ExtensionAPI);

    const tmpDir = fs.mkdtempSync("/tmp/pi-ast-grep-test-");
    const tmpFile = `${tmpDir}/sample.ts`;
    try {
      fs.writeFileSync(tmpFile, `console.log("${"x".repeat(300)}");\n`, "utf-8");

      const tool = pi.tools.get("ast_grep_search")!;
      const ctx = { cwd: tmpDir } as never;
      const result = (await tool.execute(
        "tc1",
        { pattern: "console.log($A)", paths: [tmpFile], maxChars: 5 },
        new AbortController().signal,
        undefined,
        ctx,
      )) as {
        content: Array<{ type: string; text: string }>;
        details: { cappedByChars: boolean };
      };

      expect(result.details.cappedByChars).toBe(true);
      expect(result.content[0].text.length).toBeLessThanOrEqual(5);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("ast_grep_replace applies replacements to files", async () => {
    const pi = createMockPi();
    astGrepExtension(pi as unknown as ExtensionAPI);

    const tmpDir = fs.mkdtempSync("/tmp/pi-ast-grep-test-");
    const tmpFile = `${tmpDir}/sample.ts`;
    try {
      fs.writeFileSync(tmpFile, 'console.log("hello");\n', "utf-8");

      const tool = pi.tools.get("ast_grep_replace")!;
      const ctx = { cwd: tmpDir } as never;
      const result = (await tool.execute(
        "tc1",
        {
          pattern: 'console.log("hello")',
          replacement: 'console.info("hello")',
          paths: [tmpFile],
        },
        new AbortController().signal,
        undefined,
        ctx,
      )) as {
        content: Array<{ type: string; text: string }>;
        details: { count: number; files: number; modifiedFiles: string[] };
      };

      expect(result.details.count).toBe(1);
      expect(result.details.files).toBe(1);

      const updated = fs.readFileSync(tmpFile, "utf-8");
      expect(updated).toContain('console.info("hello")');
      expect(updated).not.toContain('console.log("hello")');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("ast_grep_replace caps modified-file reports but keeps counts and recovery", async () => {
    const pi = createMockPi();
    astGrepExtension(pi as unknown as ExtensionAPI);

    const tmpDir = fs.mkdtempSync("/tmp/pi-ast-grep-test-");
    try {
      const files = ["a.ts", "b.ts", "c.ts"].map((name) => `${tmpDir}/${name}`);
      for (const file of files) {
        fs.writeFileSync(file, 'console.log("hello");\n', "utf-8");
      }

      const tool = pi.tools.get("ast_grep_replace")!;
      const ctx = { cwd: tmpDir } as never;
      const result = (await tool.execute(
        "tc1",
        {
          pattern: 'console.log("hello")',
          replacement: 'console.info("hello")',
          paths: [tmpDir],
          maxReportFiles: 2,
          maxChars: 0,
        },
        new AbortController().signal,
        undefined,
        ctx,
      )) as {
        content: Array<{ type: string; text: string }>;
        details: {
          count: number;
          files: number;
          modifiedFiles: string[];
          displayModifiedFiles: string[];
          totalModifiedFiles: number;
          capped: boolean;
        };
      };

      expect(result.details.count).toBe(3);
      expect(result.details.files).toBe(3);
      expect(result.details.modifiedFiles).toHaveLength(3);
      expect(result.details.displayModifiedFiles).toHaveLength(2);
      expect(result.details.totalModifiedFiles).toBe(3);
      expect(result.details.capped).toBe(true);
      expect(result.content[0].text).toContain("Modified files (3, showing 2)");
      expect(result.content[0].text).toContain("use maxReportFiles:0");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("ast_grep_replace bounds details when maxChars truncates output", async () => {
    const pi = createMockPi();
    astGrepExtension(pi as unknown as ExtensionAPI);

    const tmpDir = fs.mkdtempSync("/tmp/pi-ast-grep-test-");
    try {
      const files = Array.from({ length: 12 }, (_, i) => `${tmpDir}/file-${i}.ts`);
      for (const file of files) {
        fs.writeFileSync(file, 'console.log("hello");\n', "utf-8");
      }

      const tool = pi.tools.get("ast_grep_replace")!;
      const ctx = { cwd: tmpDir } as never;
      const result = (await tool.execute(
        "tc1",
        {
          pattern: 'console.log("hello")',
          replacement: 'console.info("hello")',
          paths: [tmpDir],
          maxReportFiles: 0,
          maxChars: 220,
        },
        new AbortController().signal,
        undefined,
        ctx,
      )) as {
        content: Array<{ type: string; text: string }>;
        details: {
          cappedByChars: boolean;
          results: string[];
          modifiedFiles: string[];
          displayModifiedFiles: string[];
          totalModifiedFiles: number;
        };
      };

      expect(result.details.cappedByChars).toBe(true);
      expect(result.details.totalModifiedFiles).toBe(12);
      expect(JSON.stringify(result.details.results).length).toBeLessThanOrEqual(220);
      expect(result.details.modifiedFiles).toHaveLength(12);
      expect(JSON.stringify(result.details.displayModifiedFiles).length).toBeLessThanOrEqual(220);
      expect(result.details.results.length).toBeLessThan(12);
      expect(result.details.displayModifiedFiles.length).toBeLessThan(12);
      expect(result.content[0].text.length).toBeLessThanOrEqual(220);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("ast_grep_replace returns no matches when pattern not found", async () => {
    const pi = createMockPi();
    astGrepExtension(pi as unknown as ExtensionAPI);

    const tmpDir = fs.mkdtempSync("/tmp/pi-ast-grep-test-");
    const tmpFile = `${tmpDir}/sample.ts`;
    try {
      fs.writeFileSync(tmpFile, "const x = 1;\n", "utf-8");

      const tool = pi.tools.get("ast_grep_replace")!;
      const ctx = { cwd: tmpDir } as never;
      const result = (await tool.execute(
        "tc1",
        {
          pattern: "nonexistent_pattern_xyz($A)",
          replacement: "replaced($A)",
          paths: [tmpFile],
        },
        new AbortController().signal,
        undefined,
        ctx,
      )) as {
        content: Array<{ type: string; text: string }>;
        details: { count: number };
      };

      expect(result.details.count).toBe(0);
      expect(result.content[0].text).toContain("No matches found");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

// ── Helper function tests ──────────────────────────────────────────────

describe("resolveSearchPaths", () => {
  it("returns cwd when paths is empty", async () => {
    const { resolveSearchPaths } = await import("../src/index.js");
    const result = resolveSearchPaths([], "/home/user/project");
    expect(result).toEqual(["/home/user/project"]);
  });

  it("resolves relative paths against cwd", async () => {
    const { resolveSearchPaths } = await import("../src/index.js");
    const result = resolveSearchPaths(["src"], "/home/user/project");
    expect(result).toEqual(["/home/user/project/src"]);
  });

  it("passes through absolute paths", async () => {
    const { resolveSearchPaths } = await import("../src/index.js");
    const result = resolveSearchPaths(
      ["/absolute/path"],
      "/home/user/project",
    );
    expect(result).toEqual(["/absolute/path"]);
  });
});

describe("collectSourceFiles", () => {
  it("returns file if path is a file", async () => {
    const { collectSourceFiles } = await import("../src/index.js");
    const tmpFile = "/tmp/pi-ast-grep-collect-test.ts";
    fs.writeFileSync(tmpFile, "const x = 1;\n", "utf-8");
    try {
      const result = collectSourceFiles([tmpFile]);
      expect(result).toContain(tmpFile);
    } finally {
      fs.rmSync(tmpFile, { force: true });
    }
  });

  it("returns empty for directory with no source files", async () => {
    const { collectSourceFiles } = await import("../src/index.js");
    const tmpDir = fs.mkdtempSync("/tmp/pi-ast-grep-collect-");
    try {
      const result = collectSourceFiles([tmpDir]);
      expect(result).toEqual([]);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("finds TypeScript files recursively", async () => {
    const { collectSourceFiles } = await import("../src/index.js");
    const tmpDir = fs.mkdtempSync("/tmp/pi-ast-grep-collect-");
    try {
      fs.writeFileSync(`${tmpDir}/a.ts`, "const a = 1;\n", "utf-8");
      fs.mkdirSync(`${tmpDir}/sub`);
      fs.writeFileSync(`${tmpDir}/sub/b.ts`, "const b = 2;\n", "utf-8");
      fs.writeFileSync(`${tmpDir}/ignore.txt`, "not source\n", "utf-8");

      const result = collectSourceFiles([tmpDir]);
      expect(result).toHaveLength(2);
      expect(result.map((p) => p.replace(tmpDir, "")).sort()).toEqual([
        "/a.ts",
        "/sub/b.ts",
      ]);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("skips node_modules and .git directories", async () => {
    const { collectSourceFiles } = await import("../src/index.js");
    const tmpDir = fs.mkdtempSync("/tmp/pi-ast-grep-collect-");
    try {
      fs.mkdirSync(`${tmpDir}/node_modules`);
      fs.writeFileSync(
        `${tmpDir}/node_modules/pkg.ts`,
        "const p = 1;\n",
        "utf-8",
      );
      fs.mkdirSync(`${tmpDir}/.git`);
      fs.writeFileSync(`${tmpDir}/.git/hooks.ts`, "const h = 1;\n", "utf-8");
      fs.writeFileSync(`${tmpDir}/real.ts`, "const r = 1;\n", "utf-8");

      const result = collectSourceFiles([tmpDir]);
      expect(result).toHaveLength(1);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

describe("getAstGrepLang", () => {
  it("maps .ts to TypeScript", async () => {
    const { getAstGrepLang } = await import("../src/ast-grep-utils.js");
    expect(getAstGrepLang("file.ts")).toBe("TypeScript");
  });

  it("maps .tsx to Tsx", async () => {
    const { getAstGrepLang } = await import("../src/ast-grep-utils.js");
    expect(getAstGrepLang("file.tsx")).toBe("Tsx");
  });

  it("maps .js to JavaScript", async () => {
    const { getAstGrepLang } = await import("../src/ast-grep-utils.js");
    expect(getAstGrepLang("file.js")).toBe("JavaScript");
  });

  it("returns undefined for unknown extensions", async () => {
    const { getAstGrepLang } = await import("../src/ast-grep-utils.js");
    expect(getAstGrepLang("file.py")).toBeUndefined();
    expect(getAstGrepLang("file.rs")).toBeUndefined();
  });
});

describe("applyEdits", () => {
  it("applies a single edit", async () => {
    const { applyEdits } = await import("../src/ast-grep-utils.js");
    const result = applyEdits("hello world", [
      { startPos: 0, endPos: 5, insertedText: "HELLO" },
    ]);
    expect(result).toBe("HELLO world");
  });

  it("applies multiple edits from right to left", async () => {
    const { applyEdits } = await import("../src/ast-grep-utils.js");
    const result = applyEdits("aaa bbb ccc", [
      { startPos: 0, endPos: 3, insertedText: "AAA" },
      { startPos: 4, endPos: 7, insertedText: "BBB" },
      { startPos: 8, endPos: 11, insertedText: "CCC" },
    ]);
    expect(result).toBe("AAA BBB CCC");
  });
});

describe("normalizePath", () => {
  it("normalizes forward slashes and collapses duplicates", async () => {
    const { normalizePath } = await import("../src/path-utils.js");
    expect(normalizePath("foo//bar///baz")).toBe("foo/bar/baz");
  });

  it("strips trailing slashes", async () => {
    const { normalizePath } = await import("../src/path-utils.js");
    expect(normalizePath("foo/bar/")).toBe("foo/bar");
  });

  it("preserves root slash", async () => {
    const { normalizePath } = await import("../src/path-utils.js");
    expect(normalizePath("/")).toBe("/");
  });
});
