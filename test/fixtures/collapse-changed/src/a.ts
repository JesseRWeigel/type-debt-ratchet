// Fixture for loose-mode message collapsing.
//
// Same file, same line, same TS2322, but the offending type is now 'boolean' rather than
// 'string'. See collapse-base/src/a.ts for what this is testing.

export const widgetCount: number = true;
