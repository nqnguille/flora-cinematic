-- El plan CUOTASOCIAL del panel de MP ($10.000/mes, sin límite de cuotas,
-- de la app vieja 3909856389923111): registrarlo habilita que el
-- descubrimiento lo reconozca como cuota social (sin gramos, sin racha,
-- categoría cuota_ong) en vez de tratarlo como membresía.
UPDATE precios SET mp_plan_id = '892f6def307e45f39674050b329c35ff'
 WHERE tipo = 'cuota_ong' AND lista_id = 2;
