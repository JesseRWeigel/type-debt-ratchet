/**
 * Read and write `type-debt.json`.
 *
 * The file is committed, so it is diffed by humans and merged by git. It therefore carries
 * no timestamps, no line numbers and no run metadata: writing it twice for the same error
 * set produces byte-identical output, and an unrelated edit never churns it.
 */
import type { Baseline, Signature, SignatureMode } from "./types.ts";
/** Thrown for anything the caller can fix by changing input, as opposed to a bug. */
export declare class BaselineError extends Error {
    constructor(message: string);
}
/** Build a baseline from counted signatures. */
export declare function buildBaseline(counts: ReadonlyMap<string, {
    signature: Signature;
    count: number;
}>, mode: SignatureMode): Baseline;
/** An empty baseline, used when a project starts out clean. */
export declare function emptyBaseline(mode: SignatureMode): Baseline;
/** Serialize with a trailing newline so the file is well formed for git and editors. */
export declare function serializeBaseline(baseline: Baseline): string;
/** Validate an unknown parsed value as a baseline, with messages a user can act on. */
export declare function parseBaseline(text: string, source: string): Baseline;
/** Read a baseline from disk. Returns null when the file does not exist. */
export declare function readBaseline(filePath: string): Promise<Baseline | null>;
/** Write a baseline to disk. Returns true when the bytes actually changed. */
export declare function writeBaseline(filePath: string, baseline: Baseline): Promise<boolean>;
