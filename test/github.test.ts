import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import {
  findExistingComment,
  resolvePullRequestNumber,
  upsertComment,
  type FetchLike,
} from "../src/github.ts";
import { COMMENT_MARKER } from "../src/report.ts";

const target = { repo: "octo/repo", prNumber: 7, token: "t0ken" };

interface Call {
  readonly url: string;
  readonly method: string;
  readonly body: unknown;
  readonly headers: Record<string, string>;
}

/** A fetch stand-in that records calls and replies from a scripted queue. */
function fakeFetch(responses: readonly { status?: number; json?: unknown; text?: string }[]): {
  fetchImpl: FetchLike;
  calls: Call[];
} {
  const calls: Call[] = [];
  const queue = [...responses];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({
      url,
      method: init?.method ?? "GET",
      body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
      headers: (init?.headers ?? {}) as Record<string, string>,
    });
    const next = queue.shift() ?? { status: 200, json: [] };
    const status = next.status ?? 200;
    return new Response(next.text ?? JSON.stringify(next.json ?? []), {
      status,
      headers: { "content-type": "application/json" },
    });
  };
  return { fetchImpl, calls };
}

test("findExistingComment matches on the hidden marker, not the author", () => {
  const { fetchImpl } = fakeFetch([
    { json: [{ id: 1, body: "unrelated review comment" }, { id: 2, body: `${COMMENT_MARKER}\nold body` }] },
  ]);
  return findExistingComment(target, fetchImpl).then((id) => assert.equal(id, 2));
});

test("findExistingComment returns null when this tool has not commented", async () => {
  const { fetchImpl } = fakeFetch([{ json: [{ id: 1, body: "nope" }] }]);
  assert.equal(await findExistingComment(target, fetchImpl), null);
});

test("findExistingComment pages until a short page ends the list", async () => {
  const fullPage = Array.from({ length: 100 }, (_unused, index) => ({ id: index, body: "x" }));
  const { fetchImpl, calls } = fakeFetch([
    { json: fullPage },
    { json: [{ id: 999, body: COMMENT_MARKER }] },
  ]);
  assert.equal(await findExistingComment(target, fetchImpl), 999);
  assert.equal(calls.length, 2);
  assert.match(calls[1]?.url as string, /page=2/);
});

test("upsertComment creates a comment when none exists", async () => {
  const { fetchImpl, calls } = fakeFetch([{ json: [] }, { status: 201, json: { id: 42 } }]);
  const outcome = await upsertComment(target, "hello", fetchImpl);
  assert.deepEqual(outcome, { action: "created", id: 42 });
  assert.equal(calls[1]?.method, "POST");
  assert.equal(calls[1]?.url, "https://api.github.com/repos/octo/repo/issues/7/comments");
  assert.deepEqual(calls[1]?.body, { body: "hello" });
});

test("upsertComment edits in place so a PR never collects duplicates", async () => {
  const { fetchImpl, calls } = fakeFetch([
    { json: [{ id: 5, body: COMMENT_MARKER }] },
    { json: { id: 5 } },
  ]);
  const outcome = await upsertComment(target, "updated", fetchImpl);
  assert.deepEqual(outcome, { action: "updated", id: 5 });
  assert.equal(calls[1]?.method, "PATCH");
  assert.equal(calls[1]?.url, "https://api.github.com/repos/octo/repo/issues/comments/5");
});

test("every request is authenticated and version pinned", async () => {
  const { fetchImpl, calls } = fakeFetch([{ json: [] }, { status: 201, json: { id: 1 } }]);
  await upsertComment(target, "hello", fetchImpl);
  for (const call of calls) {
    assert.equal(call.headers["authorization"], "Bearer t0ken");
    assert.equal(call.headers["x-github-api-version"], "2022-11-28");
  }
});

test("an API failure surfaces the status instead of passing silently", async () => {
  const { fetchImpl } = fakeFetch([{ status: 403, text: '{"message":"Resource not accessible"}' }]);
  await assert.rejects(upsertComment(target, "hello", fetchImpl), /403.*Resource not accessible/s);
});

test("resolvePullRequestNumber reads a pull_request payload", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "tdr-event-"));
  const file = path.join(dir, "event.json");
  await writeFile(file, JSON.stringify({ pull_request: { number: 31 } }), "utf8");
  assert.equal(await resolvePullRequestNumber({ GITHUB_EVENT_PATH: file }), 31);
});

test("resolvePullRequestNumber reads an issue_comment payload on a PR", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "tdr-event-"));
  const file = path.join(dir, "event.json");
  await writeFile(file, JSON.stringify({ issue: { number: 12, pull_request: {} } }), "utf8");
  assert.equal(await resolvePullRequestNumber({ GITHUB_EVENT_PATH: file }), 12);
});

test("resolvePullRequestNumber returns null off a pull request", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "tdr-event-"));
  const file = path.join(dir, "event.json");
  await writeFile(file, JSON.stringify({ ref: "refs/heads/main" }), "utf8");
  assert.equal(await resolvePullRequestNumber({ GITHUB_EVENT_PATH: file }), null);
  assert.equal(await resolvePullRequestNumber({}), null);
  assert.equal(await resolvePullRequestNumber({ GITHUB_EVENT_PATH: "/no/such/file" }), null);
});

test("an issue comment on a plain issue is not treated as a PR", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "tdr-event-"));
  const file = path.join(dir, "event.json");
  await writeFile(file, JSON.stringify({ issue: { number: 12 } }), "utf8");
  assert.equal(await resolvePullRequestNumber({ GITHUB_EVENT_PATH: file }), null);
});
