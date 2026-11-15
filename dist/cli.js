#!/usr/bin/env node
/** Command-line entry point. Works standalone, with no GitHub involved. */
import path from "node:path";
import process from "node:process";
import { BaselineError, readBaseline } from "./baseline.js";
import { diffAgainstBaseline } from "./diff.js";
import { isEntryPoint } from "./entrypoint.js";
import { renderBaselineReview, renderComment, renderTerminal } from "./report.js";
import { DEFAULT_OPTIONS, EXIT_NEW_DEBT, EXIT_USAGE, runRatchet } from "./run.js";
import { hashSignature } from "./signature.js";
import { TscRunError } from "./tsc.js";
const USAGE = `type-debt-ratchet - fail CI only on NEW tsc errors

Usage:
  type-debt-ratchet [options]
  type-debt-ratchet --update-baseline [options]
  type-debt-ratchet --compare-baseline <previous> [--baseline <current>] [options]

Options:
  --baseline <path>        Baseline file. Default: ${DEFAULT_OPTIONS.baselinePath}
  --compare-baseline <p>   Read-only diff from previous snapshot p to --baseline; no tsc
  --command <shell>        Type-check command. Default: ${DEFAULT_OPTIONS.command}
  --cwd <path>             Directory to run in. Default: the current directory
  --signature-mode <mode>  loose (default) or exact. See the README.
  --update-baseline        Rewrite the baseline from this run and exit 0
  --auto-shrink            Record fixed errors in the baseline. Never absorbs new ones.
  --fail-on-stale          Also fail when the baseline lists errors that no longer occur
  --base-ref <revision>    Detect committed renames from merge-base(revision, HEAD).
  --no-rename-detection    Treat a moved file's errors as new debt
  --rename-strategy <s>    git (default) confirms renames with git. fingerprint
                           trusts matching error shapes, which can absorb a new
                           file's new errors. Use only where git is unavailable.
  --allow-empty-result     Accept a checker run that produced zero diagnostics
                           against a non-empty baseline (default: treat as broken)
  --format <fmt>           text (default), json, or markdown
  -h, --help               Show this message

Exit codes:
  0  no new errors, or saved-baseline review completed
  1  new errors, or --fail-on-stale with a stale baseline
  2  bad usage, invalid or incomparable baselines, or a failed type-check command
`;
/** Raised for anything the user can fix by changing the command line. */
class UsageError extends Error {
}
function requireValue(argv, index, flag) {
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
        throw new UsageError(`${flag} needs a value`);
    }
    return value;
}
export function parseArgs(argv) {
    let compareBaseline;
    let baselinePath = DEFAULT_OPTIONS.baselinePath;
    let command = DEFAULT_OPTIONS.command;
    let cwd = process.cwd();
    let signatureMode = DEFAULT_OPTIONS.signatureMode;
    let updateBaseline = false;
    let autoShrink = false;
    let failOnStale = false;
    let detectRenames = true;
    let allowEmptyResult = false;
    let renameStrategy = "git";
    let baseRef;
    let format = "text";
    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        switch (arg) {
            case "--compare-baseline":
                compareBaseline = requireValue(argv, i, arg);
                i += 1;
                break;
            case "--base-ref":
                baseRef = requireValue(argv, i, arg);
                i += 1;
                break;
            case "--baseline":
                baselinePath = requireValue(argv, i, arg);
                i += 1;
                break;
            case "--command":
                command = requireValue(argv, i, arg);
                i += 1;
                break;
            case "--cwd":
                cwd = requireValue(argv, i, arg);
                i += 1;
                break;
            case "--signature-mode": {
                const value = requireValue(argv, i, arg);
                if (value !== "loose" && value !== "exact") {
                    throw new UsageError(`--signature-mode must be loose or exact, got ${value}`);
                }
                signatureMode = value;
                i += 1;
                break;
            }
            case "--format": {
                const value = requireValue(argv, i, arg);
                if (value !== "text" && value !== "json" && value !== "markdown") {
                    throw new UsageError(`--format must be text, json or markdown, got ${value}`);
                }
                format = value;
                i += 1;
                break;
            }
            case "--update-baseline":
                updateBaseline = true;
                break;
            case "--auto-shrink":
                autoShrink = true;
                break;
            case "--fail-on-stale":
                failOnStale = true;
                break;
            case "--rename-strategy": {
                const value = argv[++i];
                if (value !== "git" && value !== "fingerprint") {
                    throw new Error(`--rename-strategy must be "git" or "fingerprint", got ${JSON.stringify(value)}`);
                }
                renameStrategy = value;
                break;
            }
            case "--allow-empty-result":
                allowEmptyResult = true;
                break;
            case "--no-rename-detection":
                detectRenames = false;
                break;
            default:
                throw new UsageError(`unknown option: ${arg}`);
        }
    }
    if (compareBaseline !== undefined) {
        const supported = new Set(["--compare-baseline", "--baseline", "--cwd", "--format"]);
        for (let i = 0; i < argv.length; i += 2) {
            const flag = argv[i];
            if (!supported.has(flag)) {
                throw new UsageError(`${flag} does not apply when comparing saved baselines.`);
            }
        }
    }
    if (updateBaseline && autoShrink) {
        throw new UsageError("--update-baseline already rewrites the baseline, drop --auto-shrink");
    }
    return {
        ...(compareBaseline !== undefined ? { compareBaseline } : {}),
        options: {
            cwd,
            baselinePath,
            command,
            signatureMode,
            updateBaseline,
            autoShrink,
            failOnStale,
            detectRenames,
            allowEmptyResult,
            renameStrategy,
            ...(baseRef ? { baseRef } : {}),
        },
        format,
    };
}
/** Compare stored counts, not source diagnostics. Never use rename inference here. */
async function compareSavedBaselines(cwd, previousPath, currentPath) {
    async function load(file) {
        const baseline = await readBaseline(path.resolve(cwd, file));
        if (baseline === null)
            throw new BaselineError(`No baseline at ${file}`);
        const seen = new Set();
        for (const entry of baseline.entries) {
            if (entry.hash !== hashSignature(entry.file, entry.code, entry.message) || seen.has(entry.hash)) {
                throw new BaselineError(`${file} contains an invalid or duplicate signature hash: ${entry.hash}`);
            }
            seen.add(entry.hash);
        }
        return baseline;
    }
    const previous = await load(previousPath);
    const current = await load(currentPath);
    if (previous.signatureMode !== current.signatureMode) {
        throw new BaselineError(`Cannot compare ${previous.signatureMode} and ${current.signatureMode} baselines. ` +
            "Review this signature-mode migration with a raw Git diff.");
    }
    const counts = new Map(current.entries.map((entry) => [
        entry.hash, { signature: entry, count: entry.count },
    ]));
    const diff = diffAgainstBaseline(previous, counts, { detectRenames: false });
    return {
        mode: current.signatureMode,
        previous: diff.baselineTotal,
        current: diff.currentTotal,
        matched: diff.currentTotal - diff.newErrorCount,
        added: diff.newErrorCount,
        removed: diff.fixedErrorCount,
        additions: diff.added,
        removals: diff.fixed,
    };
}
export async function main(argv) {
    if (argv.includes("--help") || argv.includes("-h")) {
        process.stdout.write(USAGE);
        return 0;
    }
    let parsed;
    try {
        parsed = parseArgs(argv);
    }
    catch (error) {
        process.stderr.write(`${error.message}\n\n${USAGE}`);
        return EXIT_USAGE;
    }
    try {
        if (parsed.compareBaseline !== undefined) {
            const review = await compareSavedBaselines(parsed.options.cwd, parsed.compareBaseline, parsed.options.baselinePath);
            const output = parsed.format === "json"
                ? JSON.stringify(review, null, 2)
                : renderBaselineReview(review, parsed.format === "markdown");
            process.stdout.write(`${output}\n`);
            return 0;
        }
        const result = await runRatchet(parsed.options);
        for (const note of result.notes)
            process.stderr.write(`${note}\n`);
        if (parsed.format === "json") {
            process.stdout.write(`${JSON.stringify(result.diff, null, 2)}\n`);
        }
        else if (parsed.format === "markdown") {
            process.stdout.write(renderComment(result.diff, { baselinePath: parsed.options.baselinePath }));
        }
        else {
            process.stdout.write(`${renderTerminal(result.diff, { baselinePath: parsed.options.baselinePath })}\n`);
        }
        return result.exitCode;
    }
    catch (error) {
        if (error instanceof BaselineError || error instanceof TscRunError) {
            process.stderr.write(`${error.message}\n`);
            return EXIT_USAGE;
        }
        process.stderr.write(`${error.message}\n`);
        return EXIT_USAGE;
    }
}
if (isEntryPoint(import.meta.url)) {
    main(process.argv.slice(2)).then((code) => {
        process.exitCode = code;
    }, (error) => {
        process.stderr.write(`type-debt-ratchet crashed: ${String(error)}\n`);
        process.exitCode = EXIT_USAGE;
    });
}
export { EXIT_NEW_DEBT, EXIT_USAGE };
//# sourceMappingURL=cli.js.map