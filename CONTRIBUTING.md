# Contributing

## Add a sample pack

1. Add a draft to the `drafts` array in `tools/make-packs.js`: `id`, `title`, `summary`, `kind` (`json-transformation`, `parsing` or `validation`), `code`, `reference`, `input`, and a `guard` if some inputs are not meaningful.
2. Run `npm run packs`. It runs your code, records the failure it sees, and seals the pack into `packs/<id>.json`.
3. Run `npm run build` to refresh `site/samples.js`.
4. If the bug can also happen in Python, add a buggy and a fixed Python port under `test/fixtures/` and a line for it in the Python test list in `test/specimen.test.js`.
5. Run `npm test`.

A good specimen is small, deterministic, needs no network, files or clock, and has a one-sentence explanation.

## Write a pack by hand

Copy a file from `packs/`, edit it, then run `node cli/specimen.js seal your-pack.json`. The command refuses to seal a pack whose code already gives the expected answer.

## Content rules

Explain what happens, not who is to blame. Content you add is published under CC BY 4.0 and code under MIT.
