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
export interface GitRenameLookup {
    /** Rename pairs git is willing to attest to, as from -> to, both repo-relative. */
    readonly pairs: ReadonlyMap<string, string>;
    /** False when this is not a git repository, or git could not be run at all. */
    readonly available: boolean;
}
/**
 * Rename pairs across the working tree and the index, relative to HEAD.
 *
 * Both are consulted because a rename can be staged, unstaged, or a mix, and a CI checkout
 * of a pull request branch shows it as a committed change against the base. Callers that
 * need the committed-only view can diff against a merge base themselves and pass the
 * result in.
 */
export declare function detectGitRenames(cwd: string): GitRenameLookup;
/** Build a confirmer for `detectRenames`. Unavailable git confirms nothing. */
export declare function gitConfirmer(cwd: string): (from: string, to: string) => boolean;
