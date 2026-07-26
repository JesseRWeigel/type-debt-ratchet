#!/usr/bin/env node
/**
 * GitHub Action entry point.
 *
 * Deliberately does not depend on @actions/core or @actions/github. The runner contract is
 * a handful of environment variables and two append-only files, which is less code to own
 * than a bundler configuration and a committed vendor tree.
 */

import { appendFile } from "node:fs/promises";
import process from "node:process";
import { BaselineError } from "./baseline.ts";
import { isEntryPoint } from "./entrypoint.ts";
import { resolvePullRequestNumber, upsertComment } from "./github.ts";
import { renderComment, renderTerminal, verdictLine } from "./report.ts";
import { DEFAULT_OPTIONS, EXIT_NEW_DEBT, EXIT_USAGE, runRatchet, type RatchetOptions } from "./run.ts";
import { TscRunError } from "./tsc.ts";
import type { SignatureMode } from "./types.ts";

type Env = NodeJS.ProcessEnv;

/** Read an `inputs:` value. The runner exposes them as INPUT_<NAME>, spaces become _. */
export function input(env: Env, name: string): string {
  return (env[`INPUT_${name.replace(/ /g, "_").toUpperCase()}`] ?? "").trim();
}

/** GitHub's own boolean input convention: only the exact string "true" is true. */
export function booleanInput(env: Env, name: string, fallback: boolean): boolean {
  const raw = input(env, name).toLowerCase();
  if (raw === "") return fallback;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new Error(`input "${name}" must be true or false, got ${JSON.stringify(raw)}`);
}

/** Translate the action's inputs into ratchet options. Exported so tests can assert it. */
export function optionsFromEnv(env: Env): RatchetOptions {
  const signatureMode = input(env, "signature-mode") || DEFAULT_OPTIONS.signatureMode;
  if (signatureMode !== "loose" && signatureMode !== "exact") {
    throw new Error(`input "signature-mode" must be loose or exact, got ${signatureMode}`);
  }
  return {
    cwd: input(env, "working-directory") || ".",
    baselinePath: input(env, "baseline") || DEFAULT_OPTIONS.baselinePath,
    command: input(env, "tsc-command") || DEFAULT_OPTIONS.command,
    signatureMode: signatureMode satisfies SignatureMode,
    updateBaseline: booleanInput(env, "update-baseline", false),
    autoShrink: booleanInput(env, "auto-shrink", false),
    failOnStale: booleanInput(env, "fail-on-stale", false),
    detectRenames: booleanInput(env, "rename-detection", true),
  };
}

/** Write a step output in the `name<<EOF` form, which survives multi-line values. */
async function setOutput(env: Env, name: string, value: string): Promise<void> {
  const file = env["GITHUB_OUTPUT"];
  if (!file) return;
  const delimiter = `ghadelimiter_${name}_${Date.now()}`;
  await appendFile(file, `${name}<<${delimiter}\n${value}\n${delimiter}\n`, "utf8");
}

/** Append to the job summary, which is where a human looks after a red build. */
async function appendSummary(env: Env, markdown: string): Promise<void> {
  const file = env["GITHUB_STEP_SUMMARY"];
  if (!file) return;
  await appendFile(file, `${markdown}\n`, "utf8");
}

export async function run(env: Env = process.env): Promise<number> {
  let options: RatchetOptions;
  try {
    options = optionsFromEnv(env);
  } catch (error) {
    process.stderr.write(`::error::${(error as Error).message}\n`);
    return EXIT_USAGE;
  }

  let result;
  try {
    result = await runRatchet(options);
  } catch (error) {
    const message = (error as Error).message;
    const known = error instanceof BaselineError || error instanceof TscRunError;
    process.stderr.write(`::error::${known ? message : `type-debt-ratchet failed: ${message}`}\n`);
    return EXIT_USAGE;
  }

  const { diff } = result;
  for (const note of result.notes) process.stdout.write(`${note}\n`);
  process.stdout.write(`${renderTerminal(diff, { baselinePath: options.baselinePath })}\n`);

  await setOutput(env, "new-errors", String(diff.newErrorCount));
  await setOutput(env, "fixed-errors", String(diff.fixedErrorCount));
  await setOutput(env, "total-errors", String(diff.currentTotal));
  await setOutput(env, "baseline-errors", String(diff.baselineTotal));
  await setOutput(env, "baseline-written", String(result.baselineWritten));
  await setOutput(env, "summary", verdictLine(diff));

  const body = renderComment(diff, { baselinePath: options.baselinePath });
  await appendSummary(env, body);

  if (booleanInput(env, "comment", true)) {
    const token = input(env, "github-token");
    const repo = env["GITHUB_REPOSITORY"] ?? "";
    const prNumber = await resolvePullRequestNumber(env);
    if (prNumber === null) {
      process.stdout.write("Not a pull request event, skipping the comment.\n");
    } else if (token === "" || repo === "") {
      process.stderr.write(
        "::warning::comment is enabled but github-token or GITHUB_REPOSITORY is missing, skipping the comment.\n",
      );
    } else {
      try {
        const outcome = await upsertComment({ repo, prNumber, token }, body);
        process.stdout.write(`Comment ${outcome.action} (id ${outcome.id}).\n`);
      } catch (error) {
        // A comment is reporting, not gatekeeping. Losing it must not change the verdict.
        process.stderr.write(`::warning::could not post the PR comment: ${(error as Error).message}\n`);
      }
    }
  }

  if (result.exitCode === EXIT_NEW_DEBT) {
    process.stderr.write(`::error::${verdictLine(diff)}\n`);
  }
  return result.exitCode;
}

if (isEntryPoint(import.meta.url)) {
  run().then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      process.stderr.write(`::error::type-debt-ratchet crashed: ${String(error)}\n`);
      process.exitCode = EXIT_USAGE;
    },
  );
}
