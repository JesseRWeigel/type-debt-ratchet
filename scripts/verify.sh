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
# report the whole file as new debt; rename detection must absorb it. This fixture is not
# a git repository, so it exercises the fingerprint strategy explicitly. Section 5 covers
# the shipped default, which requires git to attest to the move.
expect "renaming a file is not new debt" 0 renamed --rename-strategy fingerprint

# And with rename detection off, the same input should fail, proving the pass above was
# rename detection working rather than the fixture simply having no errors.
expect "renamed file IS new debt with detection off" 1 renamed --no-rename-detection
# and with no git and no explicit strategy, the safe default also reports new debt
expect "renamed file IS new debt when nothing can confirm the move" 1 renamed

echo
echo "4. a checker that silently checks nothing must not read as a clean pass"
# A wrong tsconfig, a bad exclude glob, or a wrapper that exits 0 without running tsc all
# produce zero diagnostics, which is indistinguishable from a completed cleanup unless the
# tool treats it as suspicious. A CI gate that passes when the checker is broken is worse
# than no gate, so this is asserted explicitly rather than left to judgement.
expect "an empty checker run against a real baseline is refused" 2 base --command "true"
expect "--allow-empty-result accepts it deliberately" 0 base --command "true" --allow-empty-result

echo
echo "5. rename detection requires evidence, not a matching error shape"
# The defect: the fingerprint is only (code, normalized message, count), so in loose mode
# "one TS2345" is identical across unrelated files. Deleting one file while adding another
# with the same shape was read as a rename and the new file's new error was absorbed. The
# gate reported PASS while letting new debt through. Both directions are asserted, because
# a fix that simply disabled rename detection would pass the first check alone.
RN="$TMP/renames"
mkdir -p "$RN/src"
cp test/fixtures/base/tsconfig.json "$RN/tsconfig.json"
cat > "$RN/src/a.ts" <<'TS'
function takesString(s: string) { return s; }
export const A = takesString(42);
TS
cat > "$RN/src/legacy.ts" <<'TS'
function takesString(s: string) { return s; }
export const L = takesString(99);
TS
TSC_LOCAL="$PWD/node_modules/.bin/tsc --noEmit --pretty false"
git -C "$RN" init -q && git -C "$RN" config user.email v@e && git -C "$RN" config user.name v
git -C "$RN" add -A && git -C "$RN" commit -qm base
$CLI --cwd "$RN" --baseline "$RN/tdb.json" --update-baseline --command "$TSC_LOCAL" >/dev/null 2>&1

# a REAL git rename must still be absorbed
git -C "$RN" mv src/legacy.ts src/moved.ts
out=$($CLI --cwd "$RN" --baseline "$RN/tdb.json" --command "$TSC_LOCAL" 2>&1); rc=$?
[ "$rc" -eq 0 ] && ok "a real git rename is not new debt (exit 0)" \
                || { bad "a real git rename should exit 0, got $rc"; printf '%s\n' "$out" | sed 's/^/        /' | head -6; }

# an UNRELATED new file with the same error shape must NOT be absorbed
git -C "$RN" mv src/moved.ts src/legacy.ts >/dev/null 2>&1
git -C "$RN" add -A && git -C "$RN" commit -qm restore
rm "$RN/src/legacy.ts"
cat > "$RN/src/feature.ts" <<'TS'
function takesString(s: string) { return s; }
export const F = takesString(7);
TS
out=$($CLI --cwd "$RN" --baseline "$RN/tdb.json" --command "$TSC_LOCAL" 2>&1); rc=$?
[ "$rc" -eq 1 ] && ok "an unrelated new file is new debt, not a rename (exit 1)" \
                || { bad "unrelated new file should exit 1, got $rc"; printf '%s\n' "$out" | sed 's/^/        /' | head -6; }

echo
echo "6. the shipped GitHub Action can actually start"
# action.yml points at dist/action.js and a runner performs no build step, so an unbuilt
# or untracked dist means every consumer gets "File not found".
entry=$(grep -E "^\s*main:" action.yml | head -1 | sed 's/.*main:[[:space:]]*//' | tr -d "'\"")
if [ -n "$entry" ] && [ -f "$entry" ]; then ok "action.yml main ($entry) exists on disk"
else bad "action.yml main ($entry) is missing"; fi
if [ -n "$entry" ] && git ls-files --error-unmatch "$entry" >/dev/null 2>&1; then
  ok "$entry is tracked in git, so a consumer gets it"
else bad "$entry is NOT tracked in git; @main consumers cannot run this action"; fi
if node -e "require('./$entry')" >/dev/null 2>&1; then ok "$entry loads under node"
else bad "$entry does not load"; fi
# every declared input must be one the code actually reads
missing=""
for name in $(python3 - <<'PY2'
import re,sys
y=open("action.yml").read()
block=y.split("inputs:",1)[1].split("\nruns:",1)[0]
print(" ".join(re.findall(r"^  ([a-z0-9-]+):", block, re.M)))
PY2
); do
  grep -q "\"$name\"\|'$name'" src/action.ts || missing="$missing $name"
done
[ -z "$missing" ] && ok "every action.yml input is read by src/action.ts" \
                  || bad "inputs declared but never read:$missing"

echo
echo "7. stale detection"
expect "--fail-on-stale flags a shrunk baseline" 1 fixed-only --fail-on-stale

echo
printf '%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ] || { echo "VERIFY FAILED"; exit 1; }
echo "VERIFY OK"
