"use client";

import { useActionState } from "react";
import { saveSettings, type SettingsFormState } from "./save-settings";

const initial: SettingsFormState = { message: "", problems: [] };

export function SettingsForm({ customerId }: { customerId: string }) {
  const [state, action, pending] = useActionState(saveSettings, initial);
  return (
    <form className="settings-form" action={action}>
      <p>Update settings</p>
      <input type="hidden" name="customerId" value={customerId} />
      <label>
        YAML
        <textarea name="yaml" rows={16} spellCheck={false} autoComplete="off" />
      </label>
      <button type="submit" disabled={pending}>
        Save settings
      </button>
      {state.message === "" ? null : <p role="status">{state.message}</p>}
      {state.problems.length === 0 ? null : (
        <ul className="problems">
          {state.problems.map((problem, index) => (
            <li key={`${problem.path}:${index}`}>
              <span>{problem.path}</span>: {problem.message}
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}
