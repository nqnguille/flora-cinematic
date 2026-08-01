-- Giro a links de plan precargados (orden de Guille 01/08): los preapprovals
-- nacen en MP desde el link del PLAN del panel, sin external_reference
-- nuestro. socio_id pasa a nullable (una suscripción descubierta puede no
-- tener socio identificado todavía) — SQLite no suelta NOT NULL: rebuild.

CREATE TABLE suscripciones_v2 (
  id INTEGER PRIMARY KEY,
  socio_id INTEGER REFERENCES socios(id),      -- NULL = descubierta, sin identificar
  mp_preapproval_id TEXT UNIQUE,
  estado TEXT NOT NULL DEFAULT 'pendiente',    -- pendiente | activa | pausada | cancelada
  monto INTEGER NOT NULL,
  racha_meses INTEGER NOT NULL DEFAULT 0,
  fin TEXT,
  init_point TEXT,
  tier TEXT,
  link_enviado TEXT,                           -- legado individual (histórico)
  link_via TEXT,
  origen TEXT NOT NULL DEFAULT 'individual',   -- individual (legado) | plan
  mp_plan_id TEXT,                             -- de qué plan del panel de MP nació
  mp_payer_email TEXT,                         -- lo que dice MP del pagador (puede NO ser el del padrón)
  mp_payer_id TEXT,
  no_es_socio INTEGER NOT NULL DEFAULT 0,      -- descartada a mano de la cola de identificación
  creado TEXT NOT NULL DEFAULT (datetime('now')),
  actualizado TEXT
);
INSERT INTO suscripciones_v2 (id, socio_id, mp_preapproval_id, estado, monto, racha_meses,
                              fin, init_point, tier, link_enviado, link_via, creado, actualizado)
  SELECT id, socio_id, mp_preapproval_id, estado, monto, racha_meses,
         fin, init_point, tier, link_enviado, link_via, creado, actualizado FROM suscripciones;
DROP TABLE suscripciones;
ALTER TABLE suscripciones_v2 RENAME TO suscripciones;
CREATE INDEX IF NOT EXISTS idx_susc_socio ON suscripciones(socio_id, estado);
CREATE INDEX IF NOT EXISTS idx_susc_plan ON suscripciones(mp_plan_id);

-- Los débitos que llegan sin socio conocido recuerdan de qué suscripción
-- vinieron: al identificarla, se les enchufa el socio retroactivamente.
ALTER TABLE movimientos ADD COLUMN suscripcion_id INTEGER REFERENCES suscripciones(id);

-- Historial de envíos del link del plan. Vive aparte de suscripciones porque
-- el envío ocurre ANTES de que exista fila (recién nace cuando autoriza).
CREATE TABLE IF NOT EXISTS envios_debito (
  id INTEGER PRIMARY KEY,
  socio_id INTEGER NOT NULL REFERENCES socios(id),
  tier TEXT NOT NULL,
  mp_plan_id TEXT,
  via TEXT NOT NULL,                           -- whatsapp | email
  enviado TEXT NOT NULL DEFAULT (datetime('now')),
  enviado_por TEXT
);
CREATE INDEX IF NOT EXISTS idx_envios_socio ON envios_debito(socio_id, enviado);
