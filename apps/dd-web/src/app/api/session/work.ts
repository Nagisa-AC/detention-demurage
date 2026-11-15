let ran = false;

export function markSessionRoute(): void {
  ran = true;
}

export function sessionRouteRan(): boolean {
  return ran;
}

export function resetSessionRoute(): void {
  ran = false;
}
