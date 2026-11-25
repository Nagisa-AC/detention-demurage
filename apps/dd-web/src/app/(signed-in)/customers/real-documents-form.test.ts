import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RealDocumentsForm } from "./real-documents-form";
import { SettingsView } from "./settings-view";
import type { SettingsCards } from "../../../settings-cards";

describe("real documents confirmation", () => {
  it("asks before turning real documents on or off", () => {
    const off = renderToStaticMarkup(createElement(RealDocumentsForm, { customerId: "cust", accepts: false }));
    expect(off).toContain("Accept real customer PDFs. They will be stored and read.");
    expect(off).toContain("Turn on real documents");
    expect(off).toContain('type="checkbox"');

    const on = renderToStaticMarkup(createElement(RealDocumentsForm, { customerId: "cust", accepts: true }));
    expect(on).toContain("Stop accepting real PDFs. New files that are not synthetic samples will be refused.");
    expect(on).toContain("Turn off real documents");

    const page = renderToStaticMarkup(createElement(SettingsView, { cards: cards(false) }));
    expect(page).toContain("Real documents");
    expect(page).toContain("Off");
    expect(page).toContain("Accept real customer PDFs. They will be stored and read.");
  });
});

function cards(acceptsReal: boolean): SettingsCards {
  return {
    customerId: "1dd5e894-bac7-4ade-8d11-e60da1290c83",
    displayName: "Harbor Home Goods",
    headline: "Version 1",
    engagement: [{ label: "Real documents", value: acceptsReal ? "On" : "Off" }],
    unreadable: null,
    acceptsReal,
    canToggleReal: true,
    carriers: [],
    terms: [],
    history: [],
  };
}
