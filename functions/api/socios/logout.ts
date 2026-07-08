import { clearSessionCookie } from './_session';

export const onRequestPost: PagesFunction = async ({ request }) => {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  // Dos cookies a borrar (host-only + Domain=floraong.ar) necesitan dos
  // headers Set-Cookie separados — un objeto plano en Response.json solo
  // deja mandar uno.
  for (const cookie of clearSessionCookie(new URL(request.url).hostname)) {
    headers.append('Set-Cookie', cookie);
  }
  return new Response(JSON.stringify({ ok: true }), { headers });
};
