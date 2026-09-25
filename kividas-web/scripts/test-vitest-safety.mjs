import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const run = promisify(execFile);
const packageRoot = fileURLToPath(new URL("../", import.meta.url));

test("isolated worktree tests use threads and ignore broken parent PostCSS", { timeout: 25000 }, async () => {
  const root = await mkdtemp(path.join(tmpdir(), "kividas-test-safety-"));
  const project = path.join(root, "web");
  try {
    await mkdir(project);
    await writeFile(path.join(root, "postcss.config.cjs"),
      'throw new Error("BROKEN_PARENT_POSTCSS_MUST_NOT_LOAD");\n');
    await writeFile(path.join(project, "package.json"), '{"type":"module"}\n');
    await symlink(path.join(packageRoot, "node_modules"), path.join(project, "node_modules"),
      process.platform === "win32" ? "junction" : "dir");
    await copyFile(path.join(packageRoot, "vitest.config.ts"), path.join(project, "vitest.config.ts"));
    await writeFile(path.join(project, "worker.test.ts"), `
import { test, expect } from "vitest";
import { isMainThread } from "node:worker_threads";
test("runs in a worker thread instead of an orphanable child process", () => {
  expect(isMainThread).toBe(false);
});
`);
    const { stdout, stderr } = await run(process.execPath, [
      "--max-old-space-size=512", path.join(packageRoot, "node_modules/vitest/vitest.mjs"), "run",
    ], {
      cwd: project,
      timeout: 20000,
      maxBuffer: 1024 * 1024,
      env: { ...process.env, NODE_OPTIONS: "--max-old-space-size=512", NO_COLOR: "1" },
    });
    assert.match(stdout, /1 passed/);
    assert.doesNotMatch(stdout + stderr, /BROKEN_PARENT_POSTCSS_MUST_NOT_LOAD/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
