import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { detectGitRenames } from "../src/git.ts";
import { parseArgs } from "../src/cli.ts";
import { optionsFromEnv } from "../src/action.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
function repo(t: TestContext) {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "tdr-git-"));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  git(cwd, "init", "-b", "main");
  git(cwd, "config", "user.name", "Fixture");
  git(cwd, "config", "user.email", "fixture@example.invalid");
  fs.mkdirSync(path.join(cwd, "src"));
  fs.writeFileSync(path.join(cwd, "src/old.ts"), 'const value: number = "wrong";\n');
  git(cwd, "add", "."); git(cwd, "commit", "-m", "base");
  git(cwd, "tag", "base");
  return cwd;
}

test("committed rename in a clean checkout is found against explicit base", t => {
  const cwd = repo(t);
  git(cwd, "mv", "src/old.ts", "src/new.ts"); git(cwd, "commit", "-m", "rename");
  assert.equal(git(cwd, "status", "--porcelain"), "");
  assert.equal(detectGitRenames(cwd).pairs.size, 0);
  assert.equal(detectGitRenames(cwd, "base").pairs.get("src/old.ts"), "src/new.ts");
  assert.equal(detectGitRenames(path.join(cwd, "src"), "base").pairs.get("old.ts"), "new.ts");
});

test("diverged base uses merge base, not the base branch tip", t => {
  const cwd = repo(t);
  git(cwd, "checkout", "-b", "topic");
  git(cwd, "mv", "src/old.ts", "src/new.ts"); git(cwd, "commit", "-m", "topic rename");
  git(cwd, "checkout", "main");
  git(cwd, "mv", "src/old.ts", "src/other.ts"); git(cwd, "commit", "-m", "base diverges");
  git(cwd, "checkout", "topic");
  const lookup = detectGitRenames(cwd, "main");
  assert.equal(lookup.pairs.get("src/old.ts"), "src/new.ts");
  assert.equal(lookup.pairs.has("src/other.ts"), false);
});

test("local staged rename and tracked working-tree edits retain detection", t => {
  const cwd = repo(t);
  git(cwd, "mv", "src/old.ts", "src/new.ts");
  assert.equal(detectGitRenames(cwd).pairs.get("src/old.ts"), "src/new.ts");
  fs.appendFileSync(path.join(cwd, "src/new.ts"), "\n");
  assert.equal(detectGitRenames(cwd).pairs.get("src/old.ts"), "src/new.ts");
});

test("missing and shallow history fail with actionable errors", t => {
  const cwd = repo(t);
  assert.throws(() => detectGitRenames(cwd, "absent"), /Fetch the base revision/);
  fs.writeFileSync(path.join(cwd, "another"), "next");
  git(cwd, "add", "."); git(cwd, "commit", "-m", "next");
  const shallow = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "tdr-shallow-")), "clone");
  t.after(() => fs.rmSync(path.dirname(shallow), { recursive: true, force: true }));
  git(cwd, "clone", "--depth", "1", `file://${cwd}`, shallow);
  assert.throws(() => detectGitRenames(shallow, "base"), /fetch-depth: 0/);
  git(cwd, "checkout", "--orphan", "unrelated");
  git(cwd, "commit", "-m", "independent root");
  assert.throws(() => detectGitRenames(cwd, "base"), /Cannot find a merge base/);
});

test("CLI and Action accept explicit base without guessing one", () => {
  assert.equal(parseArgs(["--base-ref", "origin/main"]).options.baseRef, "origin/main");
  assert.throws(() => parseArgs(["--base-ref"]), /needs a value/);
  assert.equal(optionsFromEnv({ "INPUT_BASE-REF": " origin/main " }).baseRef, "origin/main");
  assert.equal(optionsFromEnv({ GITHUB_BASE_REF: "main" }).baseRef, undefined);
});

test("actual compiled CLI accepts clean committed rename but rejects extra debt", t => {
  const cwd = repo(t);
  fs.writeFileSync(path.join(cwd, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true, noEmit: true, types: [] }, include: ["src"] }));
  const command = `${JSON.stringify(process.execPath)} ${JSON.stringify(path.join(root, "node_modules/typescript/bin/tsc"))} --pretty false`;
  const run = (...extra: string[]) => spawnSync(process.execPath, [path.join(root, "dist/cli.js"), "--cwd", cwd, "--command", command, ...extra], { encoding: "utf8" });
  let result = run("--update-baseline");
  assert.equal(result.status, 0, result.stderr);
  git(cwd, "add", "."); git(cwd, "commit", "-m", "baseline");
  git(cwd, "tag", "baseline");
  git(cwd, "mv", "src/old.ts", "src/new.ts"); git(cwd, "commit", "-m", "rename");
  assert.equal(git(cwd, "status", "--porcelain"), "");
  result = run("--base-ref", "baseline");
  assert.equal(result.status, 0, result.stderr + result.stdout);
  fs.writeFileSync(path.join(cwd, "src/extra.ts"), 'const extra: boolean = "wrong";\n');
  git(cwd, "add", "."); git(cwd, "commit", "-m", "new debt");
  result = run("--base-ref", "baseline");
  assert.equal(result.status, 1, result.stderr + result.stdout);
  git(cwd, "rm", "src/extra.ts");
  fs.appendFileSync(path.join(cwd, "src/new.ts"), 'const another: boolean = "wrong";\n');
  git(cwd, "add", "."); git(cwd, "commit", "-m", "new debt inside renamed file");
  result = run("--base-ref", "baseline");
  assert.equal(result.status, 1, result.stderr + result.stdout);
  const before = fs.readFileSync(path.join(cwd, "type-debt.json"), "utf8");
  result = run("--base-ref", "absent", "--update-baseline");
  assert.equal(result.status, 2);
  assert.equal(fs.readFileSync(path.join(cwd, "type-debt.json"), "utf8"), before);
});
