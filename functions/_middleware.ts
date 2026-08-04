// Canónico sin www.
//
// El CNAME de www.floraong.ar apunta al mismo proyecto de Pages, así que el
// sitio se servía dos veces con el mismo contenido y distinta dirección: para
// Google son dos sitios idénticos compitiendo entre sí. Esto lo resuelve del
// lado del código, sin depender de una regla de redirección en el panel.
//
// Se conservan la ruta, la query y el fragmento, y va 301 (permanente) para
// que los buscadores transfieran la autoridad al dominio sin www.
export const onRequest: PagesFunction = async (context) => {
  const url = new URL(context.request.url);
  if (url.hostname === 'www.floraong.ar') {
    url.hostname = 'floraong.ar';
    return Response.redirect(url.toString(), 301);
  }
  return context.next();
};
