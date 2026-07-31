-- Estado de REPROCANN estandarizado por socio.
-- Antes era texto libre en socios.reprocann ("Pendiente con WeCann",
-- "Pendiente con Oscar", 84 en blanco): no se podía saber a quién había que
-- empujar ni quién estaba habilitado para retirar. Ahora es un embudo con
-- pasos fijos, alineado a los 8 estados reales del trámite en REPROCANN.
--
-- El embudo, en orden:
--   sin_iniciar        el socio todavía no arrancó nada
--   esperando_codigo   le pedimos que genere su código en Mi Argentina
--   codigo_listo       tenemos el código de 13 caracteres; le toca a Kalb cargar
--   cargado            Kalb cargó el trámite; falta que el paciente firme  ← se traba acá
--   observado          el paciente observó algo del trámite
--   a_vincular         el paciente firmó; LE TOCA A FLORA vincular como cultivadora
--   en_evaluacion      Flora vinculó; espera al organismo
--   revision_medica    el organismo devolvió el trámite al profesional
--   aprobado           certificado vigente (1 año para persona jurídica)
--   rechazado / anulado / vencido
--
-- El texto libre viejo NO se borra: queda en reprocann_nota como memoria de
-- quién venía gestionando cada caso (WeCann, Oscar, por su cuenta).

ALTER TABLE socios ADD COLUMN reprocann_estado TEXT NOT NULL DEFAULT 'sin_iniciar';
ALTER TABLE socios ADD COLUMN reprocann_codigo TEXT;          -- 13 caracteres, lo genera el paciente
ALTER TABLE socios ADD COLUMN reprocann_tramite INTEGER;      -- nº de trámite en REPROCANN
ALTER TABLE socios ADD COLUMN reprocann_vence TEXT;           -- ISO; 1 año desde la aprobación
ALTER TABLE socios ADD COLUMN reprocann_nota TEXT;            -- el texto libre viejo + notas de gestión
ALTER TABLE socios ADD COLUMN reprocann_actualizado TEXT;

CREATE INDEX idx_socios_reprocann ON socios(reprocann_estado);

-- Migración del texto libre al embudo, sin perder el matiz de quién gestionaba.
UPDATE socios SET reprocann_nota = reprocann WHERE reprocann IS NOT NULL;

UPDATE socios SET reprocann_estado = 'aprobado'
 WHERE lower(reprocann) LIKE '%vinculado%';

UPDATE socios SET reprocann_estado = 'autocultivo'
 WHERE lower(reprocann) LIKE '%autocultivo%';

-- "Pendiente con X" = alguien lo está gestionando, pero no sabemos en qué paso.
-- Van a 'esperando_codigo', que es el primer paso accionable del embudo.
UPDATE socios SET reprocann_estado = 'esperando_codigo'
 WHERE lower(reprocann) LIKE 'pendiente%';

-- Los socios que retiran hace meses seguramente ya tienen su certificado,
-- pero no lo damos por hecho: quedan en revisar, para confirmarlos contra
-- REPROCANN cuando sincronicemos.
UPDATE socios SET reprocann_estado = 'revisar'
 WHERE reprocann_estado = 'sin_iniciar'
   AND id IN (SELECT DISTINCT socio_id FROM dispensas WHERE socio_id IS NOT NULL);
