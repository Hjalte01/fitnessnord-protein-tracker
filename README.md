# FitnessNord Protein Tracker

Firefox extension for FitnessNord's offer page that estimates protein grams per DKK and helps rank products by value.

It runs on:

```text
https://www.fitnessnord.com/tilbud*
```

## Features

- Adds a protein-value badge beside product prices, for example `(2,58 p/DKK)`.
- Fetches each linked product page and reads the nutrition table when available.
- Scales table values correctly for packages like `1 x 60 g`, `12 x 35 g`, `3 x 330 g`, and `2 kg`.
- Falls back to explicit product text like `25 g protein` or `35% protein` when table data is missing.
- Shows `protein ukendt` when the product page does not expose parseable protein data.
- Provides a sticky `Protein` menu for ranking and filtering.

## Protein Menu

The `Protein` menu includes:

- `Beregn alle`: scrolls through the full lazy-loaded offer listing, loads all product cards, calculates them, then scrolls back to the top.
- `Gå til bedst`: jumps to the best available protein-per-DKK product.
- `Min. p/DKK`: filters the ranked list by a minimum protein-per-DKK threshold.
- `Skjul under grænse og ukendt`: hides page cards below the threshold and cards with unknown protein.
- `Skjul udsolgt`: hides sold-out products from the ranking/page view by default.
- `Sorter siden efter p/DKK`: sorts the loaded product grid globally by best protein value first while keeping the Bootstrap card layout.

## How It Works

The listing page has product URLs and prices, but most protein data lives on each product page. The content script:

1. Reads each offer card's product URL and current price.
2. Fetches the product page.
3. Parses package size from product title/card/page text.
4. Reads the `Protein` row from nutrition tables.
5. Converts `per 100 g`, `per serving`, or `per product` values into total package protein.
6. Falls back to scoped explicit product text when nutrition tables are missing.
7. Computes `total protein grams / DKK`.

Results are cached in `sessionStorage` for one hour per product URL.

## Install Locally

Open Firefox and go to:

```text
about:debugging#/runtime/this-firefox
```

Then:

1. Click **Load Temporary Add-on**.
2. Select `manifest.json` from this repository.
3. Open `https://www.fitnessnord.com/tilbud`.

Temporary add-ons are removed when Firefox restarts.

## Development

Enter the Nix dev shell:

```sh
nix develop
```

Run the extension in Firefox:

```sh
web-ext run --firefox=firefox --source-dir=.
```

Lint:

```sh
web-ext lint --source-dir=.
```

Build:

```sh
web-ext build --source-dir=. --overwrite-dest
```

The built zip is written to:

```text
web-ext-artifacts/fitnessnord_protein_tracker-0.1.0.zip
```

## Regression Test

There is a live regression test for known tricky FitnessNord products:

```sh
node --test --test-reporter=spec tests/live-regression.mjs
```

This test fetches live FitnessNord pages, so results can change when the sale ends, prices change, products disappear, or FitnessNord changes markup. It is mainly a guard for parser changes during active development.

## Privacy

The extension only runs on FitnessNord offer pages and fetches FitnessNord product pages to calculate protein value. It does not collect, transmit, or store personal data outside the browser.
