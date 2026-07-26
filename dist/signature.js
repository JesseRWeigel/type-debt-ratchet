/**
 * Turn a raw tsc diagnostic into the stable identity the baseline tracks.
 *
 * The whole tool rests on this file. A baseline keyed on line numbers is worthless: adding
 * an import at the top of a file would invalidate every entry below it. So a signature
 * deliberately drops position entirely and keeps only what survives ordinary editing.
 */
import { createHash } from "node:crypto";
import path from "node:path";
/** Placeholder for a quoted type name or identifier. */
const QUOTED = "'{}'";
/** Placeholder for a numeric literal. */
const NUMBER = "{n}";
/**
 * Normalize a path to a repo-relative POSIX path.
 *
 * tsc prints paths relative to its own working directory, which is where the tsconfig
 * lives. When the ratchet runs from a different directory the two must be reconciled or
 * every entry looks new.
 */
export function normalizeFilePath(filePath, rootDir) {
    if (filePath === "")
        return "";
    const posix = filePath.replace(/\\/g, "/");
    const absolute = path.posix.isAbsolute(posix) || /^[A-Za-z]:\//.test(posix)
        ? posix
        : path.posix.join(rootDir.replace(/\\/g, "/"), posix);
    const relative = path.posix.relative(rootDir.replace(/\\/g, "/") || ".", absolute);
    return relative.replace(/^\.\//, "");
}
/**
 * Collapse a diagnostic message to its shape.
 *
 * `loose` (the default) replaces every single-quoted span and every number, so
 * "Property 'userId' does not exist on type 'Session'." and the same error about a
 * different property share one signature. That is intentional: specificity is recovered by
 * counting occurrences per file, so three of these becoming five is still caught.
 *
 * `exact` keeps the message verbatim apart from whitespace. Use it when a codebase has a
 * small, well understood error set and you want the baseline to pin exact types.
 *
 * Quoted spans are paired left to right. A message containing an odd apostrophe therefore
 * pairs "wrong", but it does so deterministically, which is all a hash key needs.
 */
export function normalizeMessage(message, mode = "loose") {
    const collapsed = message.replace(/\s+/g, " ").trim();
    if (mode === "exact")
        return collapsed;
    return collapsed
        .replace(/'[^']*'/g, QUOTED)
        .replace(/\d+(?:\.\d+)?/g, NUMBER);
}
/**
 * Short, stable content hash of the three signature fields.
 *
 * The NUL separator keeps fields from bleeding into each other, since none of them can
 * contain one. 48 bits is ample for the few thousand signatures a real baseline holds.
 */
export function hashSignature(file, code, message) {
    return createHash("sha256").update([file, code, message].join("\u0000")).digest("hex").slice(0, 12);
}
/** Format a numeric tsc code as it appears in output, e.g. 2322 -> "TS2322". */
export function formatCode(code) {
    return `TS${code}`;
}
/** Reduce one diagnostic to its signature. */
export function toSignature(diagnostic, rootDir, mode = "loose") {
    const file = normalizeFilePath(diagnostic.file, rootDir);
    const code = formatCode(diagnostic.code);
    const message = normalizeMessage(diagnostic.message, mode);
    return { file, code, message, hash: hashSignature(file, code, message) };
}
/**
 * Count how many times each signature occurs.
 *
 * Counting is what makes duplicate errors within one file tractable. Two identical TS2322s
 * in `src/a.ts` are one baseline row with count 2, and a third one is new debt.
 */
export function countSignatures(signatures) {
    const counts = new Map();
    for (const signature of signatures) {
        const existing = counts.get(signature.hash);
        if (existing) {
            counts.set(signature.hash, { signature, count: existing.count + 1 });
        }
        else {
            counts.set(signature.hash, { signature, count: 1 });
        }
    }
    return counts;
}
//# sourceMappingURL=signature.js.map