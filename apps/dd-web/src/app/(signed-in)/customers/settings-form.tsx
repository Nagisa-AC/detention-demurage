"use client";

import { useActionState } from "react";
import { saveSettings, type SettingsFormState } from "./save-settings";

const initial: SettingsFormState = { message: "", problems: [] };

export function SettingsForm({ customerId }: { customerId: string }) {
  const [state, action, pending] = useActionState(saveSettings, initial);
  const saved = state.message.startsWith("Settings saved");
  return (
    <form className="settings-form" action={action}>
      <input type="hidden" name="customerId" value={customerId} />
      <div className="fld">
        <label htmlFor="settings-yaml">YAML</label>
        <textarea id="settings-yaml" name="yaml" rows={16} spellCheck={false} autoComplete="off" />
        <p className="help">Saving stores a new version and keeps the current one. The id inside must match this customer.</p>
        {saved ? <p className="ok">{state.message}</p> : null}
        {!saved && state.message !== "" ? <p className="err">{state.message}</p> : null}
        {state.problems.length === 0 ? null : (
          <ul className="problems">
            {state.problems.map((problem, index) => (
              <li key={`${problem.path}:${index}`}>
                <span>{problem.path}</span>: {problem.message}
              </li>
            ))}
          </ul>
        )}
      </div>
      <button type="submit" className="btn primary" disabled={pending}>
        Save settings
      </button>
    </form>
  );
}
