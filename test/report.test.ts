import assert from "node:assert/strict";
import { test } from "node:test";
import { buildBaseline } from "../src/baseline.ts";
import { diffAgainstBaseline } from "../src/diff.ts";
import { parseTscOutput } from "../src/parse.ts";
import { COMMENT_MARKER, renderComment, renderTerminal, verdictLine } from "../src/report.ts";
import { countSignatures, toSignature } from "../src/signature.ts";
import type { RatchetDiff } from "../src/types.ts";

function counts(lines: readonly string[]) {
  return countSignatures(parseTscOutput(lines.join("\n")).map((d) => toSignature(d, ".")));
}

const BASE = [
  "src/a.ts(4,14): error TS2322: Type 'string' is not assignable to type 'number'.",
  "src/b.ts(7,32): error TS2345: Argument of type 'number' is not assignable to parameter of type 'string'.",
];

function diffFor(before: readonly string[], after: readonly string[]): RatchetDiff {
  return diffAgainstBaseline(buildBaseline(counts(before), "loose"), counts(after), {
    fileExists: () => true,
  });
}

const options = { baselinePath: "type-debt.json" };

test("verdictLine states the outcome in plain words", () => {
  assert.equal(verdictLine(diffFor(BASE, BASE)), "No new type errors");
  assert.equal(
    verdictLine(diffFor(BASE, [BASE[0] as string])),
    "No new type errors, and 1 type error fixed",
  );
  assert.equal(
    verdictLine(diffFor(BASE, [...BASE, "src/c.ts(1,1): error TS2554: Expected 1 arguments, but got 2."])),
    "1 new type error not in the baseline",
  );
});

test("the comment carries the marker so it can be updated in place", () => {
  const body = renderComment(diffFor(BASE, BASE), options);
  assert.ok(body.startsWith(COMMENT_MARKER));
});

test("the comment reports the counts a reviewer needs", () => {
  const body = renderComment(
    diffFor(BASE, [...BASE, "src/c.ts(1,1): error TS2554: Expected 1 arguments, but got 2."]),
    options,
  );
  assert.match(body, /Type debt went up/);
  assert.match(body, /\| Baseline \| 2 \|/);
  assert.match(body, /\| This branch \| 3 \|/);
  assert.match(body, /\| Net change \| \+1 \|/);
  assert.match(body, /#### New debt/);
  assert.match(body, /TS2554/);
  assert.match(body, /--update-baseline/);
});

test("a clean run says debt held and offers no update instruction", () => {
  const body = renderComment(diffFor(BASE, BASE), options);
  assert.match(body, /Type debt held/);
  assert.equal(body.includes("#### New debt"), false);
  assert.equal(body.includes("--update-baseline"), false);
});

test("a run that only fixes errors nudges toward banking them", () => {
  const body = renderComment(diffFor(BASE, [BASE[0] as string]), options);
  assert.match(body, /Type debt held/);
  assert.match(body, /#### Debt paid down/);
  assert.match(body, /ahead of reality/);
});

test("renames are called out explicitly", () => {
  const diff = diffAgainstBaseline(
    buildBaseline(counts(BASE), "loose"),
    counts([
      BASE[0] as string,
      "src/lib/b.ts(7,32): error TS2345: Argument of type 'number' is not assignable to parameter of type 'string'.",
    ]),
    { fileExists: (file) => file !== "src/b.ts" },
  );
  const body = renderComment(diff, options);
  assert.match(body, /#### Renamed files/);
  assert.match(body, /`src\/b\.ts` → `src\/lib\/b\.ts`/);
});

test("pipe characters in a message cannot break out of the markdown table", () => {
  const diff: RatchetDiff = {
    added: [
      {
        hash: "abc",
        file: "src/a.ts",
        code: "TS2322",
        message: "Type '{}' is not assignable to type 'a | b'.",
        baselineCount: 0,
        currentCount: 1,
        delta: 1,
      },
    ],
    fixed: [],
    newErrorCount: 1,
    fixedErrorCount: 0,
    baselineTotal: 0,
    currentTotal: 1,
    renames: [],
    stale: false,
  };
  const row = renderComment(diff, options)
    .split("\n")
    .find((line) => line.includes("TS2322"));
  assert.ok(row, "expected a table row for the error");
  assert.match(row, /a \\\| b/, "the pipe should be escaped");
  assert.equal(row.replaceAll("\\|", "").split("|").length - 1, 6, "row should have exactly 5 cells");
});

test("large diffs are truncated rather than posting a thousand rows", () => {
  const many = Array.from(
    { length: 40 },
    (_unused, index) => `src/f${index}.ts(1,1): error TS2322: Type 'string' is not assignable to type 'number'.`,
  );
  const body = renderComment(diffFor([], many), options);
  assert.match(body, /20 more signatures not shown/);
});

test("terminal output ends in a machine greppable PASS or FAIL", () => {
  assert.match(renderTerminal(diffFor(BASE, BASE), options), /\nPASS {2}No new type errors$/);
  const failing = renderTerminal(
    diffFor(BASE, [...BASE, "src/c.ts(1,1): error TS2554: Expected 1 arguments, but got 2."]),
    options,
  );
  assert.match(failing, /FAIL {2}1 new type error/);
  assert.match(failing, /^baseline 2 {2}current 3 {2}new 1 {2}fixed 0$/m);
});

test("a project level diagnostic renders without an empty file cell", () => {
  const body = renderComment(diffFor([], ["error TS18003: No inputs were found."]), options);
  assert.match(body, /`\(project\)`/);
});
