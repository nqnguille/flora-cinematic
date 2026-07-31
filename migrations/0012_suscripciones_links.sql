-- MP nivel 2: el link de autorización hoy se pierde al cerrar el modal —
-- guardarlo permite reusarlo y reenviarlo sin crear preapprovals duplicados.
-- link_enviado/link_via registran el último envío ("mandado hace N días").
ALTER TABLE suscripciones ADD COLUMN init_point TEXT;
ALTER TABLE suscripciones ADD COLUMN tier TEXT;
ALTER TABLE suscripciones ADD COLUMN link_enviado TEXT;
ALTER TABLE suscripciones ADD COLUMN link_via TEXT;
-- El socio que paga contado y no quiere débito: que no moleste en la cola.
ALTER TABLE socios ADD COLUMN debito_no_insistir INTEGER NOT NULL DEFAULT 0;
