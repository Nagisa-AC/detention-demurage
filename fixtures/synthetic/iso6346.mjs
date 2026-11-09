const LETTER = {
  A: 10, B: 12, C: 13, D: 14, E: 15, F: 16, G: 17, H: 18, I: 19, J: 20,
  K: 21, L: 23, M: 24, N: 25, O: 26, P: 27, Q: 28, R: 29, S: 30, T: 31,
  U: 32, V: 34, W: 35, X: 36, Y: 37, Z: 38,
};

export function checkDigit(body) {
  if (!/^[A-Z]{4}\d{6}$/.test(body)) {
    throw new Error(`ISO 6346 body must be 4 letters and 6 digits: ${body}`);
  }
  let sum = 0;
  for (let i = 0; i < body.length; i += 1) {
    const char = body[i];
    const value = LETTER[char] ?? Number(char);
    sum += value * 2 ** i;
  }
  const remainder = sum % 11;
  return remainder === 10 ? 0 : remainder;
}

export function isValidContainer(number) {
  if (!/^[A-Z]{4}\d{7}$/.test(number)) {
    return false;
  }
  return checkDigit(number.slice(0, 10)) === Number(number[10]);
}
