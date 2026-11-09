import { unreadable, type Unreadable } from "./dates.js";

/**
 * Printed container numbers become 11 characters, or `unreadable`.
 * A failed ISO 6346 check digit is never replaced with the digit that would pass.
 */

const LETTER: Record<string, number> = {
  A: 10, B: 12, C: 13, D: 14, E: 15, F: 16, G: 17, H: 18, I: 19, J: 20,
  K: 21, L: 23, M: 24, N: 25, O: 26, P: 27, Q: 28, R: 29, S: 30, T: 31,
  U: 32, V: 34, W: 35, X: 36, Y: 37, Z: 38,
};

/** Read one container number. Spaces and hyphens are separators. The category letter must be U, J, or Z. */
export function parseContainer(text: string): string | Unreadable {
  if (typeof text !== "string") return unreadable;
  const number = text.toUpperCase().replace(/[\s-]/g, "");
  if (!/^[A-Z]{4}\d{7}$/.test(number)) return unreadable;
  const category = number[3];
  if (category !== "U" && category !== "J" && category !== "Z") return unreadable;
  if (number[10] !== checkDigit(number.slice(0, 10))) return unreadable;
  return number;
}

function checkDigit(body: string): string {
  let sum = 0;
  for (let i = 0; i < body.length; i += 1) {
    const char = body[i];
    if (char === undefined) return "";
    const letter = LETTER[char];
    const value = letter === undefined ? char.charCodeAt(0) - 48 : letter;
    sum += value * (1 << i);
  }
  const remainder = sum % 11;
  return remainder === 10 ? "0" : String(remainder);
}
