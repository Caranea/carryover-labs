import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { namedForm, specimenClass } from './specimens.js';

describe('specimenClass', () => {
  it('names other body fluids in Polish, German and English', () => {
    for (const text of ['Urine', 'Mocz', 'badanie moczu', 'Harn', 'Spontanharn', 'urinalysis'])
      assert.equal(specimenClass(text), 'urine', text);
    for (const text of ['Kał', 'badanie kału', 'Stuhl', 'Stool', 'faeces'])
      assert.equal(specimenClass(text), 'stool', text);
    assert.equal(specimenClass('Liquor'), 'CSF');
  });

  it('keeps blood tests whose names start like a fluid on the blood line', () => {
    for (const text of [
      'Kalium',
      'Kalzium',
      'Harnstoff',
      'Harnsäure',
      'Mocznik',
      'Kwas moczowy',
      'Serum',
      'Klinische Chemie',
    ])
      assert.equal(specimenClass(text), null, text);
  });
});

describe('namedForm', () => {
  it('separates forms that must not share a chart line', () => {
    assert.equal(namedForm('Calcium ionisiert'), 'ionized');
    assert.equal(namedForm('Wapń zjonizowany'), 'ionized');
    assert.equal(namedForm('Ionized calcium'), 'ionized');
    assert.equal(namedForm('Wapń całkowity'), 'total');
    assert.equal(namedForm('Bilirubin direkt'), 'direct');
    assert.equal(namedForm('Bilirubina bezpośrednia'), 'direct');
    assert.equal(namedForm('Bilirubin, indirect'), 'indirect');
    assert.equal(namedForm('Bilirubina pośrednia'), 'indirect');
    assert.equal(namedForm('fT4 (wolna tyroksyna)'), 'free');
    assert.equal(namedForm('Freies T4'), 'free');
    assert.equal(namedForm('Gesamtbilirubin'), null);
    assert.equal(namedForm('Kalium'), null);
  });
});
