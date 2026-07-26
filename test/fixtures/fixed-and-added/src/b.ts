// Fixture: keeps base's TS2345 and adds a brand new TS2554.

export function toUpper(value: string): string {
  return value.toUpperCase();
}

export const shouted = toUpper(42);
export const louder = toUpper("quiet", "extra");
