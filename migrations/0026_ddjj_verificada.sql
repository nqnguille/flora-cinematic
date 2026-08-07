-- La verificación como acto SEPARADO de la subida (doble control real):
-- hasta acá "adjuntar la firmada" y "darla por buena" eran el mismo clic de
-- la misma persona. Ahora la declaración firmada la verifica OTRO usuario
-- del panel (o el mismo, pero queda registrado quién y cuándo), y recién
-- la verificada habilita el camino del débito para el ex-autocultivador.
ALTER TABLE declaraciones ADD COLUMN verificada TEXT;      -- ISO de la verificación
ALTER TABLE declaraciones ADD COLUMN verificada_por TEXT;  -- email del panel que verificó
-- Campos de la firma en el portal (el socio firma logueado, sin papel):
ALTER TABLE declaraciones ADD COLUMN firma_texto TEXT;     -- el nombre tal como lo tipeó
ALTER TABLE declaraciones ADD COLUMN firma_ip TEXT;        -- evidencia
ALTER TABLE declaraciones ADD COLUMN firma_ua TEXT;        -- evidencia (user agent)
