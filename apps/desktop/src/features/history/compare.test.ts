import { describe, expect, it } from 'vitest';
import { comparableBody, headersText } from './compare';

describe('comparableBody', () => {
  it('sorts keys at every level so key order is not a difference', () => {
    expect(comparableBody('{"b":1,"a":{"d":[{"z":1,"y":2}],"c":0}}').text).toBe(comparableBody('{"a":{"c":0,"d":[{"y":2,"z":1}]},"b":1}').text);
    expect(comparableBody('{"b":1,"a":2}')).toEqual({ text: '{\n  "a": 2,\n  "b": 1\n}', json: true });
  });
  it('keeps non-JSON text and handles empty bodies', () => {
    expect(comparableBody('plain')).toEqual({ text: 'plain', json: false });
    expect(comparableBody(null)).toEqual({ text: '', json: false });
  });
});

describe('headersText', () => {
  it('lists headers sorted, lower-cased', () => {
    expect(headersText({ 'X-B': '2', 'content-type': 'json', A: '1' })).toBe('a: 1\ncontent-type: json\nx-b: 2');
  });
});
