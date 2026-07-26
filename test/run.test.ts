import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { parseBaseline } from "../src/baseline.ts";
import { EXIT_NEW_DEBT, EXIT_OK, runRatchet, type RatchetOptions } from "../src/run.ts";
import { runTypeCheck, TscRunError } from "../src/tsc.ts";

const BASE_OUTPUT = [
  "src/a.ts(4,14): error TS2322: Type 'string' is not assignable to type 'number'.",
  "src/a.ts(5,14): error TS2322: Type 'boolean' is not assignable to type 'number'.",
  "src/b.ts(7,32): error TS2345: Argument of type 'number' is not assignable to parameter of type 'string'.",
].join("\n");

/** A stand-in for tsc that returns canned output, so run.ts is tested without compiling. */
function stubRunner(output: string, exitCode = output === "" ? 0 : 2) {
  return async () => ({ output, exitCode });
}

async function workspace(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "tdr-run-"));
}

function options(cwd: string, overrides: Partial<RatchetOptions> = {}): RatchetOptions {
  return {
    cwd,
    baselinePath: "type-debt.json",
    command: "stub",
    signatureMode: "loose",
    updateBaseline: false,
    autoShrink: false,
    failOnStale: false,
    detectRenames: true,
    ...overrides,
  };
}

test("--update-baseline writes the file and exits 0", async () => {
  const cwd = await workspace();
  const result = await runRatchet(
    options(cwd, { updateBaseline: true, runner: stubRunner(BASE_OUTPUT) }),
  );
  assert.equal(result.exitCode, EXIT_OK);
  assert.equal(result.baselineWritten, true);
  assert.equal(result.baseline.totalErrors, 3);

  const written = parseBaseline(await readFile(path.join(cwd, "type-debt.json"), "utf8"), "test");
  assert.equal(written.totalErrors, 3);
});

test("--update-baseline twice on the same errors leaves the file untouched", async () => {
  const cwd = await workspace();
  await runRatchet(options(cwd, { updateBaseline: true, runner: stubRunner(BASE_OUTPUT) }));
  const second = await runRatchet(
    options(cwd, { updateBaseline: true, runner: stubRunner(BASE_OUTPUT) }),
  );
  assert.equal(second.baselineWritten, false);
  assert.match(second.notes.join(" "), /already matched/);
});

test("a run matching the baseline exits 0", async () => {
  const cwd = await workspace();
  await runRatchet(options(cwd, { updateBaseline: true, runner: stubRunner(BASE_OUTPUT) }));
  const result = await runRatchet(options(cwd, { runner: stubRunner(BASE_OUTPUT) }));
  assert.equal(result.exitCode, EXIT_OK);
  assert.equal(result.diff.newErrorCount, 0);
});

test("a new error exits 1 and does not touch the baseline", async () => {
  const cwd = await workspace();
  await runRatchet(options(cwd, { updateBaseline: true, runner: stubRunner(BASE_OUTPUT) }));
  const before = await readFile(path.join(cwd, "type-debt.json"), "utf8");

  const worse = `${BASE_OUTPUT}\nsrc/b.ts(8,40): error TS2554: Expected 1 arguments, but got 2.`;
  const result = await runRatchet(options(cwd, { runner: stubRunner(worse) }));
  assert.equal(result.exitCode, EXIT_NEW_DEBT);
  assert.equal(result.diff.newErrorCount, 1);
  assert.equal(await readFile(path.join(cwd, "type-debt.json"), "utf8"), before);
});

test("a fixed error exits 0 and leaves the baseline for a human to bank", async () => {
  const cwd = await workspace();
  await runRatchet(options(cwd, { updateBaseline: true, runner: stubRunner(BASE_OUTPUT) }));
  const before = await readFile(path.join(cwd, "type-debt.json"), "utf8");

  const better = BASE_OUTPUT.split("\n").slice(0, 2).join("\n");
  const result = await runRatchet(options(cwd, { runner: stubRunner(better) }));
  assert.equal(result.exitCode, EXIT_OK);
  assert.equal(result.diff.fixedErrorCount, 1);
  assert.equal(result.diff.stale, true);
  assert.equal(await readFile(path.join(cwd, "type-debt.json"), "utf8"), before);
});

test("--fail-on-stale turns an unbanked fix into a failure", async () => {
  const cwd = await workspace();
  await runRatchet(options(cwd, { updateBaseline: true, runner: stubRunner(BASE_OUTPUT) }));
  const better = BASE_OUTPUT.split("\n").slice(0, 2).join("\n");
  const result = await runRatchet(options(cwd, { failOnStale: true, runner: stubRunner(better) }));
  assert.equal(result.exitCode, EXIT_NEW_DEBT);
});

test("--auto-shrink banks the fix and still exits 0", async () => {
  const cwd = await workspace();
  await runRatchet(options(cwd, { updateBaseline: true, runner: stubRunner(BASE_OUTPUT) }));
  const better = BASE_OUTPUT.split("\n").slice(0, 2).join("\n");
  const result = await runRatchet(options(cwd, { autoShrink: true, runner: stubRunner(better) }));

  assert.equal(result.exitCode, EXIT_OK);
  assert.equal(result.baselineWritten, true);
  const written = parseBaseline(await readFile(path.join(cwd, "type-debt.json"), "utf8"), "test");
  assert.equal(written.totalErrors, 2);
});

test("--auto-shrink never absorbs a new error", async () => {
  const cwd = await workspace();
  await runRatchet(options(cwd, { updateBaseline: true, runner: stubRunner(BASE_OUTPUT) }));
  const mixed = [
    "src/a.ts(4,14): error TS2322: Type 'string' is not assignable to type 'number'.",
    "src/a.ts(5,14): error TS2322: Type 'boolean' is not assignable to type 'number'.",
    "src/b.ts(8,40): error TS2554: Expected 1 arguments, but got 2.",
  ].join("\n");
  const result = await runRatchet(options(cwd, { autoShrink: true, runner: stubRunner(mixed) }));

  assert.equal(result.exitCode, EXIT_NEW_DEBT);
  const written = parseBaseline(await readFile(path.join(cwd, "type-debt.json"), "utf8"), "test");
  assert.equal(
    written.entries.some((entry) => entry.code === "TS2554"),
    false,
  );
});

test("a missing baseline is a usage error with the command to create one", async () => {
  const cwd = await workspace();
  await assert.rejects(
    runRatchet(options(cwd, { runner: stubRunner(BASE_OUTPUT) })),
    /No baseline at .*--update-baseline/s,
  );
});

test("a clean project can hold an empty baseline", async () => {
  const cwd = await workspace();
  const created = await runRatchet(options(cwd, { updateBaseline: true, runner: stubRunner("") }));
  assert.equal(created.baseline.totalErrors, 0);
  const checked = await runRatchet(options(cwd, { runner: stubRunner("") }));
  assert.equal(checked.exitCode, EXIT_OK);

  const regressed = await runRatchet(
    options(cwd, { runner: stubRunner("src/a.ts(1,1): error TS2322: Type 'a' is not assignable to type 'b'.") }),
  );
  assert.equal(regressed.exitCode, EXIT_NEW_DEBT);
});

test("switching signature mode is refused rather than silently rebaselining", async () => {
  const cwd = await workspace();
  await runRatchet(options(cwd, { updateBaseline: true, runner: stubRunner(BASE_OUTPUT) }));
  await assert.rejects(
    runRatchet(options(cwd, { signatureMode: "exact", runner: stubRunner(BASE_OUTPUT) })),
    /signature mode.*--update-baseline/s,
  );
});

test("warnings are ignored, only errors are ratcheted", async () => {
  const cwd = await workspace();
  const output = [BASE_OUTPUT, "src/a.ts(1,1): warning TS6133: 'x' is declared but never used."].join("\n");
  const result = await runRatchet(options(cwd, { updateBaseline: true, runner: stubRunner(output) }));
  assert.equal(result.baseline.totalErrors, 3);
});

test("a type-check command that fails without diagnostics is an error, not a clean run", async () => {
  await assert.rejects(
    runTypeCheck("stub", ".", async () => ({ output: "sh: tsc: not found", exitCode: 127 })),
    (error: Error) => {
      assert.ok(error instanceof TscRunError);
      assert.match(error.message, /no parseable diagnostics/);
      assert.match(error.message, /sh: tsc: not found/);
      return true;
    },
  );
});

test("pretty output produces a fix-it message rather than a false clean run", async () => {
  await assert.rejects(
    runTypeCheck("tsc --noEmit", ".", async () => ({
      output: "src/a.ts:2:29 - error TS2322: Type 'string' is not assignable.",
      exitCode: 2,
    })),
    /--pretty false/,
  );
});

test("a crashed type check cannot blank out a recorded baseline", async () => {
  const cwd = await workspace();
  await runRatchet(options(cwd, { updateBaseline: true, runner: stubRunner(BASE_OUTPUT) }));
  const before = await readFile(path.join(cwd, "type-debt.json"), "utf8");

  await assert.rejects(
    runRatchet(
      options(cwd, {
        updateBaseline: true,
        runner: async () => ({ output: "Killed", exitCode: 137 }),
      }),
    ),
    /no parseable diagnostics/,
  );
  assert.equal(await readFile(path.join(cwd, "type-debt.json"), "utf8"), before);
});

test("a corrupt baseline fails before the compile, not after it", async () => {
  const cwd = await workspace();
  await writeFile(path.join(cwd, "type-debt.json"), "{ oops", "utf8");
  let ranTypeCheck = false;
  await assert.rejects(
    runRatchet(
      options(cwd, {
        runner: async () => {
          ranTypeCheck = true;
          return { output: BASE_OUTPUT, exitCode: 2 };
        },
      }),
    ),
    /not valid JSON/,
  );
  assert.equal(ranTypeCheck, false);
});
