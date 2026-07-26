import assert from "node:assert/strict";
import { test } from "node:test";
import { booleanInput, input, optionsFromEnv } from "../src/action.ts";

test("input reads the runner's INPUT_ convention and trims", () => {
  assert.equal(input({ INPUT_BASELINE: "  debt.json  " }, "baseline"), "debt.json");
  assert.equal(input({ "INPUT_TSC-COMMAND": "yarn tsc" }, "tsc-command"), "yarn tsc");
  assert.equal(input({}, "baseline"), "");
});

test("booleanInput follows GitHub's true/false convention and rejects anything else", () => {
  assert.equal(booleanInput({ INPUT_COMMENT: "true" }, "comment", false), true);
  assert.equal(booleanInput({ INPUT_COMMENT: "TRUE" }, "comment", false), true);
  assert.equal(booleanInput({ INPUT_COMMENT: "false" }, "comment", true), false);
  assert.equal(booleanInput({}, "comment", true), true, "an unset input falls back");
  assert.throws(() => booleanInput({ INPUT_COMMENT: "yes" }, "comment", true), /must be true or false/);
});

test("optionsFromEnv applies the documented defaults", () => {
  const options = optionsFromEnv({});
  assert.equal(options.baselinePath, "type-debt.json");
  assert.equal(options.command, "npx tsc --noEmit --pretty false");
  assert.equal(options.cwd, ".");
  assert.equal(options.signatureMode, "loose");
  assert.equal(options.detectRenames, true, "rename detection is on unless turned off");
  assert.equal(options.updateBaseline, false);
  assert.equal(options.autoShrink, false);
  assert.equal(options.failOnStale, false);
});

test("optionsFromEnv maps every documented input", () => {
  const options = optionsFromEnv({
    INPUT_BASELINE: "config/debt.json",
    "INPUT_TSC-COMMAND": "pnpm exec vue-tsc --noEmit --pretty false",
    "INPUT_WORKING-DIRECTORY": "packages/web",
    "INPUT_SIGNATURE-MODE": "exact",
    "INPUT_UPDATE-BASELINE": "true",
    "INPUT_AUTO-SHRINK": "true",
    "INPUT_FAIL-ON-STALE": "true",
    "INPUT_RENAME-DETECTION": "false",
  });
  assert.deepEqual(options, {
    cwd: "packages/web",
    baselinePath: "config/debt.json",
    command: "pnpm exec vue-tsc --noEmit --pretty false",
    signatureMode: "exact",
    updateBaseline: true,
    autoShrink: true,
    failOnStale: true,
    detectRenames: false,
  });
});

test("an unknown signature-mode is rejected before anything runs", () => {
  assert.throws(() => optionsFromEnv({ "INPUT_SIGNATURE-MODE": "fuzzy" }), /must be loose or exact/);
});
