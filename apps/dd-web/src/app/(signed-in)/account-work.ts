let ran = false;

export function markAccountRead(): void {
  ran = true;
}

export function accountWasRead(): boolean {
  return ran;
}

export function resetAccountRead(): void {
  ran = false;
}
