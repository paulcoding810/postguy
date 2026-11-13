import { createHash, createHmac, randomBytes } from 'node:crypto';

type Encoding = 'hex' | 'base64' | 'base64url' | 'utf8' | 'latin1';
const ENCODINGS = new Set<Encoding>(['hex', 'base64', 'base64url', 'utf8', 'latin1']);
const HASHES = new Set(['md5', 'sha1', 'sha224', 'sha256', 'sha384', 'sha512', 'sha3-224', 'sha3-256', 'sha3-384', 'sha3-512']);

function encoding(e: unknown): Encoding {
  if (!ENCODINGS.has(e as Encoding)) throw new Error(`Unknown encoding ${String(e)}`);
  return e as Encoding;
}

function algorithm(a: unknown): string {
  if (!HASHES.has(String(a))) throw new Error(`Unknown hash ${String(a)}`);
  return String(a);
}

/** Host side of the sandbox's CryptoJS, btoa and atob. Byte strings cross as hex. */
export function hostCrypto(op: string, args: unknown[]): string {
  switch (op) {
    case 'toHex':
      return Buffer.from(String(args[1]), encoding(args[0])).toString('hex');
    case 'fromHex':
      return Buffer.from(String(args[1]), 'hex').toString(encoding(args[0]));
    case 'hash':
      return createHash(algorithm(args[0])).update(Buffer.from(String(args[1]), 'hex')).digest('hex');
    case 'hmac':
      return createHmac(algorithm(args[0]), Buffer.from(String(args[2]), 'hex')).update(Buffer.from(String(args[1]), 'hex')).digest('hex');
    case 'random':
      return randomBytes(Math.min(Math.max(0, Number(args[0]) || 0), 1024)).toString('hex');
    case 'btoa': {
      const s = String(args[0]);
      if (/[^\u0000-ÿ]/.test(s)) throw new Error("btoa: the string contains characters outside of the Latin1 range");
      return Buffer.from(s, 'latin1').toString('base64');
    }
    case 'atob':
      return Buffer.from(String(args[0]), 'base64').toString('latin1');
    default:
      throw new Error(`Unknown crypto operation ${op}`);
  }
}

/** CryptoJS subset: hashes, HMAC, encoders and random words. Ciphers are not available. */
export const CRYPTO_PRELUDE = `
const __wa = (hex) => ({
  __hex: hex,
  get sigBytes() { return this.__hex.length / 2; },
  toString(enc) { return (enc || CryptoJS.enc.Hex).stringify(this); },
  concat(other) { this.__hex += __toWa(other).__hex; return this; },
  clone() { return __wa(this.__hex); },
});
const __toWa = (v) => (v && typeof v === 'object' && typeof v.__hex === 'string' ? v : __wa(__call('crypto', 'toHex', 'utf8', v == null ? '' : String(v))));
const __enc = (name) => Object.freeze({ stringify: (wa) => __call('crypto', 'fromHex', name, __toWa(wa).__hex), parse: (s) => __wa(__call('crypto', 'toHex', name, String(s))) });
const __hash = (algo) => (msg) => __wa(__call('crypto', 'hash', algo, __toWa(msg).__hex));
const __hmac = (algo) => (msg, key) => __wa(__call('crypto', 'hmac', algo, __toWa(msg).__hex, __toWa(key).__hex));
const __noCipher = (name) => ({ get() { throw new Error('CryptoJS.' + name + ' is not available in Postguy; hashes, HMAC and encoders are'); } });
const CryptoJS = Object.freeze(Object.defineProperties({
  MD5: __hash('md5'), SHA1: __hash('sha1'), SHA224: __hash('sha224'), SHA256: __hash('sha256'), SHA384: __hash('sha384'), SHA512: __hash('sha512'), SHA3: __hash('sha3-512'),
  HmacMD5: __hmac('md5'), HmacSHA1: __hmac('sha1'), HmacSHA224: __hmac('sha224'), HmacSHA256: __hmac('sha256'), HmacSHA384: __hmac('sha384'), HmacSHA512: __hmac('sha512'), HmacSHA3: __hmac('sha3-512'),
  enc: Object.freeze({ Hex: Object.freeze({ stringify: (wa) => __toWa(wa).__hex, parse: (s) => __wa(String(s).toLowerCase()) }), Base64: __enc('base64'), Base64url: __enc('base64url'), Utf8: __enc('utf8'), Latin1: __enc('latin1') }),
  lib: Object.freeze({ WordArray: Object.freeze({ random: (n) => __wa(__call('crypto', 'random', n)), create: () => __wa('') }) }),
}, { AES: __noCipher('AES'), DES: __noCipher('DES'), TripleDES: __noCipher('TripleDES'), Rabbit: __noCipher('Rabbit'), RC4: __noCipher('RC4'), PBKDF2: __noCipher('PBKDF2') }));
const btoa = (s) => __call('crypto', 'btoa', String(s));
const atob = (s) => __call('crypto', 'atob', String(s));
const require = (name) => {
  if (name === 'crypto-js') return CryptoJS;
  throw new Error("require('" + name + "') is not available in Postguy; only 'crypto-js' (hashes, HMAC, encoders) is");
};
`;
