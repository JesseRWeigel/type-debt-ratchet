/**
 * Ask git which files were actually renamed.
 *
 * Rename detection used to be inferred from error fingerprints alone, which is not
 * evidence. A fingerprint is the multiset of (code, normalized message, count) for one
 * file, and in loose signature mode "one TS2345" is byte-identical across every unrelated
 * file in a codebase. Deleting one file and adding another that happens to carry the same
 * error shape was therefore read as a rename, and the new file's genuinely new errors were
 * absorbed into the baseline. The gate reported PASS while letting new debt through, which
 * is the worst thing a ratchet can do.
 *
 * Git already solves this properly, by content similarity rather than by coincidence. It
 * is the right authority, so ask it.
 */
import { execFileSync } from "node:child_process";
const EMPTY = { pairs: new Map(), available: false };
function git(cwd, args) {
    try {
        return execFileSync("git", args, {
            cwd,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"],
            timeout: 20_000,
            maxBuffer: 16 * 1024 * 1024,
        });
    }
    catch {
        return null;
    }
}
function parseNameStatus(out, into) {
    // -z output is NUL separated. A rename record is three fields:
    //   "R<score>\0<from>\0<to>"
    const parts = out.split("\0");
    for (let i = 0; i < parts.length; i += 1) {
        const field = parts[i];
        if (!field || !/^R\d*$/.test(field))
            continue;
        const from = parts[i + 1];
        const to = parts[i + 2];
        if (from && to) {
            into.set(from, to);
            i += 2;
        }
    }
}
/**
 * Without a base, preserve the local HEAD/index workflow. With an explicit base,
 * compare its merge base with HEAD to the current working tree, so a clean PR
 * checkout includes committed renames and diverged branches are handled correctly.
 * Missing history is an error, never silently treated as an empty rename map.
 */
export function detectGitRenames(cwd, baseRef) {
    const inside = git(cwd, ["rev-parse", "--is-inside-work-tree"]);
    if (inside === null || inside.trim() !== "true") {
        if (baseRef)
            throw new Error("--base-ref requires a Git working tree and available git executable.");
        return EMPTY;
    }
    let mergeBase = null;
    if (baseRef) {
        const resolved = git(cwd, ["rev-parse", "--verify", "--end-of-options", `${baseRef}^{commit}`]);
        if (resolved === null) {
            throw new Error(`Cannot resolve base ref ${JSON.stringify(baseRef)}. Fetch the base revision/history (checkout fetch-depth: 0 in Actions).`);
        }
        mergeBase = git(cwd, ["merge-base", resolved.trim(), "HEAD"])?.trim() ?? null;
        if (!mergeBase) {
            throw new Error(`Cannot find a merge base for ${JSON.stringify(baseRef)} and HEAD. Fetch full history (checkout fetch-depth: 0); unrelated histories are unsupported.`);
        }
    }
    const pairs = new Map();
    let sawAny = false;
    const commands = mergeBase ? [
        ["diff", "--find-renames", "--name-status", "-z", "--relative", mergeBase, "--", "."],
    ] : [
        ["diff", "--find-renames", "--name-status", "-z", "HEAD"],
        ["diff", "--find-renames", "--name-status", "-z", "--cached"],
    ];
    for (const args of commands) {
        const out = git(cwd, args);
        if (out === null) {
            if (mergeBase)
                throw new Error("Git could not compare renames against the resolved base revision.");
            continue;
        }
        sawAny = true;
        parseNameStatus(out, pairs);
    }
    // A repository with no commits has no HEAD, so both diffs fail. That is "git cannot
    // answer", not "there are no renames", and the difference matters: the first must not
    // be reported as confirmation that nothing moved.
    if (!sawAny)
        return EMPTY;
    return { pairs, available: true };
}
/** Build a confirmer for `detectRenames`. Unavailable git confirms nothing. */
export function gitConfirmer(cwd, baseRef) {
    const lookup = detectGitRenames(cwd, baseRef);
    if (!lookup.available)
        return () => false;
    return (from, to) => lookup.pairs.get(from) === to;
}
//# sourceMappingURL=git.js.map