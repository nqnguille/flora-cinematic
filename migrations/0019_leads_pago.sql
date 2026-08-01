-- Ciclo de pago del consultorio: la reserva entra RETENIDA (15 min esperando
-- el pago de Mercado Pago) y termina aprobada o vencida; el turno confirmado
-- avanza a 'entrevista'. El consultorio escribe estos campos con binding
-- directo a la misma D1; el panel los muestra y acompaña.
-- Fechas en UTC 'YYYY-MM-DD HH:MM:SS', como todo el resto de la base.
ALTER TABLE leads ADD COLUMN pago_estado TEXT;   -- retenido | aprobado | vencido (NULL = sin ciclo de pago)
ALTER TABLE leads ADD COLUMN pago_vence TEXT;    -- fin de la retención
ALTER TABLE leads ADD COLUMN pago_mp_id TEXT;    -- preferencia/pago de MP, para rastrear
ALTER TABLE leads ADD COLUMN turno_fecha TEXT;   -- fecha y hora del turno
