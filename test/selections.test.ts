import { test } from 'node:test';
import assert from 'node:assert/strict';
import { conversionRanges } from '../src/selections';

test('empty cursors convert the full document; an empty document needs no job', () => {
  assert.deepEqual(conversionRanges(20, [{ start: 4, end: 4 }, { start: 10, end: 10 }]), [{ start: 0, end: 20 }]);
  assert.deepEqual(conversionRanges(0, [{ start: 0, end: 0 }]), []);
});

test('selected text excludes empty cursors and merges overlapping ranges once', () => {
  assert.deepEqual(conversionRanges(50, [
    { start: 15, end: 30 }, { start: 4, end: 20 }, { start: 7, end: 7 }, { start: 6, end: 10 },
    { start: 35, end: 40 }, { start: 4, end: 20 },
  ]), [{ start: 4, end: 30 }, { start: 35, end: 40 }]);
});

test('adjacent independent selections stay separate, so words cannot match across them', () => {
  const selections = [{ start: 2, end: 4 }, { start: 0, end: 2 }];
  assert.deepEqual(conversionRanges(8, selections), [{ start: 0, end: 2 }, { start: 2, end: 4 }]);
  assert.deepEqual(selections, [{ start: 2, end: 4 }, { start: 0, end: 2 }]);
});
