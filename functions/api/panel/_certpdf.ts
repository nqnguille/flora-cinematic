// Lector del certificado REPROCANN subido: saca del PDF los datos que hoy se
// tipeaban a mano (DNI, domicilio, vencimiento y sobre todo el DIAGNÓSTICO,
// que es lo que funda la DDJJ y no puede depender de la memoria de nadie:
// el que vale es el que figura en el trámite presentado al Ministerio).
//
// El parser va GUIADO POR ETIQUETAS y es deliberadamente tolerante: busca
// los rótulos donde aparezcan, en cualquier orden, y devuelve solo lo que
// encuentra. Si el PDF es una foto escaneada sin capa de texto, devuelve
// vacío y los campos manuales siguen mandando: esto completa, nunca bloquea.
import { extractText, getDocumentProxy } from 'unpdf';

export interface DatosCertificado {
  dni?: string;
  nombre?: string;
  domicilio?: string;
  localidad?: string;
  provincia?: string;
  vence?: string;        // ISO yyyy-mm-dd
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

export async function leerCertificado(bytes: ArrayBuffer): Promise<DatosCertificado> {
  let texto = '';
  try {
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const r = await extractText(pdf, { mergePages: true });
    texto = String(r.text || '');
  } catch {
    return {}; // no era un PDF legible: campos manuales
  }
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
