#!/usr/bin/env node
/** Command-line entry point. Works standalone, with no GitHub involved. */

import process from "node:process";
import { BaselineError } from "./baseline.ts";
import { isEntryPoint } from "./entrypoint.ts";
import { renderComment, renderTerminal } from "./report.ts";
import { DEFAULT_OPTIONS, EXIT_NEW_DEBT, EXIT_USAGE, runRatchet, type RatchetOptions } from "./run.ts";
import { TscRunError } from "./tsc.ts";
import type { SignatureMode } from "./types.ts";

const USAGE = `type-debt-ratchet - fail CI only on NEW tsc errors

Usage:
  type-debt-ratchet [options]
  type-debt-ratchet --update-baseline [options]

Options:
  --baseline <path>        Baseline file. Default: ${DEFAULT_OPTIONS.baselinePath}
  --command <shell>        Type-check command. Default: ${DEFAULT_OPTIONS.command}
  --cwd <path>             Directory to run in. Default: the current directory
  --signature-mode <mode>  loose (default) or exact. See the README.
  --update-baseline        Rewrite the baseline from this run and exit 0
  --auto-shrink            Record fixed errors in the baseline. Never absorbs new ones.
  --fail-on-stale          Also fail when the baseline lists errors that no longer occur
  --no-rename-detection    Treat a moved file's errors as new debt
  --rename-strategy <s>    git (default) confirms renames with git. fingerprint
                           trusts matching error shapes, which can absorb a new
                           file's new errors. Use only where git is unavailable.
  --allow-empty-result     Accept a checker run that produced zero diagnostics
                           against a non-empty baseline (default: treat as broken)
  --format <fmt>           text (default), json, or markdown
  -h, --help               Show this message

Exit codes:
  0  no new errors
  1  new errors, or --fail-on-stale with a stale baseline
  2  bad usage, unreadable baseline, or a type-check command that did not run
`;

interface ParsedArgs {
  readonly options: RatchetOptions;
  readonly format: "text" | "json" | "markdown";
}

/** Raised for anything the user can fix by changing the command line. */
class UsageError extends Error {}

function requireValue(argv: readonly string[], index: number, flag: string): string {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new UsageError(`${flag} needs a value`);
  }
  return value;
}

export function parseArgs(argv: readonly string[]): ParsedArgs {
  let baselinePath: string = DEFAULT_OPTIONS.baselinePath;
  let command: string = DEFAULT_OPTIONS.command;
  let cwd = process.cwd();
  let signatureMode: SignatureMode = DEFAULT_OPTIONS.signatureMode;
  let updateBaseline = false;
  let autoShrink = false;
  let failOnStale = false;
  let detectRenames = true;
  let allowEmptyResult = false;
  let renameStrategy: "git" | "fingerprint" = "git";
  let format: "text" | "json" | "markdown" = "text";

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] as string;
    switch (arg) {
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

  if (updateBaseline && autoShrink) {
    throw new UsageError("--update-baseline already rewrites the baseline, drop --auto-shrink");
  }

  return {
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
    },
    format,
  };
}

export async function main(argv: readonly string[]): Promise<number> {
  if (argv.includes("--help") || argv.includes("-h")) {
    process.stdout.write(USAGE);
    return 0;
  }

  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n\n${USAGE}`);
    return EXIT_USAGE;
  }

  try {
    const result = await runRatchet(parsed.options);
    for (const note of result.notes) process.stderr.write(`${note}\n`);

    if (parsed.format === "json") {
      process.stdout.write(`${JSON.stringify(result.diff, null, 2)}\n`);
    } else if (parsed.format === "markdown") {
      process.stdout.write(renderComment(result.diff, { baselinePath: parsed.options.baselinePath }));
    } else {
      process.stdout.write(`${renderTerminal(result.diff, { baselinePath: parsed.options.baselinePath })}\n`);
    }
    return result.exitCode;
  } catch (error) {
    if (error instanceof BaselineError || error instanceof TscRunError) {
      process.stderr.write(`${error.message}\n`);
      return EXIT_USAGE;
    }
    process.stderr.write(`${(error as Error).message}\n`);
    return EXIT_USAGE;
  }
}

if (isEntryPoint(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error: unknown) => {
      process.stderr.write(`type-debt-ratchet crashed: ${String(error)}\n`);
      process.exitCode = EXIT_USAGE;
    },
  );
}

export { EXIT_NEW_DEBT, EXIT_USAGE };
