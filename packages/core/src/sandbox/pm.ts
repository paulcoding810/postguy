/**
 * Postman `pm.*` compatibility layer, evaluated inside the sandbox after the flow/env globals.
 * Covers the common subset of pm.test / pm.expect / pm.response / pm.request / variable scopes.
 */
export const PM_PRELUDE = String.raw`
const __pmFmt = (v) => { try { return typeof v === 'string' ? JSON.stringify(v) : JSON.stringify(v) ?? String(v); } catch (e) { return String(v); } };
const __typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);
const __deepEq = (a, b) => { try { return JSON.stringify(a) === JSON.stringify(b); } catch (e) { return a === b; } };
const __expect = (actual, negate) => {
  const check = (pass, msg) => { if (negate ? pass : !pass) throw new Error('expected ' + __pmFmt(actual) + ' to ' + (negate ? 'not ' : '') + msg); return api; };
  const api = {
    get to() { return api; }, get be() { return api; }, get been() { return api; }, get have() { return api; }, get has() { return api; },
    get that() { return api; }, get and() { return api; }, get is() { return api; }, get deep() { return api; }, get which() { return api; },
    get not() { return __expect(actual, !negate); },
    equal(v) { return check(actual === v, 'equal ' + __pmFmt(v)); },
    equals(v) { return api.equal(v); }, eq(v) { return api.equal(v); },
    eql(v) { return check(__deepEq(actual, v), 'deeply equal ' + __pmFmt(v)); },
    get ok() { return check(!!actual, 'be truthy'); },
    get true() { return check(actual === true, 'be true'); },
    get false() { return check(actual === false, 'be false'); },
    get null() { return check(actual === null, 'be null'); },
    get undefined() { return check(actual === undefined, 'be undefined'); },
    get exist() { return check(actual !== null && actual !== undefined, 'exist'); },
    get empty() { const n = actual == null ? 0 : typeof actual === 'object' && !Array.isArray(actual) ? Object.keys(actual).length : actual.length; return check(n === 0, 'be empty'); },
    a(type) { return check(__typeOf(actual) === String(type).toLowerCase(), 'be a ' + type); },
    an(type) { return api.a(type); },
    include(v) {
      const pass = typeof actual === 'string' ? actual.includes(v) : Array.isArray(actual) ? actual.some((x) => __deepEq(x, v)) : actual && typeof v === 'object' ? Object.keys(v).every((k) => __deepEq(actual[k], v[k])) : false;
      return check(pass, 'include ' + __pmFmt(v));
    },
    includes(v) { return api.include(v); }, contain(v) { return api.include(v); }, contains(v) { return api.include(v); },
    above(n) { return check(actual > n, 'be above ' + n); }, greaterThan(n) { return api.above(n); }, gt(n) { return api.above(n); },
    below(n) { return check(actual < n, 'be below ' + n); }, lessThan(n) { return api.below(n); }, lt(n) { return api.below(n); },
    least(n) { return check(actual >= n, 'be at least ' + n); }, gte(n) { return api.least(n); },
    most(n) { return check(actual <= n, 'be at most ' + n); }, lte(n) { return api.most(n); },
    within(a, b) { return check(actual >= a && actual <= b, 'be within ' + a + '..' + b); },
    oneOf(list) { return check(list.some((x) => __deepEq(x, actual)), 'be one of ' + __pmFmt(list)); },
    match(re) { return check(re.test(String(actual)), 'match ' + re); },
    property(name, value) {
      const has = actual != null && Object.prototype.hasOwnProperty.call(Object(actual), name);
      if (arguments.length < 2) return check(has, 'have property ' + JSON.stringify(name));
      return check(has && __deepEq(actual[name], value), 'have property ' + JSON.stringify(name) + ' of ' + __pmFmt(value));
    },
    lengthOf(n) { return check(actual != null && actual.length === n, 'have length ' + n); },
    keys(...ks) { const list = ks.flat(); return check(actual != null && list.every((k) => k in Object(actual)), 'have keys ' + __pmFmt(list)); },
    status(code) { const s = actual && (actual.code ?? actual.status); return check(typeof code === 'number' ? s === code : actual && actual.status === code, 'have status ' + code); },
    header(name, value) {
      const h = actual && actual.headers && actual.headers.get ? actual.headers.get(name) : undefined;
      return arguments.length < 2 ? check(h !== undefined, 'have header ' + name) : check(h === value, 'have header ' + name + ' = ' + value);
    },
    jsonBody(path) { let b; try { b = actual.json(); } catch (e) { return check(false, 'have a JSON body'); } return path === undefined ? check(true, '') : check(path.split('.').reduce((o, k) => (o == null ? o : o[k]), b) !== undefined, 'have JSON at ' + path); },
  };
  return api;
};
const __headers = (obj) => ({
  get: (name) => { const k = Object.keys(obj).find((x) => x.toLowerCase() === String(name).toLowerCase()); return k === undefined ? undefined : obj[k]; },
  has: (name) => Object.keys(obj).some((x) => x.toLowerCase() === String(name).toLowerCase()),
  toObject: () => ({ ...obj }),
  add: (h) => { obj[h.key] = String(h.value); },
  upsert: (h) => { const k = Object.keys(obj).find((x) => x.toLowerCase() === String(h.key).toLowerCase()); obj[k ?? h.key] = String(h.value); },
  remove: (name) => { for (const k of Object.keys(obj)) if (k.toLowerCase() === String(name).toLowerCase()) delete obj[k]; },
  each: (fn) => { for (const [key, value] of Object.entries(obj)) fn({ key, value }); },
});
const __scope = (scope) => ({
  get: (k) => (scope === 'variables' ? flow.get(k) : __call('envGet', String(k))),
  set: (k, v) => { if (scope === 'variables') flow.set(k, v); else __call('envSet', String(k), v === undefined ? null : v, scope); },
  unset: (k) => { if (scope === 'variables') flow.set(k, null); else __call('envSet', String(k), null, scope); },
  has: (k) => (scope === 'variables' ? flow.get(k) : __call('envGet', String(k))) !== undefined,
  replaceIn: (s) => String(s).replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (m, k) => { const d = k[0] === '$' ? __call('dynamic', k) : undefined; const v = d !== undefined ? d : scope === 'variables' ? flow.get(k) : __call('envGet', k); return v === undefined ? m : String(v); }),
});
const __makeResponse = (r) => {
  const text = typeof r.body === 'string' ? r.body : JSON.stringify(r.body);
  const self = {
    code: r.status,
    status: r.statusText || String(r.status),
    responseTime: r.timeMs ?? 0,
    responseSize: encodeURIComponent(text ?? '').replace(/%[0-9A-F]{2}/g, '_').length,
    headers: __headers({ ...(r.headers || {}) }),
    json: () => (typeof r.body === 'string' ? JSON.parse(r.body) : r.body),
    text: () => text,
  };
  self.to = {
    have: {
      status(c) { __expect(self).to.have.status(c); },
      header(n, v) { if (arguments.length < 2) __expect(self).to.have.header(n); else __expect(self).to.have.header(n, v); },
      jsonBody(p) { __expect(self).to.have.jsonBody(p); },
      jsonSchema(schema) {
        const issues = __call('jsonSchema', schema, self.json());
        if (issues === null) throw new Error('expected a valid JSON Schema');
        if (issues.length) throw new Error('expected response to match the JSON Schema: ' + issues.slice(0, 3).map((i) => i.path + ' ' + i.message).join('; '));
      },
    },
    be: {
      get ok() { __expect(r.status >= 200 && r.status < 300).to.be.true; return true; },
      get success() { __expect(r.status >= 200 && r.status < 300).to.be.true; return true; },
      get error() { __expect(r.status >= 400).to.be.true; return true; },
      get clientError() { __expect(r.status >= 400 && r.status < 500).to.be.true; return true; },
      get serverError() { __expect(r.status >= 500).to.be.true; return true; },
      get json() { self.json(); return true; },
    },
  };
  return self;
};
const __pmResponse = response ? __makeResponse(response) : undefined;
const __sends = new Map();
let __sendSeq = 0;
const __bodyText = (b) => {
  if (b == null) return null;
  if (typeof b === 'string') return b;
  if (b.mode === 'raw') return b.raw == null ? null : typeof b.raw === 'string' ? b.raw : JSON.stringify(b.raw);
  if (b.mode === 'urlencoded') return __formEncode((Array.isArray(b.urlencoded) ? b.urlencoded : Object.entries(b.urlencoded || {}).map(([key, value]) => ({ key, value }))).map(__formItem));
  if (b.mode === 'graphql') return JSON.stringify({ query: b.graphql && b.graphql.query, variables: b.graphql && b.graphql.variables });
  throw new Error('pm.sendRequest supports raw, urlencoded and graphql bodies');
};
const __sendHeaders = (h) => {
  const out = {};
  if (Array.isArray(h)) for (const x of h) { if (x && !x.disabled) out[String(x.key)] = x.value == null ? '' : String(x.value); }
  else if (typeof h === 'string') for (const line of h.split('\n')) { const i = line.indexOf(':'); if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim(); }
  else for (const [k, v] of Object.entries(h || {})) out[k] = v == null ? '' : String(v);
  return out;
};
const __sendRequest = (req, callback) => {
  const r = typeof req === 'string' ? { url: req } : req || {};
  const url = typeof r.url === 'string' ? r.url : r.url && typeof r.url.toString === 'function' ? r.url.toString() : '';
  const headers = __sendHeaders(r.header || r.headers);
  if (r.body && r.body.mode === 'urlencoded' && !Object.keys(headers).some((k) => k.toLowerCase() === 'content-type')) headers['Content-Type'] = 'application/x-www-form-urlencoded';
  if (r.body && r.body.mode === 'graphql' && !Object.keys(headers).some((k) => k.toLowerCase() === 'content-type')) headers['Content-Type'] = 'application/json';
  return __queueSend({ method: String(r.method || 'GET').toUpperCase(), url, headers, body: __bodyText(r.body) }, 'pm.sendRequest', { callback: typeof callback === 'function' ? callback : null });
};
/** Hands a request to the host; it is sent once the script yields, and settled with __settleSend. */
const __queueSend = (req, via, opts) => {
  const id = ++__sendSeq;
  const done = new Promise((resolve, reject) => __sends.set(id, { resolve, reject, callback: opts.callback || null, raw: !!opts.raw }));
  __call('send', id, req, via);
  return done;
};
const __fetchResponse = (r, url) => {
  const text = typeof r.body === 'string' ? r.body : JSON.stringify(r.body);
  const lower = Object.fromEntries(Object.entries(r.headers || {}).map(([k, v]) => [k.toLowerCase(), v]));
  const unsupported = (what) => () => Promise.reject(new TypeError(what + ' is not available in Postguy scripts; use text() or json()'));
  return {
    ok: r.status >= 200 && r.status < 300,
    status: r.status,
    statusText: r.statusText || '',
    url,
    redirected: false,
    headers: { get: (n) => lower[String(n).toLowerCase()] ?? null, has: (n) => String(n).toLowerCase() in lower, forEach: (fn) => Object.entries(lower).forEach(([k, v]) => fn(v, k)), entries: () => Object.entries(lower)[Symbol.iterator]() },
    text: () => Promise.resolve(text),
    json: () => Promise.resolve(typeof r.body === 'string' ? JSON.parse(r.body) : r.body),
    blob: unsupported('blob()'),
    arrayBuffer: unsupported('arrayBuffer()'),
    formData: unsupported('formData()'),
  };
};
/** The common part of the browser fetch: url, method, headers and a string body; resolves even for error statuses. */
const fetch = (input, init) => {
  const opts = init || {};
  if (opts.signal) return Promise.reject(new TypeError('AbortController is not available in Postguy scripts'));
  const url = typeof input === 'string' ? input : input && typeof input.url === 'string' ? input.url : String(input);
  const h = opts.headers || {};
  const headers = Array.isArray(h) ? Object.fromEntries(h.map(([k, v]) => [String(k), String(v)])) : Object.fromEntries(Object.entries(h).map(([k, v]) => [k, String(v)]));
  if (opts.body != null && typeof opts.body !== 'string') return Promise.reject(new TypeError('fetch in Postguy scripts takes a string body; use JSON.stringify(...)'));
  return __queueSend({ method: String(opts.method || 'GET').toUpperCase(), url, headers, body: opts.body == null ? null : opts.body }, 'fetch', { raw: true }).then(
    (r) => __fetchResponse(r, url),
    (e) => { throw new TypeError('Failed to fetch: ' + e.message); },
  );
};
/** Called by the host when a request sent with pm.sendRequest finishes. */
globalThis.__settleSend = (id, error, res) => {
  const s = __sends.get(id);
  if (!s) return;
  __sends.delete(id);
  if (s.raw) return error ? s.reject(new Error(error)) : s.resolve(res);
  const response = res ? __makeResponse(res) : null;
  if (s.callback) {
    try { s.callback(error ? new Error(error) : null, response); } catch (e) { __failures.push(e); }
    s.resolve(response);
  } else if (error) s.reject(new Error(error));
  else s.resolve(response);
};
const __formDecodePart = (s) => { try { return decodeURIComponent(s.replace(/\+/g, ' ')); } catch (e) { return s; } };
const __formDecode = (text) => text.split('&').filter(Boolean).map((p) => { const i = p.indexOf('='); return { key: __formDecodePart(i < 0 ? p : p.slice(0, i)), value: i < 0 ? '' : __formDecodePart(p.slice(i + 1)) }; });
const __formItem = (p) => ({ key: String(p.key), value: p.value == null ? '' : typeof p.value === 'string' ? p.value : String(p.value), ...(p.disabled ? { disabled: true } : {}) });
const __formEncode = (list) => list.filter((p) => !p.disabled).map((p) => encodeURIComponent(p.key) + '=' + encodeURIComponent(p.value)).join('&');
const __pmRequest = request ? {
  get url() { return { toString: () => request.url }; },
  set url(v) { request.url = String(v); },
  get method() { return request.method; },
  set method(v) { request.method = String(v).toUpperCase(); },
  headers: __headers(request.headers),
  body: {
    get raw() { return request.body; },
    set raw(v) { request.body = v == null ? null : typeof v === 'string' ? v : JSON.stringify(v); },
    get mode() { return request.bodyMode === 'formdata' || request.bodyMode === 'file' ? request.bodyMode : request.body == null ? 'none' : (request.bodyMode || 'raw'); },
    get urlencoded() {
      const list = request.bodyMode === 'urlencoded' && request.body ? __formDecode(String(request.body)) : [];
      const save = () => { request.body = __formEncode(list); request.bodyMode = 'urlencoded'; };
      const find = (k) => list.findIndex((p) => p.key === k);
      const put = (p) => Array.prototype.push.call(list, __formItem(p));
      const methods = {
        add(p) { put(p); save(); },
        append(p) { put(p); save(); },
        push(...ps) { ps.forEach(put); save(); return list.length; },
        upsert(p) { const i = find(String(p.key)); if (i < 0) put(p); else list[i] = __formItem(p); save(); },
        remove(k) { const keep = list.filter((p) => !(typeof k === 'function' ? k(p) : p.key === (k && typeof k === 'object' ? k.key : k))); list.length = 0; keep.forEach((p) => Array.prototype.push.call(list, p)); save(); },
        clear() { list.length = 0; save(); },
        get(k) { const i = find(k); return i < 0 ? undefined : list[i].value; },
        one(k) { const i = find(k); return i < 0 ? undefined : list[i]; },
        has(k) { return find(k) >= 0; },
        all() { return list.slice(); },
        count() { return list.length; },
        each(fn) { list.forEach(fn); },
        toObject() { return Object.fromEntries(list.filter((p) => !p.disabled).map((p) => [p.key, p.value])); },
      };
      for (const [k, f] of Object.entries(methods)) Object.defineProperty(list, k, { value: f, enumerable: false });
      return list;
    },
    get formdata() { return request.bodyMode === 'formdata' ? (request.formdata || []).map((p) => ({ ...p })) : []; },
    isEmpty() { return request.bodyMode === 'file' ? false : request.bodyMode === 'formdata' ? !(request.formdata || []).length : request.body == null || request.body === ''; },
    toString() { return request.body ?? ''; },
    toJSON() {
      const mode = this.mode;
      if (mode === 'none') return {};
      if (mode === 'urlencoded') return { mode, urlencoded: this.urlencoded.all() };
      if (mode === 'formdata') return { mode, formdata: this.formdata };
      if (mode === 'file') return { mode, file: { src: request.file ? request.file.src : '' } };
      return { mode, raw: request.body };
    },
    update(o) {
      const contentType = (type) => { if (!__headers(request.headers).has('content-type')) request.headers['Content-Type'] = type; };
      if (o == null) { request.body = null; request.bodyMode = undefined; return; }
      if (typeof o === 'string') { request.body = o; return; }
      if (o.mode == null && o.raw === undefined) { request.body = null; request.bodyMode = undefined; return; }
      const mode = o.mode ?? 'raw';
      if (mode === 'raw') {
        request.body = o.raw == null ? '' : typeof o.raw === 'string' ? o.raw : JSON.stringify(o.raw);
        const lang = o.options && o.options.raw && o.options.raw.language;
        const types = { json: 'application/json', xml: 'application/xml', html: 'text/html', text: 'text/plain', javascript: 'application/javascript' };
        if (lang && types[lang]) contentType(types[lang]);
        return;
      }
      if (mode === 'urlencoded') {
        const u = o.urlencoded;
        const list = Array.isArray(u) ? u
          : u && typeof u.all === 'function' ? u.all()
          : u ? Object.entries(u).map(([key, value]) => ({ key, value }))
          : typeof o.raw === 'string' ? __formDecode(o.raw) : [];
        request.body = __formEncode(list.filter((p) => p && p.key != null).map(__formItem));
        request.bodyMode = 'urlencoded';
        return;
      }
      if (mode === 'graphql') {
        const g = o.graphql || {};
        let variables = g.variables || {};
        if (typeof variables === 'string') { try { variables = JSON.parse(variables || '{}'); } catch (e) { throw new Error('pm.request.body.update: graphql variables are not valid JSON'); } }
        request.body = JSON.stringify({ query: g.query || '', variables });
        contentType('application/json');
        return;
      }
      if (mode === 'formdata' && request.bodyMode === 'formdata' && JSON.stringify(o.formdata || []) === JSON.stringify(request.formdata || [])) return;
      if (mode === 'file' && request.bodyMode === 'file' && o.file && request.file && o.file.src === request.file.src) return;
      if (mode === 'formdata' || mode === 'file') throw new Error('pm.request.body.update: ' + mode + ' bodies cannot be set from a script; use raw or urlencoded');
      throw new Error('pm.request.body.update: unknown mode ' + JSON.stringify(mode));
    },
  },
} : undefined;
/** chai's expect, plus expect.fail(message) and expect.fail(actual, expected, message, operator). */
const __pmExpect = (v) => __expect(v, false);
__pmExpect.fail = function (actual, expected, message, operator) {
  if (arguments.length <= 1) throw new Error(actual === undefined ? 'expect.fail()' : String(actual));
  throw new Error(message !== undefined ? String(message) : 'expected ' + __pmFmt(actual) + ' to ' + (operator ?? 'not equal') + ' ' + __pmFmt(expected));
};
const pm = Object.freeze({
  environment: __scope('environment'),
  globals: __scope('globals'),
  collectionVariables: __scope('collection'),
  variables: __scope('variables'),
  response: __pmResponse,
  request: __pmRequest,
  expect: __pmExpect,
  test: Object.assign((name, fn) => {
    try { fn(); __call('assert', true, String(name)); }
    catch (e) { __call('assert', false, String(name) + ': ' + (e && e.message ? e.message : String(e))); }
  }, { skip: (name) => { __call('log', 'info', 'Skipped test: ' + String(name)); } }),
  cookies: Object.freeze({
    get: (name) => { const c = __call('cookies').find((x) => x.name === name); return c ? c.value : undefined; },
    has: (name) => __call('cookies').some((x) => x.name === name),
    toObject: () => Object.fromEntries(__call('cookies').map((x) => [x.name, x.value])),
    all: () => __call('cookies'),
  }),
  sendRequest: __sendRequest,
  info: { requestName: '', eventName: response ? 'test' : 'prerequest', iteration: 0 },
});
const postman = Object.freeze({
  setEnvironmentVariable: (k, v) => pm.environment.set(k, v),
  getEnvironmentVariable: (k) => pm.environment.get(k),
  setGlobalVariable: (k, v) => pm.globals.set(k, v),
  getGlobalVariable: (k) => pm.globals.get(k),
});
const tests = new Proxy({}, { set: (t, k, v) => { __call('assert', !!v, String(k)); t[k] = v; return true; } });
const responseBody = response ? (typeof response.body === 'string' ? response.body : JSON.stringify(response.body)) : undefined;
const responseCode = response ? { code: response.status } : undefined;
`;
