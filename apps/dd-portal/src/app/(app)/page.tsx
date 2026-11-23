import { requireAccount } from "../../auth/session";
import { loadHome } from "../../model";
import { HomeView } from "../../views";

export default async function HomePage() {
  const account = await requireAccount();
  try {
    const model = await loadHome(account.customer);
    return <HomeView model={model} />;
  } catch {
    return <p>Something went wrong. Please try again.</p>;
  }
}
