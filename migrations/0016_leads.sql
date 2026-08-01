-- Embudo de LEADS: el recorrido de un prospecto hasta convertirse en socio.
-- Etapas (decisión 01/08): nuevo → contactado → entrevista → convertido,
-- más perdido. Las solicitudes web y los intentos de login entran solos
-- (espejados desde el KV al abrir el tablero); también hay alta manual.
CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY,
  nombre TEXT,
  email TEXT UNIQUE,                       -- llave del espejo con el KV
  telefono TEXT,
  origen TEXT NOT NULL DEFAULT 'manual',   -- solicitud_web | intento | manual | consultorio
  intent TEXT,                             -- acceso | entrevista (de la solicitud web)
  etapa TEXT NOT NULL DEFAULT 'nuevo',     -- nuevo | contactado | entrevista | convertido | perdido
  nota TEXT,
  tiene_adjunto INTEGER NOT NULL DEFAULT 0,
  socio_id INTEGER REFERENCES socios(id),  -- al convertir
  creado TEXT NOT NULL DEFAULT (datetime('now')),
  etapa_desde TEXT NOT NULL DEFAULT (datetime('now')),
  actualizado TEXT
);
CREATE INDEX IF NOT EXISTS idx_leads_etapa ON leads(etapa, etapa_desde);
