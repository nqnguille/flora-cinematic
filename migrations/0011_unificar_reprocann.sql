-- "Unificar pacientes": el volcado oficial del portal REPROCANN (con el DNI
-- de cada trámite) entra a una tabla staging, el matching propone pares
-- socio↔persona y la confirmación es SIEMPRE humana. Una vez confirmado, cada
-- volcado nuevo actualiza al socio solo (estado, vencimiento, plantas).

-- Plantas autorizadas del certificado: la migración 0008 no la creó.
ALTER TABLE socios ADD COLUMN reprocann_plantas INTEGER;

-- Staging del portal: UNA fila por persona (DNI). Cada volcado la pisa con el
-- trámite "ganador" (vigente > en curso > muerto; empate: id más nuevo).
-- Solo la ve el presidente: son datos oficiales de pacientes.
CREATE TABLE IF NOT EXISTS tramites_portal (
  dni         TEXT PRIMARY KEY,            -- solo dígitos, sin ceros a la izquierda
  tramite_id  INTEGER NOT NULL,
  nombre      TEXT NOT NULL,
  apellido    TEXT NOT NULL,
  estado      TEXT NOT NULL,               -- crudo, uno de los 8 oficiales del portal
  autocultivo INTEGER NOT NULL DEFAULT 0,
  plantas     INTEGER,
  inicio      TEXT,                        -- inicioVigencia (ISO, 10 chars)
  vence       TEXT,                        -- finalizacionVigencia
  renovacion  INTEGER NOT NULL DEFAULT 0,
  actualizado TEXT NOT NULL DEFAULT (datetime('now'))
);

-- El par socio↔persona-del-portal y su decisión. Los rechazos quedan para
-- siempre (un par rechazado no vuelve a proponerse) y la llave estable es el
-- DNI, no el nº de trámite: las renovaciones cambian de trámite, no de persona.
CREATE TABLE IF NOT EXISTS vinculos_reprocann (
  socio_id     INTEGER NOT NULL REFERENCES socios(id),
  dni          TEXT NOT NULL,
  estado       TEXT NOT NULL DEFAULT 'pendiente',  -- pendiente | confirmado | rechazado
  senales      TEXT,                       -- JSON {"match":[...],"conflictos":[...],"puntaje":n}
  creado       TEXT NOT NULL DEFAULT (datetime('now')),
  decidido_por TEXT,
  decidido     TEXT,
  PRIMARY KEY (socio_id, dni)
);
-- 1:1 real entre confirmados: un socio con a lo sumo un DNI y viceversa.
CREATE UNIQUE INDEX IF NOT EXISTS ix_vr_socio ON vinculos_reprocann(socio_id) WHERE estado = 'confirmado';
CREATE UNIQUE INDEX IF NOT EXISTS ix_vr_dni   ON vinculos_reprocann(dni)      WHERE estado = 'confirmado';
