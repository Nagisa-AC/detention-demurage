let ran = false;

export function markUploadRoute(): void {
  ran = true;
}

export function uploadRouteRan(): boolean {
  return ran;
}

export function resetUploadRoute(): void {
  ran = false;
}
