import { formatSavedAt, settingsFacts, type CustomerSettings } from "../../../settings";
import { SettingsForm } from "./settings-form";

export function SettingsPanel({ customer }: { customer: CustomerSettings }) {
  const current = customer.versions[0];
  return (
    <section className="settings" aria-label={`Settings for ${customer.displayName}`}>
      <h2>Settings</h2>
      <p>
        {customer.displayName} · {customer.configId}
      </p>
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
