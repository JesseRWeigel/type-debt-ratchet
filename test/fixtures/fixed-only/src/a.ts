// Fixture: same as base/src/a.ts with the TS2339 fixed and nothing added.

export const widgetCount: number = "twelve";
export const gadgetCount: number = "forty";

export interface Session {
  userId: string;
  displayName: string;
}

export function greet(session: Session): string {
  return `hello ${session.displayName}`;
}
