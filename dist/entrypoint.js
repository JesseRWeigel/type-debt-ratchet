import { realpathSync } from "node:fs";
import process from "node:process";
import { pathToFileURL } from "node:url";
/**
 * True when `moduleUrl` names the file Node was asked to run, as opposed to one a test
 * imported.
 *
 * The realpath step matters: npm installs `bin` entries as symlinks, so `argv[1]` is the
 * link while `import.meta.url` is already resolved.
 */
export function isEntryPoint(moduleUrl) {
    const entry = process.argv[1];
    if (entry === undefined)
        return false;
    try {
        return pathToFileURL(realpathSync(entry)).href === moduleUrl;
    }
    catch {
        return false;
    }
}
//# sourceMappingURL=entrypoint.js.map