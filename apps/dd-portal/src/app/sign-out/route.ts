import { signOut } from "../sign-out-action";

export async function GET(): Promise<void> {
  await signOut();
}

export async function POST(): Promise<void> {
  await signOut();
}
