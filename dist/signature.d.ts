/**
 * Turn a raw tsc diagnostic into the stable identity the baseline tracks.
 *
 * The whole tool rests on this file. A baseline keyed on line numbers is worthless: adding
 * an import at the top of a file would invalidate every entry below it. So a signature
 * deliberately drops position entirely and keeps only what survives ordinary editing.
 */
import type { RawDiagnostic, Signature, SignatureMode } from "./types.ts";
/**
 * Normalize a path to a repo-relative POSIX path.
 *
 * tsc prints paths relative to its own working directory, which is where the tsconfig
 * lives. When the ratchet runs from a different directory the two must be reconciled or
 * every entry looks new.
 */
export declare function normalizeFilePath(filePath: string, rootDir: string): string;
/**
 * Collapse a diagnostic message to its shape.
 *
 * `loose` (the default) replaces every single-quoted span and every number, so
 * "Property 'userId' does not exist on type 'Session'." and the same error about a
 * different property share one signature. That is intentional: specificity is recovered by
 * counting occurrences per file, so three of these becoming five is still caught.
 *
 * `exact` keeps the message verbatim apart from whitespace. Use it when a codebase has a
 * small, well understood error set and you want the baseline to pin exact types.
 *
 * Quoted spans are paired left to right. A message containing an odd apostrophe therefore
 * pairs "wrong", but it does so deterministically, which is all a hash key needs.
 */
export declare function normalizeMessage(message: string, mode?: SignatureMode): string;
/**
 * Short, stable content hash of the three signature fields.
 *
 * The NUL separator keeps fields from bleeding into each other, since none of them can
 * contain one. 48 bits is ample for the few thousand signatures a real baseline holds.
 */
export declare function hashSignature(file: string, code: string, message: string): string;
/** Format a numeric tsc code as it appears in output, e.g. 2322 -> "TS2322". */
export declare function formatCode(code: number): string;
/** Reduce one diagnostic to its signature. */
export declare function toSignature(diagnostic: RawDiagnostic, rootDir: string, mode?: SignatureMode): Signature;
/**
 * Count how many times each signature occurs.
 *
 * Counting is what makes duplicate errors within one file tractable. Two identical TS2322s
 * in `src/a.ts` are one baseline row with count 2, and a third one is new debt.
 */
export declare function countSignatures(signatures: readonly Signature[]): Map<string, {
    signature: Signature;
    count: number;
}>;
