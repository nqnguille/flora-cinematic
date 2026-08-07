// Lector del certificado REPROCANN subido: saca del PDF los datos que hoy se
// tipeaban a mano (DNI, domicilio, vencimiento y sobre todo el DIAGNÓSTICO,
// que es lo que funda la DDJJ y no puede depender de la memoria de nadie:
// el que vale es el que figura en el trámite presentado al Ministerio).
//
// El parser va GUIADO POR ETIQUETAS y es deliberadamente tolerante: busca
// los rótulos donde aparezcan, en cualquier orden, y devuelve solo lo que
// encuentra. Si el PDF es una foto escaneada sin capa de texto, devuelve
// vacío y los campos manuales siguen mandando: esto completa, nunca bloquea.
import { extractText, extractImages, getDocumentProxy } from 'unpdf';
import { encode as encodePng } from 'fast-png';

export interface DatosCertificado {
  dni?: string;
  nombre?: string;
  domicilio?: string;
  localidad?: string;
  provincia?: string;
  cp?: string;
  vence?: string;        // ISO yyyy-mm-dd
  emision?: string;      // ISO yyyy-mm-dd
  tramite?: string;      // id de trámite REPROCANN
  modalidad?: string;    // 'autocultivo' | 'ong' | el texto que traiga
  plantas?: number;      // plantas florecidas autorizadas (tope legal 9)
  diagnostico?: string;
  codigo?: string;       // código de vinculación, si figura
  texto?: string;        // el texto plano completo, para depurar desde el panel
}

const RE_FECHA = /(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})/;

function aIso(m: RegExpMatchArray): string {
  const [, d, mes, a] = m;
  const anio = a.length === 2 ? `20${a}` : a;
  return `${anio}-${mes.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

/** El valor que sigue a una etiqueta, en la misma línea o la siguiente. */
function despuesDe(lineas: string[], etiquetas: RegExp): string | null {
  for (let i = 0; i < lineas.length; i++) {
    const m = lineas[i].match(etiquetas);
    if (!m) continue;
    const mismaLinea = lineas[i].slice((m.index || 0) + m[0].length).replace(/^[:\s.-]+/, '').trim();
    if (mismaLinea) return mismaLinea;
    const siguiente = (lineas[i + 1] || '').trim();
    if (siguiente) return siguiente;
  }
  return null;
}

export async function leerCertificado(bytes: ArrayBuffer, ai?: Ai): Promise<DatosCertificado> {
  let texto = '';
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>> | null = null;
  try {
    pdf = await getDocumentProxy(new Uint8Array(bytes));
    const r = await extractText(pdf, { mergePages: true });
    texto = String(r.text || '');
  } catch {
    return {}; // no era un PDF legible: campos manuales
  }
  const porTexto = leerDeTexto(texto);
  // La credencial oficial (la tarjetita para plastificar) trae los datos como
  // IMAGEN, no como texto: si el texto no dio ni DNI ni vencimiento, se le
  // pide a la IA de visión de Cloudflare que lea las imágenes embebidas.
  if (!porTexto.dni && !porTexto.vence && ai && pdf) {
    try {
      const porImagen = await leerDeImagenes(pdf, ai);
      return { ...porImagen, ...sinVacios(porTexto) };
    } catch (e) { console.error('certpdf: fallo la lectura por imagen:', e); /* la IA nunca rompe la subida */ }
  }
  return porTexto;
}

function sinVacios<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v)) as Partial<T>;
}

function aBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

const PROMPT_CREDENCIAL =
  'Esta imagen es parte de una credencial o constancia del REPROCANN (Registro del Programa Cannabis, Argentina). ' +
  'Leé el texto impreso y devolvé SOLO un objeto JSON, sin explicación, con las claves que realmente veas: ' +
  '"dni" (solo dígitos), "nombre" (apellido y nombres del paciente), "domicilio" (calle y número), ' +
  '"localidad", "provincia", "cp" (código postal), "vence" (fecha de vencimiento, dd/mm/aaaa), ' +
  '"emision" (fecha de emisión, dd/mm/aaaa), "id_tramite" (el número que figura como Id trámite), ' +
  '"modalidad" ("autocultivo" si dice Paciente con autocultivo, "ong" si dice vinculado a una organización), ' +
  '"plantas" (cantidad de plantas florecidas autorizadas, solo el número), ' +
  '"diagnostico" (SOLO si figura un ' +
  'diagnóstico médico explícito; la condición de vinculación como "autocultivo" u "ONG" NO es un diagnóstico). ' +
  'Si un dato no aparece en la imagen, no incluyas su clave. No inventes nada.';

// La credencial trae la condición de vinculación ("Paciente con autocultivo",
// "Vinculado a ONG"...), que no es un diagnóstico médico: se descarta.
const RE_NO_DIAGNOSTICO = /autocultivo|cultivo|vinculaci[oó]n|vinculad[oa]|\bong\b|reprocann/i;

async function leerDeImagenes(pdf: NonNullable<Awaited<ReturnType<typeof getDocumentProxy>>>, ai: Ai): Promise<DatosCertificado> {
  const out: DatosCertificado = {};
  const candidatas: Array<{ png: Uint8Array }> = [];
  for (let pagina = 1; pagina <= Math.min(pdf.numPages, 2); pagina++) {
    let imgs: Awaited<ReturnType<typeof extractImages>> = [];
    try { imgs = await extractImages(pdf, pagina); } catch { continue; }
    for (const im of imgs) {
      const razon = im.width / im.height;
      // tarjetas apaisadas (la credencial es ~1.58); afuera QRs (cuadrados),
      // banners anchos y gigantografías decorativas
      if (im.width < 400 || im.width > 2000 || im.height < 200 || razon < 1.2 || razon > 2.1) continue;
      const canales = (im as { channels?: number }).channels || 4;
      candidatas.push({
        png: encodePng({
          width: im.width, height: im.height,
          data: new Uint8Array(im.data.buffer, im.data.byteOffset, im.data.byteLength),
          channels: canales as 1 | 2 | 3 | 4, depth: 8,
        }),
      });
      if (candidatas.length >= 3) break;
    }
    if (candidatas.length >= 3) break;
  }

  for (const c of candidatas) {
    // mistral-small-3.1: modelo de visión de Workers AI sin gate de licencia
    // (llama-3.2-11b-vision exige aceptar la licencia de Meta por cuenta) y
    // que recibe la imagen como data URI en messages, el único formato que el
    // binding transporta sin pelearse con el esquema del modelo.
    const r = (await ai.run('@cf/mistralai/mistral-small-3.1-24b-instruct' as Parameters<Ai['run']>[0], {
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: PROMPT_CREDENCIAL },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${aBase64(c.png)}` } },
        ],
      }],
      max_tokens: 512,
    })) as { response?: string; description?: string; choices?: Array<{ message?: { content?: string } }> };
    const crudo = r.response || r.description || r.choices?.[0]?.message?.content || '';
    const m = String(crudo).match(/\{[\s\S]*\}/);
    if (!m) continue;
    let j: Record<string, unknown>;
    try { j = JSON.parse(m[0]); } catch { continue; }
    const texto = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 300) : undefined);
    if (!out.dni) { const t = texto(j.dni); if (t) { const d = t.replace(/\D/g, ''); if (d.length >= 7 && d.length <= 8) out.dni = d; } }
    if (!out.nombre) out.nombre = texto(j.nombre);
    if (!out.domicilio) out.domicilio = texto(j.domicilio);
    if (!out.localidad) out.localidad = texto(j.localidad);
    if (!out.provincia) out.provincia = texto(j.provincia);
    if (!out.diagnostico) { const t = texto(j.diagnostico); if (t && !RE_NO_DIAGNOSTICO.test(t)) out.diagnostico = t; }
    if (!out.cp) { const t = texto(j.cp); if (t && /^[A-Z]?\d{4}/i.test(t)) out.cp = t.slice(0, 8); }
    if (!out.tramite) { const t = texto(j.id_tramite); const tm = t ? t.match(/\d{4,}/) : null; if (tm) out.tramite = tm[0]; }
    if (!out.modalidad) { const t = texto(j.modalidad); if (t) out.modalidad = /autocultivo/i.test(t) ? 'autocultivo' : /ong|organizaci/i.test(t) ? 'ong' : undefined; }
    if (out.plantas === undefined) { const n = Number(j.plantas); if (Number.isFinite(n) && n >= 1 && n <= 20) out.plantas = n; }
    if (!out.emision) { const t = texto(j.emision); const fm = t ? t.match(RE_FECHA) : null; if (fm) out.emision = aIso(fm); }
    if (!out.vence) { const t = texto(j.vence); const fm = t ? t.match(RE_FECHA) : null; if (fm) out.vence = aIso(fm); }
  }
  return sinVacios(out) as DatosCertificado;
}

function leerDeTexto(texto: string): DatosCertificado {
  if (!texto.trim()) return {};

  const plano = texto.replace(/ /g, ' ');
  const lineas = plano.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const d: DatosCertificado = { texto: plano.slice(0, 4000) };

  // DNI: por etiqueta primero; si no, el primer número de 7-8 cifras suelto.
  const porEtiqueta = despuesDe(lineas, /\b(?:D\.?N\.?I\.?|documento(?:\s+n[°º.]?)?)\b/i);
  const dniM = (porEtiqueta || plano).match(/\b(\d{1,2}[.\s]?\d{3}[.\s]?\d{3})\b/);
  if (dniM) d.dni = dniM[1].replace(/[.\s]/g, '');

  const nombre = despuesDe(lineas, /\b(?:apellido y nombres?|nombre y apellidos?|paciente)\b/i);
  if (nombre) d.nombre = nombre.replace(/\bDNI\b.*$/i, '').trim();

  const dom = despuesDe(lineas, /\b(?:domicilio|direcci[oó]n)\b/i);
  if (dom) d.domicilio = dom;
  const loc = despuesDe(lineas, /\blocalidad\b/i);
  if (loc) d.localidad = loc;
  const prov = despuesDe(lineas, /\bprovincia\b/i);
  if (prov) d.provincia = prov;

  const diag = despuesDe(lineas, /\bdiagn[oó]stico\b/i);
  if (diag) d.diagnostico = diag.slice(0, 300);

  const tram = despuesDe(lineas, /\bid\s+tr[aá]mite\b|\bn[°º.]?\s*(?:de\s+)?tr[aá]mite\b/i);
  if (tram) { const tm = tram.match(/\d{4,}/); if (tm) d.tramite = tm[0]; }
  const cp = despuesDe(lineas, /\bc[oó]digo\s+postal\b|\bC\.?P\.?\b/i);
  if (cp) { const cm2 = cp.match(/\b[A-Z]?\d{4}\b/i); if (cm2) d.cp = cm2[0]; }
  const plantas = despuesDe(lineas, /plantas\s+florecidas\s+autorizadas/i);
  if (plantas) { const pm = plantas.match(/\d{1,2}/); if (pm) d.plantas = Number(pm[0]); }
  if (/paciente\s+con\s+autocultivo/i.test(plano)) d.modalidad = 'autocultivo';
  else if (/vinculad[oa]\s+a\s+(?:una\s+)?(?:ONG|organizaci[oó]n|persona\s+jur[ií]dica)/i.test(plano)) d.modalidad = 'ong';
  const emisionTxt = despuesDe(lineas, /\bfecha\s+(?:de\s+)?emisi[oó]n\b/i);
  const em = emisionTxt ? emisionTxt.match(RE_FECHA) : null;
  if (em) d.emision = aIso(em);

  const cod = despuesDe(lineas, /\bc[oó]digo(?:\s+de)?\s+vinculaci[oó]n\b/i);
  if (cod) {
    const cm = cod.match(/[A-Z0-9-]{6,}/i);
    if (cm) d.codigo = cm[0];
  }

  // Vencimiento: la fecha que sigue a su etiqueta; sin etiqueta, la fecha
  // más lejana en el futuro que aparezca (los certificados duran un año).
  const venceTxt = despuesDe(lineas, /\b(?:vencimiento|v[aá]lido hasta|vigencia hasta|vence)\b/i);
  const vm = venceTxt ? venceTxt.match(RE_FECHA) : null;
  if (vm) d.vence = aIso(vm);
  else {
    let mejor: string | null = null;
    for (const m of plano.matchAll(new RegExp(RE_FECHA.source, 'g'))) {
      const iso = aIso(m as RegExpMatchArray);
      if (iso > new Date().toISOString().slice(0, 10) && (!mejor || iso > mejor)) mejor = iso;
    }
    if (mejor) d.vence = mejor;
  }

  return d;
}
