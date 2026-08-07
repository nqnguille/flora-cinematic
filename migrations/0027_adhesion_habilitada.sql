-- Habilitación individual para adherirse al débito desde el portal:
-- el panel se la concede a un socio puntual aunque su estado de REPROCANN
-- todavía no esté en la lista general de estados habilitados.
ALTER TABLE socios ADD COLUMN adhesion_habilitada TEXT;      -- ISO: cuándo se concedió
ALTER TABLE socios ADD COLUMN adhesion_habilitada_por TEXT;  -- quién la concedió
