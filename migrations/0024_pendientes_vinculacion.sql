-- Trámites que el médico ya presentó y que, cuando el paciente firma su
-- consentimiento, quedan esperando que la ONG los vincule como cultivadora.
--
-- Por qué una tabla propia y no `socios.reprocann_estado`: en este punto el
-- trámite todavía NO pertenece a la ONG (justamente falta vincularlo), así que
-- no aparece en el volcado `GET /api/v2/tramites?idOng=342` que alimenta a los
-- socios. La única fuente es el agente, que lo ve con la sesión del médico. El
-- tile "Nos toca vincular" del Inicio se cuenta de acá.
--
-- Lo llena el agente (token de máquina) vía POST /api/panel/reprocann/pendiente.
-- `resuelto` se sella solo cuando el trámite avanza más allá de la vinculación.
CREATE TABLE IF NOT EXISTS pendientes_vinculacion (
  tramite    INTEGER PRIMARY KEY,
  dni        TEXT,
  nombre     TEXT,
  apellido   TEXT,
  codigo     TEXT,
  estado     TEXT NOT NULL,
  creado     TEXT NOT NULL DEFAULT (datetime('now')),
  actualizado TEXT NOT NULL DEFAULT (datetime('now')),
  resuelto   TEXT
);

CREATE INDEX IF NOT EXISTS idx_pendientes_vinc_abiertos
  ON pendientes_vinculacion (resuelto) WHERE resuelto IS NULL;
