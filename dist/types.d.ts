/** Shared data shapes for the ratchet. */
/** How aggressively a diagnostic message is collapsed before hashing. */
export type SignatureMode = "loose" | "exact";
/** One diagnostic as tsc reported it, before any normalization. */
export interface RawDiagnostic {
    /** Path exactly as tsc printed it. Empty string for project-level diagnostics. */
    readonly file: string;
    /** 1-based line, or null for project-level diagnostics. */
    readonly line: number | null;
    /** 1-based column, or null for project-level diagnostics. */
    readonly column: number | null;
    readonly severity: "error" | "warning";
    /** Numeric part of the code, e.g. 2322 for TS2322. */
    readonly code: number;
    /** Primary message plus any indented continuation lines, joined by a single space. */
    readonly message: string;
}
/** A diagnostic reduced to the identity the baseline tracks. */
export interface Signature {
    /** Repo-relative POSIX path, or "" for project-level diagnostics. */
    readonly file: string;
    /** Full code including the TS prefix, e.g. "TS2322". */
    readonly code: string;
    /** Message with identifiers, quoted spans and numbers replaced by placeholders. */
    readonly message: string;
    /** Stable short hash of file + code + message. */
    readonly hash: string;
}
/** One baseline row: a signature and how many times it is tolerated. */
export interface BaselineEntry {
    readonly hash: string;
    readonly file: string;
    readonly code: string;
    readonly message: string;
    readonly count: number;
}
/**
 * The committed baseline file.
 *
 * Deliberately contains no timestamps and no line numbers, so that writing it twice for
 * the same error set produces byte-identical output and an unrelated edit does not churn it.
 */
export interface Baseline {
    readonly version: 1;
    readonly signatureMode: SignatureMode;
    readonly totalErrors: number;
    /** Sorted by file, then code, then hash. */
    readonly entries: readonly BaselineEntry[];
}
/** A per-signature change between baseline and current run. */
export interface DebtChange {
    readonly hash: string;
    readonly file: string;
    readonly code: string;
    readonly message: string;
    readonly baselineCount: number;
    readonly currentCount: number;
    /** currentCount - baselineCount. Positive is new debt, negative is paid-down debt. */
    readonly delta: number;
}
/** A baseline path remapped onto a current path because the file looks renamed. */
export interface DetectedRename {
    readonly from: string;
    readonly to: string;
    /** How many baseline errors moved with the file. */
    readonly errors: number;
}
/** The full comparison result. Everything the reporter and the exit code need. */
export interface RatchetDiff {
    /** Signatures whose count went up (or appeared). Sorted worst-first. */
    readonly added: readonly DebtChange[];
    /** Signatures whose count went down (or vanished). Sorted best-first. */
    readonly fixed: readonly DebtChange[];
    /** Sum of positive deltas. Nonzero means the ratchet fails. */
    readonly newErrorCount: number;
    /** Sum of negative deltas, as a positive number. */
    readonly fixedErrorCount: number;
    readonly baselineTotal: number;
    readonly currentTotal: number;
    readonly renames: readonly DetectedRename[];
    /** True when the baseline records errors that no longer occur. */
    readonly stale: boolean;
}
