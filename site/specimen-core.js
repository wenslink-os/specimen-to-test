(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Specimen = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var FORMAT = 1;

  // ---------- hashing and canonical JSON ----------
  var K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];
  function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }
  function sha256Hex(str) {
    var bytes = new TextEncoder().encode(str);
    var l = bytes.length;
    var padded = new Uint8Array(((l + 9 + 63) >> 6) << 6);
    padded.set(bytes);
    padded[l] = 0x80;
    var view = new DataView(padded.buffer);
    view.setUint32(padded.length - 8, Math.floor(l / 0x20000000));
    view.setUint32(padded.length - 4, (l << 3) >>> 0);
    var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    var w = new Uint32Array(64);
    for (var off = 0; off < padded.length; off += 64) {
      var i;
      for (i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
      for (i = 16; i < 64; i++) {
        var s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
        var s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
      }
      var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (i = 0; i < 64; i++) {
        var S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        var ch = (e & f) ^ (~e & g);
        var t1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
        var S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        var maj = (a & b) ^ (a & c) ^ (b & c);
        var t2 = (S0 + maj) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
      H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
    }
    return H.map(function (x) { return ('00000000' + x.toString(16)).slice(-8); }).join('');
  }

  function canonicalJson(v) {
    if (v === null || typeof v !== 'object') return JSON.stringify(v);
    if (Array.isArray(v)) return '[' + v.map(canonicalJson).join(',') + ']';
    return '{' + Object.keys(v).sort().map(function (k) { return JSON.stringify(k) + ':' + canonicalJson(v[k]); }).join(',') + '}';
  }
  function deepEqual(a, b) { return canonicalJson(a) === canonicalJson(b); }

  function packHash(pack) {
    var copy = {};
    Object.keys(pack).forEach(function (k) { if (k !== 'packHash') copy[k] = pack[k]; });
    return sha256Hex(canonicalJson(copy));
  }
  function seal(pack) { var p = {}; Object.keys(pack).forEach(function (k) { p[k] = pack[k]; }); p.packHash = packHash(p); return p; }
  function verifySeal(pack) { return typeof pack.packHash === 'string' && pack.packHash === packHash(pack); }

  // ---------- pack validation ----------
  function isJsonValue(v, depth) {
    if (depth > 200) return false;
    if (v === null || typeof v === 'string' || typeof v === 'boolean') return true;
    if (typeof v === 'number') return isFinite(v);
    if (Array.isArray(v)) return v.every(function (x) { return isJsonValue(x, depth + 1); });
    if (typeof v === 'object') return Object.keys(v).every(function (k) { return isJsonValue(v[k], depth + 1); });
    return false;
  }
  function validatePack(p) {
    var errs = [];
    if (!p || typeof p !== 'object' || Array.isArray(p)) return ['The pack must be a JSON object.'];
    if (p.format !== FORMAT) errs.push('format must be ' + FORMAT + '.');
    ['id', 'title', 'summary'].forEach(function (k) { if (typeof p[k] !== 'string' || !p[k].trim()) errs.push(k + ' must be a non-empty string.'); });
    if (typeof p.id === 'string' && !/^[a-z0-9][a-z0-9-]*$/.test(p.id)) errs.push('id may contain only lowercase letters, digits and hyphens.');
    if (typeof p.code !== 'string' || !p.code.trim()) errs.push('code must be a string that defines function run(input).');
    else if (!/function\s+run\s*\(/.test(p.code) && !/(const|let|var)\s+run\s*=/.test(p.code)) errs.push('code must define run.');
    if (p.reference !== undefined && (typeof p.reference !== 'string' || !/function\s+run\s*\(/.test(p.reference))) errs.push('reference must be a string that defines function run(input).');
    if (p.guard !== undefined && (typeof p.guard !== 'string' || !/function\s+valid\s*\(/.test(p.guard))) errs.push('guard must be a string that defines function valid(input).');
    if (!('input' in p) || !isJsonValue(p.input, 0)) errs.push('input must be a JSON value.');
    if (p.reference === undefined && !('expected' in p)) errs.push('Provide either expected or reference.');
    if ('expected' in p && !isJsonValue(p.expected, 0)) errs.push('expected must be a JSON value.');
    if (!p.environment || typeof p.environment.runtime !== 'string') errs.push('environment.runtime must be a string.');
    if (p.actual !== undefined) {
      var a = p.actual;
      var okShape = a && typeof a === 'object' && (('output' in a && isJsonValue(a.output, 0)) || (a.error && typeof a.error.name === 'string'));
      if (!okShape) errs.push('actual must be {"output": <json>} or {"error": {"name": "..."}}.');
    }
    return errs;
  }

  // ---------- running ----------
  // A runner takes {code, fn, arg} and resolves {ok:true, json} or {ok:false, error:{name,message}, timeout?}.
  function parseRun(r) {
    if (!r.ok) return { ok: false, error: r.error || { name: 'Error', message: 'unknown' }, timeout: !!r.timeout };
    if (typeof r.json !== 'string') return { ok: false, error: { name: 'NoResult', message: 'The function returned undefined or something that is not JSON.' } };
    try { return { ok: true, value: JSON.parse(r.json) }; } catch (e) { return { ok: false, error: { name: 'NoResult', message: 'The result could not be read as JSON.' } }; }
  }

  async function expectedFor(pack, runner, input) {
    if (pack.reference === undefined) return { ok: true, value: pack.expected };
    var r = parseRun(await runner({ code: pack.reference, fn: 'run', arg: JSON.stringify(input) }));
    return r.ok ? { ok: true, value: r.value } : { ok: false, error: r.error };
  }

  async function isValidInput(pack, runner, input) {
    if (!pack.guard) return true;
    var r = parseRun(await runner({ code: pack.guard, fn: 'valid', arg: JSON.stringify(input) }));
    return r.ok && r.value === true;
  }

  // Evaluate the code in the pack (or o.code) on the pack input (or o.input).
  // status: 'pass' | 'fail' | 'invalid' (the reference itself could not produce an answer)
  async function evaluate(pack, runner, o) {
    o = o || {};
    var code = o.code !== undefined ? o.code : pack.code;
    var input = o.input !== undefined ? o.input : pack.input;
    var exp = await expectedFor(pack, runner, input);
    if (!exp.ok) return { status: 'invalid', kind: 'reference-error', message: 'The reference failed on this input: ' + exp.error.name };
    var r = parseRun(await runner({ code: code, fn: 'run', arg: JSON.stringify(input) }));
    if (!r.ok) {
      return { status: 'fail', kind: 'exception', errorName: r.error.name, message: r.error.name + (r.error.message ? ': ' + r.error.message : ''), timeout: !!r.timeout, expected: exp.value };
    }
    if (deepEqual(r.value, exp.value)) return { status: 'pass', output: r.value, expected: exp.value };
    return { status: 'fail', kind: 'wrong-output', output: r.value, expected: exp.value, message: 'The output differs from the expected value.' };
  }

  function sameFailure(a, b) {
    if (a.status !== 'fail' || b.status !== 'fail' || a.kind !== b.kind) return false;
    return a.kind !== 'exception' || a.errorName === b.errorName;
  }

  // Compare what the reporter saw (pack.actual) with what happens now.
  async function reproduce(pack, runner, o) {
    var current = await evaluate(pack, runner, o);
    if (current.status === 'invalid') return { verdict: 'invalid', current: current };
    if (current.status === 'pass') return { verdict: 'not-reproduced', current: current };
    var claimed = pack.actual;
    if (!claimed) return { verdict: 'reproduced', current: current, note: 'The pack does not record what the reporter saw.' };
    var same;
    if (claimed.error) same = current.kind === 'exception' && current.errorName === claimed.error.name;
    else same = current.kind === 'wrong-output' && deepEqual(current.output, claimed.output);
    return { verdict: same ? 'reproduced' : 'different-failure', current: current };
  }

  // ---------- shrinking JSON inputs ----------
  function size(v) { return canonicalJson(v).length; }
  function weight(v) {
    if (typeof v === 'number') return v === 0 ? 0 : 1 + Math.abs(v) / (1 + Math.abs(v));
    if (v === true) return 1;
    if (Array.isArray(v)) return v.reduce(function (n, x) { return n + weight(x); }, 0);
    if (v && typeof v === 'object') return Object.keys(v).reduce(function (n, k) { return n + weight(v[k]); }, 0);
    return 0;
  }
  function smaller(cand, cur) {
    var a = size(cand), b = size(cur);
    return a < b || (a === b && weight(cand) < weight(cur));
  }
  function* slices(n) {
    for (var s = Math.ceil(n / 2); s >= 1; s = s === 1 ? 0 : Math.ceil(s / 2)) {
      for (var i = 0; i + s <= n; i += s) yield [i, s];
      if (s === 1) break;
    }
  }
  function* shrinks(v) {
    if (Array.isArray(v)) {
      var seen = {};
      for (var sl of slices(v.length)) {
        var c = v.slice(0, sl[0]).concat(v.slice(sl[0] + sl[1]));
        var key = canonicalJson(c);
        if (!seen[key]) { seen[key] = 1; yield c; }
      }
      for (var i = 0; i < v.length; i++) {
        for (var s of shrinks(v[i])) { var cp = v.slice(); cp[i] = s; yield cp; }
      }
    } else if (v && typeof v === 'object') {
      var keys = Object.keys(v);
      for (var k of keys) { var o = Object.assign({}, v); delete o[k]; yield o; }
      for (var k2 of keys) {
        for (var s2 of shrinks(v[k2])) { var o2 = Object.assign({}, v); o2[k2] = s2; yield o2; }
      }
    } else if (typeof v === 'string') {
      var chars = Array.from(v);
      if (chars.length > 0) yield '';
      var seenS = {};
      for (var sl2 of slices(chars.length)) {
        var t = chars.slice(0, sl2[0]).concat(chars.slice(sl2[0] + sl2[1])).join('');
        if (!seenS[t]) { seenS[t] = 1; yield t; }
      }
    } else if (typeof v === 'number') {
      if (v !== 0) yield 0;
      if (Math.abs(v) > 1) yield Math.trunc(v / 2);
      if (!Number.isInteger(v)) yield Math.trunc(v);
    } else if (v === true) {
      yield false;
    }
  }

  // Greedy delta debugging: keep any smaller input that still fails the same way and passes the guard.
  async function minimize(pack, runner, o) {
    o = o || {};
    var maxRuns = o.maxRuns || 1500;
    if (pack.reference === undefined) throw new Error('Shrinking needs a reference implementation, because the expected answer changes with the input.');
    var codeOpt = o.code !== undefined ? { code: o.code } : {};
    var start = await evaluate(pack, runner, codeOpt);
    if (start.status !== 'fail') throw new Error('The pack does not fail, so there is nothing to shrink.');
    var current = pack.input;
    var tried = {};
    tried[canonicalJson(current)] = true;
    var runs = 1, steps = 0, progress = true;
    while (progress && runs < maxRuns) {
      progress = false;
      for (var cand of shrinks(current)) {
        if (!smaller(cand, current)) continue;
        var key = canonicalJson(cand);
        if (tried[key]) continue;
        tried[key] = true;
        if (runs >= maxRuns) break;
        runs++;
        if (!(await isValidInput(pack, runner, cand))) continue;
        var res = await evaluate(pack, runner, Object.assign({}, codeOpt, { input: cand }));
        if (sameFailure(res, start)) {
          current = cand; steps++; progress = true;
          if (o.onStep) o.onStep(current, steps, runs);
          break;
        }
      }
    }
    return { input: current, steps: steps, runs: runs, originalSize: size(pack.input), finalSize: size(current), capped: runs >= maxRuns };
  }

  // ---------- capturing a failure and sealing a pack ----------
  async function capture(pack, runner) {
    var cur = await evaluate(pack, runner, {});
    var p = {};
    Object.keys(pack).forEach(function (k) { if (k !== 'packHash') p[k] = pack[k]; });
    if (cur.status === 'invalid') throw new Error(cur.message);
    if (cur.status === 'pass') throw new Error('The code gives the expected answer on this input, so there is no failure to capture.');
    p.actual = cur.kind === 'exception' ? { error: { name: cur.errorName } } : { output: cur.output };
    if (p.reference === undefined && !('expected' in p)) p.expected = cur.expected;
    return seal(p);
  }

  // ---------- emitting regression tests ----------
  var IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
  var PYIDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
  var PYMODULE = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/;
  function lit(v) { return JSON.stringify(JSON.stringify(v)); }

  async function expectedForInput(pack, runner, input) {
    var e = await expectedFor(pack, runner, input);
    if (!e.ok) throw new Error('The reference failed on the input: ' + e.error.name);
    return e.value;
  }

  function emitJs(pack, o) {
    var modulePath = o.modulePath, fn = o.functionName || 'run';
    if (typeof modulePath !== 'string' || !modulePath) throw new Error('Give the module path, for example ./src/parser.');
    if (!IDENT.test(fn)) throw new Error('The function name must be a valid JavaScript identifier.');
    var input = o.input !== undefined ? o.input : pack.input;
    return [
      "'use strict';",
      '// Regression test generated by specimen-to-test.',
      '// Pack: ' + pack.id + (pack.packHash ? ' (' + pack.packHash + ')' : ''),
      '// It calls your function with the failing input and expects the correct answer.',
      "const test = require('node:test');",
      "const assert = require('node:assert');",
      'const { ' + fn + ' } = require(' + JSON.stringify(modulePath) + ');',
      '',
      'test(' + JSON.stringify(pack.title) + ', () => {',
      '  const input = JSON.parse(' + lit(input) + ');',
      '  const expected = JSON.parse(' + lit(o.expected) + ');',
      '  assert.deepStrictEqual(' + fn + '(structuredClone(input)), expected);',
      '});',
      ''
    ].join('\n');
  }

  function emitPy(pack, o) {
    var modulePath = o.modulePath, fn = o.functionName || 'run';
    if (typeof modulePath !== 'string' || !PYMODULE.test(modulePath)) throw new Error('Give the module as a dotted Python path, for example app.parser.');
    if (!PYIDENT.test(fn)) throw new Error('The function name must be a valid Python identifier.');
    var input = o.input !== undefined ? o.input : pack.input;
    return [
      '# Regression test generated by specimen-to-test.',
      '# Pack: ' + pack.id + (pack.packHash ? ' (' + pack.packHash + ')' : ''),
      '# It calls your function with the failing input and expects the correct answer.',
      'import copy',
      'import json',
      'import unittest',
      '',
      'from ' + modulePath + ' import ' + fn,
      '',
      '',
      'class SpecimenRegression(unittest.TestCase):',
      '    def test_' + pack.id.replace(/-/g, '_') + '(self):',
      '        data = json.loads(' + lit(input) + ')',
      '        expected = json.loads(' + lit(o.expected) + ')',
      '        self.assertEqual(' + fn + '(copy.deepcopy(data)), expected)',
      '',
      '',
      'if __name__ == "__main__":',
      '    unittest.main()',
      ''
    ].join('\n');
  }

  return {
    FORMAT: FORMAT, sha256Hex: sha256Hex, canonicalJson: canonicalJson, deepEqual: deepEqual,
    packHash: packHash, seal: seal, verifySeal: verifySeal, validatePack: validatePack,
    evaluate: evaluate, reproduce: reproduce, minimize: minimize, capture: capture,
    expectedForInput: expectedForInput, emitJs: emitJs, emitPy: emitPy, sameFailure: sameFailure, size: size
  };
});
