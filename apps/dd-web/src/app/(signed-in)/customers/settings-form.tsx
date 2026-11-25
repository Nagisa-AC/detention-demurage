"use client";

import { useActionState, useId, useState, type ReactNode } from "react";
import type { CustomerConfig } from "dd-core";
import type { SettingsProblem } from "../../../settings";
import {
  addCarrier,
  addRate,
  addTerm,
  blankDraft,
  draftFromConfig,
  removeCarrier,
  removeRate,
  removeTerm,
  settingsYaml,
  type CarrierStance,
  type SettingsDraft,
} from "../../../settings-draft";
import { saveSettings, type SettingsFormState } from "./save-settings";

const initial: SettingsFormState = { message: "", problems: [] };

export function SettingsForm({
  customerId,
  configId,
  displayName,
  config,
}: {
  customerId: string;
  configId: string;
  displayName: string;
  config: CustomerConfig | null;
}) {
  const [draft, setDraft] = useState<SettingsDraft>(() =>
    config === null ? blankDraft({ configId, name: displayName }) : draftFromConfig(config),
  );
  const [yaml, setYaml] = useState(false);
  const [state, action, pending] = useActionState(saveSettings, initial);
  const base = useId();
  const saved = state.message.startsWith("Settings saved");
  const problems = state.problems;
  const shown = new Set<string>();

  function take(path: string): string {
    const problem = problems.find((item) => item.path === path);
    if (problem === undefined) return "";
    shown.add(path);
    return problem.message;
  }

  return (
    <form className="settings-form" action={action}>
      <input type="hidden" name="customerId" value={customerId} />
      <input type="hidden" name="draft" value={JSON.stringify(draft)} />
      <div className="settings-toolbar">
        <button
          type="button"
          className="btn"
          aria-pressed={yaml}
          onClick={() => setYaml((open) => !open)}
        >
          {yaml ? "Back to the form" : "View as YAML"}
        </button>
        <p className="help">Saving stores a new version and keeps the current one.</p>
      </div>
      {yaml ? (
        <div className="fld">
          <label htmlFor={`${base}-yaml`}>YAML</label>
          <textarea id={`${base}-yaml`} readOnly spellCheck={false} value={settingsYaml(draft)} />
          <p className="help">Reference only. Edit the form, then save.</p>
        </div>
      ) : (
        <>
          <section className="settings-section" aria-labelledby={`${base}-engagement`}>
            <h3 id={`${base}-engagement`}>Engagement</h3>
            <Field id={`${base}-id`} label="Customer ID" help="Permanent. Settings always use this id.">
              <input id={`${base}-id`} className="mono" value={draft.configId} readOnly />
            </Field>
            <div className="field-row">
              <Field id={`${base}-name`} label="Name" error={take("name")}>
                <input
                  id={`${base}-name`}
                  value={draft.name}
                  aria-invalid={take("name") !== ""}
                  autoComplete="off"
                  onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                />
              </Field>
              <Field
                id={`${base}-fee`}
                label="Fee %"
                error={take("fee_pct")}
                help="0 to 100. 25 is stored as 0.25."
              >
                <input
                  id={`${base}-fee`}
                  type="number"
                  min={0}
                  max={100}
                  step="any"
                  inputMode="decimal"
                  value={draft.feePercent}
                  aria-invalid={problems.some((problem) => problem.path === "fee_pct")}
                  onChange={(event) => setDraft({ ...draft, feePercent: event.target.value })}
                />
              </Field>
            </div>
            <div className="field-row">
              <Field id={`${base}-billed`} label="Billed as" error={take("billed_party_role")}>
                <select
                  id={`${base}-billed`}
                  value={draft.billedAs}
                  aria-invalid={take("billed_party_role") !== ""}
                  onChange={(event) => setDraft({ ...draft, billedAs: event.target.value })}
                >
                  <option value="direct">Direct</option>
                  <option value="nvocc_passthrough">Through a forwarder</option>
                </select>
              </Field>
              {draft.billedAs === "nvocc_passthrough" ? (
                <Field id={`${base}-forwarder`} label="Forwarder name" error={take("nvocc")}>
                  <input
                    id={`${base}-forwarder`}
                    value={draft.forwarder}
                    aria-invalid={take("nvocc") !== ""}
                    autoComplete="off"
                    onChange={(event) => setDraft({ ...draft, forwarder: event.target.value })}
                  />
                </Field>
              ) : null}
            </div>
            <h3>Authorization</h3>
            <Field id={`${base}-document`} label="Document name" error={take("authorization.document")}>
              <input
                id={`${base}-document`}
                value={draft.document}
                aria-invalid={take("authorization.document") !== ""}
                autoComplete="off"
                onChange={(event) => setDraft({ ...draft, document: event.target.value })}
              />
            </Field>
            <div className="field-row">
              <Field id={`${base}-signed`} label="Signed on" error={take("authorization.signed_on")}>
                <input
                  id={`${base}-signed`}
                  type="date"
                  value={draft.signedOn}
                  aria-invalid={take("authorization.signed_on") !== ""}
                  onChange={(event) => setDraft({ ...draft, signedOn: event.target.value })}
                />
              </Field>
              <Field id={`${base}-until`} label="Valid until" error={take("authorization.valid_until")}>
                <input
                  id={`${base}-until`}
                  type="date"
                  value={draft.validUntil}
                  aria-invalid={take("authorization.valid_until") !== ""}
                  onChange={(event) => setDraft({ ...draft, validUntil: event.target.value })}
                />
              </Field>
            </div>
            <p className="help">Carriers covered are the list in Carriers.</p>
            <div className="field-row">
              <Field id={`${base}-lookback`} label="Lookback date" error={take("lookback_from")}>
                <input
                  id={`${base}-lookback`}
                  type="date"
                  value={draft.lookbackFrom}
                  aria-invalid={take("lookback_from") !== ""}
                  onChange={(event) => setDraft({ ...draft, lookbackFrom: event.target.value })}
                />
              </Field>
              <Field
                id={`${base}-retention`}
                label="Retention days"
                error={take("retention_days_after_close")}
                help="Days documents are kept after the case closes."
              >
                <input
                  id={`${base}-retention`}
                  type="number"
                  min={1}
                  step={1}
                  value={draft.retentionDays}
                  aria-invalid={take("retention_days_after_close") !== ""}
                  onChange={(event) => setDraft({ ...draft, retentionDays: event.target.value })}
                />
              </Field>
            </div>
            <Field
              id={`${base}-real`}
              label="Accepts real documents"
              help="Read only. Use the Real documents section to change this."
            >
              <input id={`${base}-real`} value={draft.acceptsRealDocuments ? "On" : "Off"} readOnly />
            </Field>
          </section>
          <section className="settings-section" aria-labelledby={`${base}-carriers`}>
            <div className="repeat-head">
              <h3 id={`${base}-carriers`}>Carriers</h3>
              <button type="button" className="btn" onClick={() => setDraft(addCarrier(draft))}>
                Add carrier
              </button>
            </div>
            <SectionErrors
              problems={problems}
              paths={["authorization.covers", "billing_parties.pursue", "billing_parties.do_not_pursue"]}
              shown={shown}
            />
            {draft.carriers.length === 0 ? <p className="help">No carriers yet.</p> : null}
            {draft.carriers.map((carrier, index) => (
              <div className="repeat" key={`carrier-${index}`}>
                <div className="field-row">
                  <Field
                    id={`${base}-carrier-${index}`}
                    label="Carrier"
                    error={take(`authorization.covers.${index}`)}
                  >
                    <input
                      id={`${base}-carrier-${index}`}
                      className="mono"
                      value={carrier.id}
                      spellCheck={false}
                      autoComplete="off"
                      aria-invalid={take(`authorization.covers.${index}`) !== ""}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          carriers: draft.carriers.map((row, at) =>
                            at === index ? { ...row, id: event.target.value } : row,
                          ),
                        })
                      }
                    />
                  </Field>
                  <Field id={`${base}-stance-${index}`} label="Mark">
                    <select
                      id={`${base}-stance-${index}`}
                      value={carrier.stance}
                      onChange={(event) =>
                        setDraft({
                          ...draft,
                          carriers: draft.carriers.map((row, at) =>
                            at === index ? { ...row, stance: event.target.value as CarrierStance } : row,
                          ),
                        })
                      }
                    >
                      <option value="pursue">Pursue</option>
                      <option value="skip">Do not pursue</option>
                      <option value="covered">Covered only</option>
                    </select>
                  </Field>
                </div>
                <button type="button" className="btn" onClick={() => setDraft(removeCarrier(draft, index))}>
                  Remove carrier
                </button>
              </div>
            ))}
          </section>
          <section className="settings-section" aria-labelledby={`${base}-terms`}>
            <div className="repeat-head">
              <h3 id={`${base}-terms`}>Contract terms</h3>
              <button type="button" className="btn" onClick={() => setDraft(addTerm(draft))}>
                Add contract term
              </button>
            </div>
            <SectionErrors problems={problems} paths={["contract_terms", "store_contract_terms"]} shown={shown} />
            {draft.terms.length === 0 ? <p className="help">No contract terms.</p> : null}
            {draft.terms.map((term, termIndex) => (
              <div className="repeat" key={`term-${termIndex}`}>
                <div className="repeat-head">
                  <h3>{term.billingParty === "" ? `Term ${termIndex + 1}` : term.billingParty}</h3>
                  <button type="button" className="btn" onClick={() => setDraft(removeTerm(draft, termIndex))}>
                    Remove term
                  </button>
                </div>
                <div className="field-row">
                  <Field
                    id={`${base}-party-${termIndex}`}
                    label="Carrier"
                    error={take(`contract_terms.${termIndex}.billing_party`)}
                  >
                    <input
                      id={`${base}-party-${termIndex}`}
                      className="mono"
                      value={term.billingParty}
                      spellCheck={false}
                      autoComplete="off"
                      aria-invalid={take(`contract_terms.${termIndex}.billing_party`) !== ""}
                      onChange={(event) => setDraft(updateTerm(draft, termIndex, { billingParty: event.target.value }))}
                    />
                  </Field>
                  <Field
                    id={`${base}-contract-${termIndex}`}
                    label="Contract number"
                    error={take(`contract_terms.${termIndex}.service_contract`)}
                  >
                    <input
                      id={`${base}-contract-${termIndex}`}
                      className="mono"
                      value={term.serviceContract}
                      spellCheck={false}
                      autoComplete="off"
                      aria-invalid={take(`contract_terms.${termIndex}.service_contract`) !== ""}
                      onChange={(event) =>
                        setDraft(updateTerm(draft, termIndex, { serviceContract: event.target.value }))
                      }
                    />
                  </Field>
                </div>
                <div className="field-row">
                  <Field
                    id={`${base}-from-${termIndex}`}
                    label="Valid from"
                    error={take(`contract_terms.${termIndex}.valid_from`)}
                  >
                    <input
                      id={`${base}-from-${termIndex}`}
                      type="date"
                      value={term.validFrom}
                      aria-invalid={take(`contract_terms.${termIndex}.valid_from`) !== ""}
                      onChange={(event) => setDraft(updateTerm(draft, termIndex, { validFrom: event.target.value }))}
                    />
                  </Field>
                  <Field
                    id={`${base}-to-${termIndex}`}
                    label="Valid to"
                    error={take(`contract_terms.${termIndex}.valid_to`)}
                  >
                    <input
                      id={`${base}-to-${termIndex}`}
                      type="date"
                      value={term.validTo}
                      aria-invalid={take(`contract_terms.${termIndex}.valid_to`) !== ""}
                      onChange={(event) => setDraft(updateTerm(draft, termIndex, { validTo: event.target.value }))}
                    />
                  </Field>
                </div>
                <div className="field-row">
                  <Field
                    id={`${base}-demurrage-days-${termIndex}`}
                    label="Demurrage free days"
                    error={take(`contract_terms.${termIndex}.demurrage.free_days`)}
                  >
                    <input
                      id={`${base}-demurrage-days-${termIndex}`}
                      type="number"
                      step={1}
                      value={term.demurrageDays}
                      aria-invalid={take(`contract_terms.${termIndex}.demurrage.free_days`) !== ""}
                      onChange={(event) =>
                        setDraft(updateTerm(draft, termIndex, { demurrageDays: event.target.value }))
                      }
                    />
                  </Field>
                  <Field
                    id={`${base}-demurrage-basis-${termIndex}`}
                    label="Demurrage day basis"
                    error={take(`contract_terms.${termIndex}.demurrage.day_basis`)}
                  >
                    <BasisSelect
                      id={`${base}-demurrage-basis-${termIndex}`}
                      value={term.demurrageBasis}
                      invalid={take(`contract_terms.${termIndex}.demurrage.day_basis`) !== ""}
                      onChange={(value) => setDraft(updateTerm(draft, termIndex, { demurrageBasis: value }))}
                    />
                  </Field>
                </div>
                <div className="field-row">
                  <Field
                    id={`${base}-detention-days-${termIndex}`}
                    label="Detention free days"
                    error={take(`contract_terms.${termIndex}.detention.free_days`)}
                  >
                    <input
                      id={`${base}-detention-days-${termIndex}`}
                      type="number"
                      step={1}
                      value={term.detentionDays}
                      aria-invalid={take(`contract_terms.${termIndex}.detention.free_days`) !== ""}
                      onChange={(event) =>
                        setDraft(updateTerm(draft, termIndex, { detentionDays: event.target.value }))
                      }
                    />
                  </Field>
                  <Field
                    id={`${base}-detention-basis-${termIndex}`}
                    label="Detention day basis"
                    error={take(`contract_terms.${termIndex}.detention.day_basis`)}
                  >
                    <BasisSelect
                      id={`${base}-detention-basis-${termIndex}`}
                      value={term.detentionBasis}
                      invalid={take(`contract_terms.${termIndex}.detention.day_basis`) !== ""}
                      onChange={(value) => setDraft(updateTerm(draft, termIndex, { detentionBasis: value }))}
                    />
                  </Field>
                </div>
                <div className="repeat-head">
                  <h3>Rate tiers</h3>
                  <button type="button" className="btn" onClick={() => setDraft(addRate(draft, termIndex))}>
                    Add rate tier
                  </button>
                </div>
                {term.rates.map((rate, rateIndex) => {
                  const prefix = `contract_terms.${termIndex}.rates.${rateIndex}`;
                  return (
                    <div className="repeat" key={`rate-${termIndex}-${rateIndex}`}>
                      <div className="field-row">
                        <Field id={`${base}-charge-${termIndex}-${rateIndex}`} label="Charge" error={take(`${prefix}.charge`)}>
                          <select
                            id={`${base}-charge-${termIndex}-${rateIndex}`}
                            value={rate.charge}
                            aria-invalid={take(`${prefix}.charge`) !== ""}
                            onChange={(event) =>
                              setDraft(updateRate(draft, termIndex, rateIndex, { charge: event.target.value }))
                            }
                          >
                            <option value="demurrage">Demurrage</option>
                            <option value="detention">Detention</option>
                          </select>
                        </Field>
                        <Field id={`${base}-currency-${termIndex}-${rateIndex}`} label="Currency" error={take(`${prefix}.currency`)}>
                          <input
                            id={`${base}-currency-${termIndex}-${rateIndex}`}
                            className="mono"
                            value={rate.currency}
                            spellCheck={false}
                            autoComplete="off"
                            aria-invalid={take(`${prefix}.currency`) !== ""}
                            onChange={(event) =>
                              setDraft(updateRate(draft, termIndex, rateIndex, { currency: event.target.value }))
                            }
                          />
                        </Field>
                      </div>
                      <div className="field-row">
                        <Field id={`${base}-from-day-${termIndex}-${rateIndex}`} label="From day" error={take(`${prefix}.from_day`)}>
                          <input
                            id={`${base}-from-day-${termIndex}-${rateIndex}`}
                            type="number"
                            min={1}
                            step={1}
                            value={rate.fromDay}
                            aria-invalid={take(`${prefix}.from_day`) !== ""}
                            onChange={(event) =>
                              setDraft(updateRate(draft, termIndex, rateIndex, { fromDay: event.target.value }))
                            }
                          />
                        </Field>
                        <Field
                          id={`${base}-to-day-${termIndex}-${rateIndex}`}
                          label="To day"
                          error={take(`${prefix}.to_day`) || take(prefix)}
                          help="Leave blank for an open-ended tier."
                        >
                          <input
                            id={`${base}-to-day-${termIndex}-${rateIndex}`}
                            type="number"
                            min={1}
                            step={1}
                            value={rate.toDay}
                            aria-invalid={take(`${prefix}.to_day`) !== "" || take(prefix) !== ""}
                            onChange={(event) =>
                              setDraft(updateRate(draft, termIndex, rateIndex, { toDay: event.target.value }))
                            }
                          />
                        </Field>
                      </div>
                      <Field id={`${base}-rate-${termIndex}-${rateIndex}`} label="Rate" error={take(`${prefix}.per_day`)} help="Two decimals, such as 150.00.">
                        <input
                          id={`${base}-rate-${termIndex}-${rateIndex}`}
                          className="mono"
                          value={rate.perDay}
                          inputMode="decimal"
                          spellCheck={false}
                          autoComplete="off"
                          aria-invalid={take(`${prefix}.per_day`) !== ""}
                          onChange={(event) =>
                            setDraft(updateRate(draft, termIndex, rateIndex, { perDay: event.target.value }))
                          }
                        />
                      </Field>
                      <button type="button" className="btn" onClick={() => setDraft(removeRate(draft, termIndex, rateIndex))}>
                        Remove rate tier
                      </button>
                    </div>
                  );
                })}
              </div>
            ))}
          </section>
        </>
      )}
      {saved ? <p className="ok">{state.message}</p> : null}
      {!saved && state.message !== "" ? <p className="err">{state.message}</p> : null}
      <Unmapped problems={problems} shown={shown} />
      <button type="submit" className="btn primary" disabled={pending}>
        Save settings
      </button>
    </form>
  );
}

function updateTerm(draft: SettingsDraft, index: number, patch: Partial<SettingsDraft["terms"][number]>): SettingsDraft {
  return {
    ...draft,
    terms: draft.terms.map((term, at) => (at === index ? { ...term, ...patch } : term)),
  };
}

function updateRate(
  draft: SettingsDraft,
  termIndex: number,
  rateIndex: number,
  patch: Partial<SettingsDraft["terms"][number]["rates"][number]>,
): SettingsDraft {
  return {
    ...draft,
    terms: draft.terms.map((term, at) =>
      at === termIndex
        ? { ...term, rates: term.rates.map((rate, index) => (index === rateIndex ? { ...rate, ...patch } : rate)) }
        : term,
    ),
  };
}

function Field({
  id,
  label,
  error = "",
  help,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  help?: string;
  children: ReactNode;
}) {
  return (
    <div className="fld">
      <label htmlFor={id}>{label}</label>
      {children}
      {error !== "" ? <p className="err">{error}</p> : null}
      {error === "" && help !== undefined ? <p className="help">{help}</p> : null}
    </div>
  );
}

function BasisSelect({
  id,
  value,
  invalid,
  onChange,
}: {
  id: string;
  value: string;
  invalid: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <select id={id} value={value} aria-invalid={invalid} onChange={(event) => onChange(event.target.value)}>
      <option value="calendar">Calendar days</option>
      <option value="business">Business days</option>
    </select>
  );
}

function SectionErrors({
  problems,
  paths,
  shown,
}: {
  problems: SettingsProblem[];
  paths: string[];
  shown: Set<string>;
}) {
  const matched = problems.filter((problem) => paths.includes(problem.path));
  for (const problem of matched) shown.add(problem.path);
  if (matched.length === 0) return null;
  return (
    <ul className="problems">
      {matched.map((problem, index) => (
        <li key={`${problem.path}:${index}`}>{problem.message}</li>
      ))}
    </ul>
  );
}

function Unmapped({ problems, shown }: { problems: SettingsProblem[]; shown: Set<string> }) {
  const rest = problems.filter((problem) => !shown.has(problem.path));
  if (rest.length === 0) return null;
  return (
    <ul className="problems">
      {rest.map((problem, index) => (
        <li key={`${problem.path}:${index}`}>
          <span>{problem.path}</span>: {problem.message}
        </li>
      ))}
    </ul>
  );
}
