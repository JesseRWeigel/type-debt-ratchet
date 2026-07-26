/**
 * Post the debt delta as a PR comment.
 *
 * Uses the REST API through global fetch rather than @actions/github, so the action ships
 * with zero runtime dependencies and nothing has to be bundled. `fetchImpl` is injectable
 * so the upsert logic is unit tested without touching the network.
 */
import { readFile } from "node:fs/promises";
import { COMMENT_MARKER } from "./report.js";
const API = "https://api.github.com";
function headers(token) {
    return {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "x-github-api-version": "2022-11-28",
        "user-agent": "type-debt-ratchet",
    };
}
async function ensureOk(response, what) {
    if (response.ok)
        return;
    const body = await response.text().catch(() => "");
    throw new Error(`${what} failed: ${response.status} ${response.statusText} ${body.slice(0, 400)}`);
}
/**
 * Find this tool's previous comment on the PR.
 *
 * Identified by the hidden marker in the body, not by author, because the token may be the
 * generic `github-actions[bot]` that other workflows also post as.
 */
export async function findExistingComment(target, fetchImpl) {
    for (let page = 1; page <= 10; page += 1) {
        const url = `${API}/repos/${target.repo}/issues/${target.prNumber}/comments?per_page=100&page=${page}`;
        const response = await fetchImpl(url, { headers: headers(target.token) });
        await ensureOk(response, "listing PR comments");
        const comments = (await response.json());
        const match = comments.find((comment) => (comment.body ?? "").includes(COMMENT_MARKER));
        if (match)
            return match.id;
        if (comments.length < 100)
            return null;
    }
    return null;
}
/** Create the comment, or edit the existing one so a PR never accumulates duplicates. */
export async function upsertComment(target, body, fetchImpl = fetch) {
    const existingId = await findExistingComment(target, fetchImpl);
    if (existingId !== null) {
        const response = await fetchImpl(`${API}/repos/${target.repo}/issues/comments/${existingId}`, {
            method: "PATCH",
            headers: headers(target.token),
            body: JSON.stringify({ body }),
        });
        await ensureOk(response, "updating the PR comment");
        return { action: "updated", id: existingId };
    }
    const response = await fetchImpl(`${API}/repos/${target.repo}/issues/${target.prNumber}/comments`, {
        method: "POST",
        headers: headers(target.token),
        body: JSON.stringify({ body }),
    });
    await ensureOk(response, "creating the PR comment");
    const created = (await response.json());
    return { action: "created", id: created.id };
}
/**
 * Read the PR number from the workflow event payload.
 *
 * Returns null for events that are not attached to a pull request (a push to main, a tag,
 * a manual dispatch), which is a normal state and not an error.
 */
export async function resolvePullRequestNumber(env = process.env) {
    const eventPath = env["GITHUB_EVENT_PATH"];
    if (!eventPath)
        return null;
    let payload;
    try {
        payload = JSON.parse(await readFile(eventPath, "utf8"));
    }
    catch {
        return null;
    }
    if (typeof payload !== "object" || payload === null)
        return null;
    const record = payload;
    const pullRequest = record["pull_request"];
    if (typeof pullRequest === "object" && pullRequest !== null) {
        const number = pullRequest["number"];
        if (typeof number === "number")
            return number;
    }
    // `issue_comment` and `workflow_run` style payloads put it under `issue`.
    const issue = record["issue"];
    if (typeof issue === "object" && issue !== null) {
        const candidate = issue;
        if (candidate["pull_request"] !== undefined && typeof candidate["number"] === "number") {
            return candidate["number"];
        }
    }
    return null;
}
//# sourceMappingURL=github.js.map