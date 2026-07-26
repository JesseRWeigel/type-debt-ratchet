/**
 * Parse the plain-text output of `tsc --noEmit --pretty false`.
 *
 * Pretty output is a different format built for humans (ANSI colour, code frames, a
 * "Found N errors" footer). Rather than guess at it, this module detects it and asks the
 * caller to turn it off. See `looksLikePrettyOutput`.
 */

import type { RawDiagnostic } from "./types.ts";

/** `src/a.ts(4,14): error TS2322: Type 'string' is not ...` */
const FILE_DIAGNOSTIC =
  /^(?<file>.+?)\((?<line>\d+),(?<column>\d+)\): (?<severity>error|warning) TS(?<code>\d+): (?<message>.*)$/;

/** `error TS18003: No inputs were found in config file ...` (no file, no position) */
const GLOBAL_DIAGNOSTIC = /^(?<severity>error|warning) TS(?<code>\d+): (?<message>.*)$/;

/** Footer and summary-table lines that tsc emits around the diagnostics. */
const FOOTER = /^(Found \d+ error|Errors\s+Files|\s*\d+\s+\S+:\d+\s*$)/;

/** The pretty-mode first line of a diagnostic, used only to produce a good error message. */
const PRETTY_DIAGNOSTIC = /^.+?:\d+:\d+ - (error|warning) TS\d+:/m;

/** CSI escape sequences such as ESC[96m, so a colourised tsc still parses. */
const ANSI = /\u001B\[[0-9;]*[A-Za-z]/g;

/** Remove ANSI colour codes so a coloured tsc still parses. */
export function stripAnsi(text: string): string {
  return text.replace(ANSI, "");
}

/**
 * True when the text carries pretty-printed diagnostics. The caller turns this into an
 * actionable "add --pretty false" error instead of silently reporting zero errors.
 */
export function looksLikePrettyOutput(text: string): boolean {
  return PRETTY_DIAGNOSTIC.test(stripAnsi(text));
}

/**
 * Extract every diagnostic from tsc's plain output.
 *
 * Indented lines following a diagnostic are continuations of its message (tsc uses them for
 * elaborations like "Types of parameters 's' and 'n' are incompatible."). They are appended
 * to the primary message so that two structurally different errors sharing a first line do
 * not collapse into one signature.
 */
export function parseTscOutput(rawText: string): RawDiagnostic[] {
  const diagnostics: RawDiagnostic[] = [];
  const continuations: string[][] = [];

  for (const rawLine of stripAnsi(rawText).split(/\r?\n/)) {
    const line = rawLine.replace(/\s+$/, "");
    if (line === "") continue;

    if (FOOTER.test(line)) {
      // A footer ends any run of continuation lines. Anything after it is not a message.
      continuations.push([]);
      continue;
    }

    const fileMatch = FILE_DIAGNOSTIC.exec(line);
    if (fileMatch?.groups) {
      const g = fileMatch.groups;
      diagnostics.push({
        file: g["file"] as string,
        line: Number(g["line"]),
        column: Number(g["column"]),
        severity: g["severity"] as "error" | "warning",
        code: Number(g["code"]),
        message: g["message"] as string,
      });
      continuations.push([]);
      continue;
    }

    const globalMatch = GLOBAL_DIAGNOSTIC.exec(line);
    if (globalMatch?.groups) {
      const g = globalMatch.groups;
      diagnostics.push({
        file: "",
        line: null,
        column: null,
        severity: g["severity"] as "error" | "warning",
        code: Number(g["code"]),
        message: g["message"] as string,
      });
      continuations.push([]);
      continue;
    }

    // An indented line directly after a diagnostic elaborates on it.
    if (/^\s/.test(rawLine) && diagnostics.length > 0) {
      continuations[continuations.length - 1]?.push(line.trim());
    }
  }

  return diagnostics.map((diagnostic, index) => {
    const extra = continuations[index] ?? [];
    if (extra.length === 0) return diagnostic;
    return { ...diagnostic, message: [diagnostic.message, ...extra].join(" ") };
  });
}
