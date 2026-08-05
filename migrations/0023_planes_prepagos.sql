-- Planes prepagos: se pagan de contado por adelantado y dan un saldo de
-- gramos a favor que el socio retira a lo largo de N meses.
--
-- La tabla ya los guardaba (tipo = 'plan'), pero solo el TOTAL de gramos, con
-- el reparto escondido en el nombre: «PLAN 15x12» quiere decir 15 gramos por
-- mes durante 12 meses. Eso obligaba a leer el nombre para saber la vigencia,
-- y hacía imposible editarlos desde el panel sin adivinar.
--
-- Ahora el reparto es dato. `gramos` sigue siendo el total, para no tocar a
-- nadie que ya lo lea.
ALTER TABLE precios ADD COLUMN plan_gramos_mes REAL;
ALTER TABLE precios ADD COLUMN plan_meses INTEGER;

-- Backfill de los tres que ya existen, leyendo el reparto del nombre por
-- única vez. De acá en más lo escribe el panel.
UPDATE precios SET plan_gramos_mes = 15, plan_meses = 12 WHERE tipo = 'plan' AND item LIKE '%15x12%';
UPDATE precios SET plan_gramos_mes = 20, plan_meses = 18 WHERE tipo = 'plan' AND item LIKE '%20x18%';
UPDATE precios SET plan_gramos_mes = 30, plan_meses = 24 WHERE tipo = 'plan' AND item LIKE '%30x24%';

-- Los que no matchean quedan en NULL y el panel los muestra para completar,
-- en vez de inventarles un reparto.
