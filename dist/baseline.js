/**
 * Read and write `type-debt.json`.
 *
 * The file is committed, so it is diffed by humans and merged by git. It therefore carries
 * no timestamps, no line numbers and no run metadata: writing it twice for the same error
 * set produces byte-identical output, and an unrelated edit never churns it.
 */
import { readFile, writeFile } from "node:fs/promises";
/** Thrown for anything the caller can fix by changing input, as opposed to a bug. */
export class BaselineError extends Error {
    constructor(message) {
        super(message);
        this.name = "BaselineError";
    }
}
/** Deterministic order: file, then code, then hash. Never insertion order. */
function compareEntries(a, b) {
    return a.file.localeCompare(b.file) || a.code.localeCompare(b.code) || a.hash.localeCompare(b.hash);
}
/** Build a baseline from counted signatures. */
export function buildBaseline(counts, mode) {
    const entries = [];
    let total = 0;
    for (const { signature, count } of counts.values()) {
        entries.push({
            hash: signature.hash,
            file: signature.file,
            code: signature.code,
            message: signature.message,
            count,
        });
        total += count;
    }
    entries.sort(compareEntries);
    return { version: 1, signatureMode: mode, totalErrors: total, entries };
}
/** An empty baseline, used when a project starts out clean. */
export function emptyBaseline(mode) {
    return { version: 1, signatureMode: mode, totalErrors: 0, entries: [] };
}
/** Serialize with a trailing newline so the file is well formed for git and editors. */
export function serializeBaseline(baseline) {
    return `${JSON.stringify(baseline, null, 2)}\n`;
}
/** Validate an unknown parsed value as a baseline, with messages a user can act on. */
export function parseBaseline(text, source) {
    let value;
    try {
        value = JSON.parse(text);
    }
    catch (error) {
        throw new BaselineError(`${source} is not valid JSON: ${error.message}`);
    }
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new BaselineError(`${source} must contain a JSON object`);
    }
    const record = value;
    if (record["version"] !== 1) {
        throw new BaselineError(`${source} has version ${JSON.stringify(record["version"])}, this tool understands version 1`);
    }
    const mode = record["signatureMode"];
    if (mode !== "loose" && mode !== "exact") {
        throw new BaselineError(`${source} has an unknown signatureMode: ${JSON.stringify(mode)}`);
    }
    const rawEntries = record["entries"];
    if (!Array.isArray(rawEntries)) {
        throw new BaselineError(`${source} is missing an "entries" array`);
    }
    const entries = rawEntries.map((raw, index) => {
        if (typeof raw !== "object" || raw === null) {
            throw new BaselineError(`${source} entry ${index} is not an object`);
        }
        const entry = raw;
        const hash = entry["hash"];
        const file = entry["file"];
        const code = entry["code"];
        const message = entry["message"];
        const count = entry["count"];
        if (typeof hash !== "string" || typeof file !== "string" || typeof code !== "string") {
            throw new BaselineError(`${source} entry ${index} needs string hash, file and code`);
        }
        if (typeof message !== "string") {
            throw new BaselineError(`${source} entry ${index} needs a string message`);
        }
        if (typeof count !== "number" || !Number.isInteger(count) || count < 1) {
            throw new BaselineError(`${source} entry ${index} needs a positive integer count`);
        }
        return { hash, file, code, message, count };
    });
    const declaredTotal = record["totalErrors"];
    const actualTotal = entries.reduce((sum, entry) => sum + entry.count, 0);
    if (typeof declaredTotal === "number" && declaredTotal !== actualTotal) {
        throw new BaselineError(`${source} says totalErrors is ${declaredTotal} but its entries sum to ${actualTotal}. ` +
            `The file was probably hand-edited or badly merged. Re-run with --update-baseline.`);
    }
    return {
        version: 1,
        signatureMode: mode,
        totalErrors: actualTotal,
        entries: [...entries].sort(compareEntries),
    };
}
/** Read a baseline from disk. Returns null when the file does not exist. */
export async function readBaseline(filePath) {
    let text;
    try {
        text = await readFile(filePath, "utf8");
    }
    catch (error) {
        if (error.code === "ENOENT")
            return null;
        throw error;
    }
    return parseBaseline(text, filePath);
}
/** Write a baseline to disk. Returns true when the bytes actually changed. */
export async function writeBaseline(filePath, baseline) {
    const next = serializeBaseline(baseline);
    let current = null;
    try {
        current = await readFile(filePath, "utf8");
    }
    catch {
        current = null;
    }
    if (current === next)
        return false;
    await writeFile(filePath, next, "utf8");
    return true;
}
//# sourceMappingURL=baseline.js.map