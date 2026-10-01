'use strict';
// Builds the sample packs in packs/. Each one is sealed with a hash and records the failure seen on this machine.
const fs = require('node:fs');
const path = require('node:path');
const S = require('../site/specimen-core.js');
const { nodeRunner } = require('../cli/node-runner.js');

const ENV = { runtime: 'JavaScript (ES2022), run in an isolated context', notes: 'Pure function: JSON in, JSON out. No network, no files, no clock.' };

const drafts = [
  {
    format: 1,
    id: 'tag-index-constructor',
    title: 'Tag index crashes on a tag called "constructor"',
    summary: 'Building an index from tag to item names works until a tag has the same name as something every object already owns.',
    kind: 'json-transformation',
    environment: ENV,
    code: [
      'function run(input) {',
      '  const index = {};',
      '  for (const item of input.items) {',
      '    for (const tag of item.tags) {',
      '      index[tag] = index[tag] || [];',
      '      index[tag].push(item.name);',
      '    }',
      '  }',
      '  return index;',
      '}'
    ].join('\n'),
    reference: [
      'function run(input) {',
      '  const index = new Map();',
      '  for (const item of input.items) {',
      '    for (const tag of item.tags) {',
      '      if (!index.has(tag)) index.set(tag, []);',
      '      index.get(tag).push(item.name);',
      '    }',
      '  }',
      '  return Object.fromEntries(index);',
      '}'
    ].join('\n'),
    input: { items: [{ name: 'spec', tags: ['docs', 'constructor', 'v2'] }, { name: 'guide', tags: ['docs', 'howto'] }, { name: 'faq', tags: ['help', 'docs'] }] }
  },
  {
    format: 1,
    id: 'csv-quoted-comma',
    title: 'CSV line splits inside a quoted field',
    summary: 'A parser that splits on every comma breaks any field that contains a comma inside quotes.',
    kind: 'parsing',
    environment: ENV,
    code: 'function run(input) {\n  return input.line.split(",");\n}',
    reference: [
      'function run(input) {',
      '  const line = input.line;',
      '  const out = [];',
      '  let cur = "";',
      '  let quoted = false;',
      '  for (let i = 0; i < line.length; i++) {',
      '    const c = line[i];',
      '    if (quoted) {',
      '      if (c === \'"\' && line[i + 1] === \'"\') { cur += \'"\'; i++; }',
      '      else if (c === \'"\') quoted = false;',
      '      else cur += c;',
      '    } else if (c === \'"\') quoted = true;',
      '    else if (c === ",") { out.push(cur); cur = ""; }',
      '    else cur += c;',
      '  }',
      '  out.push(cur);',
      '  return out;',
      '}'
    ].join('\n'),
    guard: 'function valid(input) {\n  return typeof input.line === "string" && (input.line.split(\'"\').length - 1) % 2 === 0;\n}',
    input: { line: 'id,"Smith, Jane",42' }
  },
  {
    format: 1,
    id: 'age-trailing-text',
    title: 'Age validator accepts "12abc"',
    summary: 'parseInt stops reading at the first letter, so a value with trailing text passes validation.',
    kind: 'validation',
    environment: ENV,
    code: [
      'function run(input) {',
      '  const v = input.value;',
      '  const n = typeof v === "number" ? v : parseInt(v, 10);',
      '  return Number.isInteger(n) && n >= 0 && n <= 150;',
      '}'
    ].join('\n'),
    reference: [
      'function run(input) {',
      '  const v = input.value;',
      '  if (typeof v === "number") return Number.isInteger(v) && v >= 0 && v <= 150;',
      '  if (typeof v !== "string" || !/^[0-9]+$/.test(v)) return false;',
      '  return Number(v) <= 150;',
      '}'
    ].join('\n'),
    input: { value: '12abc' }
  }
];

(async () => {
  const runner = nodeRunner(1000);
  fs.mkdirSync(path.join(__dirname, '..', 'packs'), { recursive: true });
  for (const d of drafts) {
    const errs = S.validatePack(Object.assign({}, d));
    if (errs.length) throw new Error(d.id + ': ' + errs.join(' '));
    const pack = await S.capture(d, runner);
    fs.writeFileSync(path.join(__dirname, '..', 'packs', d.id + '.json'), JSON.stringify(pack, null, 2) + '\n');
    console.log('wrote packs/' + d.id + '.json ' + pack.packHash.slice(0, 12) + ' actual=' + JSON.stringify(pack.actual));
  }
})().catch((e) => { console.error(e.message); process.exit(1); });
