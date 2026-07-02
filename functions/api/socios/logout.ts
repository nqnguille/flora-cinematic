import { clearSessionCookie } from './_session';

export const onRequestPost: PagesFunction = async () => {
  return Response.json({ ok: true }, { headers: { 'Set-Cookie': clearSessionCookie() } });
};
