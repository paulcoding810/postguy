const h = (name: string, value: string) => ({ name, value });

/** A Chrome-style recording: a page, assets, API calls (one repeated), a form post and a multipart upload. */
export function sampleHar() {
  const api = 'https://api.shop.test';
  const entry = (resourceType: string, method: string, url: string, extra: Record<string, unknown> = {}, response: Record<string, unknown> = {}) => ({
    _resourceType: resourceType,
    startedDateTime: '2026-11-20T10:00:00.000Z',
    time: 12,
    request: {
      method,
      url,
      httpVersion: 'HTTP/2',
      headers: [h(':authority', 'api.shop.test'), h('accept', 'application/json'), h('cookie', 'sid=1'), h('sec-fetch-mode', 'cors'), h('user-agent', 'Chrome'), h('authorization', 'Bearer tok-123'), h('x-tenant', 'acme')],
      queryString: [],
      ...extra,
    },
    response: { status: 200, statusText: 'OK', headers: [], content: { size: 20, mimeType: 'application/json', text: '{"data":{"id":7}}' }, ...response },
  });
  return {
    log: {
      version: '1.2',
      creator: { name: 'WebInspector', version: '537.36' },
      pages: [{ id: 'page_1', title: 'Shop admin' }],
      entries: [
        entry('document', 'GET', 'https://shop.test/admin', {}, { content: { mimeType: 'text/html', text: '<html>' } }),
        entry('script', 'GET', 'https://shop.test/app.js', {}, { content: { mimeType: 'application/javascript', text: '' } }),
        entry('image', 'GET', 'https://shop.test/logo.png', {}, { content: { mimeType: 'image/png', text: 'AAA', encoding: 'base64' } }),
        entry('fetch', 'GET', `${api}/users/7?expand=orders&page=2`),
        entry('fetch', 'GET', `${api}/users/7?expand=orders&page=2`),
        entry('xhr', 'POST', `${api}/orders`, { postData: { mimeType: 'application/json', text: '{"sku":"A1","qty":2}' } }, { status: 201, content: { mimeType: 'application/json', text: '{"id":"ord_1"}' } }),
        entry('fetch', 'POST', `${api}/login`, { postData: { mimeType: 'application/x-www-form-urlencoded', params: [{ name: 'user', value: 'ann' }, { name: 'pass', value: 'p w' }] } }),
        entry('fetch', 'POST', 'https://files.shop.test/upload', {
          postData: { mimeType: 'multipart/form-data; boundary=x', params: [{ name: 'title', value: 'Cat' }, { name: 'file', fileName: 'cat.png' }] },
          headers: [h('content-type', 'multipart/form-data; boundary=x'), h('authorization', 'Basic YTpi')],
        }),
        entry('fetch', 'GET', 'chrome-extension://abc/x.json'),
      ],
    },
  };
}
