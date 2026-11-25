import { notFound } from "next/navigation";
import { readCustomerSettings } from "../../../../../settings";
import { requireSession } from "../../../../../session";
import { settingsCards } from "../../../../../settings-cards";
import { shellFrame } from "../../../../../shell-frame";
import { Shell } from "../../../../../shell";
import { SettingsView } from "../../settings-view";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function CustomerSettingsPage({ params }: { params: Promise<{ customerId: string }> }) {
  const session = await requireSession({ path: "/customers/settings" });
  const { customerId } = await params;
  const frame = await shellFrame();
  const settings = await readCustomerSettings();
  const customer = settings.find((item) => item.id === customerId);
  if (customer === undefined) notFound();
  const current = customer.versions[0];
  return (
    <Shell session={session} active="customers" theme={frame.theme} waiting={frame.waiting}>
      <SettingsView
        cards={settingsCards(customer)}
        configId={customer.configId}
        config={current?.config ?? null}
        editable={current === undefined || current.config !== null}
      />
    </Shell>
  );
}
