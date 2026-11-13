import { describe, expect, it } from 'vitest';
import { applyUrlInput, displayUrl, pathParamNames, syncPathParams, urlBarText } from './url';

const kv = (key: string, value: string, enabled = true) => ({ id: key, key, value, enabled });

describe('url sync', () => {
  it('splits typed query into params and keeps disabled ones', () => {
    const r = applyUrlInput('{{base}}/a?x=1&y=&z', [kv('x', '0'), kv('off', 'v', false)]);
    expect(r.url).toBe('{{base}}/a');
    expect(r.params.map((p) => [p.key, p.value, p.enabled])).toEqual([
      ['x', '1', true],
      ['y', '', true],
      ['z', '', true],
      ['off', 'v', false],
    ]);
    expect(r.params[0]!.id).toBe('x');
  });

  it('renders enabled params into the display URL', () => {
    expect(displayUrl('http://h/a', [kv('a', '1'), kv('b', '', true), kv('c', '3', false)])).toBe('http://h/a?a=1&b');
    expect(displayUrl('http://h/a', [])).toBe('http://h/a');
  });

  it('finds path params but not ports or schemes', () => {
    expect(pathParamNames('http://localhost:8080/users/:id/orders/:orderId')).toEqual(['id', 'orderId']);
    expect(pathParamNames('{{baseUrl}}/users/:id')).toEqual(['id']);
    expect(pathParamNames('http://localhost:8080')).toEqual([]);
  });

  it('keeps values of existing path params', () => {
    const r = syncPathParams('/users/:id/x/:other', [kv('id', '7'), kv('gone', '1')]);
    expect(r.map((p) => [p.key, p.value])).toEqual([
      ['id', '7'],
      ['other', ''],
    ]);
  });
});

describe('urlBarText', () => {
  it('keeps a typed "?" and "&" while typing a query key by key', () => {
    let url = '';
    let params: ReturnType<typeof applyUrlInput>['params'] = [];
    let text = '';
    for (const ch of 'http://x/echo?a=1&b=2') {
      const typed = urlBarText(text, url, params) + ch;
      ({ url, params } = applyUrlInput(typed, params));
      text = urlBarText(typed, url, params);
    }
    expect(text).toBe('http://x/echo?a=1&b=2');
    expect(params.map((p) => [p.key, p.value])).toEqual([['a', '1'], ['b', '2']]);
  });
  it('shows the stored URL when it changed elsewhere', () => {
    expect(urlBarText('http://x/a?', 'http://x/a', [kv('q', '1')])).toBe('http://x/a?q=1');
    expect(urlBarText(null, 'http://x/a', [])).toBe('http://x/a');
  });
});
