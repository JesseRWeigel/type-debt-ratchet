/** Run the type-check command and hand its output to the parser. */
import { spawn } from "node:child_process";
import { looksLikePrettyOutput, parseTscOutput } from "./parse.js";
/** Raised when the type-check command could not be interpreted, as opposed to failing. */
export class TscRunError extends Error {
    constructor(message) {
        super(message);
        this.name = "TscRunError";
    }
}
/**
 * Execute `command` in `cwd` and return its combined output.
 *
 * The command is run through a shell because it is written by a human in a config file and
 * routinely contains pipes, `&&` or a package-manager prefix. Colour is forced off so the
 * plain-text parser sees plain text.
 */
export function runCommand(command, cwd) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, {
            cwd,
            shell: true,
            env: { ...process.env, NO_COLOR: "1", FORCE_COLOR: "0" },
        });
        let output = "";
        child.stdout.on("data", (chunk) => {
            output += chunk.toString();
        });
        child.stderr.on("data", (chunk) => {
            output += chunk.toString();
        });
        child.on("error", reject);
        child.on("close", (code) => resolve({ output, exitCode: code ?? 1 }));
    });
}
/**
 * Run the type-check command and parse its diagnostics.
 *
 * A nonzero exit with zero parsed diagnostics is not "clean". It means the command failed
 * for some other reason (missing tsconfig, tsc not installed, output in pretty format), and
 * silently reporting zero errors there would let real debt through. That case throws.
 */
export async function runTypeCheck(command, cwd, runner = runCommand) {
    const { output, exitCode } = await runner(command, cwd);
    const diagnostics = parseTscOutput(output);
    if (diagnostics.length === 0 && exitCode !== 0) {
        if (looksLikePrettyOutput(output)) {
            throw new TscRunError(`The type-check command produced pretty-printed output, which cannot be parsed reliably.\n` +
                `Add --pretty false to the command (currently: ${command}).`);
        }
        throw new TscRunError(`The type-check command exited ${exitCode} but produced no parseable diagnostics.\n` +
            `Command: ${command}\nWorking directory: ${cwd}\n\n${output.trim() || "(no output)"}`);
    }
    return { diagnostics, exitCode, output };
}
//# sourceMappingURL=tsc.js.map