"use client";

import { useActionState } from "react";
import { createCustomer, type CustomerFormState } from "./create-customer";

const initial: CustomerFormState = { message: "" };

export function AddCustomerForm() {
  const [state, action, pending] = useActionState(createCustomer, initial);
  return (
    <form className="upload" action={action}>
      <p>Add a customer.</p>
      <label>
        Display name
        <input name="displayName" type="text" required maxLength={120} autoComplete="off" />
      </label>
      <label>
        Config id
        <input
          name="configId"
          type="text"
          required
          maxLength={64}
          pattern="[a-z][a-z0-9_]{0,63}"
          autoComplete="off"
          spellCheck={false}
        />
      </label>
      <button type="submit" className="btn primary" disabled={pending}>
        Add customer
      </button>
      <p role="status">{state.message}</p>
    </form>
  );
}
