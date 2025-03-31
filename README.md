# GrasshopperExampleModels
Example Grasshopper models used throughout our documentation. 

Please find a searchable overview of all example models [here](https://shapediver.github.io/GrasshopperExampleModels/). 

You can clone this repository to download all models at once. 

## How to add or update example models

### Overview

This repository uses [mdBook](https://rust-lang.github.io/mdBook/) to auto-generate documentation based on [Markdown](https://rust-lang.github.io/mdBook/format/markdown.html). A [GitHub action](.github/workflows/static.yml) is used to deploy to [GitHub pages](https://shapediver.github.io/GrasshopperExampleModels/). 

### Guidelines

  * Use the `ghx` XML file format of Grasshopper.

### Local testing

Take the following setup steps to locally test auto-generation of the documentation. 

  * Install [rust](https://www.rust-lang.org/tools/install)
  * Install [mdBook](https://rust-lang.github.io/mdBook/guide/installation.html)
    `cargo install mdbook`
  * Install [mdbook-external-links](https://crates.io/crates/mdbook-external-links)
    `cargo install mdbook-external-links`
  * From the root directory of this repository run `mdbook serve .`

