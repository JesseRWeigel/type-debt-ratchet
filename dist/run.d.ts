/**
 * The ratchet itself, with no opinion about where it was invoked from.
 *
 * `src/cli.ts` and `src/action.ts` are both thin shells around `runRatchet`. Keeping the
 * decision logic here is what lets the end-to-end tests exercise the same code path CI runs.
 */
import { emptyBaseline } from "./baseline.ts";
import type { Baseline, RatchetDiff, SignatureMode } from "./types.ts";
/** Exit codes. Distinguishing 1 from 2 lets a workflow tell debt from breakage. */
export declare const EXIT_OK = 0;
export declare const EXIT_NEW_DEBT = 1;
export declare const EXIT_USAGE = 2;
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
    readonly runner?: (command: string, cwd: string) => Promise<{
        output: string;
        exitCode: number;
    }>;
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
export declare const DEFAULT_OPTIONS: {
    readonly baselinePath: "type-debt.json";
    readonly command: "npx tsc --noEmit --pretty false";
    readonly signatureMode: "loose";
};
export declare function runRatchet(options: RatchetOptions): Promise<RatchetResult>;
/** An empty baseline for a project that starts clean. Exposed for tests and docs. */
export { emptyBaseline };
