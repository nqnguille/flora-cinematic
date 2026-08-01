-- Papelera de socios: depuración del padrón importado del Excel para que
-- quede el fiel reflejo de REPROCANN. Soft-delete SIEMPRE (las finanzas
-- históricas referencian socio_id): papelera = fecha en que se mandó,
-- NULL = ficha viva. Restaurar = volver a NULL.
ALTER TABLE socios ADD COLUMN papelera TEXT;
