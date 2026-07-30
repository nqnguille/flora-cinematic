-- Planes de débito de Mercado Pago (3 cuotas mensuales, precio con 20%)
ALTER TABLE precios ADD COLUMN mp_plan_id TEXT;
UPDATE precios SET mp_plan_id = '4986974a04e94718976a3ea973b2b66c' WHERE item = 'SMALL' AND tipo = 'membresia' AND lista_id = 2;
UPDATE precios SET mp_plan_id = 'aa684c34bda346cab1f3bfa2ee9b1fca' WHERE item = 'MEDIUM' AND tipo = 'membresia' AND lista_id = 2;
UPDATE precios SET mp_plan_id = '1efd237e34c64bd49088860575f360d9' WHERE item = 'LARGE' AND tipo = 'membresia' AND lista_id = 2;
UPDATE precios SET mp_plan_id = 'b14cdaa0ea144df1a30f7d380cd4ab45' WHERE item = 'EXTRA LARGE' AND tipo = 'membresia' AND lista_id = 2;