import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  BaselineError,
  buildBaseline,
  emptyBaseline,
  parseBaseline,
  readBaseline,
  serializeBaseline,
  writeBaseline,
} from "../src/baseline.ts";
import { countSignatures, toSignature } from "../src/signature.ts";
import { parseTscOutput } from "../src/parse.ts";

const SAMPLE = [
  "src/b.ts(1,1): error TS2345: Argument of type 'number' is not assignable to parameter of type 'string'.",
  "src/a.ts(4,14): error TS2322: Type 'string' is not assignable to type 'number'.",
  "src/a.ts(5,14): error TS2322: Type 'boolean' is not assignable to type 'number'.",
].join("\n");

function sampleCounts() {
  return countSignatures(parseTscOutput(SAMPLE).map((d) => toSignature(d, ".")));
}

async function tempDir(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "tdr-baseline-"));
}

test("buildBaseline totals and sorts", () => {
  const baseline = buildBaseline(sampleCounts(), "loose");
  assert.equal(baseline.totalErrors, 3);
  assert.deepEqual(
    baseline.entries.map((entry) => entry.file),
    ["src/a.ts", "src/b.ts"],
  );
  assert.equal(baseline.entries[0]?.count, 2);
});

test("serialization is deterministic, so the committed file does not churn", () => {
  const first = serializeBaseline(buildBaseline(sampleCounts(), "loose"));
  const second = serializeBaseline(buildBaseline(sampleCounts(), "loose"));
  assert.equal(first, second);
  assert.ok(first.endsWith("\n"), "baseline should end with a newline");
  assert.equal(first.includes("generatedAt"), false, "no timestamp should be recorded");
  assert.match(first, /"count": 2/);
});

test("the baseline records no line numbers", () => {
  const text = serializeBaseline(buildBaseline(sampleCounts(), "loose"));
  assert.equal(/"line"|\(4,14\)|\(5,14\)/.test(text), false);
});

test("a baseline round trips through parse", () => {
  const baseline = buildBaseline(sampleCounts(), "loose");
  assert.deepEqual(parseBaseline(serializeBaseline(baseline), "test"), baseline);
});

test("parseBaseline rejects malformed input with an actionable message", () => {
  assert.throws(() => parseBaseline("{", "b.json"), (error: Error) => {
    assert.ok(error instanceof BaselineError);
    assert.match(error.message, /not valid JSON/);
    return true;
  });
  assert.throws(() => parseBaseline("[]", "b.json"), /must contain a JSON object/);
  assert.throws(() => parseBaseline('{"version":2}', "b.json"), /version 2/);
  assert.throws(
    () => parseBaseline('{"version":1,"signatureMode":"weird","entries":[]}', "b.json"),
    /unknown signatureMode/,
  );
  assert.throws(() => parseBaseline('{"version":1,"signatureMode":"loose"}', "b.json"), /entries/);
  assert.throws(
    () =>
      parseBaseline(
        '{"version":1,"signatureMode":"loose","entries":[{"hash":"a","file":"f","code":"TS1","message":"m","count":0}]}',
        "b.json",
      ),
    /positive integer count/,
  );
});

test("parseBaseline catches a bad merge where totalErrors no longer matches", () => {
  const text = JSON.stringify({
    version: 1,
    signatureMode: "loose",
    totalErrors: 99,
    entries: [{ hash: "a", file: "f.ts", code: "TS1", message: "m", count: 1 }],
  });
  assert.throws(() => parseBaseline(text, "b.json"), /says totalErrors is 99 but its entries sum to 1/);
});

test("readBaseline returns null when the file is absent", async () => {
  const dir = await tempDir();
  assert.equal(await readBaseline(path.join(dir, "nope.json")), null);
});

test("writeBaseline reports whether the bytes changed", async () => {
  const dir = await tempDir();
  const file = path.join(dir, "type-debt.json");
  const baseline = buildBaseline(sampleCounts(), "loose");

  assert.equal(await writeBaseline(file, baseline), true);
  assert.equal(await writeBaseline(file, baseline), false, "rewriting identical content is a no-op");
  assert.equal(await readFile(file, "utf8"), serializeBaseline(baseline));

  assert.equal(await writeBaseline(file, emptyBaseline("loose")), true);
});

test("readBaseline surfaces a corrupt file rather than treating it as absent", async () => {
  const dir = await tempDir();
  const file = path.join(dir, "type-debt.json");
  await writeFile(file, "not json", "utf8");
  await assert.rejects(readBaseline(file), /not valid JSON/);
});
