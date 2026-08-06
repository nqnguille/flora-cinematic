-- Señal de tratamiento médico del socio, espejada desde el consultorio del
-- Dr. Kalb (hc.drezequielkalb.com) por la llave DNI/email.
--
-- Para qué: respaldar la declaración jurada de vinculación ("tratamiento médico
-- supervisado") y afinar los avisos de vencimiento, sin que cruce NADA clínico.
-- Solo dos señales: si sigue en tratamiento (booleano) y cuándo es su próxima
-- consulta. Nunca diagnóstico, síntomas ni historia clínica.
--
-- Lo escribe el consultorio con binding directo a esta D1, igual que ya hace
-- con los leads (migración 0019).
ALTER TABLE socios ADD COLUMN med_en_tratamiento INTEGER;   -- 1 = tiene consultas firmadas y activo
ALTER TABLE socios ADD COLUMN med_proxima_consulta TEXT;    -- ISO de la próxima consulta agendada
ALTER TABLE socios ADD COLUMN med_actualizado TEXT;         -- cuándo el consultorio lo espejó
