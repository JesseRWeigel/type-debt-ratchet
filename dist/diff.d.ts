/**
 * Compare a run against the baseline and decide what counts as new debt.
 *
 * Two behaviours here are load-bearing and easy to get wrong:
 *
 *   1. Comparison is by count, not presence. A file going from three of the same error to
 *      five is new debt even though the signature already existed.
 *   2. A renamed file is not new debt. Since a signature is keyed on path, moving a file
 *      would otherwise wipe out its baseline rows and re-add them as new. `detectRenames`
 *      matches a vanished path to an appeared path by the fingerprint of its errors.
 */
import type { Baseline, DetectedRename, RatchetDiff, Signature } from "./types.ts";
/** Per-signature counts for the current run, keyed by hash. */
export type SignatureCounts = ReadonlyMap<string, {
    signature: Signature;
    count: number;
}>;
/** Does this path still exist on disk? Injectable so rename tests need no real files. */
export type FileExists = (relativePath: string) => boolean;
/**
 * Match baseline paths that vanished to current paths that appeared.
 *
 * A pair is a rename when all three hold: the baseline file now reports zero errors, the
 * baseline file is gone from disk, and the two files' error fingerprints are identical.
 * When several candidates share one fingerprint they are paired in sorted path order, so
 * the result is deterministic rather than dependent on map iteration.
 *
 * A file that is moved *and* edited in the same commit will not match. That is the honest
 * outcome: its errors really did change, and the tool cannot tell which are new.
 */
export declare function detectRenames(baseline: Baseline, current: SignatureCounts, fileExists: FileExists, 
/**
 * Positive evidence that `from` really became `to`. Defaults to refusing every pair.
 *
 * The fingerprint below only nominates candidates. It cannot confirm them, because in
 * loose signature mode the fingerprint of "one TS2345" is identical across every
 * unrelated file in a codebase, so any deletion pairs with any addition. Accepting a
 * pair on that basis absorbs a genuinely new file's genuinely new errors into the
 * baseline and reports PASS, which is precisely the failure a ratchet exists to
 * prevent. The default is therefore to confirm nothing; `src/run.ts` supplies a
 * git-backed confirmer, and callers can pass `() => true` to opt into the old
 * fingerprint-only behavior explicitly.
 */
confirm?: (from: string, to: string) => boolean): DetectedRename[];
/** Rewrite baseline entries onto their new paths, recomputing the hashes that embed them. */
export declare function applyRenames(baseline: Baseline, renames: readonly DetectedRename[]): Baseline;
/** Compare the current run against the baseline, after accounting for renames. */
export declare function diffAgainstBaseline(baseline: Baseline, current: SignatureCounts, options?: {
    readonly fileExists?: FileExists;
    readonly detectRenames?: boolean;
    /** Positive evidence a rename happened. Defaults to confirming nothing. */
    readonly confirmRename?: (from: string, to: string) => boolean;
}): RatchetDiff;
/**
 * The baseline rewritten to record only the debt that was paid down.
 *
 * Used by `--auto-shrink`. New debt is never absorbed: a count only ever moves toward zero,
 * so a run that adds errors still fails even with auto-shrink on.
 */
export declare function shrinkBaseline(baseline: Baseline, diff: RatchetDiff): Baseline;
