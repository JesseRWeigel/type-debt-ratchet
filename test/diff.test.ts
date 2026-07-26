import assert from "node:assert/strict";
import { test } from "node:test";
import { buildBaseline } from "../src/baseline.ts";
import { applyRenames, detectRenames, diffAgainstBaseline, shrinkBaseline } from "../src/diff.ts";
import { parseTscOutput } from "../src/parse.ts";
import { countSignatures, toSignature } from "../src/signature.ts";
import type { Baseline } from "../src/types.ts";

/** Build counted signatures from lines of tsc output. */
function counts(lines: readonly string[]) {
  return countSignatures(parseTscOutput(lines.join("\n")).map((d) => toSignature(d, ".")));
}

function baselineFrom(lines: readonly string[]): Baseline {
  return buildBaseline(counts(lines), "loose");
}

/** No file exists, which is what a fresh rename looks like from the old path's side. */
const noFiles = () => false;
/** Every file exists, which disables rename matching. */
const allFiles = () => true;

const TWO_2322 = [
  "src/a.ts(4,14): error TS2322: Type 'string' is not assignable to type 'number'.",
  "src/a.ts(5,14): error TS2322: Type 'boolean' is not assignable to type 'number'.",
];
const ONE_2345 = [
  "src/b.ts(7,32): error TS2345: Argument of type 'number' is not assignable to parameter of type 'string'.",
];

test("an unchanged run produces no debt in either direction", () => {
  const baseline = baselineFrom([...TWO_2322, ...ONE_2345]);
  const diff = diffAgainstBaseline(baseline, counts([...TWO_2322, ...ONE_2345]), {
    fileExists: allFiles,
  });
  assert.equal(diff.newErrorCount, 0);
  assert.equal(diff.fixedErrorCount, 0);
  assert.equal(diff.stale, false);
  assert.deepEqual(diff.added, []);
});

test("line numbers moving is not new debt", () => {
  const baseline = baselineFrom(TWO_2322);
  const moved = [
    "src/a.ts(400,14): error TS2322: Type 'string' is not assignable to type 'number'.",
    "src/a.ts(401,14): error TS2322: Type 'boolean' is not assignable to type 'number'.",
  ];
  const diff = diffAgainstBaseline(baseline, counts(moved), { fileExists: allFiles });
  assert.equal(diff.newErrorCount, 0);
  assert.equal(diff.fixedErrorCount, 0);
});

test("a brand new error in a baselined file is new debt", () => {
  const baseline = baselineFrom(TWO_2322);
  const diff = diffAgainstBaseline(
    baseline,
    counts([...TWO_2322, "src/a.ts(9,1): error TS2554: Expected 1 arguments, but got 2."]),
    { fileExists: allFiles },
  );
  assert.equal(diff.newErrorCount, 1);
  assert.equal(diff.added.length, 1);
  assert.equal(diff.added[0]?.code, "TS2554");
  assert.equal(diff.added[0]?.baselineCount, 0);
});

test("more of the same error in one file is new debt, which is the point of counting", () => {
  const baseline = baselineFrom(TWO_2322);
  const worse = [
    ...TWO_2322,
    "src/a.ts(6,14): error TS2322: Type 'null' is not assignable to type 'number'.",
    "src/a.ts(7,14): error TS2322: Type 'undefined' is not assignable to type 'number'.",
  ];
  const diff = diffAgainstBaseline(baseline, counts(worse), { fileExists: allFiles });
  assert.equal(diff.newErrorCount, 2);
  assert.equal(diff.added[0]?.baselineCount, 2);
  assert.equal(diff.added[0]?.currentCount, 4);
  assert.equal(diff.added[0]?.delta, 2);
});

test("fewer of the same error is paid-down debt and does not fail", () => {
  const baseline = baselineFrom(TWO_2322);
  const diff = diffAgainstBaseline(baseline, counts([TWO_2322[0] as string]), { fileExists: allFiles });
  assert.equal(diff.newErrorCount, 0);
  assert.equal(diff.fixedErrorCount, 1);
  assert.equal(diff.stale, true);
});

test("an entirely fixed file leaves the baseline stale but passing", () => {
  const baseline = baselineFrom([...TWO_2322, ...ONE_2345]);
  const diff = diffAgainstBaseline(baseline, counts(TWO_2322), { fileExists: allFiles });
  assert.equal(diff.newErrorCount, 0);
  assert.equal(diff.fixedErrorCount, 1);
  assert.equal(diff.fixed[0]?.file, "src/b.ts");
  assert.equal(diff.fixed[0]?.currentCount, 0);
});

test("one fix and one addition reports both, and still fails", () => {
  const baseline = baselineFrom([
    ...TWO_2322,
    "src/a.ts(12,27): error TS2339: Property 'displayName' does not exist on type 'Session'.",
    ...ONE_2345,
  ]);
  const after = [
    ...TWO_2322,
    ...ONE_2345,
    "src/b.ts(8,40): error TS2554: Expected 1 arguments, but got 2.",
  ];
  const diff = diffAgainstBaseline(baseline, counts(after), { fileExists: allFiles });
  assert.equal(diff.newErrorCount, 1);
  assert.equal(diff.fixedErrorCount, 1);
  assert.equal(diff.added[0]?.code, "TS2554");
  assert.equal(diff.fixed[0]?.code, "TS2339");
});

test("a renamed file carries its debt over instead of reading as new", () => {
  const baseline = baselineFrom([...TWO_2322, ...ONE_2345]);
  const moved = [
    ...TWO_2322,
    "src/lib/b.ts(7,32): error TS2345: Argument of type 'number' is not assignable to parameter of type 'string'.",
  ];
  const diff = diffAgainstBaseline(baseline, counts(moved), {
    fileExists: (file) => file !== "src/b.ts",
  });
  assert.deepEqual(diff.renames, [{ from: "src/b.ts", to: "src/lib/b.ts", errors: 1 }]);
  assert.equal(diff.newErrorCount, 0);
  assert.equal(diff.fixedErrorCount, 0);
});

test("rename matching is refused when the old file is still on disk", () => {
  const baseline = baselineFrom([...TWO_2322, ...ONE_2345]);
  const moved = [
    ...TWO_2322,
    "src/lib/b.ts(7,32): error TS2345: Argument of type 'number' is not assignable to parameter of type 'string'.",
  ];
  const diff = diffAgainstBaseline(baseline, counts(moved), { fileExists: allFiles });
  assert.deepEqual(diff.renames, []);
  assert.equal(diff.newErrorCount, 1);
  assert.equal(diff.fixedErrorCount, 1);
});

test("--no-rename-detection turns a move back into new debt", () => {
  const baseline = baselineFrom(ONE_2345);
  const moved = [
    "src/lib/b.ts(7,32): error TS2345: Argument of type 'number' is not assignable to parameter of type 'string'.",
  ];
  const diff = diffAgainstBaseline(baseline, counts(moved), {
    fileExists: noFiles,
    detectRenames: false,
  });
  assert.equal(diff.newErrorCount, 1);
});

test("a move plus an edit is honestly reported as new debt, not a silent rename", () => {
  const baseline = baselineFrom(ONE_2345);
  const movedAndEdited = [
    "src/lib/b.ts(7,32): error TS2345: Argument of type 'number' is not assignable to parameter of type 'string'.",
    "src/lib/b.ts(9,1): error TS2554: Expected 1 arguments, but got 2.",
  ];
  const diff = diffAgainstBaseline(baseline, counts(movedAndEdited), { fileExists: noFiles });
  assert.deepEqual(diff.renames, []);
  assert.equal(diff.newErrorCount, 2);
});

test("a new file whose errors match nothing is not mistaken for a rename", () => {
  const baseline = baselineFrom(TWO_2322);
  const withNewFile = [
    ...TWO_2322,
    "src/c.ts(1,1): error TS2345: Argument of type 'number' is not assignable to parameter of type 'string'.",
  ];
  const diff = diffAgainstBaseline(baseline, counts(withNewFile), { fileExists: allFiles });
  assert.deepEqual(diff.renames, []);
  assert.equal(diff.newErrorCount, 1);
});

test("two files renamed with identical fingerprints pair deterministically", () => {
  const baseline = baselineFrom([
    "src/x.ts(1,1): error TS2322: Type 'string' is not assignable to type 'number'.",
    "src/y.ts(1,1): error TS2322: Type 'string' is not assignable to type 'number'.",
  ]);
  const moved = counts([
    "src/p.ts(1,1): error TS2322: Type 'string' is not assignable to type 'number'.",
    "src/q.ts(1,1): error TS2322: Type 'string' is not assignable to type 'number'.",
  ]);
  const first = detectRenames(baseline, moved, noFiles);
  const second = detectRenames(baseline, moved, noFiles);
  assert.deepEqual(first, second);
  assert.deepEqual(
    first.map((rename) => `${rename.from}->${rename.to}`),
    ["src/x.ts->src/p.ts", "src/y.ts->src/q.ts"],
  );
});

test("applyRenames recomputes hashes so remapped entries match current signatures", () => {
  const baseline = baselineFrom(ONE_2345);
  const remapped = applyRenames(baseline, [{ from: "src/b.ts", to: "src/lib/b.ts", errors: 1 }]);
  const current = counts([
    "src/lib/b.ts(7,32): error TS2345: Argument of type 'number' is not assignable to parameter of type 'string'.",
  ]);
  assert.ok(current.has(remapped.entries[0]?.hash as string));
});

test("project level diagnostics are tracked under an empty file and never renamed", () => {
  const baseline = baselineFrom(["error TS18003: No inputs were found in config file 'tsconfig.json'."]);
  assert.equal(baseline.entries[0]?.file, "");
  const diff = diffAgainstBaseline(baseline, counts([]), { fileExists: noFiles });
  assert.deepEqual(diff.renames, []);
  assert.equal(diff.fixedErrorCount, 1);
});

test("shrinkBaseline banks fixes without absorbing new errors", () => {
  const baseline = baselineFrom([...TWO_2322, ...ONE_2345]);
  const after = counts([
    TWO_2322[0] as string,
    "src/a.ts(9,1): error TS2554: Expected 1 arguments, but got 2.",
  ]);
  const diff = diffAgainstBaseline(baseline, after, { fileExists: allFiles });
  const shrunk = shrinkBaseline(baseline, diff);

  assert.equal(shrunk.totalErrors, 1, "only the surviving TS2322 stays");
  assert.deepEqual(
    shrunk.entries.map((entry) => `${entry.file} ${entry.code} ${entry.count}`),
    ["src/a.ts TS2322 1"],
  );
  assert.equal(
    shrunk.entries.some((entry) => entry.code === "TS2554"),
    false,
    "auto-shrink must never record a new error",
  );
});

test("shrinkBaseline follows a rename before shrinking", () => {
  const baseline = baselineFrom([...TWO_2322, ...ONE_2345]);
  const moved = counts([
    TWO_2322[0] as string,
    "src/lib/b.ts(7,32): error TS2345: Argument of type 'number' is not assignable to parameter of type 'string'.",
  ]);
  const diff = diffAgainstBaseline(baseline, moved, { fileExists: (file) => file !== "src/b.ts" });
  const shrunk = shrinkBaseline(baseline, diff);
  assert.deepEqual(
    shrunk.entries.map((entry) => `${entry.file} ${entry.count}`),
    ["src/a.ts 1", "src/lib/b.ts 1"],
  );
});
