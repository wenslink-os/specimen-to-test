'use strict';
// Runs pack code in a fresh vm context per call. Good enough to isolate state and stop infinite loops,
// but vm is not a security boundary: only run packs you trust, or run them inside a container.
const vm = require('node:vm');

function nodeRunner(timeoutMs) {
  const limit = timeoutMs || 1000;
  return async function run(job) {
    const sandbox = Object.create(null);
    sandbox.__arg = job.arg;
    const ctx = vm.createContext(sandbox, { codeGeneration: { strings: false, wasm: false } });
    const script =
      job.code + '\n;(function () {\n' +
      '  var out = ' + job.fn + '(JSON.parse(__arg));\n' +
      '  return out === undefined ? undefined : JSON.stringify(out);\n' +
      '})();';
    try {
      const json = vm.runInContext(script, ctx, { timeout: limit });
      return { ok: true, json: json };
    } catch (e) {
      const timeout = !!(e && e.code === 'ERR_SCRIPT_EXECUTION_TIMEOUT');
      const name = timeout ? 'Timeout' : (e && e.name) || 'Error';
      return { ok: false, timeout: timeout, error: { name: String(name), message: String((e && e.message) || e) } };
    }
  };
}

module.exports = { nodeRunner };
