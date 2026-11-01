# Session browser terminology

English source copy is defined in `en.ts` (app) and `packages/ui/src/i18n/en.ts` (`ui.tool.browser.*`). The shared dictionary in `browser.ts` supplies the app keys to every locale; the five timeline keys (`ui.tool.browser.navigate`, `.read`, `.act`, `.source.live`, `.source.fetched`) are written directly into each UI locale file.

**Status: draft, not corpus-verified.** These translations were written from model knowledge, not checked against the references the project requires (Unicode CLDR, Microsoft and Mozilla style guides and terminology, Firefox localization corpus, language authorities). They need a native-language review before release.

Choices to check during review:

- "Browser" follows the word the existing locale already uses for web browsers where one was apparent; several locales keep the English loanword (`it`, `nl`, `de`, `id`, `bs` use Browser/preglednik variants; `lo` and `my` mix in Latin "browser").
- "AI" is written with the locale's established form (`IA`, `KI`, `ИИ`, `ШІ`, `ВИ`, `DI`, `MI`, `UI` in `sl`) or kept as `AI` where unsure.
- "session" reuses each locale's existing term for session (for example `is` "seta", `no` "økt", `cs` "relace"), taken from `command.session.new`.
- Register follows each locale's existing UI (formal in `de`, `fr`; informal in `es`, `nl`).
- "live" / "fetched" are the timeline tag for a page read from the open panel versus fetched by the server.

Least certain (little reference material available): `am`, `dv`, `dz`, `fo`, `km`, `lo`, `my`, `pa`, `si`, `tg`, `tk`, `mn`, `ne`, `uz`.

## Action and tag keys (issue #12)

The timeline rows for `browser_act`, `browser_read` and `browser_screenshot` add these keys, written into every UI locale file after `ui.tool.browser.source.fetched`:

- `ui.tool.browser.act.{click,hover,type,fill,select,press,scroll}`: the verb shown before the element, e.g. `Fill textbox "Customer name:"`. Each is a standalone word, so no sentence is built from fragments.
- `ui.tool.browser.act.direction.{up,down,left,right}`: the scroll direction chip.
- `ui.tool.browser.format.{text,html,interactive}`: the read format tag. Markdown, the default, has no tag.
- `ui.tool.browser.read.elements.{one,other}` plus any extra categories the language uses (`zero`, `two`, `few`, `many`): the element count on an interactive read (`live · interactive · 9 elements`). `i18n/parity.test.ts` requires every locale to carry exactly the categories `Intl.PluralRules` reports for it. Languages with no singular category (`id`, `ja`, `ko`, `ms`, `th`, `vi`, `zh`, `zht`) reuse the `.other` text for `.one`, and the extra categories reuse `.other` too.
- `ui.tool.browser.screenshot.fullPage`: the tag on a full-page screenshot.

`packages/ui/src/i18n/browser-keys.test.ts` checks that every locale has each of these keys.

Placeholders: `am`, `br`, `dv`, `dz`, `fo`, `hy`, `ka`, `km`, `lo`, `mn`, `my`, `ne`, `pa`, `si`, `tg`, `tk`, `uz` hold the English text for these keys. There was too little reference material to draft them, so a native speaker needs to supply them. Until then the rows show English words in those locales.

Choices to check during review of the other locales:

- Verb form: infinitive in `de`, `fr`, `es`, `it`, `nl` and similar; imperative in `da`, `no`, `pl`, `cs`, `sk`, `bs`, `hr`, `sr` and similar. Match the form each locale already uses for UI buttons.
- "HTML" stays in Latin letters in every locale.
- Plural: where the plural noun would need to agree with the number in `cs`, `sk`, `sl`, `pl`, `ru`, `uk`, `lt`, `lv`, `bs`, `hr`, `sr` and `ar`, the `.other` form is written as `Label: {{count}}` so it is correct for every count. Only `.one` is a full noun phrase.
- "hover" (`ui.tool.browser.act.hover`) is the least settled term; locales differ between "point at" and "move the cursor over".
