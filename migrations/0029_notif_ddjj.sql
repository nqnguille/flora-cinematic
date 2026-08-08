-- Aviso "firmá tu declaración jurada": sale al generarse la DDJJ de renuncia
-- al autocultivo, con el link directo a la firma en Mi cuenta. Nace PRENDIDO
-- porque Guille lo pidió activo (08/08/2026); se apaga desde el panel Avisos.
INSERT INTO notif_eventos (clave, nombre, descripcion, familia, obligatorio, canales, def_push, def_mail, dias_antes, asunto, cuerpo, push_titulo, push_texto, activo)
VALUES ('ddjj_firmar', 'Tu declaración está lista para firmar',
 'Sale cuando se genera la declaración jurada de renuncia al autocultivo: lo invita a entrar a su cuenta y firmarla, para poder adherirse al débito.',
 'transaccional', 0, 'push,mail', 1, 1, NULL,
 'Tu declaración jurada está lista para firmar',
 'Hola {nombre}, ya está lista tu declaración jurada para pasarte a Flora: es la renuncia al autocultivo que pide el registro, redactada con tus datos.
La firmás en dos minutos desde tu cuenta, con tu nombre, tu DNI y tu firma dibujada en la pantalla. Apenas la verifiquemos vas a poder adherirte al débito automático con el 20% de descuento.
https://floraong.ar/socios/cuenta/#firmar
Cualquier duda antes de firmar, respondé este mail o escribinos por WhatsApp.',
 'Firma pendiente', 'Tu declaración para pasarte a Flora está lista. Entrá y firmala.', 1);
