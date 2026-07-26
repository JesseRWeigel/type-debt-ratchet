/** Run the type-check command and hand its output to the parser. */
import type { RawDiagnostic } from "./types.ts";
/** Raised when the type-check command could not be interpreted, as opposed to failing. */
export declare class TscRunError extends Error {
    constructor(message: string);
}
export interface TscResult {
    readonly diagnostics: readonly RawDiagnostic[];
    readonly exitCode: number;
    /** Combined stdout and stderr, kept for error reporting. */
    readonly output: string;
}
/**
 * Execute `command` in `cwd` and return its combined output.
 *
 * The command is run through a shell because it is written by a human in a config file and
 * routinely contains pipes, `&&` or a package-manager prefix. Colour is forced off so the
 * plain-text parser sees plain text.
 */
export declare function runCommand(command: string, cwd: string): Promise<{
    output: string;
    exitCode: number;
}>;
/**
 * Run the type-check command and parse its diagnostics.
 *
 * A nonzero exit with zero parsed diagnostics is not "clean". It means the command failed
 * for some other reason (missing tsconfig, tsc not installed, output in pretty format), and
 * silently reporting zero errors there would let real debt through. That case throws.
 */
export declare function runTypeCheck(command: string, cwd: string, runner?: (command: string, cwd: string) => Promise<{
    output: string;
    exitCode: number;
}>): Promise<TscResult>;
