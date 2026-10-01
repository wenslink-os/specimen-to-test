'use strict';
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const S = require('../site/specimen-core.js');
const { nodeRunner } = require('../cli/node-runner.js');
const cli = require('../cli/specimen.js');

const ROOT = path.join(__dirname, '..');
const runner = nodeRunner(1000);
const packFiles = fs.readdirSync(path.join(ROOT, 'packs')).filter((f) => f.endsWith('.json'));
const packs = Object.fromEntries(packFiles.map((f) => [f.replace(/\.json$/, ''), JSON.parse(fs.readFileSync(path.join(ROOT, 'packs', f), 'utf8'))]));
const tmp = (name) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'specimen-' + name + '-')); return d; };
const cleanEnv = () => { const e = { ...process.env }; delete e.NODE_TEST_CONTEXT; return e; };
const captureLog = () => { const lines = []; return { lines, fn: (s) => lines.push(s) }; };

test('sha256 matches node crypto, including block boundaries and unicode', () => {
  for (const s of ['', 'abc', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(64), 'a'.repeat(1000), 'नमস্তে 😀 é']) {
    assert.strictEqual(S.sha256Hex(s), crypto.createHash('sha256').update(s, 'utf8').digest('hex'));
  }
});

test('canonical JSON ignores key order but not array order', () => {
  assert.strictEqual(S.canonicalJson({ b: 1, a: [1, 2] }), S.canonicalJson({ a: [1, 2], b: 1 }));
  assert.notStrictEqual(S.canonicalJson([1, 2]), S.canonicalJson([2, 1]));
});

test('there are three sample packs: parsing, validation and JSON transformation', () => {
  assert.deepStrictEqual(Object.keys(packs).sort(), ['age-trailing-text', 'csv-quoted-comma', 'tag-index-constructor']);
  assert.deepStrictEqual(Object.values(packs).map((p) => p.kind).sort(), ['json-transformation', 'parsing', 'validation']);
});

test('pack validation accepts the samples and rejects broken packs', () => {
  for (const p of Object.values(packs)) assert.deepStrictEqual(S.validatePack(p), []);
  const base = packs['age-trailing-text'];
  const bad = (mut) => { const p = JSON.parse(JSON.stringify(base)); mut(p); return S.validatePack(p); };
  assert.ok(bad((p) => { p.format = 2; }).length);
  assert.ok(bad((p) => { p.id = 'Bad Id'; }).length);
  assert.ok(bad((p) => { delete p.code; }).length);
  assert.ok(bad((p) => { p.code = 'var x = 1;'; }).length);
  assert.ok(bad((p) => { delete p.input; }).length);
  assert.ok(bad((p) => { delete p.reference; }).length, 'needs expected or reference');
  assert.ok(bad((p) => { p.actual = { nonsense: 1 }; }).length);
  assert.deepStrictEqual(S.validatePack(null), ['The pack must be a JSON object.']);
});

test('seal detects any edit to a pack', () => {
  for (const p of Object.values(packs)) assert.strictEqual(S.verifySeal(p), true);
  const edited = JSON.parse(JSON.stringify(packs['csv-quoted-comma']));
  edited.input.line = 'x';
  assert.strictEqual(S.verifySeal(edited), false);
  const reordered = JSON.parse(JSON.stringify(packs['csv-quoted-comma']));
  const { packHash, ...rest } = reordered;
  assert.strictEqual(S.verifySeal({ packHash, ...Object.fromEntries(Object.entries(rest).reverse()) }), true, 'key order does not matter');
});

for (const [id, pack] of Object.entries(packs)) {
  test(id + ': the reported failure reproduces', async () => {
    const r = await S.reproduce(pack, runner);
    assert.strictEqual(r.verdict, 'reproduced');
  });

  test(id + ': the reference gives the expected answer, so the reference is a valid fix', async () => {
    const r = await S.reproduce(pack, runner, { code: pack.reference });
    assert.strictEqual(r.verdict, 'not-reproduced');
  });

  test(id + ': a failure that differs from the report is called out', async () => {
    const altered = JSON.parse(JSON.stringify(pack));
    altered.actual = altered.actual.error ? { output: 'something else' } : { error: { name: 'RangeError' } };
    const r = await S.reproduce(altered, runner);
    assert.strictEqual(r.verdict, 'different-failure');
  });

  test(id + ': shrinking gives a smaller input that still fails the same way and passes the guard', async () => {
    const res = await S.minimize(pack, runner);
    assert.ok(res.finalSize < res.originalSize);
    const shrunk = Object.assign({}, pack, { input: res.input });
    const a = await S.evaluate(pack, runner, {});
    const b = await S.evaluate(shrunk, runner, {});
    assert.ok(S.sameFailure(a, b));
    if (pack.guard) {
      const g = await runner({ code: pack.guard, fn: 'valid', arg: JSON.stringify(res.input) });
      assert.strictEqual(JSON.parse(g.json), true);
    }
    // local minimum: no single-step smaller input still fails
    const again = await S.minimize(shrunk, runner);
    assert.strictEqual(again.steps, 0);
  });

  test(id + ': emitted JavaScript test fails on the buggy code and passes on the reference', async () => {
    const expected = await S.expectedForInput(pack, runner, pack.input);
    const testSrc = S.emitJs(pack, { modulePath: './src.js', functionName: 'run', expected });
    for (const [label, code, want] of [['buggy', pack.code, 1], ['fixed', pack.reference, 0]]) {
      const d = tmp('js-' + label);
      fs.writeFileSync(path.join(d, 'src.js'), code + '\nmodule.exports = { run };\n');
      fs.writeFileSync(path.join(d, 'regression.test.js'), testSrc);
      const r = spawnSync(process.execPath, ['--test', path.join(d, 'regression.test.js')], { encoding: 'utf8', env: cleanEnv() });
      assert.strictEqual(r.status, want, label + '\n' + r.stdout + r.stderr);
    }
  });

  test(id + ': emitted Python test is valid Python', async () => {
    const expected = await S.expectedForInput(pack, runner, pack.input);
    const d = tmp('py-compile');
    fs.writeFileSync(path.join(d, 'test_regression.py'), S.emitPy(pack, { modulePath: 'app.parser', functionName: 'run', expected }));
    const r = spawnSync('python3', ['-m', 'py_compile', path.join(d, 'test_regression.py')], { encoding: 'utf8' });
    assert.strictEqual(r.status, 0, r.stderr);
  });
}

for (const [id, buggy, fixed] of [['csv-quoted-comma', 'csv_buggy', 'csv_fixed'], ['age-trailing-text', 'age_buggy', 'age_fixed']]) {
  test(id + ': emitted Python test fails on a buggy Python port and passes on a fixed one', async () => {
    const pack = packs[id];
    const expected = await S.expectedForInput(pack, runner, pack.input);
    for (const [label, mod, want] of [['buggy', buggy, 1], ['fixed', fixed, 0]]) {
      const d = tmp('py-' + label);
      fs.copyFileSync(path.join(__dirname, 'fixtures', mod + '.py'), path.join(d, mod + '.py'));
      fs.writeFileSync(path.join(d, 'test_regression.py'), S.emitPy(pack, { modulePath: mod, functionName: 'run', expected }));
      const r = spawnSync('python3', ['-m', 'unittest', 'test_regression'], { cwd: d, encoding: 'utf8' });
      assert.strictEqual(r.status, want, label + '\n' + r.stderr);
    }
  });
}

test('shrinking needs a reference and a failing pack', async () => {
  const noRef = JSON.parse(JSON.stringify(packs['age-trailing-text']));
  delete noRef.reference; noRef.expected = false;
  await assert.rejects(() => S.minimize(noRef, runner), /reference/);
  await assert.rejects(() => S.minimize(packs['age-trailing-text'], runner, { code: packs['age-trailing-text'].reference }), /does not fail/);
});

test('the runner stops infinite loops and reports them as a timeout failure', async () => {
  const p = Object.assign({}, packs['age-trailing-text'], { code: 'function run() { while (true) {} }' });
  const r = await S.evaluate(p, nodeRunner(200), {});
  assert.strictEqual(r.status, 'fail');
  assert.strictEqual(r.timeout, true);
});

test('each run gets a fresh context, so pollution cannot leak between runs', async () => {
  const a = await runner({ code: 'function run() { Object.prototype.leak = 1; return 1; }', fn: 'run', arg: 'null' });
  assert.strictEqual(a.ok, true);
  const b = await runner({ code: 'function run() { return ({}).leak === undefined; }', fn: 'run', arg: 'null' });
  assert.strictEqual(b.json, 'true');
  assert.strictEqual(typeof process, 'object');
  const c = await runner({ code: 'function run() { return typeof process; }', fn: 'run', arg: 'null' });
  assert.strictEqual(c.json, '"undefined"');
});

test('a function that returns nothing is reported, not treated as a pass', async () => {
  const p = Object.assign({}, packs['age-trailing-text'], { code: 'function run() {}' });
  const r = await S.evaluate(p, runner, {});
  assert.strictEqual(r.status, 'fail');
  assert.strictEqual(r.errorName, 'NoResult');
});

test('emit refuses identifiers and module paths that could inject code', async () => {
  const pack = packs['age-trailing-text'];
  assert.throws(() => S.emitJs(pack, { modulePath: './a', functionName: 'x; process.exit(1)', expected: false }), /identifier/);
  assert.throws(() => S.emitPy(pack, { modulePath: 'a; import os', functionName: 'run', expected: false }), /dotted/);
  assert.throws(() => S.emitPy(pack, { modulePath: 'a.b', functionName: 'run)\nimport os', expected: false }), /identifier/);
  assert.throws(() => S.emitJs(pack, { modulePath: '', functionName: 'run', expected: false }), /module path/);
});

test('emitted files survive awkward titles and data', async () => {
  const pack = Object.assign({}, packs['csv-quoted-comma'], { title: 'Title with "quotes", \\ backslash and\nnewline \u2028', input: { line: 'a"b\\c\nd\u2028e😀' } });
  const d = tmp('awkward');
  fs.writeFileSync(path.join(d, 't.test.js'), S.emitJs(pack, { modulePath: './src.js', expected: ['x'] }));
  assert.strictEqual(spawnSync(process.execPath, ['--check', path.join(d, 't.test.js')]).status, 0);
  fs.writeFileSync(path.join(d, 't.py'), S.emitPy(pack, { modulePath: 'm', expected: ['x'] }));
  const r = spawnSync('python3', ['-c', 'import ast,sys; ast.parse(open(sys.argv[1], encoding="utf8").read())', path.join(d, 't.py')], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
});

test('capture fills in the failure and seals; it refuses a passing pack', async () => {
  const draft = JSON.parse(JSON.stringify(packs['age-trailing-text']));
  delete draft.actual; delete draft.packHash;
  const sealed = await S.capture(draft, runner);
  assert.deepStrictEqual(sealed.actual, { output: true });
  assert.strictEqual(S.verifySeal(sealed), true);
  draft.input = { value: '12' };
  await assert.rejects(() => S.capture(draft, runner), /no failure/);
});

test('static expected value works without a reference', async () => {
  const p = { format: 1, id: 'static', title: 't', summary: 's', environment: { runtime: 'js' }, code: 'function run(i) { return i.a + 1; }', input: { a: 1 }, expected: 3 };
  assert.deepStrictEqual(S.validatePack(p), []);
  assert.strictEqual((await S.reproduce(p, runner)).verdict, 'reproduced');
  assert.strictEqual((await S.reproduce(p, runner, { code: 'function run(i) { return i.a + 2; }' })).verdict, 'not-reproduced');
});

// ---------- CLI ----------
const pk = (id) => path.join(ROOT, 'packs', id + '.json');

test('cli run: exit codes 1 (reproduced), 0 (fix passes), 2 (different failure), 3 (invalid)', async () => {
  const l = captureLog();
  assert.strictEqual(await cli.main(['run', pk('age-trailing-text')], l.fn), 1);
  assert.match(l.lines.join('\n'), /REPRODUCED/);

  const d = tmp('cli');
  const fix = path.join(d, 'fix.js');
  fs.writeFileSync(fix, packs['age-trailing-text'].reference);
  const l2 = captureLog();
  assert.strictEqual(await cli.main(['run', pk('age-trailing-text'), '--code', fix], l2.fn), 0);
  assert.match(l2.lines.join('\n'), /PASS/);

  const other = path.join(d, 'other.js');
  fs.writeFileSync(other, 'function run() { throw new RangeError("x"); }');
  const l3 = captureLog();
  assert.strictEqual(await cli.main(['run', pk('age-trailing-text'), '--code', other], l3.fn), 2);
  assert.match(l3.lines.join('\n'), /DIFFERENT FAILURE/);

  const badPack = path.join(d, 'bad.json');
  fs.writeFileSync(badPack, '{"format": 1}');
  await assert.rejects(() => cli.main(['run', badPack], () => {}), /Invalid pack/);
  fs.writeFileSync(badPack, 'not json');
  await assert.rejects(() => cli.main(['run', badPack], () => {}), /not valid JSON/);
});

test('cli check detects a tampered pack', async () => {
  const d = tmp('tamper');
  const f = path.join(d, 'p.json');
  const p = JSON.parse(JSON.stringify(packs['csv-quoted-comma']));
  fs.writeFileSync(f, JSON.stringify(p));
  assert.strictEqual(await cli.main(['check', f], () => {}), 0);
  p.input.line = 'changed';
  fs.writeFileSync(f, JSON.stringify(p));
  const l = captureLog();
  assert.strictEqual(await cli.main(['check', f], l.fn), 3);
  assert.match(l.lines.join('\n'), /HASH MISMATCH/);
});

test('cli shrink --out writes a sealed pack that still reproduces', async () => {
  const d = tmp('shrink');
  const out = path.join(d, 'small.json');
  assert.strictEqual(await cli.main(['shrink', pk('tag-index-constructor'), '--out', out], () => {}), 0);
  const small = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.strictEqual(S.verifySeal(small), true);
  assert.ok(S.size(small.input) < S.size(packs['tag-index-constructor'].input));
  assert.strictEqual((await S.reproduce(small, runner)).verdict, 'reproduced');
});

test('cli emit writes a test file and validates its options', async () => {
  const d = tmp('emit');
  const out = path.join(d, 'regression.test.js');
  assert.strictEqual(await cli.main(['emit', pk('csv-quoted-comma'), '--lang', 'js', '--module', './src.js', '--out', out], () => {}), 0);
  assert.match(fs.readFileSync(out, 'utf8'), /node:test/);
  await assert.rejects(() => cli.main(['emit', pk('csv-quoted-comma'), '--lang', 'rb', '--module', 'x'], () => {}), /--lang/);
  await assert.rejects(() => cli.main(['emit', pk('csv-quoted-comma'), '--lang', 'js'], () => {}), /--module/);
});

test('the real command line exits with the documented codes', () => {
  const bin = path.join(ROOT, 'cli', 'specimen.js');
  assert.strictEqual(spawnSync(process.execPath, [bin, 'run', pk('csv-quoted-comma')], { encoding: 'utf8' }).status, 1);
  assert.strictEqual(spawnSync(process.execPath, [bin, 'run', '/nonexistent.json'], { encoding: 'utf8' }).status, 3);
  assert.strictEqual(spawnSync(process.execPath, [bin, 'help'], { encoding: 'utf8' }).status, 0);
});

test('sample packs are reproducible from tools/make-packs.js', async () => {
  const before = Object.fromEntries(packFiles.map((f) => [f, fs.readFileSync(path.join(ROOT, 'packs', f), 'utf8')]));
  const r = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'make-packs.js')], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
  for (const f of packFiles) assert.strictEqual(fs.readFileSync(path.join(ROOT, 'packs', f), 'utf8'), before[f], f + ' changed after regenerating');
});

test('site/samples.js is current with packs/', () => {
  const { render } = require('../tools/build-site.js');
  assert.strictEqual(fs.readFileSync(path.join(ROOT, 'site', 'samples.js'), 'utf8'), render());
});
