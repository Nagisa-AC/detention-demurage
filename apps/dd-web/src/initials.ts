/** Two letters from a display name. Parentheticals and punctuation are not words. */
export function initials(name: string): string {
  const words = name
    .replace(/\([^)]*\)/g, " ")
    .split(/[^A-Za-z0-9]+/)
    .filter((word) => word.length > 0);
  const first = words[0];
  if (first === undefined) return "—";
  if (words.length === 1) return first.slice(0, 2).toUpperCase();
  const second = words[1] ?? first;
  return `${first.slice(0, 1)}${second.slice(0, 1)}`.toUpperCase();
}
