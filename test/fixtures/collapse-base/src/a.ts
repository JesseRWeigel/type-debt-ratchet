// Fixture for loose-mode message collapsing.
//
// One TS2322 whose message names the type 'string'. The changed variant next door has the
// same error code in the same place but names 'boolean' instead. Loose mode replaces quoted
// type names with a placeholder, so the two collapse to one signature and the change is not
// new debt. Exact mode keeps the names, so it is. Nothing else differs between the two.

export const widgetCount: number = "twelve";
