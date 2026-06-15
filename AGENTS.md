# AGENTS.md

## Repository purpose

This repository contains example Grasshopper models and their documentation for ShapeDiver. Documentation is built with mdBook from the `src/` directory.

## Important paths

- `src/**/examples.json` — source of truth for example metadata
- `src/**/definitions.md` — chapter documentation with human-written prose and generated tables
- `tools/docs-cli/src/utils.ts` — defines `SCHEMA_EXAMPLES`
- `tools/docs-cli/src/validate.ts` — validation logic
- `tools/docs-cli/src/createTables.ts` — markdown table generation
- `book.toml` — mdBook configuration

## Source of truth

Treat these as the canonical sources:

- `src/**/examples.json`
- human-written prose in `src/**/definitions.md`
- existing model files provided by humans

Treat generated markdown tables in `src/**/definitions.md` as derived output.

## Hard rules

- Never manually edit generated markdown tables in `src/**/definitions.md`.
- If table content must change, update `src/**/examples.json` instead.
- Never create, modify, or rewrite `.ghx`, `.gh`, or `.3dm` files.
- Do not rename, move, or delete large groups of examples or docs unless the user explicitly asks.
- Avoid broad structural reorganizations of chapter folders or documentation layout unless explicitly asked.

## Editing guidance

- You may add or edit explanatory prose in `src/**/definitions.md`.
- Preserve mdBook structure and existing chapter organization unless the user asks for restructuring.
- AI may help develop repository code, including the docs CLI and related automation.

## Adding or updating examples

Preferred workflow:

1. Use the existing human-provided model artifact in the appropriate chapter folder.
2. Add or update the matching entry in that chapter's `src/**/examples.json`.
3. Add explanatory prose to `definitions.md` only when needed.
4. Do not manually regenerate or rewrite markdown tables unless the user explicitly asks for that local workflow.

## Naming convention

Example files follow this pattern:

`{chapter number}{alphabetical identifier starting from A}-{description}.{extension}`

Example:

`11A-AppBuilder_Tutorial1.ghx`

## Validation

After changing any `src/**/examples.json`, run:

```bash
npm run docs:validate
```

This validation is required, but it does not check everything. If your change affects behavior or content not fully covered by the validation script, explicitly warn the user about the remaining unchecked risk.

## Useful commands

```bash
npm run docs:validate
mdbook serve .
```

Use `npm run docs:validate` for metadata validation and `mdbook serve .` for local documentation preview.
