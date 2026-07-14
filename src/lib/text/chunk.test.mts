import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chunkText } from './chunk.ts';

test('chunkText: empty/whitespace input returns no chunks', () => {
  assert.deepEqual(chunkText(''), []);
  assert.deepEqual(chunkText('   \n\n  '), []);
});

test('chunkText: short text stays in a single chunk', () => {
  const text = 'Hello world. This is a short sentence.';
  assert.deepEqual(chunkText(text, 600), [text]);
});

test('chunkText: every chunk stays within targetChars * 1.4 hard cap', () => {
  const sentence = 'This is a sentence with a reasonable number of words in it. ';
  const text = sentence.repeat(40);
  const target = 200;
  const chunks = chunkText(text, target);
  assert.ok(chunks.length > 1, 'expected multiple chunks');
  for (const chunk of chunks) {
    assert.ok(chunk.length <= target * 1.4 + 1, `chunk exceeded hard cap: ${chunk.length} chars`);
  }
});

test('chunkText: never splits a word in half', () => {
  const text = 'supercalifragilisticexpialidocious '.repeat(30).trim();
  const chunks = chunkText(text, 50);
  const words = text.split(/\s+/);
  for (const chunk of chunks) {
    for (const token of chunk.split(/\s+/)) {
      assert.ok(words.includes(token), `unexpected word fragment: "${token}"`);
    }
  }
});

test('chunkText: preserves all non-whitespace content across chunks', () => {
  const text =
    'First paragraph with a couple of sentences. Here is the second one.\n\n' +
    'Second paragraph, also with content. And a bit more text to push size up.';
  const chunks = chunkText(text, 60);
  const rejoined = chunks.join(' ').replace(/\s+/g, '');
  const original = text.replace(/\s+/g, '');
  assert.equal(rejoined, original);
});

test('chunkText: a single pathologically long "sentence" (no punctuation) still gets split', () => {
  const text = Array.from({ length: 100 }, (_, i) => `word${i}`).join(' ');
  const chunks = chunkText(text, 50);
  assert.ok(chunks.length > 1);
  for (const chunk of chunks) {
    assert.ok(chunk.length <= 50 * 1.4 + 10);
  }
});
