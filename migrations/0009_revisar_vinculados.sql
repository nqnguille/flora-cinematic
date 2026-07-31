-- Corrección: "Vinculado" del Excel NO quiere decir "aprobado".
-- En el vocabulario oficial de REPROCANN, `vinculado` es un paso ANTERIOR a
-- la aprobación (el trámite existe y está vinculado, pero el certificado
-- todavía no salió). La migración 0008 lo mapeó optimista a 'aprobado', y
-- 'aprobado' es justo lo que el Mostrador lee para dejar retirar.
-- Ante la duda, el estado seguro es 'revisar': no habilita nada y aparece en
-- el embudo como algo que el club tiene que confirmar contra el portal.
UPDATE socios
   SET reprocann_estado = 'revisar',
       reprocann_nota = COALESCE(reprocann_nota, '') || ' · confirmar contra REPROCANN (decía "vinculado" en el Excel)',
       reprocann_actualizado = datetime('now')
 WHERE reprocann_estado = 'aprobado'
   AND reprocann_vence IS NULL
   AND lower(COALESCE(reprocann_nota, '')) LIKE '%vinculado%';
