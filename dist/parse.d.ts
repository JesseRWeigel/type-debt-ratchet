/**
 * Parse the plain-text output of `tsc --noEmit --pretty false`.
 *
 * Pretty output is a different format built for humans (ANSI colour, code frames, a
 * "Found N errors" footer). Rather than guess at it, this module detects it and asks the
 * caller to turn it off. See `looksLikePrettyOutput`.
 */
import type { RawDiagnostic } from "./types.ts";
/** Remove ANSI colour codes so a coloured tsc still parses. */
export declare function stripAnsi(text: string): string;
/**
 * True when the text carries pretty-printed diagnostics. The caller turns this into an
 * actionable "add --pretty false" error instead of silently reporting zero errors.
 */
export declare function looksLikePrettyOutput(text: string): boolean;
/**
 * Extract every diagnostic from tsc's plain output.
 *
 * Indented lines following a diagnostic are continuations of its message (tsc uses them for
 * elaborations like "Types of parameters 's' and 'n' are incompatible."). They are appended
 * to the primary message so that two structurally different errors sharing a first line do
 * not collapse into one signature.
 */
export declare function parseTscOutput(rawText: string): RawDiagnostic[];
