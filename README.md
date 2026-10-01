# Specimen to test

A bug report that runs. A specimen pack is one small JSON file that holds the input, the expected behavior, what the reporter actually saw, the environment, and the code that misbehaves. Anyone can open it, reproduce the same failure, shrink the input to its smallest form, and turn it into a regression test.

Live page: https://wenslink-os.github.io/specimen-to-test/ (after GitHub Pages is enabled for this repository)

## What a pack contains

| Field | Meaning |
| --- | --- |
| `input` | The JSON input that triggers the bug |
| `code` | JavaScript defining `function run(input)`, the code that misbehaves |
| `reference` | JavaScript defining `function run(input)`, the correct behavior. It decides what "expected" means for any input, which is what makes shrinking possible |
| `expected` | A fixed expected value, for packs without a reference |
| `actual` | What the reporter saw: `{"output": ...}` or `{"error": {"name": "TypeError"}}` |
| `guard` | Optional `function valid(input)` so shrinking never drifts into nonsense inputs |
| `environment` | The runtime the failure was seen in |
| `packHash` | SHA-256 over the pack contents. Any edit breaks it |

The first release covers three kinds of bug, with one sample each in `packs/`:

- JSON transformation: a tag index that crashes on a tag named `constructor`
- Parsing: a CSV line that splits inside a quoted field
- Validation: an age check that accepts `12abc`

## What you can do with a pack

**Reproduce.** The verdict compares the failure now with the failure the reporter saw: reproduced, a different failure, or not reproduced. Exceptions are matched by error name, so the result does not depend on the exact wording of an engine's message.

**Shrink.** A delta-debugging pass removes list items, object keys, string characters and number magnitude while the same failure remains. It keeps only inputs that pass the pack's guard. The sample inputs shrink from 141 to 36, 32 to 15, and 17 to 14 characters.

**Keep.** Generate a regression test in JavaScript (`node:test`) or Python (`unittest`). It calls your function, found at the module path and name you give, with the failing input and asserts the correct answer.

**Try your fix.** Run your own code against the pack, in the page or from the command line. It passes when it gives the expected answer.

## Command line

Needs Node 20 or newer. No dependencies.

```
node cli/specimen.js run packs/age-trailing-text.json
node cli/specimen.js run packs/age-trailing-text.json --code my-fix.js
node cli/specimen.js shrink packs/csv-quoted-comma.json --out small.json
node cli/specimen.js emit packs/csv-quoted-comma.json --lang py --module app.parser --out test_csv.py
node cli/specimen.js seal my-pack.json
node cli/specimen.js check my-pack.json
```

Exit codes of `run`: `0` the code gives the expected answer, `1` the reported failure is reproduced, `2` it fails differently, `3` the pack is invalid or could not run. This lets CI fail on a pack that still reproduces.

## Run the page locally

```
npm test
npm run serve     # http://localhost:8080
```

## Safety

Pack code is arbitrary code. In the page it runs in a Web Worker that has no access to the page, and the page's content security policy blocks all network requests (checked with a blocked synchronous request from pack code). On the command line it runs in a Node `vm` context with a time limit. `vm` is not a security boundary: open only packs you trust, or run the command line inside a container.

## Limits of this release

- Packs hold JavaScript code. The generated Python test is for Python projects that have the same bug, but a pack itself cannot run Python code.
- Input and output must be JSON values. Functions, dates, `undefined` and `NaN` are not supported.
- Shrinking needs a `reference` implementation.
- The page has been exercised in Chromium only.

## How it stays honest

`npm test` checks, among other things, that every sample reproduces; that each reference passes where the buggy code fails; that shrunk inputs still fail the same way and cannot be shrunk further; that the generated JavaScript test fails on the buggy code and passes on the fix; that the generated Python tests fail on buggy Python ports and pass on fixed ones (the ports are in `test/fixtures`); that awkward titles and data cannot break or inject into generated files; that infinite loops time out; that runs cannot leak state into each other; and that the SHA-256 implementation matches Node's crypto.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Licenses

- Code: MIT, see [LICENSE](LICENSE).
- Explanations and written content: CC BY 4.0, see [LICENSE-CONTENT.md](LICENSE-CONTENT.md).
