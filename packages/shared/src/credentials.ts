const CREDENTIAL = /(password|passwd|pwd|secret|token|api[-_]?key|apikey|private[-_]?key|client[-_]?secret|credential|session[-_]?id|cookie|auth)/i;
/** Names that describe a credential rather than hold one, e.g. token_type, expires_in, auth_url. */
const DESCRIPTIVE = /(type|kind|expires?(_?in|_?at|_?on)?|expiry|ttl|lifetime|scopes?|url|uri|endpoint|host|count|length|header|method|mode|name|user(name)?|e?mail)$/i;

/** True when a variable with this name and value looks like a credential that should be marked secret. */
export function looksLikeCredential(key: string, value: string): boolean {
  const v = value.trim();
  if (!v || /^\{\{[^{}]+\}\}$/.test(v)) return false;
  return CREDENTIAL.test(key) && !DESCRIPTIVE.test(key);
}
