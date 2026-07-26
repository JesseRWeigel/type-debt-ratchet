// Fixture: deliberate type errors. Not part of the ratchet's own build.
// Two TS2322 errors that normalize to the same signature, plus one TS2339.

export const widgetCount: number = "twelve";
export const gadgetCount: number = "forty";

export interface Session {
  userId: string;
}

export function greet(session: Session): string {
  return `hello ${session.displayName}`;
}
