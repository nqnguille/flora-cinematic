-- Roles v2: los roles pensados para "socios de la ONG" genéricos se vuelven
-- roles con nombre y propósito real: operacion (Sofi), socio_proyecto (los
-- socios del proyecto: ven todo y cargan gastos), medico, tesorero.
-- SQLite no permite alterar un CHECK: se recrea la tabla y se migran las filas.
CREATE TABLE accesos_v2 (
  email TEXT PRIMARY KEY,
  nombre TEXT,
  rol TEXT NOT NULL CHECK (rol IN ('dueno','operacion','socio_proyecto','medico','mostrador','tesorero')),
  creado TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO accesos_v2 (email, nombre, rol, creado)
SELECT email, nombre,
  CASE rol
    WHEN 'socio_ong' THEN 'socio_proyecto'
    WHEN 'socio_ong_carga' THEN 'socio_proyecto'
    ELSE rol
  END,
  creado
FROM accesos;

DROP TABLE accesos;
ALTER TABLE accesos_v2 RENAME TO accesos;
