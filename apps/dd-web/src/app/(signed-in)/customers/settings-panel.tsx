import type { LatestChecks } from "../../../rules-run";
import { formatSavedAt, settingsFacts, type CustomerSettings } from "../../../settings";
import { rerunChecks } from "./rerun-checks";
import { SettingsForm } from "./settings-form";

export function SettingsPanel({ customer, checks }: { customer: CustomerSettings; checks: LatestChecks | null }) {
  const current = customer.versions[0];
  return (
    <section className="settings" aria-label={`Settings for ${customer.displayName}`}>
      <h2>Settings</h2>
      <p>
        {customer.displayName} · {customer.configId}
      </p>
      <LatestChecksLine customerId={customer.id} checks={checks} />
      {current === undefined ? (
        <p>No settings yet.</p>
      ) : current.config === null ? (
        <p>Version {current.version} cannot be shown.</p>
      ) : (
        <dl>
          <div>
            <dt>Version</dt>
            <dd>{current.version}</dd>
          </div>
          {settingsFacts(current.config).map((fact) => (
            <div key={fact.label}>
              <dt>{fact.label}</dt>
              <dd>{fact.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {customer.versions.length === 0 ? null : (
        <ul>
          {customer.versions.map((version) => (
            <li key={version.version}>
              Version {version.version} saved by {version.createdBy} on {formatSavedAt(version.createdAt)}
            </li>
          ))}
        </ul>
      )}
      <SettingsForm customerId={customer.id} />
    </section>
  );
}

function LatestChecksLine({ customerId, checks }: { customerId: string; checks: LatestChecks | null }) {
  if (checks === null) return null;
  if (checks.status === "failed") {
    return (
      <div className="latest-checks">
        <span>Checks failed — run again</span>
        <form action={rerunChecks}>
          <input type="hidden" name="customerId" value={customerId} />
          <button type="submit" className="btn">
            Run again
          </button>
        </form>
      </div>
    );
  }
  const count = checks.findings === 1 ? "1 finding" : `${checks.findings} findings`;
  return (
    <p className="latest-checks">
      Latest checks: {formatSavedAt(checks.ranAt)} · {count} · day 1 {checks.day1} · day 0 {checks.day0}
    </p>
  );
}
