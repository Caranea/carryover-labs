// Explicit, tiny paid-inference check. Only the invented strings below leave this process.
import assert from 'node:assert/strict';
import { loadConfig } from '../dist/config.js';
import { CATALOGUE } from '../dist/records/catalogue.js';
import { MuseSpark } from '../dist/records/muse.js';
import { mapNamesTask } from '../dist/records/prompts.js';

if (!process.argv.includes('--live')) {
  console.error('This check calls your configured provider with fictional test names. Run with --live to enable it.');
  process.exitCode = 2;
} else {
  const config = loadConfig();
  assert.ok(config.models.length, 'Configure a Meta/Baseten model key before the live check.');
  const names = [
    { name: 'synthetic-en', printedName: 'Thryeotropin', unit: 'mIU/L', value: '2.4' },
    { name: 'synthetic-de', printedName: 'Thyreotropes Hormon', unit: 'mIU/L', value: '2.4' },
    { name: 'synthetic-pl', printedName: 'Stężenie tyreotropiny', unit: 'mIU/L', value: '2,4' },
  ];
  const started = performance.now();
  const answer = await new MuseSpark(config.models).ask(mapNamesTask(names, CATALOGUE));
  for (const row of names) {
    const mapped = answer.answers.find(a => a.name === row.printedName);
    assert.equal(mapped?.key, 'tsh', `Unexpected mapping for the fictional ${row.name} row`);
    assert.equal(mapped?.notATest, false);
  }
  console.log(JSON.stringify({ fixture: 'invented-multilingual-tsh', passed: names.length, milliseconds: Math.round(performance.now() - started), schemaValidated: true }));
}
