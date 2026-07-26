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

export interface GitRenameLookup {
  /** Rename pairs git is willing to attest to, as from -> to, both repo-relative. */
  readonly pairs: ReadonlyMap<string, string>;
  /** False when this is not a git repository, or git could not be run at all. */
  readonly available: boolean;
}

const EMPTY: GitRenameLookup = { pairs: new Map(), available: false };

function git(cwd: string, args: readonly string[]): string | null {
  try {
    return execFileSync("git", args as string[], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 20_000,
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch {
    return null;
  }
}

function parseNameStatus(out: string, into: Map<string, string>): void {
  // -z output is NUL separated. A rename record is three fields:
  //   "R<score>\0<from>\0<to>"
  const parts = out.split("\0");
  for (let i = 0; i < parts.length; i += 1) {
    const field = parts[i];
    if (!field || !/^R\d*$/.test(field)) continue;
    const from = parts[i + 1];
    const to = parts[i + 2];
    if (from && to) {
      into.set(from, to);
      i += 2;
    }
  }
}

/**
 * Rename pairs across the working tree and the index, relative to HEAD.
 *
 * Both are consulted because a rename can be staged, unstaged, or a mix, and a CI checkout
 * of a pull request branch shows it as a committed change against the base. Callers that
 * need the committed-only view can diff against a merge base themselves and pass the
 * result in.
 */
export function detectGitRenames(cwd: string): GitRenameLookup {
  const inside = git(cwd, ["rev-parse", "--is-inside-work-tree"]);
  if (inside === null || inside.trim() !== "true") return EMPTY;

  const pairs = new Map<string, string>();
  let sawAny = false;
  for (const args of [
    ["diff", "--find-renames", "--name-status", "-z", "HEAD"],
    ["diff", "--find-renames", "--name-status", "-z", "--cached"],
  ]) {
    const out = git(cwd, args);
    if (out === null) continue;
    sawAny = true;
    parseNameStatus(out, pairs);
  }

  // A repository with no commits has no HEAD, so both diffs fail. That is "git cannot
  // answer", not "there are no renames", and the difference matters: the first must not
  // be reported as confirmation that nothing moved.
  if (!sawAny) return EMPTY;
  return { pairs, available: true };
}

/** Build a confirmer for `detectRenames`. Unavailable git confirms nothing. */
export function gitConfirmer(cwd: string): (from: string, to: string) => boolean {
  const lookup = detectGitRenames(cwd);
  if (!lookup.available) return () => false;
  return (from, to) => lookup.pairs.get(from) === to;
}
