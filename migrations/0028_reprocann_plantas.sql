-- Plantas florecidas autorizadas según el certificado REPROCANN del socio
-- (Anexo IV Res. 1780/2025: tope 9 por representado). Se lee del PDF.
ALTER TABLE socios ADD COLUMN reprocann_plantas INTEGER;
