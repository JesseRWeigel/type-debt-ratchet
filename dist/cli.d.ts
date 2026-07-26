#!/usr/bin/env node
/** Command-line entry point. Works standalone, with no GitHub involved. */
import { EXIT_NEW_DEBT, EXIT_USAGE, type RatchetOptions } from "./run.ts";
interface ParsedArgs {
    readonly options: RatchetOptions;
    readonly format: "text" | "json" | "markdown";
}
export declare function parseArgs(argv: readonly string[]): ParsedArgs;
export declare function main(argv: readonly string[]): Promise<number>;
export { EXIT_NEW_DEBT, EXIT_USAGE };
