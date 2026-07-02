// Verifica un ID token de Google (Sign-In With Google) contra las JWKS públicas.
const CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs';

function b64urlToUint8Array(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/').padEnd(b64url.length + ((4 - (b64url.length % 4)) % 4), '=');
  const raw = atob(b64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

function b64urlToJson(b64url: string): any {
  return JSON.parse(new TextDecoder().decode(b64urlToUint8Array(b64url)));
}

let cachedCerts: { keys: any[]; fetchedAt: number } | null = null;

async function getGoogleCerts() {
  if (cachedCerts && Date.now() - cachedCerts.fetchedAt < 60 * 60 * 1000) return cachedCerts.keys;
  const res = await fetch(CERTS_URL);
  const { keys } = await res.json();
  cachedCerts = { keys, fetchedAt: Date.now() };
  return keys;
}

export interface GooglePayload {
  email: string;
  email_verified: boolean;
  name?: string;
  picture?: string;
  aud: string;
  iss: string;
  exp: number;
}

export async function verifyGoogleIdToken(idToken: string, clientId: string): Promise<GooglePayload> {
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new Error('token con formato inválido');
  const [headerB64, payloadB64, sigB64] = parts;
  const header = b64urlToJson(headerB64);
  const payload = b64urlToJson(payloadB64) as GooglePayload;

  const keys = await getGoogleCerts();
  const jwk = keys.find((k: any) => k.kid === header.kid);
  if (!jwk) throw new Error('no se encontró la clave pública de Google (kid desconocido)');

  const key = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify']
  );

  const signature = b64urlToUint8Array(sigB64);
  const data = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, data);
  if (!valid) throw new Error('firma inválida');

  if (payload.aud !== clientId) throw new Error('audience no coincide con el client ID');
  if (payload.iss !== 'https://accounts.google.com' && payload.iss !== 'accounts.google.com') {
    throw new Error('issuer inválido');
  }
  if (payload.exp * 1000 < Date.now()) throw new Error('token expirado');
  if (!payload.email_verified) throw new Error('email de Google no verificado');

  return payload;
}
