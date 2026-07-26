/**
 * Post the debt delta as a PR comment.
 *
 * Uses the REST API through global fetch rather than @actions/github, so the action ships
 * with zero runtime dependencies and nothing has to be bundled. `fetchImpl` is injectable
 * so the upsert logic is unit tested without touching the network.
 */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;
export interface CommentTarget {
    /** "owner/repo" */
    readonly repo: string;
    readonly prNumber: number;
    readonly token: string;
}
/** What `upsertComment` did, so the caller can log it truthfully. */
export type CommentOutcome = {
    readonly action: "created";
    readonly id: number;
} | {
    readonly action: "updated";
    readonly id: number;
};
/**
 * Find this tool's previous comment on the PR.
 *
 * Identified by the hidden marker in the body, not by author, because the token may be the
 * generic `github-actions[bot]` that other workflows also post as.
 */
export declare function findExistingComment(target: CommentTarget, fetchImpl: FetchLike): Promise<number | null>;
/** Create the comment, or edit the existing one so a PR never accumulates duplicates. */
export declare function upsertComment(target: CommentTarget, body: string, fetchImpl?: FetchLike): Promise<CommentOutcome>;
/**
 * Read the PR number from the workflow event payload.
 *
 * Returns null for events that are not attached to a pull request (a push to main, a tag,
 * a manual dispatch), which is a normal state and not an error.
 */
export declare function resolvePullRequestNumber(env?: NodeJS.ProcessEnv): Promise<number | null>;
