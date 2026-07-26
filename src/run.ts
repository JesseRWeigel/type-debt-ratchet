/**
 * The ratchet itself, with no opinion about where it was invoked from.
 *
 * `src/cli.ts` and `src/action.ts` are both thin shells around `runRatchet`. Keeping the
 * decision logic here is what lets the end-to-end tests exercise the same code path CI runs.
 */

import { existsSync } from "node:fs";
import path from "node:path";
import { buildBaseline, emptyBaseline, readBaseline, writeBaseline } from "./baseline.ts";
import { diffAgainstBaseline, shrinkBaseline } from "./diff.ts";
import { countSignatures, toSignature } from "./signature.ts";
import { runCommand, runTypeCheck } from "./tsc.ts";
import { gitConfirmer } from "./git.ts";
import type { Baseline, RatchetDiff, SignatureMode } from "./types.ts";

/** Exit codes. Distinguishing 1 from 2 lets a workflow tell debt from breakage. */
export const EXIT_OK = 0;
export const EXIT_NEW_DEBT = 1;
export const EXIT_USAGE = 2;

export interface RatchetOptions {
  /** Directory the type-check command runs in. Also the root paths are made relative to. */
  readonly cwd: string;
  /** Path to the baseline file, absolute or relative to `cwd`. */
  readonly baselinePath: string;
  /** Shell command that prints tsc diagnostics. */
  readonly command: string;
  readonly signatureMode: SignatureMode;
  /** Rewrite the baseline from this run and exit 0. */
  readonly updateBaseline: boolean;
  /** Record fixed errors in the baseline automatically. Never absorbs new errors. */
  readonly autoShrink: boolean;
  /** Fail when the baseline still lists errors that no longer occur. */
  readonly failOnStale: boolean;
  /** Turn off rename matching, for a codebase where it misfires. */
  readonly detectRenames: boolean;
  /** Accept a checker run that produced zero diagnostics against a non-empty baseline. */
  readonly allowEmptyResult?: boolean;
  /**
   * How a rename is confirmed. "git" asks git, which decides by content similarity
   * and is the only real evidence available. "fingerprint" restores the old
   * behavior of trusting matching error shapes, which can absorb a new file's new
   * errors and is unsafe on a codebase with many identical error shapes.
   */
  readonly renameStrategy?: "git" | "fingerprint";
  readonly runner?: (command: string, cwd: string) => Promise<{ output: string; exitCode: number }>;
}

export interface RatchetResult {
  readonly exitCode: number;
  readonly diff: RatchetDiff;
  /** The baseline as it stands after the run, whether or not it was written. */
  readonly baseline: Baseline;
  /** True when this run changed the baseline file on disk. */
  readonly baselineWritten: boolean;
  /** Human-readable notes about what the run decided, for the CLI to print. */
  readonly notes: readonly string[];
}

export const DEFAULT_OPTIONS = {
  baselinePath: "type-debt.json",
  command: "npx tsc --noEmit --pretty false",
  signatureMode: "loose",
} as const satisfies Partial<RatchetOptions>;

/**
 * Run the type check, compare it to the baseline, and decide the exit code.
 *
 * Order matters. The baseline is read before the check so a malformed file fails fast
 * rather than after a slow compile, and it is written only after a successful parse so a
 * crashed tsc can never blank out a project's recorded debt.
 */
/**
 * Build the rename confirmer for a run.
 *
 * Git is the default because it is the only source of actual evidence. When the project
 * is not a git repository, git confirms nothing and renames are simply not detected,
 * which reports a moved file's errors as new debt. That is the safe direction to fail:
 * the user runs --update-baseline once, rather than the gate silently swallowing errors.
 */
function renameConfirmer(
  cwd: string,
  options: RatchetOptions,
): (from: string, to: string) => boolean {
  if (options.detectRenames === false) return () => false;
  if (options.renameStrategy === "fingerprint") return () => true;
  return gitConfirmer(cwd);
}

export async function runRatchet(options: RatchetOptions): Promise<RatchetResult> {
  const cwd = path.resolve(options.cwd);
  const baselinePath = path.resolve(cwd, options.baselinePath);
  const notes: string[] = [];

  const existing = await readBaseline(baselinePath);

  if (existing !== null && existing.signatureMode !== options.signatureMode && !options.updateBaseline) {
    throw new Error(
      `${options.baselinePath} was written in "${existing.signatureMode}" signature mode but this run ` +
        `uses "${options.signatureMode}". Every signature would look new. Re-run with --update-baseline ` +
        `or switch back with --signature-mode ${existing.signatureMode}.`,
    );
  }

  const { diagnostics } = await runTypeCheck(options.command, cwd, options.runner ?? runCommand);
  const errors = diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  const counts = countSignatures(errors.map((error) => toSignature(error, cwd, options.signatureMode)));

  if (options.updateBaseline) {
    const next = buildBaseline(counts, options.signatureMode);
    const written = await writeBaseline(baselinePath, next);
    const before = existing?.totalErrors ?? 0;
    notes.push(
      written
        ? `Wrote ${options.baselinePath}: ${before} -> ${next.totalErrors} recorded errors.`
        : `${options.baselinePath} already matched this run, left unchanged.`,
    );
    const diff = diffAgainstBaseline(next, counts, {
      fileExists: (relative) => existsSync(path.resolve(cwd, relative)),
      detectRenames: options.detectRenames,
      confirmRename: renameConfirmer(cwd, options),
    });
    return { exitCode: EXIT_OK, diff, baseline: next, baselineWritten: written, notes };
  }

  if (existing === null) {
    throw new Error(
      `No baseline at ${baselinePath}.\n` +
        `Create one from the current state with:\n` +
        `  npx type-debt-ratchet --update-baseline --baseline ${options.baselinePath}\n` +
        `Commit the result, then this command will fail only on errors added after it.`,
    );
  }

  // A checker that silently checked nothing looks exactly like a heroic cleanup: zero
  // diagnostics, every baseline entry "fixed". A wrong tsconfig path, an exclude glob
  // that swallows the whole source tree, or a wrapper script that exits 0 without
  // running tsc all produce it. Reporting PASS there means the gate stops guarding and
  // nobody notices, which is worse than having no gate. Treat a total wipeout with zero
  // parsed diagnostics as a broken run unless the caller says otherwise.
  if (
    !options.allowEmptyResult &&
    existing.totalErrors > 0 &&
    diagnostics.length === 0
  ) {
    throw new Error(
      `The type-check command produced no diagnostics at all, but ${options.baselinePath} ` +
        `records ${existing.totalErrors} existing error${existing.totalErrors === 1 ? "" : "s"}.\n` +
        `Every recorded error disappearing at once, with nothing parsed from the checker, ` +
        `is far more often a broken type-check command than a completed cleanup.\n` +
        `Command: ${options.command}\n` +
        `Check that it runs, that it points at the right tsconfig, and that its include ` +
        `globs still match your sources.\n` +
        `If the errors really are all fixed, re-run with --update-baseline, or pass ` +
        `--allow-empty-result to accept an empty checker run.`,
    );
  }

  const diff = diffAgainstBaseline(existing, counts, {
    fileExists: (relative) => existsSync(path.resolve(cwd, relative)),
    detectRenames: options.detectRenames,
    confirmRename: renameConfirmer(cwd, options),
  });

  let baseline = existing;
  let baselineWritten = false;
  if (options.autoShrink && diff.fixedErrorCount > 0) {
    baseline = shrinkBaseline(existing, diff);
    baselineWritten = await writeBaseline(baselinePath, baseline);
    notes.push(
      `Auto-shrink recorded ${diff.fixedErrorCount} fixed error${diff.fixedErrorCount === 1 ? "" : "s"} ` +
        `in ${options.baselinePath}. Commit the change so the fixes cannot regress.`,
    );
  }

  if (diff.newErrorCount > 0) {
    return { exitCode: EXIT_NEW_DEBT, diff, baseline, baselineWritten, notes };
  }
  if (options.failOnStale && diff.stale && !baselineWritten) {
    notes.push(
      `--fail-on-stale is set and ${options.baselinePath} lists ${diff.fixedErrorCount} error(s) that no longer occur.`,
    );
    return { exitCode: EXIT_NEW_DEBT, diff, baseline, baselineWritten, notes };
  }
  return { exitCode: EXIT_OK, diff, baseline, baselineWritten, notes };
}

/** An empty baseline for a project that starts clean. Exposed for tests and docs. */
export { emptyBaseline };
