-- Lista de precios de agosto, ajustada al Excel definitivo (01/08/2026):
-- el contado sube (375/525/625) y el débito queda EXACTO en contado −20%
-- (300/420/500) — igual a los planes precargados en el panel de Mercado Pago.
-- SMALL no cambia. También: cupo 10 por membresía y los abonos contado de
-- autocultivadores que faltaban en la lista.
UPDATE precios SET contado = 375000, debito = 300000, cupo = 10 WHERE lista_id = 2 AND item = 'MEDIUM';
UPDATE precios SET contado = 525000, debito = 420000, cupo = 10 WHERE lista_id = 2 AND item = 'LARGE';
UPDATE precios SET contado = 625000, debito = 500000, cupo = 10 WHERE lista_id = 2 AND item = 'EXTRA LARGE';
UPDATE precios SET cupo = 10 WHERE lista_id = 2 AND item = 'SMALL';

-- Abonos contado para autocultivadores (USD ancla, ARS al TC 1560 de la lista)
INSERT OR IGNORE INTO precios (lista_id, item, tipo, gramos, valor_usd, contado, cupo)
VALUES
  (2, 'PLAN 15x12', 'plan', 180, 1000, 1560000, 1),
  (2, 'PLAN 20x18', 'plan', 360, 2000, 3120000, 1),
  (2, 'PLAN 30x24', 'plan', 720, 3000, 4680000, 1);
