#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const S = require('../site/specimen-core.js');
const { nodeRunner } = require('./node-runner.js');

const USAGE = [
  'specimen-to-test',
  '',
  'Usage:',
  '  specimen run <pack.json> [--code file.js]       Reproduce the failure. --code runs your own fix against the pack.',
  '  specimen shrink <pack.json> [--out file.json]   Find the smallest input that still fails the same way.',
  '  specimen emit <pack.json> --lang js|py --module <path> [--function name] [--out file]',
  '  specimen seal <pack.json>                        Record the failure seen here and write the pack hash.',
  '  specimen check <pack.json>                       Validate the pack and its hash.',
  '',
  'Exit codes for run:',
  '  0  the code gives the expected answer (no failure)',
  '  1  the reported failure is reproduced',
  '  2  it fails, but differently from the report',
  '  3  the pack is invalid or could not be run',
  ''
].join('\n');

function parseArgs(argv) {
  const pos = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const name = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) throw new Error('--' + name + ' needs a value.');
      flags[name] = next;
      i++;
    } else pos.push(a);
  }
  return { pos, flags };
}

function readPack(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) { throw new Error('Cannot read ' + file + ': ' + e.message); }
  let pack;
  try { pack = JSON.parse(text); } catch (e) { throw new Error(file + ' is not valid JSON: ' + e.message); }
  const errs = S.validatePack(pack);
  if (errs.length) throw new Error('Invalid pack:\n  ' + errs.join('\n  '));
  return pack;
}

function show(v) { return S.canonicalJson(v); }

async function main(argv, out) {
  const log = out || ((s) => process.stdout.write(s + '\n'));
  const { pos, flags } = parseArgs(argv);
  const cmd = pos[0];
  if (!cmd || cmd === 'help' || cmd === '--help') { log(USAGE); return 0; }
  if (!pos[1]) throw new Error('Missing pack file.\n\n' + USAGE);
  const pack = readPack(pos[1]);
  const runner = nodeRunner(Number(flags.timeout || 1000));

  if (cmd === 'check') {
    const hasHash = typeof pack.packHash === 'string';
    if (!hasHash) { log('Pack is valid but has no hash. Run "specimen seal" to add one.'); return 0; }
    if (!S.verifySeal(pack)) { log('HASH MISMATCH: the pack was edited after it was sealed.'); return 3; }
    log('OK: pack is valid and the hash matches (' + pack.packHash + ').');
    return 0;
  }

  if (cmd === 'run') {
    const o = {};
    if (flags.code) o.code = fs.readFileSync(flags.code, 'utf8');
    const r = await S.reproduce(pack, runner, o);
    log('Pack: ' + pack.id + (pack.packHash && !S.verifySeal(pack) ? '  (WARNING: hash does not match, the pack was edited)' : ''));
    log('Input: ' + show(pack.input));
    if (r.verdict === 'invalid') { log('Could not judge: ' + r.current.message); return 3; }
    log('Expected: ' + show(r.current.expected));
    if (r.verdict === 'not-reproduced') { log('Got: ' + show(r.current.output)); log('RESULT: PASS. The code gives the expected answer.'); return 0; }
    log(r.current.kind === 'exception' ? 'Got: an error, ' + r.current.message : 'Got: ' + show(r.current.output));
    if (r.verdict === 'reproduced') { log('RESULT: REPRODUCED. This is the failure that was reported.'); return 1; }
    log('RESULT: DIFFERENT FAILURE. It fails, but not the way the report says.');
    return 2;
  }

  if (cmd === 'shrink') {
    const res = await S.minimize(pack, runner, { maxRuns: Number(flags['max-runs'] || 1500) });
    log('Original input (' + res.originalSize + ' characters): ' + show(pack.input));
    log('Smallest failing input (' + res.finalSize + ' characters): ' + show(res.input));
    log('Steps: ' + res.steps + ', runs: ' + res.runs + (res.capped ? ' (stopped at the run limit)' : ''));
    if (flags.out) {
      const shrunk = Object.assign({}, pack, { input: res.input });
      delete shrunk.packHash;
      const cur = await S.evaluate(shrunk, runner, {});
      shrunk.actual = cur.kind === 'exception' ? { error: { name: cur.errorName } } : { output: cur.output };
      fs.writeFileSync(flags.out, JSON.stringify(S.seal(shrunk), null, 2) + '\n');
      log('Wrote ' + flags.out);
    }
    return 0;
  }

  if (cmd === 'seal') {
    const sealed = await S.capture(pack, runner);
    fs.writeFileSync(pos[1], JSON.stringify(sealed, null, 2) + '\n');
    log('Sealed ' + pos[1] + ' (' + sealed.packHash + ')');
    return 0;
  }

  if (cmd === 'emit') {
    const lang = flags.lang;
    if (lang !== 'js' && lang !== 'py') throw new Error('--lang must be js or py.');
    if (!flags.module) throw new Error('--module is required.');
    const expected = await S.expectedForInput(pack, runner, pack.input);
    const opts = { modulePath: flags.module, functionName: flags.function, expected };
    const text = lang === 'js' ? S.emitJs(pack, opts) : S.emitPy(pack, opts);
    if (flags.out) { fs.writeFileSync(flags.out, text); log('Wrote ' + flags.out); } else log(text);
    return 0;
  }

  throw new Error('Unknown command: ' + cmd + '\n\n' + USAGE);
}

if (require.main === module) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (e) => { process.stderr.write(e.message + '\n'); process.exitCode = 3; });
}

module.exports = { main, parseArgs };
