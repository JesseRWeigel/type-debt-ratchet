import assert from "node:assert/strict";
import { test } from "node:test";
import { parseTscOutput } from "../src/parse.ts";
import {
  countSignatures,
  hashSignature,
  normalizeFilePath,
  normalizeMessage,
  toSignature,
} from "../src/signature.ts";
import type { RawDiagnostic } from "../src/types.ts";

function diagnostic(overrides: Partial<RawDiagnostic> = {}): RawDiagnostic {
  return {
    file: "src/a.ts",
    line: 1,
    column: 1,
    severity: "error",
    code: 2322,
    message: "Type 'string' is not assignable to type 'number'.",
    ...overrides,
  };
}

test("normalizeMessage replaces quoted spans and numbers", () => {
  assert.equal(
    normalizeMessage("Type 'string' is not assignable to type 'number'."),
    "Type '{}' is not assignable to type '{}'.",
  );
  assert.equal(normalizeMessage("Expected 1 arguments, but got 2."), "Expected {n} arguments, but got {n}.");
  assert.equal(
    normalizeMessage("Property 'userId' does not exist on type 'Session'."),
    "Property '{}' does not exist on type '{}'.",
  );
});

test("normalizeMessage collapses whitespace", () => {
  assert.equal(normalizeMessage("  Type\n  'a'   is  bad. "), "Type '{}' is bad.");
});

test("exact mode keeps the message apart from whitespace", () => {
  assert.equal(
    normalizeMessage("Type 'string' is not assignable to type 'number'.", "exact"),
    "Type 'string' is not assignable to type 'number'.",
  );
});

test("errors about different identifiers share one loose signature but not an exact one", () => {
  const a = toSignature(diagnostic({ message: "Property 'userId' does not exist on type 'Session'." }), ".");
  const b = toSignature(diagnostic({ message: "Property 'email' does not exist on type 'Session'." }), ".");
  assert.equal(a.hash, b.hash);

  const exactA = toSignature(
    diagnostic({ message: "Property 'userId' does not exist on type 'Session'." }),
    ".",
    "exact",
  );
  const exactB = toSignature(
    diagnostic({ message: "Property 'email' does not exist on type 'Session'." }),
    ".",
    "exact",
  );
  assert.notEqual(exactA.hash, exactB.hash);
});

test("an odd apostrophe still hashes deterministically", () => {
  const message = "Cannot find name 'x'. Did you mean the instance member's 'this.x'?";
  assert.equal(normalizeMessage(message), normalizeMessage(message));
});

test("the signature ignores line and column entirely", () => {
  const early = toSignature(diagnostic({ line: 4, column: 14 }), ".");
  const late = toSignature(diagnostic({ line: 4000, column: 2 }), ".");
  assert.equal(early.hash, late.hash);
});

test("the signature does not ignore the file", () => {
  const a = toSignature(diagnostic({ file: "src/a.ts" }), ".");
  const b = toSignature(diagnostic({ file: "src/b.ts" }), ".");
  assert.notEqual(a.hash, b.hash);
});

test("the signature does not ignore the code", () => {
  const a = toSignature(diagnostic({ code: 2322 }), ".");
  const b = toSignature(diagnostic({ code: 2345 }), ".");
  assert.notEqual(a.hash, b.hash);
});

test("hashes are stable across runs, so a baseline stays diffable", () => {
  assert.equal(
    hashSignature("src/a.ts", "TS2322", "Type '{}' is not assignable to type '{}'."),
    hashSignature("src/a.ts", "TS2322", "Type '{}' is not assignable to type '{}'."),
  );
});

test("hash field separation prevents adjacent fields from bleeding together", () => {
  assert.notEqual(hashSignature("a", "TS1", "b"), hashSignature("a TS1", "", "b"));
});

test("normalizeFilePath produces repo relative POSIX paths", () => {
  assert.equal(normalizeFilePath("./src/a.ts", "/repo"), "src/a.ts");
  assert.equal(normalizeFilePath("src\\nested\\a.ts", "/repo"), "src/nested/a.ts");
  assert.equal(normalizeFilePath("/repo/src/a.ts", "/repo"), "src/a.ts");
  assert.equal(normalizeFilePath("", "/repo"), "");
});

test("normalizeFilePath keeps a path outside the root addressable", () => {
  assert.equal(normalizeFilePath("/other/a.ts", "/repo"), "../other/a.ts");
});

test("countSignatures counts duplicates within one file", () => {
  const output = [
    "src/a.ts(4,14): error TS2322: Type 'string' is not assignable to type 'number'.",
    "src/a.ts(5,14): error TS2322: Type 'boolean' is not assignable to type 'number'.",
    "src/b.ts(1,1): error TS2345: Argument of type 'number' is not assignable to parameter of type 'string'.",
  ].join("\n");
  const counts = countSignatures(parseTscOutput(output).map((d) => toSignature(d, ".")));
  assert.equal(counts.size, 2);
  const totals = [...counts.values()].map((entry) => entry.count).sort();
  assert.deepEqual(totals, [1, 2]);
});
