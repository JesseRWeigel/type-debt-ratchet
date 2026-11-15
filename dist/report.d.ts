/**
 * Render a diff for humans: once for a terminal, once as a PR comment.
 *
 * Both renderers are pure functions of the diff, which is what makes the PR comment
 * testable without a GitHub API call.
 */
import type { DebtChange, RatchetDiff } from "./types.ts";
/** Hidden marker used to find and update this tool's own comment instead of adding another. */
export declare const COMMENT_MARKER = "<!-- type-debt-ratchet -->";
/** The one-line verdict, used as the comment heading and the last line of terminal output. */
export declare function verdictLine(diff: RatchetDiff): string;
/** The markdown body of the PR comment, marker included. */
export declare function renderComment(diff: RatchetDiff, options: {
    readonly baselinePath: string;
}): string;
/** Plain-text summary for CI logs and local runs. */
export declare function renderTerminal(diff: RatchetDiff, options: {
    readonly baselinePath: string;
}): string;
/** A review report is not a ratchet run or a CI verdict. */
export declare function renderBaselineReview(review: {
    readonly mode: string;
    readonly previous: number;
    readonly current: number;
    readonly matched: number;
    readonly added: number;
    readonly removed: number;
    readonly additions: readonly DebtChange[];
    readonly removals: readonly DebtChange[];
}, markdown?: boolean): string;
