import { test } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Assistant } from "../components/assistant/Assistant";
import { demoClinic } from "../lib/demo/data";
import { getLocale } from "../locales";
test("initial Turkish and Russian UI render complete locale-specific text and examples", () => {
  for (const language of ["tr", "ru"] as const) {
    const html = renderToStaticMarkup(
      createElement(Assistant, {
        clinic: demoClinic,
        preview: true,
        initialLanguage: language,
      }),
    );
    const t = getLocale(language).messages;
    for (const expected of [
      t.greeting,
      t.heroTitle,
      t.textPlaceholder,
      t.demoClinic,
      t.mockNotice,
      t.statuses.ready,
      ...t.examples,
    ])
      assert.ok(html.includes(expected), expected);
    const other = language === "tr" ? "ru" : "tr";
    assert.equal(html.includes(getLocale(other).messages.heroTitle), false);
    assert.match(html, /aria-pressed="true"/);
    assert.match(html, /language-switch/);
  }
});
