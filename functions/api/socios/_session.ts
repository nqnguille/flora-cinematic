// Cookie de sesión firmada con HMAC-SHA256 (sin estado en servidor, solo whitelist en KV).
const COOKIE_NAME = 'flora_socio';
const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 días

function toHex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function b64urlEncode(str: string): string {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(str: string): string {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  return atob(b64);
}

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return toHex(sig);
}

export async function createSessionCookie(email: string, secret: string): Promise<string> {
  const expires = Date.now() + TTL_MS;
  const payloadB64 = b64urlEncode(JSON.stringify({ email, expires }));
  const sig = await hmac(secret, payloadB64);
  const value = `${payloadB64}.${sig}`;
  return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${TTL_MS / 1000}`;
}

export function clearSessionCookie(): string {
  return `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export async function readSessionEmail(cookieHeader: string | null, secret: string): Promise<string | null> {
  if (!cookieHeader) return null;
  const match = cookieHeader.match(new RegExp(`${COOKIE_NAME}=([^;]+)`));
  if (!match) return null;

  const parts = match[1].split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, sig] = parts;

  const expected = await hmac(secret, payloadB64);
  if (expected !== sig) return null;

  let payload: { email: string; expires: number };
  try {
    payload = JSON.parse(b64urlDecode(payloadB64));
  } catch {
    return null;
  }
  if (Date.now() > payload.expires) return null;

  return payload.email;
}
