'use strict';
(function () {
  var S = window.Specimen;
  var samples = window.SPECIMEN_SAMPLES;
  var TIMEOUT_MS = 1500;
  var lang = 'js';
  var selectedId = null;
  var lastShrunk = null;

  function h(tag, attrs, kids) {
    var el = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'class') el.className = attrs[k];
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== false && attrs[k] !== null && attrs[k] !== undefined) el.setAttribute(k, attrs[k] === true ? '' : attrs[k]);
    });
    (kids || []).forEach(function (k) { if (k !== null && k !== undefined) el.appendChild(typeof k === 'string' ? document.createTextNode(k) : k); });
    return el;
  }
  function $(id) { return document.getElementById(id); }

  // ---- browser runner: one throwaway Worker per call, no network (CSP connect-src 'none')
  var WORKER_SRC =
    'onmessage=function(e){var j=e.data;try{' +
    'var f=new Function(j.code+"\\nreturn "+j.fn+";")();' +
    'var out=f(JSON.parse(j.arg));' +
    'postMessage({ok:true,json:out===undefined?undefined:JSON.stringify(out)});' +
    '}catch(err){postMessage({ok:false,error:{name:String(err&&err.name||"Error"),message:String(err&&err.message||err)}});}};';
  var workerUrl = URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' }));
  function runner(job) {
    return new Promise(function (resolve) {
      var w = new Worker(workerUrl);
      var done = false;
      var timer = setTimeout(function () { if (!done) { done = true; w.terminate(); resolve({ ok: false, timeout: true, error: { name: 'Timeout', message: 'Stopped after ' + TIMEOUT_MS + ' ms.' } }); } }, TIMEOUT_MS);
      w.onmessage = function (ev) { if (done) return; done = true; clearTimeout(timer); w.terminate(); resolve(ev.data); };
      w.onerror = function (ev) { if (done) return; done = true; clearTimeout(timer); w.terminate(); resolve({ ok: false, error: { name: 'Error', message: ev.message || 'worker error' } }); };
      w.postMessage(job);
    });
  }

  function show(v) { return S.canonicalJson(v); }
  function pretty(v) { return JSON.stringify(v, null, 2); }

  // ---- pack state
  function readPack() {
    var text = $('pack-json').value;
    var pack;
    try { pack = JSON.parse(text); } catch (e) { return { error: 'The pack is not valid JSON: ' + e.message }; }
    var errs = S.validatePack(pack);
    if (errs.length) return { error: errs.join(' ') };
    return { pack: pack };
  }
  function writePack(pack) { $('pack-json').value = pretty(pack); renderCard(); }

  function renderSamples() {
    var box = $('samples');
    box.textContent = '';
    samples.forEach(function (p) {
      box.appendChild(h('button', { type: 'button', 'aria-pressed': p.id === selectedId ? 'true' : 'false', onclick: function () { selectedId = p.id; writePack(p); clearOutputs(); renderSamples(); } }, [p.title.length > 34 ? p.id : p.title, h('span', { class: 'kind' }, [p.kind])]));
    });
  }

  function renderCard() {
    var card = $('card');
    card.textContent = '';
    var r = readPack();
    if (r.error) { card.appendChild(h('p', { role: 'alert' }, [r.error])); return; }
    var p = r.pack;
    var seal;
    if (!p.packHash) seal = h('span', { class: 'seal none' }, ['Not sealed']);
    else if (S.verifySeal(p)) seal = h('span', { class: 'seal ok' }, ['Sealed: contents match the hash']);
    else seal = h('span', { class: 'seal bad' }, ['Edited after sealing']);
    card.appendChild(h('h3', {}, [p.title]));
    card.appendChild(h('p', {}, [p.summary]));
    card.appendChild(seal);
    if (p.packHash) card.appendChild(h('span', { class: 'hash' }, [p.packHash]));
    var kv = h('dl', { class: 'kv' });
    kv.appendChild(h('dt', {}, ['Input'])); kv.appendChild(h('dd', {}, [show(p.input)]));
    kv.appendChild(h('dt', {}, ['Reporter saw'])); kv.appendChild(h('dd', {}, [p.actual ? (p.actual.error ? 'an error: ' + p.actual.error.name : show(p.actual.output)) : 'not recorded']));
    kv.appendChild(h('dt', {}, ['Environment'])); kv.appendChild(h('dd', {}, [p.environment.runtime]));
    kv.appendChild(h('dt', {}, ['Reference'])); kv.appendChild(h('dd', {}, [p.reference ? 'included' : 'none (shrinking is off)']));
    card.appendChild(kv);
  }

  function clearOutputs() {
    ['repro-out', 'shrink-out', 'emit-out', 'fix-out'].forEach(function (id) { $(id).textContent = ''; });
    lastShrunk = null;
  }

  function need() {
    var r = readPack();
    if (r.error) { return null; }
    return r.pack;
  }
  function errBox(target, msg) { target.textContent = ''; target.appendChild(h('div', { class: 'res fail', role: 'alert' }, [h('strong', {}, [msg])])); }

  function failLines(cur) {
    return cur.kind === 'exception' ? 'An error: ' + cur.message : 'Output ' + show(cur.output);
  }

  function renderVerdict(target, r, label) {
    target.textContent = '';
    var cur = r.current;
    if (r.verdict === 'invalid') { target.appendChild(h('div', { class: 'res warn' }, [h('strong', {}, ['Could not judge']), h('span', {}, [cur.message])])); return; }
    var cls = r.verdict === 'reproduced' ? 'fail' : (r.verdict === 'different-failure' ? 'warn' : 'pass');
    var title = r.verdict === 'reproduced' ? 'Reproduced. This is the failure that was reported.' : (r.verdict === 'different-failure' ? 'It fails, but differently from the report.' : (label === 'fix' ? 'Passes. Your code gives the expected answer.' : 'Not reproduced. The code gives the expected answer.'));
    var box = h('div', { class: 'res ' + cls, role: 'status' }, [h('strong', {}, [title])]);
    var dl = h('dl');
    dl.appendChild(h('dt', {}, ['Expected'])); dl.appendChild(h('dd', {}, [show(cur.expected)]));
    dl.appendChild(h('dt', {}, ['Got'])); dl.appendChild(h('dd', {}, [cur.status === 'pass' ? show(cur.output) : failLines(cur)]));
    box.appendChild(dl);
    target.appendChild(box);
  }

  function reproduce() {
    var p = need(); var out = $('repro-out');
    if (!p) { errBox(out, 'Fix the pack first: ' + readPack().error); return; }
    out.textContent = 'Running...';
    S.reproduce(p, runner).then(function (r) { renderVerdict(out, r, 'repro'); }, function (e) { errBox(out, e.message); });
  }

  function runFix() {
    var p = need(); var out = $('fix-out');
    if (!p) { errBox(out, 'Fix the pack first: ' + readPack().error); return; }
    var code = $('fix-code').value;
    if (!/function\s+run\s*\(/.test(code) && !/(const|let|var)\s+run\s*=/.test(code)) { errBox(out, 'Your code must define function run(input).'); return; }
    out.textContent = 'Running...';
    S.reproduce(p, runner, { code: code }).then(function (r) { renderVerdict(out, r, 'fix'); }, function (e) { errBox(out, e.message); });
  }

  function shrink() {
    var p = need(); var out = $('shrink-out');
    if (!p) { errBox(out, 'Fix the pack first: ' + readPack().error); return; }
    out.textContent = 'Shrinking...';
    $('shrink').disabled = true;
    S.minimize(p, runner, { maxRuns: 600 }).then(function (res) {
      $('shrink').disabled = false;
      out.textContent = '';
      var box = h('div', { class: 'res ' + (res.finalSize < res.originalSize ? 'pass' : 'warn'), role: 'status' }, [
        h('strong', {}, [res.finalSize < res.originalSize ? 'Shrunk from ' + res.originalSize + ' to ' + res.finalSize + ' characters.' : 'Already as small as it gets.']),
        h('div', { class: 'compare' }, [
          h('div', {}, [h('h4', {}, ['Before']), h('pre', {}, [show(p.input)])]),
          h('div', {}, [h('h4', {}, ['After']), h('pre', { id: 'shrunk-input' }, [show(res.input)])])
        ]),
        h('dl', {}, [h('dt', {}, ['Work']), h('dd', {}, [res.steps + ' accepted steps, ' + res.runs + ' runs' + (res.capped ? ' (stopped at the run limit)' : '')])])
      ]);
      out.appendChild(box);
      lastShrunk = res.input;
      if (res.finalSize < res.originalSize) {
        out.appendChild(h('button', { type: 'button', class: 'btn alt', id: 'use-shrunk', onclick: useShrunk }, ['Use the smaller input in the pack']));
      }
    }, function (e) { $('shrink').disabled = false; errBox(out, e.message); });
  }

  function useShrunk() {
    var p = need();
    if (!p || lastShrunk === null) return;
    var next = Object.assign({}, p, { input: lastShrunk });
    delete next.packHash;
    S.evaluate(next, runner, {}).then(function (cur) {
      if (cur.status === 'fail') next.actual = cur.kind === 'exception' ? { error: { name: cur.errorName } } : { output: cur.output };
      writePack(S.seal(next));
      $('shrink-out').appendChild(h('div', { class: 'res pass', role: 'status' }, [h('strong', {}, ['The pack now holds the smaller input and was sealed again.'])]));
    });
  }

  function seal() {
    var p = need(); var out = $('repro-out');
    if (!p) { errBox(out, 'Fix the pack first: ' + readPack().error); return; }
    S.capture(p, runner).then(function (sealed) { writePack(sealed); out.textContent = ''; out.appendChild(h('div', { class: 'res pass', role: 'status' }, [h('strong', {}, ['Failure captured and pack sealed.'])])); }, function (e) { errBox(out, e.message); });
  }

  function emit() {
    var p = need(); var out = $('emit-out');
    if (!p) { errBox(out, 'Fix the pack first: ' + readPack().error); return; }
    var opts = { modulePath: $('mod').value.trim(), functionName: $('fn').value.trim() || 'run' };
    S.expectedForInput(p, runner, p.input).then(function (expected) {
      opts.expected = expected;
      var text = lang === 'js' ? S.emitJs(p, opts) : S.emitPy(p, opts);
      var name = lang === 'js' ? p.id + '.regression.test.js' : 'test_' + p.id.replace(/-/g, '_') + '.py';
      out.textContent = '';
      out.appendChild(h('pre', { class: 'code', id: 'emit-code', tabindex: '0' }, [text]));
      out.appendChild(h('div', { class: 'row' }, [
        h('button', { type: 'button', class: 'btn alt', id: 'copy', onclick: function () { copy(text, function (ok) { $('copy').textContent = ok ? 'Copied' : 'Copy failed. Select the code by hand.'; }); } }, ['Copy']),
        h('button', { type: 'button', class: 'btn alt', id: 'download-test', onclick: function () { download(name, text, 'text/plain'); } }, ['Download ' + name])
      ]));
    }).catch(function (e) { errBox(out, e.message); });
  }

  function copy(text, done) {
    function fallback() {
      var ta = h('textarea', { 'aria-hidden': 'true' }); ta.value = text;
      document.body.appendChild(ta); ta.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
      document.body.removeChild(ta); done(ok);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { done(true); }, fallback); else fallback();
  }
  function download(name, text, type) {
    var url = URL.createObjectURL(new Blob([text], { type: type }));
    var a = h('a', { href: url, download: name });
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function setLang(l) {
    lang = l;
    $('tab-js').setAttribute('aria-selected', l === 'js' ? 'true' : 'false');
    $('tab-py').setAttribute('aria-selected', l === 'py' ? 'true' : 'false');
    $('mod').value = l === 'js' ? './src/parser.js' : 'app.parser';
    $('emit-out').textContent = '';
  }

  $('reproduce').addEventListener('click', reproduce);
  $('run-fix').addEventListener('click', runFix);
  $('shrink').addEventListener('click', shrink);
  $('seal').addEventListener('click', seal);
  $('emit').addEventListener('click', emit);
  $('tab-js').addEventListener('click', function () { setLang('js'); });
  $('tab-py').addEventListener('click', function () { setLang('py'); });
  $('download-pack').addEventListener('click', function () {
    var r = readPack();
    if (r.error) { errBox($('repro-out'), r.error); return; }
    download(r.pack.id + '.specimen.json', pretty(r.pack) + '\n', 'application/json');
  });
  $('pack-json').addEventListener('input', renderCard);
  $('pack-file').addEventListener('change', function (ev) {
    var f = ev.target.files[0]; if (!f) return;
    var rd = new FileReader();
    rd.onload = function () { $('pack-json').value = String(rd.result); selectedId = null; clearOutputs(); renderSamples(); renderCard(); };
    rd.readAsText(f);
  });

  selectedId = samples[0].id;
  writePack(samples[0]);
  renderSamples();
  $('fix-code').value = 'function run(input) {\n  // write your fixed version here and press "Run my code"\n  return null;\n}\n';
})();
