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

// floraong.ar y www.floraong.ar sirven el mismo sitio sin redirect entre sí
// (los dos devuelven 200 directo) — sin Domain, la cookie queda host-only y
// una sesión iniciada en uno no vale en el otro (el "deslogueo random" que
// reportó Guille). En local/preview (*.pages.dev, localhost) NO se puede
// setear Domain=floraong.ar — el browser rechaza cualquier Domain que no sea
// el host actual o un padre de ese host — por eso el atributo es condicional.
function domainAttr(hostname: string): string {
  return hostname === 'floraong.ar' || hostname.endsWith('.floraong.ar')
    ? '; Domain=floraong.ar'
    : '';
}

export async function createSessionCookie(email: string, secret: string, hostname: string): Promise<string> {
  const expires = Date.now() + TTL_MS;
  const payloadB64 = b64urlEncode(JSON.stringify({ email, expires }));
  const sig = await hmac(secret, payloadB64);
  const value = `${payloadB64}.${sig}`;
  return `${COOKIE_NAME}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${TTL_MS / 1000}${domainAttr(hostname)}`;
}

// Devuelve LAS DOS variantes (host-only y Domain=floraong.ar) para borrar en
// el mismo logout — sesiones creadas antes de que existiera domainAttr()
// quedaron como cookie host-only; si solo mandamos el clear con Domain, esa
// cookie vieja nunca se borra y la sesión sigue viva.
export function clearSessionCookie(hostname: string): string[] {
  const base = `${COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
  const withDomain = domainAttr(hostname);
  return withDomain ? [base, `${base}${withDomain}`] : [base];
}

export async function readSessionEmail(cookieHeader: string | null, secret: string): Promise<string | null> {
  if (!cookieHeader) return null;
  // Puede haber DOS cookies "flora_socio" a la vez (una host-only vieja +
  // una Domain=floraong.ar nueva) — el browser manda las dos en el mismo
  // header y la del medio no necesariamente es la válida. Probamos todas
  // las que aparezcan, no solo la primera.
  const matches = [...cookieHeader.matchAll(new RegExp(`${COOKIE_NAME}=([^;]+)`, 'g'))];
  for (const match of matches) {
    const parts = match[1].split('.');
    if (parts.length !== 2) continue;
    const [payloadB64, sig] = parts;

    const expected = await hmac(secret, payloadB64);
    if (expected !== sig) continue;

    let payload: { email: string; expires: number };
    try {
      payload = JSON.parse(b64urlDecode(payloadB64));
    } catch {
      continue;
    }
    if (Date.now() > payload.expires) continue;

    return payload.email;
  }
  return null;
}
