-- Notificaciones a socios: catálogo de avisos, preferencias, y el registro de
-- lo que salió.
--
-- La pieza central es `notif_envios` con su índice único: NO es solo un log,
-- es la cola y el anti-duplicado a la vez. Cada aviso tiene una identidad
-- determinista (`clave_dedup`), del estilo
--   reprocann_por_vencer:1042:2026-09-01
-- así que insertarlo dos veces es imposible. Eso es lo que vuelve seguro el
-- disparador: puede correr doscientas veces por día y el socio recibe uno.
-- Sin esto, cualquier barrido programado es una bomba.

-- 1) Catálogo: qué avisos existen. Lo siembra el código, el panel lo prende y
--    lo apaga. `obligatorio` es para lo que el socio no puede desactivar
--    (bienvenida, seguridad de su cuenta).
CREATE TABLE notif_eventos (
  clave TEXT PRIMARY KEY,
  nombre TEXT NOT NULL,                 -- como se lee en el panel y en las preferencias del socio
  descripcion TEXT,                     -- cuándo sale, en criollo
  familia TEXT NOT NULL,                -- transaccional | recordatorio | club
  obligatorio INTEGER NOT NULL DEFAULT 0,
  canales TEXT NOT NULL DEFAULT 'push,mail',   -- canales permitidos para este aviso
  def_push INTEGER NOT NULL DEFAULT 1,
  def_mail INTEGER NOT NULL DEFAULT 1,
  activo INTEGER NOT NULL DEFAULT 0,    -- nace APAGADO: nada sale hasta que alguien lo prenda
  dias_antes INTEGER,                   -- para los que dependen de una fecha
  tope_diario INTEGER NOT NULL DEFAULT 200,  -- freno: si un bug quiere mandar de más, corta
  asunto TEXT,                          -- plantilla del asunto (mail)
  cuerpo TEXT,                          -- plantilla del cuerpo
  push_titulo TEXT,
  push_texto TEXT,
  actualizado TEXT
);

-- 2) Preferencias del socio. Tabla RALA a propósito: solo se guardan las
--    excepciones. Sin fila, vale el default del evento. Guardar la matriz
--    completa serían miles de filas que dicen lo mismo que el default.
CREATE TABLE notif_prefs (
  socio_id INTEGER NOT NULL,
  evento TEXT NOT NULL,
  canal TEXT NOT NULL,                  -- push | mail
  habilitado INTEGER NOT NULL,
  actualizado TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (socio_id, evento, canal)
);

-- 3) Estado del canal por socio. Responde otra pregunta que las preferencias:
--    no es "¿quiere enterarse de esto?" sino "¿puedo escribirle por acá?".
--    Acá viven la baja global y los rebotes.
CREATE TABLE notif_canal (
  socio_id INTEGER NOT NULL,
  canal TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'optin', -- optin | optout | rebotado
  destino TEXT,                         -- el mail vigente cuando aceptó
  motivo TEXT,
  actualizado TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (socio_id, canal)
);

-- 4) Suscripciones push: una por DISPOSITIVO, no por persona. El mismo socio
--    puede tener el teléfono y la compu. Las bajas (404/410 del navegador) no
--    borran la fila: marcan `baja`, y eso después dice cuánta gente desinstaló.
CREATE TABLE push_subs (
  id INTEGER PRIMARY KEY,
  socio_id INTEGER NOT NULL,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  plataforma TEXT,
  creada TEXT NOT NULL DEFAULT (datetime('now')),
  ultimo_ok TEXT,
  fallos INTEGER NOT NULL DEFAULT 0,
  baja TEXT
);
CREATE INDEX idx_push_socio ON push_subs(socio_id, baja);

-- 5) Envíos: cola, auditoría y anti-duplicado en la misma tabla.
CREATE TABLE notif_envios (
  id INTEGER PRIMARY KEY,
  socio_id INTEGER,
  evento TEXT NOT NULL,
  canal TEXT NOT NULL,
  clave_dedup TEXT NOT NULL,
  estado TEXT NOT NULL DEFAULT 'pendiente',  -- pendiente | enviado | fallido | omitido
  motivo TEXT,
  proveedor_id TEXT,                    -- id de Resend o endpoint de push, para rastrear
  programado TEXT,                      -- cuándo debe salir; NULL = ya
  intentos INTEGER NOT NULL DEFAULT 0,
  creado TEXT NOT NULL DEFAULT (datetime('now')),
  enviado TEXT
);
-- Este índice ES el mecanismo anti-duplicado: se reclama el envío insertando.
CREATE UNIQUE INDEX ux_notif_dedup ON notif_envios(clave_dedup, canal);
CREATE INDEX idx_notif_pend ON notif_envios(estado, programado);
CREATE INDEX idx_notif_socio ON notif_envios(socio_id, creado DESC);

-- Semilla del catálogo. Todos nacen APAGADOS (activo = 0): el panel decide
-- qué se prende. Los textos son el punto de partida y se editan desde ahí.
INSERT INTO notif_eventos (clave, nombre, descripcion, familia, obligatorio, canales, def_push, def_mail, dias_antes, asunto, cuerpo, push_titulo, push_texto) VALUES
('reprocann_por_vencer', 'Tu credencial está por vencer',
 'Sale cuando faltan los días configurados para que se venza el REPROCANN del socio. Ya se lo prometemos en la página de privacidad.',
 'recordatorio', 0, 'push,mail', 1, 1, 30,
 'Tu REPROCANN vence el {vence}',
 'Hola {nombre}, tu credencial de REPROCANN vence el {vence}. Renovarla lleva unos días, así que conviene arrancar ahora. Escribinos y lo hacemos juntos.',
 'Tu REPROCANN vence pronto', 'Vence el {vence}. Tocá para renovarlo.'),

('reprocann_vencido', 'Se te venció la credencial',
 'Sale el día que la credencial pasó a vencida. Sin credencial vigente no puede retirar.',
 'recordatorio', 0, 'push,mail', 1, 1, 0,
 'Se venció tu REPROCANN',
 'Hola {nombre}, tu credencial venció el {vence}. Hasta que la renueves no vas a poder retirar. Escribinos y arrancamos la renovación.',
 'Se venció tu REPROCANN', 'Escribinos y lo renovamos.'),

('reprocann_te_toca', 'Te toca un paso del trámite',
 'Sale cuando el trámite quedó esperando algo del socio (firmar el consentimiento, cargar su código) y no se movió en los días configurados. Ya se lo prometemos en la página de REPROCANN.',
 'recordatorio', 0, 'push,mail', 1, 1, 3,
 'Falta un paso tuyo para tu REPROCANN',
 'Hola {nombre}, tu trámite está frenado esperándote a vos: {paso}. Es un minuto y seguimos nosotros.',
 'Falta un paso tuyo', '{paso}'),

('reserva_lista', 'Tu reserva está lista',
 'Sale cuando el club marca la reserva como lista para retirar.',
 'transaccional', 0, 'push,mail', 1, 1, NULL,
 'Tu reserva está lista 🌿',
 'Hola {nombre}, tu reserva ya está lista para que la pases a buscar. {items}',
 'Tu reserva está lista', 'Pasá cuando quieras a retirarla.'),

('pago_acreditado', 'Recibimos tu pago',
 'Sale cuando entra un pago por Mercado Pago. Hoy no se manda nada: el socio paga y no recibe confirmación.',
 'transaccional', 0, 'push,mail', 1, 1, NULL,
 'Recibimos tu pago 🌿',
 'Hola {nombre}, recibimos tu pago de {monto}. Tu cuota queda al día y tus gramos habilitados.',
 'Pago recibido', 'Tu cuota quedó al día.'),

('debito_por_terminar', 'Tu débito automático está por terminar',
 'El débito se autoriza por 3 cuotas y se corta solo. Sale antes de la última para poder renovarlo.',
 'recordatorio', 0, 'push,mail', 1, 1, 7,
 'Tu débito automático termina este mes',
 'Hola {nombre}, tu débito automático se autorizó por 3 meses y está por terminar. Si querés seguir con el descuento, renovalo acá.',
 'Tu débito termina este mes', 'Renovalo para seguir con el descuento.'),

('acceso_prueba_vence', 'Se te termina el acceso de prueba',
 'Sale antes de que se venza el acceso temporal a la carta, para que la persona no se quede afuera sin entender por qué.',
 'recordatorio', 0, 'push,mail', 1, 1, 2,
 'Tu acceso de prueba termina pronto',
 'Hola {nombre}, tu acceso para conocer la carta termina el {vence}. Si querés asociarte, escribinos y lo resolvemos.',
 'Tu acceso de prueba termina', 'Escribinos si querés asociarte.'),

('bienvenida', 'Bienvenida al club',
 'Sale al dar de alta a un socio nuevo. Hoy ya se manda por mail desde el alta.',
 'transaccional', 1, 'mail', 0, 1, NULL,
 'Bienvenido a Flora 🌿',
 'Hola {nombre}, ya sos parte de Flora. Entrá a la carta con tu cuenta de Google.',
 'Bienvenido a Flora', 'Ya podés entrar a la carta.'),

('genetica_disponible', 'Volvió una genética',
 'Aviso a quien haya pedido que le avisemos cuando vuelva una genética. Ya se lo prometemos en la carta.',
 'club', 0, 'push', 1, 0, NULL,
 'Volvió {genetica}',
 'Hola {nombre}, volvió {genetica} a la carta.',
 'Volvió {genetica}', 'Entrá a la carta para reservarla.');
