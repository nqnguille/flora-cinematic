import { clearSessionCookie } from './_session';

export const onRequestPost: PagesFunction = async ({ request }) => {
  return Response.json({ ok: true }, { headers: { 'Set-Cookie': clearSessionCookie(new URL(request.url).hostname) } });
};
