#!/usr/bin/env bash
# Full verification for the type-debt ratchet.
#
# The unit suite covers signature normalization in isolation. This script exercises the
# behavior the tool actually exists for: establish a baseline, then prove the ratchet
# fails on new debt, passes on a fix, and does not false-positive on a renamed file.
# Each fixture directory is a small TypeScript project with deliberate type errors.
#
# Exit 0 means every expectation held.

set -uo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

CLI="node --experimental-strip-types src/cli.ts"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

pass=0
fail=0

ok()   { printf '  ok    %s\n' "$1"; pass=$((pass+1)); }
bad()  { printf '  FAIL  %s\n' "$1"; fail=$((fail+1)); }

# expect <description> <expected-exit> <fixture> [extra cli args...]
expect() {
  local desc="$1" want="$2" fixture="$3"; shift 3
  local out rc
  out="$($CLI --cwd "test/fixtures/$fixture" --baseline "$TMP/baseline.json" "$@" 2>&1)"
  rc=$?
  if [ "$rc" -eq "$want" ]; then
    ok "$desc (exit $rc)"
  else
    bad "$desc: expected exit $want, got $rc"
    printf '%s\n' "$out" | sed 's/^/        /' | head -12
  fi
}

echo "1. unit suite"
if npm test >"$TMP/unit.log" 2>&1; then
  ok "$(grep -oE '# pass [0-9]+|pass [0-9]+' "$TMP/unit.log" | tail -1) unit tests"
else
  bad "unit suite"
  tail -15 "$TMP/unit.log" | sed 's/^/        /'
fi

echo
echo "2. baseline establishment"
expect "establishing a baseline exits 0" 0 base --update-baseline
if [ -s "$TMP/baseline.json" ]; then
  ok "baseline file was written ($(wc -c <"$TMP/baseline.json") bytes)"
else
  bad "baseline file was not written"
fi

echo
echo "3. the ratchet"
# Same code, same baseline: existing debt must not fail the build.
expect "known debt does not fail" 0 base

# One error fixed, one added. The addition must fail even though the total is unchanged,
# which is the case a naive error-count comparison gets wrong.
expect "a newly added error fails" 1 fixed-and-added

# Fixing an error must never fail. Without --fail-on-stale a shrinking baseline is fine.
expect "fixing an error does not fail" 0 fixed-only

# A renamed file changes every error's path. Keying on line numbers or raw paths would
# report the whole file as new debt; rename detection must absorb it.
expect "renaming a file is not new debt" 0 renamed

# And with rename detection off, the same input should fail, proving the pass above was
# rename detection working rather than the fixture simply having no errors.
expect "renamed file IS new debt with detection off" 1 renamed --no-rename-detection

echo
echo "4. a checker that silently checks nothing must not read as a clean pass"
# A wrong tsconfig, a bad exclude glob, or a wrapper that exits 0 without running tsc all
# produce zero diagnostics, which is indistinguishable from a completed cleanup unless the
# tool treats it as suspicious. A CI gate that passes when the checker is broken is worse
# than no gate, so this is asserted explicitly rather than left to judgement.
expect "an empty checker run against a real baseline is refused" 2 base --command "true"
expect "--allow-empty-result accepts it deliberately" 0 base --command "true" --allow-empty-result

echo
echo "5. stale detection"
expect "--fail-on-stale flags a shrunk baseline" 1 fixed-only --fail-on-stale

echo
printf '%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ] || { echo "VERIFY FAILED"; exit 1; }
echo "VERIFY OK"
