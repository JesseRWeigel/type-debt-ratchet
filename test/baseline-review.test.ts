import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const tsc = fileURLToPath(new URL("../node_modules/typescript/lib/tsc.js", import.meta.url));
const quote = (arg: string) => `"${arg}"`;

test("the CLI reviews equal-total tsc replacements without touching either snapshot", async (t) => {
  const cwd = await mkdtemp(path.join(tmpdir(), "tdr-baseline-review-"));
  t.after(() => rm(cwd, { recursive: true }));
  const compiled = `${quote(process.execPath)} ${quote(tsc)} --noEmit --strict --pretty false example.ts`;
  const beforePath = path.join(cwd, "before.json");
  const afterPath = path.join(cwd, "after.json");
  const source = path.join(cwd, "example.ts");
  const update = (file: string, mode: string) =>
    execFileSync(process.execPath, [
      cli, "--cwd", cwd, "--baseline", file, "--signature-mode", mode,
      "--command", compiled, "--update-baseline",
    ], { stdio: ["ignore", "ignore", "pipe"] });
  const compare = (...extra: string[]) => spawnSync(process.execPath, [
    cli, "--cwd", cwd, "--compare-baseline", "before.json", "--baseline", "after.json", ...extra,
  ], { encoding: "utf8" });

  await writeFile(source, "export const keep: number = null as unknown as undefined;\nexport const a: number = '';\n");
  update(beforePath, "exact");
  update(path.join(cwd, "before-loose.json"), "loose");
  await writeFile(source, "\nexport const keep: number = null as unknown as undefined;\nexport const a: number = true;\n");
  update(afterPath, "exact");
  update(path.join(cwd, "after-loose.json"), "loose");
  const before = await readFile(beforePath, "utf8");
  const after = await readFile(afterPath, "utf8");
  await rm(source); // Comparing snapshots must not need the checker or project files.

  const json = compare("--format", "json");
  assert.equal(json.status, 0, json.stderr);
  const report = JSON.parse(json.stdout);
  assert.deepEqual(
    [report.mode, report.previous, report.current, report.matched, report.added, report.removed],
    ["exact", 2, 2, 1, 1, 1],
  );
  assert.match(report.additions[0].message, /boolean/);
  assert.match(report.removals[0].message, /string/);
  const loose = spawnSync(process.execPath, [
    cli, "--cwd", cwd, "--compare-baseline", "before-loose.json",
    "--baseline", "after-loose.json", "--format", "json",
  ], { encoding: "utf8" });
  assert.equal(loose.status, 0, loose.stderr);
  const looseReport = JSON.parse(loose.stdout);
  assert.deepEqual([looseReport.matched, looseReport.added, looseReport.removed], [2, 0, 0]);

  const text = compare();
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, /Added baseline debt:[\s\S]*boolean[\s\S]*Removed baseline debt:[\s\S]*string/);
  const markdown = compare("--format", "markdown");
  assert.equal(markdown.status, 0, markdown.stderr);
  assert.match(markdown.stdout, /### Saved baseline review[\s\S]*#### Added baseline debt[\s\S]*#### Removed baseline debt/);

  const conflicted = compare("--update-baseline");
  assert.equal(conflicted.status, 2);
  assert.match(conflicted.stderr, /does not apply/);
  assert.equal(await readFile(beforePath, "utf8"), before);
  assert.equal(await readFile(afterPath, "utf8"), after);

  const tampered = JSON.parse(after);
  tampered.entries[0].message = "modified without changing its hash";
  await writeFile(afterPath, JSON.stringify(tampered));
  const corrupt = compare();
  assert.equal(corrupt.status, 2);
  assert.match(corrupt.stderr, /invalid or duplicate signature hash/);

  const anotherMode = JSON.parse(after);
  anotherMode.signatureMode = "loose";
  await writeFile(afterPath, JSON.stringify(anotherMode));
  const mixed = compare();
  assert.equal(mixed.status, 2);
  assert.match(mixed.stderr, /Cannot compare exact and loose baselines/);
});
