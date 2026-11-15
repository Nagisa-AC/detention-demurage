let ran = false;

export function markConfirmRoute(): void {
  ran = true;
}

export function confirmRouteRan(): boolean {
  return ran;
}

export function resetConfirmRoute(): void {
  ran = false;
}
