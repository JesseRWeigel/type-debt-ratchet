/**
 * Compare a run against the baseline and decide what counts as new debt.
 *
 * Two behaviours here are load-bearing and easy to get wrong:
 *
 *   1. Comparison is by count, not presence. A file going from three of the same error to
 *      five is new debt even though the signature already existed.
 *   2. A renamed file is not new debt. Since a signature is keyed on path, moving a file
 *      would otherwise wipe out its baseline rows and re-add them as new. `detectRenames`
 *      matches a vanished path to an appeared path by the fingerprint of its errors.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { hashSignature } from "./signature.js";
/** Group anything that has a `file` field by that field. */
function groupByFile(items) {
    const groups = new Map();
    for (const item of items) {
        const bucket = groups.get(item.file);
        if (bucket)
            bucket.push(item);
        else
            groups.set(item.file, [item]);
    }
    return groups;
}
/**
 * A path-independent summary of one file's errors.
 *
 * Only code, normalized message and count go in. If a file is moved without being edited,
 * its fingerprint is unchanged, which is exactly the signal a rename gives off.
 */
function fingerprint(rows) {
    return rows
        .map((row) => [row.code, row.message, row.count].join("\u0000"))
        .sort()
        .join("");
}
/**
 * Match baseline paths that vanished to current paths that appeared.
 *
 * A pair is a rename when all three hold: the baseline file now reports zero errors, the
 * baseline file is gone from disk, and the two files' error fingerprints are identical.
 * When several candidates share one fingerprint they are paired in sorted path order, so
 * the result is deterministic rather than dependent on map iteration.
 *
 * A file that is moved *and* edited in the same commit will not match. That is the honest
 * outcome: its errors really did change, and the tool cannot tell which are new.
 */
export function detectRenames(baseline, current, fileExists, 
/**
 * Positive evidence that `from` really became `to`. Defaults to refusing every pair.
 *
 * The fingerprint below only nominates candidates. It cannot confirm them, because in
 * loose signature mode the fingerprint of "one TS2345" is identical across every
 * unrelated file in a codebase, so any deletion pairs with any addition. Accepting a
 * pair on that basis absorbs a genuinely new file's genuinely new errors into the
 * baseline and reports PASS, which is precisely the failure a ratchet exists to
 * prevent. The default is therefore to confirm nothing; `src/run.ts` supplies a
 * git-backed confirmer, and callers can pass `() => true` to opt into the old
 * fingerprint-only behavior explicitly.
 */
confirm = () => false) {
    const baselineByFile = groupByFile(baseline.entries);
    const currentRows = [...current.values()].map(({ signature, count }) => ({
        file: signature.file,
        code: signature.code,
        message: signature.message,
        count,
    }));
    const currentByFile = groupByFile(currentRows);
    const vanished = [...baselineByFile.keys()]
        .filter((file) => file !== "" && !currentByFile.has(file) && !fileExists(file))
        .sort();
    const appeared = [...currentByFile.keys()]
        .filter((file) => file !== "" && !baselineByFile.has(file))
        .sort();
    if (vanished.length === 0 || appeared.length === 0)
        return [];
    const appearedByFingerprint = new Map();
    for (const file of appeared) {
        const key = fingerprint(currentByFile.get(file) ?? []);
        const bucket = appearedByFingerprint.get(key);
        if (bucket)
            bucket.push(file);
        else
            appearedByFingerprint.set(key, [file]);
    }
    const renames = [];
    for (const from of vanished) {
        const rows = baselineByFile.get(from) ?? [];
        const candidates = appearedByFingerprint.get(fingerprint(rows));
        if (!candidates || candidates.length === 0)
            continue;
        // Take the first candidate the confirmer accepts, and remove only that one, so an
        // unconfirmed candidate stays available for a different baseline file that git does
        // attest to.
        const index = candidates.findIndex((candidate) => confirm(from, candidate));
        if (index === -1)
            continue;
        const to = candidates.splice(index, 1)[0];
        if (to === undefined)
            continue;
        renames.push({ from, to, errors: rows.reduce((sum, row) => sum + row.count, 0) });
    }
    return renames;
}
/** Rewrite baseline entries onto their new paths, recomputing the hashes that embed them. */
export function applyRenames(baseline, renames) {
    if (renames.length === 0)
        return baseline;
    const moves = new Map(renames.map((rename) => [rename.from, rename.to]));
    const entries = baseline.entries.map((entry) => {
        const to = moves.get(entry.file);
        if (to === undefined)
            return entry;
        return { ...entry, file: to, hash: hashSignature(to, entry.code, entry.message) };
    });
    return { ...baseline, entries };
}
function compareAdded(a, b) {
    return b.delta - a.delta || a.file.localeCompare(b.file) || a.code.localeCompare(b.code);
}
function compareFixed(a, b) {
    return a.delta - b.delta || a.file.localeCompare(b.file) || a.code.localeCompare(b.code);
}
/** Compare the current run against the baseline, after accounting for renames. */
export function diffAgainstBaseline(baseline, current, options = {}) {
    // No default that silently resolves against process.cwd(). A caller whose process cwd
    // differs from the project root would see every baseline path as vanished, turning the
    // whole baseline into rename candidates. Make the dependency explicit instead.
    const fileExists = options.fileExists ??
        ((relativePath) => existsSync(path.resolve(process.cwd(), relativePath)));
    const renames = options.detectRenames === false
        ? []
        : detectRenames(baseline, current, fileExists, options.confirmRename);
    const remapped = applyRenames(baseline, renames);
    const baselineByHash = new Map();
    for (const entry of remapped.entries) {
        // Two baseline rows can collide on one hash after a rename merges two files into one.
        const existing = baselineByHash.get(entry.hash);
        baselineByHash.set(entry.hash, existing ? { ...entry, count: existing.count + entry.count } : entry);
    }
    const added = [];
    const fixed = [];
    const seen = new Set();
    for (const [hash, { signature, count }] of current) {
        seen.add(hash);
        const baselineCount = baselineByHash.get(hash)?.count ?? 0;
        const delta = count - baselineCount;
        if (delta === 0)
            continue;
        const change = {
            hash,
            file: signature.file,
            code: signature.code,
            message: signature.message,
            baselineCount,
            currentCount: count,
            delta,
        };
        if (delta > 0)
            added.push(change);
        else
            fixed.push(change);
    }
    for (const [hash, entry] of baselineByHash) {
        if (seen.has(hash))
            continue;
        fixed.push({
            hash,
            file: entry.file,
            code: entry.code,
            message: entry.message,
            baselineCount: entry.count,
            currentCount: 0,
            delta: -entry.count,
        });
    }
    added.sort(compareAdded);
    fixed.sort(compareFixed);
    const newErrorCount = added.reduce((sum, change) => sum + change.delta, 0);
    const fixedErrorCount = fixed.reduce((sum, change) => sum - change.delta, 0);
    const currentTotal = [...current.values()].reduce((sum, item) => sum + item.count, 0);
    return {
        added,
        fixed,
        newErrorCount,
        fixedErrorCount,
        baselineTotal: remapped.entries.reduce((sum, entry) => sum + entry.count, 0),
        currentTotal,
        renames,
        stale: fixed.length > 0,
    };
}
/**
 * The baseline rewritten to record only the debt that was paid down.
 *
 * Used by `--auto-shrink`. New debt is never absorbed: a count only ever moves toward zero,
 * so a run that adds errors still fails even with auto-shrink on.
 */
export function shrinkBaseline(baseline, diff) {
    const reductions = new Map(diff.fixed.map((change) => [change.hash, change.currentCount]));
    const renamed = applyRenames(baseline, diff.renames);
    const entries = renamed.entries
        .map((entry) => {
        const remaining = reductions.get(entry.hash);
        return remaining === undefined ? entry : { ...entry, count: remaining };
    })
        .filter((entry) => entry.count > 0);
    return {
        ...baseline,
        totalErrors: entries.reduce((sum, entry) => sum + entry.count, 0),
        entries,
    };
}
//# sourceMappingURL=diff.js.map