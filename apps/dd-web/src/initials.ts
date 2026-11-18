/** Two letters from a display name. A single word uses its first two letters. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter((part) => part.length > 0);
  const first = parts[0];
  if (first === undefined) return "—";
  if (parts.length === 1) return first.slice(0, 2).toUpperCase();
  const last = parts[parts.length - 1] ?? first;
  return `${first.slice(0, 1)}${last.slice(0, 1)}`.toUpperCase();
}
