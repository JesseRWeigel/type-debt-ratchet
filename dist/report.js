/**
 * Render a diff for humans: once for a terminal, once as a PR comment.
 *
 * Both renderers are pure functions of the diff, which is what makes the PR comment
 * testable without a GitHub API call.
 */
/** Hidden marker used to find and update this tool's own comment instead of adding another. */
export const COMMENT_MARKER = "<!-- type-debt-ratchet -->";
/** How many rows a table shows before collapsing the rest into a count. */
const MAX_ROWS = 20;
function signed(value) {
    return value > 0 ? `+${value}` : String(value);
}
function truncate(text, limit) {
    return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`;
}
/** Escape the characters that would break out of a markdown table cell. */
function cell(text) {
    return text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}
function markdownTable(title, changes) {
    if (changes.length === 0)
        return "";
    const shown = changes.slice(0, MAX_ROWS);
    const rows = shown.map((change) => `| \`${cell(change.file || "(project)")}\` | ${change.code} | ${change.baselineCount} → ${change.currentCount} | ${signed(change.delta)} | ${cell(truncate(change.message, 120))} |`);
    const omitted = changes.length - shown.length;
    const footer = omitted > 0 ? `\n\n_${omitted} more signature${omitted === 1 ? "" : "s"} not shown._` : "";
    return [
        `#### ${title}`,
        "",
        "| File | Code | Count | Δ | Message shape |",
        "| --- | --- | --- | --- | --- |",
        ...rows,
        footer,
    ]
        .filter((part) => part !== "")
        .join("\n");
}
/** The one-line verdict, used as the comment heading and the last line of terminal output. */
export function verdictLine(diff) {
    if (diff.newErrorCount > 0) {
        const noun = diff.newErrorCount === 1 ? "type error" : "type errors";
        return `${diff.newErrorCount} new ${noun} not in the baseline`;
    }
    if (diff.fixedErrorCount > 0) {
        const noun = diff.fixedErrorCount === 1 ? "type error" : "type errors";
        return `No new type errors, and ${diff.fixedErrorCount} ${noun} fixed`;
    }
    return "No new type errors";
}
/** The markdown body of the PR comment, marker included. */
export function renderComment(diff, options) {
    const status = diff.newErrorCount > 0 ? "Type debt went up" : "Type debt held";
    const net = diff.currentTotal - diff.baselineTotal;
    const parts = [
        COMMENT_MARKER,
        `### ${status}`,
        "",
        `**${verdictLine(diff)}.**`,
        "",
        "| | Count |",
        "| --- | --- |",
        `| Baseline | ${diff.baselineTotal} |`,
        `| This branch | ${diff.currentTotal} |`,
        `| Net change | ${signed(net)} |`,
        `| New | ${diff.newErrorCount} |`,
        `| Fixed | ${diff.fixedErrorCount} |`,
    ];
    if (diff.renames.length > 0) {
        parts.push("", "#### Renamed files", "", ...diff.renames.map((rename) => `- \`${rename.from}\` → \`${rename.to}\` (${rename.errors} existing error${rename.errors === 1 ? "" : "s"} carried over)`));
    }
    const addedTable = markdownTable("New debt", diff.added);
    if (addedTable !== "")
        parts.push("", addedTable);
    const fixedTable = markdownTable("Debt paid down", diff.fixed);
    if (fixedTable !== "")
        parts.push("", fixedTable);
    if (diff.newErrorCount > 0) {
        parts.push("", "Fix the errors above, or if they are intentional, record them with:", "", "```bash", `npx type-debt-ratchet --update-baseline --baseline ${options.baselinePath}`, "```");
    }
    else if (diff.stale) {
        parts.push("", `\`${options.baselinePath}\` is now ahead of reality. Run \`npx type-debt-ratchet --update-baseline\` to bank the fixes so they cannot come back.`);
    }
    return `${parts.join("\n")}\n`;
}
/** Plain-text summary for CI logs and local runs. */
export function renderTerminal(diff, options) {
    const lines = [];
    lines.push(`baseline ${diff.baselineTotal}  current ${diff.currentTotal}  new ${diff.newErrorCount}  fixed ${diff.fixedErrorCount}`);
    for (const rename of diff.renames) {
        lines.push(`  renamed  ${rename.from} -> ${rename.to} (${rename.errors} errors carried over)`);
    }
    if (diff.added.length > 0) {
        lines.push("", "New debt:");
        for (const change of diff.added.slice(0, MAX_ROWS)) {
            lines.push(`  ${signed(change.delta)}  ${change.file || "(project)"}  ${change.code}  ${truncate(change.message, 100)}`);
        }
        const omitted = diff.added.length - MAX_ROWS;
        if (omitted > 0)
            lines.push(`  ... ${omitted} more`);
    }
    if (diff.fixed.length > 0) {
        lines.push("", "Debt paid down:");
        for (const change of diff.fixed.slice(0, MAX_ROWS)) {
            lines.push(`  ${signed(change.delta)}  ${change.file || "(project)"}  ${change.code}  ${truncate(change.message, 100)}`);
        }
        const omitted = diff.fixed.length - MAX_ROWS;
        if (omitted > 0)
            lines.push(`  ... ${omitted} more`);
    }
    lines.push("");
    if (diff.newErrorCount > 0) {
        lines.push(`FAIL  ${verdictLine(diff)}`);
        lines.push(`      Record them deliberately with --update-baseline if they are intended.`);
    }
    else {
        lines.push(`PASS  ${verdictLine(diff)}`);
        if (diff.stale) {
            lines.push(`      ${options.baselinePath} is ahead of reality. Run --update-baseline to bank the fixes.`);
        }
    }
    return lines.join("\n");
}
//# sourceMappingURL=report.js.map