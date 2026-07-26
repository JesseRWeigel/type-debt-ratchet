# type-debt-ratchet

Fail CI only on type errors you just added, never on the ones you inherited.

A team migrating off `strict: false` has thousands of existing `tsc` errors and no way to
turn the compiler on without a big-bang fix. This records the errors you already have and
fails the build only when the set grows. Debt can go down and never up.

**[Read this on the web](https://jesserweigel.github.io/type-debt-ratchet/)**

## How it decides

The baseline is keyed by **normalized error signature**, not by line number.

```
file path + error code + message shape with identifiers, quoted types and numbers replaced
```

Line numbers churn on every edit, so a baseline keyed on them is stale the moment anyone
adds an import. Keying on the message shape means the same error survives a file being
reformatted, and a genuinely different error in the same place is still caught.

Occurrences are counted per signature, so a file going from three of one error to five is
new debt even though the signature already existed.

## Using it as an Action

```yaml
- uses: JesseRWeigel/type-debt-ratchet@main
  with:
    baseline: type-debt.json
    tsc-command: npx tsc --noEmit --pretty false
```

`dist/` is committed on purpose. A GitHub Action runner performs no build step, so an
unbuilt `dist` means every consumer gets `File not found: dist/action.js`.

## Using it as a CLI

```bash
npx type-debt-ratchet --update-baseline     # record today's errors, commit the result
npx type-debt-ratchet                       # fails only on errors added since
```

| Flag | Effect |
|---|---|
| `--baseline <path>` | Baseline file. Default `type-debt.json` |
| `--command <shell>` | Type-check command. Default `npx tsc --noEmit --pretty false` |
| `--signature-mode loose\|exact` | How much of the message is normalized |
| `--update-baseline` | Rewrite the baseline from this run and exit 0 |
| `--auto-shrink` | Record fixed errors automatically. Never absorbs new ones |
| `--fail-on-stale` | Also fail when the baseline lists errors that no longer occur |
| `--rename-strategy git\|fingerprint` | How a rename is confirmed. Default `git` |
| `--allow-empty-result` | Accept a checker run that produced zero diagnostics |
| `--no-rename-detection` | Treat a moved file's errors as new debt |
| `--format text\|json\|markdown` | Output format |

Exit codes: `0` no new errors, `1` new errors (or a stale baseline under `--fail-on-stale`),
`2` bad usage or a type-check command that did not run properly.

## Two failure modes it deliberately refuses

Both were found by an independent reviewer attacking the tool rather than testing it, and
both are the kind of bug that makes a CI gate quietly stop guarding while still reporting
green. Each now has a check in `scripts/verify.sh` asserting both directions.

**A checker that runs but checks nothing.** A wrong `tsconfig` path, an exclude glob that
stops matching, or `tsc -b` with a warm `.tsbuildinfo` restored from a CI cache all exit 0
and print nothing. That is indistinguishable from a completed cleanup: zero diagnostics,
every baseline entry "fixed". The tool used to report `PASS, 4 type errors fixed`. It now
exits 2 when a non-empty baseline meets zero parsed diagnostics, because a total wipeout is
far more often a broken command than finished work. `--allow-empty-result` opts in.

**A rename that never happened.** Rename detection used to pair a vanished file with an
appeared file whenever their error fingerprints matched. A fingerprint is only
`(code, normalized message, count)`, so in loose mode "one TS2345" is byte-identical across
every unrelated file in a codebase, and any deletion paired with any addition. A pull
request that deleted `legacy.ts` and added an unrelated `feature.ts` carrying a brand new
`TS2345` was reported as a rename, and the new error was absorbed. The gate said PASS while
letting new debt through. Renames are now confirmed by git, which decides by content
similarity and is the only real evidence available. Outside a git repository nothing
confirms a rename, so a moved file reads as new debt and you run `--update-baseline` once,
which is the safe direction to fail.

## Status

Verified 2026-07-26.

```
$ bash scripts/verify.sh
1. unit suite
  ok    pass 95 unit tests
...
5. rename detection requires evidence, not a matching error shape
  ok    a real git rename is not new debt (exit 0)
  ok    an unrelated new file is new debt, not a rename (exit 1)
6. the shipped GitHub Action can actually start
  ok    action.yml main (dist/action.js) exists on disk
  ok    dist/action.js is tracked in git, so a consumer gets it
  ok    dist/action.js loads under node
  ok    every action.yml input is read by src/action.ts

18 passed, 0 failed
VERIFY OK
```

95 unit tests plus 18 behavioral checks against real fixture projects with real `tsc` errors.
Several checks are negative controls: the renamed fixture is asserted to **fail** with
`--no-rename-detection`, so the passing case proves rename handling is doing the work rather
than the fixture simply having no errors.

## Requirements

Node 22.6 or newer to run from source, because the test and verify scripts rely on
TypeScript type stripping. The built `dist/` runs on Node 20.11 or newer with no flags.

## Known gaps

- The Action has never executed in a real GitHub CI run. `scripts/verify.sh` asserts that
  its entrypoint exists, is tracked in git, loads under node, and that every declared input
  is read by the code, which is considerably more than nothing and still is not the same as
  a green run on a real pull request.
- `--signature-mode exact` has unit coverage but is never exercised end to end.
- Loose-mode message collapsing has no end-to-end fixture. The fixtures differ by error
  code, so `file + code` alone satisfies the behavioral assertions.

## License

MIT.
