-- Conversión de autocultivadores en pacientes vinculados a Flora.
--
-- Dos cosas nuevas:
--   1) el domicilio del socio, que hasta ahora no existía en ningún lado del
--      club. Lo pide la declaración jurada, y es el mismo dato que va a hacer
--      falta el día que entreguemos a domicilio.
--   2) la tabla de declaraciones juradas: qué se generó, con qué texto exacto
--      (hash), quién lo generó y si volvió firmada. El PDF/foto firmado vive
--      en KV CERTIFICADOS bajo `ddjj:<id>`, igual que los certificados.
--
-- El texto no se guarda entero acá a propósito: lo que importa legalmente es
-- el papel firmado, y el hash prueba que ese papel salió de esta plantilla.

ALTER TABLE socios ADD COLUMN domicilio TEXT;
ALTER TABLE socios ADD COLUMN localidad TEXT;
ALTER TABLE socios ADD COLUMN provincia TEXT;

CREATE TABLE declaraciones (
  id INTEGER PRIMARY KEY,
  socio_id INTEGER NOT NULL,
  tipo TEXT NOT NULL DEFAULT 'vinculacion',   -- por ahora una sola, queda abierto
  version TEXT NOT NULL,                      -- versión de la plantilla usada
  texto_hash TEXT NOT NULL,                   -- SHA-256 del texto exacto que se imprimió
  estado TEXT NOT NULL DEFAULT 'generada',    -- generada | firmada | anulada
  generada TEXT NOT NULL DEFAULT (datetime('now')),
  generada_por TEXT,                          -- email del que apretó el botón
  firmada TEXT,                               -- ISO cuando se adjuntó el papel firmado
  firmada_por TEXT,
  archivo_bytes INTEGER,
  archivo_tipo TEXT,                          -- application/pdf | image/jpeg | image/png
  nota TEXT
);

CREATE INDEX idx_declaraciones_socio ON declaraciones(socio_id, id DESC);
CREATE INDEX idx_declaraciones_estado ON declaraciones(estado);
