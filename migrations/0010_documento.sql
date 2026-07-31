-- El DNI como llave común entre los dos sistemas de Flora.
-- El club identifica por email de Google y el consultorio por documento:
-- sin un identificador compartido no hay forma automática de saber que el
-- paciente que atendió el médico es el socio que retira en el club (hoy solo
-- 9 de 58 se reconocen por nombre). El DNI es la única llave estable que ya
-- existe del otro lado — y la Ley 26.529 (art. 17) lo acepta como "clave
-- uniforme" de identificación.
-- Guardamos solo dígitos (sin puntos). El índice único es parcial: los 155
-- socios migrados del Excel arrancan sin documento y se completa de a poco.
ALTER TABLE socios ADD COLUMN documento TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS ix_socios_documento ON socios (documento) WHERE documento IS NOT NULL;
