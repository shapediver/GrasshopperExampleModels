# GrasshopperExampleModels

Example Grasshopper models used throughout our documentation.

Please find a searchable overview of all example models [here](https://shapediver.github.io/GrasshopperExampleModels/).

You can clone this repository to download all models at once.

## How to add or update example models

### Overview

This repository uses [mdBook](https://rust-lang.github.io/mdBook/) to auto-generate documentation based on [Markdown](https://rust-lang.github.io/mdBook/format/markdown.html). A [GitHub action](.github/workflows/static.yml) is used to deploy to [GitHub pages](https://shapediver.github.io/GrasshopperExampleModels/).

The source of truth for example metadata is `src/**/examples.json`. Markdown tables in `src/**/definitions.md` are generated from these JSON files and should not be created or edited manually.

### Repository structure

- `src/` contains the mdBook content, example metadata, and model files.
- `tools/` contains repository tooling. In particular, `tools/docs-cli/` provides the scripts used to validate `examples.json` files and generate markdown tables from them.

### Guidelines

- Use the `ghx` XML file format of Grasshopper.
- Update `examples.json` when changing example metadata.
- Add only additional explanatory text manually to Markdown files.
- Do not manually create or edit generated markdown tables; they are generated via GitHub workflows.

### Commands

- `npm run docs:validate` validates all `src/**/examples.json` files and checks referenced files.
- `npm run docs:create-tables` regenerates markdown tables from `src/**/examples.json`.
- `pnpm run docs:process-models` processes changed Grasshopper models for ShapeDiver deployment.

    Required environment variables:
    - `SHAPEDIVER_PLATFORM_USER_ID` - The ShapeDiver user ID that has to own all example models.
    - `SHAPEDIVER_ACCESS_KEY_ID`
    - `SHAPEDIVER_ACCESS_KEY_SECRET`
    - `DEFAULT_BACKEND_SYSTEM_ALIAS` — backend system alias used when creating a brand-new model without a previous ShapeDiver model

    Optional environment variables:
    - `SHAPEDIVER_PLATFORM_URL` — defaults to `https://app.shapediver.com`
    - `GITHUB_SHA` — defaults to `git rev-parse HEAD`
    - `PROCESS_MODELS_CHAPTER` — limits processing to a single chapter

- `mdbook serve .` starts a local preview server for the documentation.

### Local testing

Take the following setup steps to locally test auto-generation of the documentation.

- Install [rust](https://www.rust-lang.org/tools/install)
- Install [mdBook](https://rust-lang.github.io/mdBook/guide/installation.html)
  `cargo install mdbook`
- Install [mdbook-external-links](https://crates.io/crates/mdbook-external-links)
  `cargo install mdbook-external-links`
- From the root directory of this repository run `mdbook serve .`

In normal workflows, markdown tables are generated through GitHub workflows and should not be created manually.
