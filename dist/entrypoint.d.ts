/**
 * True when `moduleUrl` names the file Node was asked to run, as opposed to one a test
 * imported.
 *
 * The realpath step matters: npm installs `bin` entries as symlinks, so `argv[1]` is the
 * link while `import.meta.url` is already resolved.
 */
export declare function isEntryPoint(moduleUrl: string): boolean;
