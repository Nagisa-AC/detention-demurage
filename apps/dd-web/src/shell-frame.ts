import { listInvoices } from "./screen-data";
import { readTheme, type ThemeName } from "./theme";

/** Theme cookie and the waiting-review count. Waiting is null when the database is not configured. */
export async function shellFrame(): Promise<{ theme: ThemeName; waiting: number | null }> {
  const theme = await readTheme();
  const invoices = await listInvoices();
  return {
    theme,
    waiting: invoices === null ? null : invoices.filter((invoice) => !invoice.approved).length,
  };
}
