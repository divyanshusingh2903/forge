# Session browser terminology

English source copy is defined in `en.ts` (app) and `packages/ui/src/i18n/en.ts` (`ui.tool.browser.*`). The shared dictionary in `browser.ts` supplies the app keys to every locale; the four timeline keys (`ui.tool.browser.navigate`, `.read`, `.source.live`, `.source.fetched`) are written directly into each UI locale file.

**Status: draft, not corpus-verified.** These translations were written from model knowledge, not checked against the references the project requires (Unicode CLDR, Microsoft and Mozilla style guides and terminology, Firefox localization corpus, language authorities). They need a native-language review before release.

Choices to check during review:

- "Browser" follows the word the existing locale already uses for web browsers where one was apparent; several locales keep the English loanword (`it`, `nl`, `de`, `id`, `bs` use Browser/preglednik variants; `lo` and `my` mix in Latin "browser").
- "AI" is written with the locale's established form (`IA`, `KI`, `ИИ`, `ШІ`, `ВИ`, `DI`, `MI`, `UI` in `sl`) or kept as `AI` where unsure.
- "session" reuses each locale's existing term for session (for example `is` "seta", `no` "økt", `cs` "relace"), taken from `command.session.new`.
- Register follows each locale's existing UI (formal in `de`, `fr`; informal in `es`, `nl`).
- "live" / "fetched" are the timeline tag for a page read from the open panel versus fetched by the server.

Least certain (little reference material available): `am`, `dv`, `dz`, `fo`, `km`, `lo`, `my`, `pa`, `si`, `tg`, `tk`, `mn`, `ne`, `uz`.
