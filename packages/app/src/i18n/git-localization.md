# Git action terminology

English source copy is defined in `en.ts`. The shared Git dictionary supplies the same keys to every supported locale. Technical terms such as Git, upstream, rebase, and stash are retained where established developer usage makes a literal translation misleading. The dictionary converts its `{stash}` template token to the application's `{{stash}}` interpolation syntax.

References consulted:

- Microsoft VS Code Git localization: `microsoft/vscode-loc`, `i18n/vscode-language-pack-*/translations/extensions/vscode.git.i18n.json` (MIT). German examples confirm Branch, Remote, Stash, Zusammenführen, and Stash anwenden/löschen. Brazilian Portuguese confirms Mesclar, Stashes, Aplicar Stash, and Aplicar e Remover Stash. The repository's `br` locale means Brazilian Portuguese, not Breton.
- KDE Kate localization: `KDE/kate`, `po/*/kate.po`; German Git/Stash and change-application terminology was cross-checked against VS Code.
- Microsoft localization style-guide index: https://learn.microsoft.com/en-us/globalization/reference/microsoft-style-guides
- Mozilla localization style guides: https://mozilla-l10n.github.io/styleguides/
- Unicode CLDR: https://cldr.unicode.org/ (locale conventions; these labels introduce no plural rules).
- Duden: https://www.duden.de/rechtschreibung/zusammenfuehren
- External machine translations were used as draft comparisons, then corrected for Git meanings (remote repository, branch, applying changes rather than applying for a job), command names, and placeholders.

Native-language review remains useful, especially for Amharic, Divehi, Dzongkha, Faroese, Khmer, Lao, Sinhala, Tajik, and Turkmen: available terminology corpora were less complete for those languages. These entries are not represented as native-speaker-reviewed translations.
