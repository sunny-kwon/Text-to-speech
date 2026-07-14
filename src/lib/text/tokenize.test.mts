import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenizeWords, wordIndexAtCharOffset, wordIndexAtCharOffsetFromTokens } from './tokenize.ts';

test('tokenizeWords: reconstructing all tokens reproduces the original text exactly', () => {
  const text = 'Hello  world, this is  a test.\nSecond line.';
  const tokens = tokenizeWords(text);
  assert.equal(tokens.map((t) => t.text).join(''), text);
});

test('tokenizeWords: isWord correctly distinguishes word runs from whitespace runs', () => {
  const tokens = tokenizeWords('a  b');
  assert.deepEqual(
    tokens.map((t) => t.isWord),
    [true, false, true],
  );
});

test('wordIndexAtCharOffset: maps char offsets at word starts to the expected word index', () => {
  const text = 'Hello  world, this is  a test.';
  const cases: Array<[number, number]> = [
    [0, 0], // "Hello"
    [7, 1], // "world,"
    [14, 2], // "this"
    [19, 3], // "is"
    [23, 4], // "a"
    [25, 5], // "test."
  ];
  for (const [charIndex, expected] of cases) {
    assert.equal(wordIndexAtCharOffset(text, charIndex), expected, `charIndex=${charIndex}`);
  }
});

test('wordIndexAtCharOffset: mid-word offset resolves to that word', () => {
  const text = 'Hello world';
  assert.equal(wordIndexAtCharOffset(text, 2), 0);
});

test('wordIndexAtCharOffset: offset past the end resolves to the last word', () => {
  const text = 'Hello world';
  assert.equal(wordIndexAtCharOffset(text, 999), 1);
});

test('wordIndexAtCharOffset: empty text resolves to -1 (no words)', () => {
  assert.equal(wordIndexAtCharOffset('', 0), -1);
});

test('wordIndexAtCharOffsetFromTokens: matches wordIndexAtCharOffset for the same text/offsets', () => {
  const text = 'Hello  world, this is  a test.';
  const tokens = tokenizeWords(text);
  for (let charIndex = 0; charIndex < text.length; charIndex++) {
    assert.equal(wordIndexAtCharOffsetFromTokens(tokens, charIndex), wordIndexAtCharOffset(text, charIndex));
  }
});
