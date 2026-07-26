import assert from "node:assert/strict";
import { test } from "node:test";
import { looksLikePrettyOutput, parseTscOutput, stripAnsi } from "../src/parse.ts";

test("parses a single file diagnostic", () => {
  const [diagnostic] = parseTscOutput(
    `src/a.ts(4,14): error TS2322: Type 'string' is not assignable to type 'number'.`,
  );
  assert.deepEqual(diagnostic, {
    file: "src/a.ts",
    line: 4,
    column: 14,
    severity: "error",
    code: 2322,
    message: "Type 'string' is not assignable to type 'number'.",
  });
});

test("parses several diagnostics and ignores blank lines", () => {
  const diagnostics = parseTscOutput(
    [
      "src/a.ts(4,14): error TS2322: Type 'string' is not assignable to type 'number'.",
      "",
      "src/b.ts(7,32): error TS2345: Argument of type 'number' is not assignable to parameter of type 'string'.",
    ].join("\n"),
  );
  assert.equal(diagnostics.length, 2);
  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.code),
    [2322, 2345],
  );
});

test("attaches indented elaboration lines to the diagnostic above them", () => {
  const diagnostics = parseTscOutput(
    [
      "src/m.ts(4,3): error TS2345: Argument of type '(s: string) => void' is not assignable to parameter of type '(n: number) => void'.",
      "  Types of parameters 's' and 'n' are incompatible.",
      "    Type 'number' is not assignable to type 'string'.",
    ].join("\n"),
  );
  assert.equal(diagnostics.length, 1);
  assert.equal(
    diagnostics[0]?.message,
    "Argument of type '(s: string) => void' is not assignable to parameter of type '(n: number) => void'. " +
      "Types of parameters 's' and 'n' are incompatible. " +
      "Type 'number' is not assignable to type 'string'.",
  );
});

test("elaborations attach to the right diagnostic when several are present", () => {
  const diagnostics = parseTscOutput(
    [
      "src/a.ts(1,1): error TS1000: first.",
      "src/b.ts(2,2): error TS1001: second.",
      "  elaboration for second.",
      "src/c.ts(3,3): error TS1002: third.",
    ].join("\n"),
  );
  assert.deepEqual(
    diagnostics.map((diagnostic) => diagnostic.message),
    ["first.", "second. elaboration for second.", "third."],
  );
});

test("parses a project level diagnostic that has no file or position", () => {
  const [diagnostic] = parseTscOutput(
    "error TS18003: No inputs were found in config file 'tsconfig.json'.",
  );
  assert.equal(diagnostic?.file, "");
  assert.equal(diagnostic?.line, null);
  assert.equal(diagnostic?.column, null);
  assert.equal(diagnostic?.code, 18003);
});

test("keeps warnings distinguishable from errors", () => {
  const [diagnostic] = parseTscOutput("src/a.ts(1,1): warning TS6133: 'x' is declared but never used.");
  assert.equal(diagnostic?.severity, "warning");
});

test("ignores the Found N errors footer and the pretty file table", () => {
  const diagnostics = parseTscOutput(
    [
      "src/a.ts(4,14): error TS2322: Type 'string' is not assignable to type 'number'.",
      "",
      "Found 1 error in 1 file.",
      "",
      "Errors  Files",
      "     1  src/a.ts:4",
    ].join("\n"),
  );
  assert.equal(diagnostics.length, 1);
  assert.equal(diagnostics[0]?.message, "Type 'string' is not assignable to type 'number'.");
});

test("handles paths containing parentheses and spaces", () => {
  const [diagnostic] = parseTscOutput(
    "src/my app (v2)/a.ts(10,3): error TS2322: Type 'string' is not assignable to type 'number'.",
  );
  assert.equal(diagnostic?.file, "src/my app (v2)/a.ts");
  assert.equal(diagnostic?.line, 10);
});

test("handles Windows style paths", () => {
  const [diagnostic] = parseTscOutput(
    "src\\a.ts(4,14): error TS2322: Type 'string' is not assignable to type 'number'.",
  );
  assert.equal(diagnostic?.file, "src\\a.ts");
});

test("returns nothing for clean output", () => {
  assert.deepEqual(parseTscOutput(""), []);
  assert.deepEqual(parseTscOutput("\n\n"), []);
});

test("strips ANSI colour before parsing", () => {
  const coloured = "\u001B[96msrc/a.ts\u001B[0m(4,14): \u001B[91merror\u001B[0m TS2322: broken.";
  assert.equal(stripAnsi(coloured), "src/a.ts(4,14): error TS2322: broken.");
  assert.equal(parseTscOutput(coloured).length, 1);
});

test("recognises pretty output so the caller can complain usefully", () => {
  const pretty =
    "\u001B[96msrc/m.ts\u001B[0m:\u001B[93m2\u001B[0m:\u001B[93m29\u001B[0m - \u001B[91merror\u001B[0m\u001B[90m TS2322: \u001B[0mType 'string' is not assignable.";
  assert.equal(looksLikePrettyOutput(pretty), true);
  assert.equal(parseTscOutput(pretty).length, 0);
  assert.equal(
    looksLikePrettyOutput("src/a.ts(4,14): error TS2322: Type 'string' is not assignable."),
    false,
  );
});
