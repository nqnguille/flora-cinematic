// El embudo del trámite, en orden. `quien` = de quién depende que avance:
// eso es lo que convierte una lista de estados en una lista de acciones.
// Compartido entre el endpoint del embudo, la lista maestra del padrón y el
// detalle del socio.
export const PASOS: { id: string; nombre: string; quien: string; ayuda: string }[] = [
  { id: 'sin_iniciar', nombre: 'Sin iniciar', quien: 'club', ayuda: 'Todavía no arrancó el trámite.' },
  { id: 'esperando_codigo', nombre: 'Esperando su código', quien: 'paciente', ayuda: 'Tiene que generar su código de vinculación en Mi Argentina.' },
  { id: 'codigo_listo', nombre: 'Código listo', quien: 'medico', ayuda: 'Ya tenemos el código: le toca a Ezequiel cargar el trámite.' },
  { id: 'cargado', nombre: 'Esperando su firma', quien: 'paciente', ayuda: 'El médico cargó el trámite; el paciente tiene que aceptar el consentimiento desde su cuenta.' },
  { id: 'observado', nombre: 'Observado por el paciente', quien: 'paciente', ayuda: 'El paciente objetó algo del trámite.' },
  { id: 'a_vincular', nombre: 'Nos toca vincular', quien: 'club', ayuda: 'El paciente ya firmó: Flora tiene que vincularlo como su cultivadora.' },
  { id: 'en_evaluacion', nombre: 'En evaluación', quien: 'organismo', ayuda: 'Ya está todo hecho de nuestro lado; espera al Ministerio.' },
  { id: 'revision_medica', nombre: 'Volvió al médico', quien: 'medico', ayuda: 'El organismo pidió correcciones al profesional.' },
  { id: 'aprobado', nombre: 'Aprobado', quien: '—', ayuda: 'Certificado vigente.' },
  { id: 'autocultivo', nombre: 'Autocultivo', quien: 'club', ayuda: 'Cultiva por su cuenta. Se le puede ofrecer pasarse a Flora con una declaración jurada.' },
  // Desvío de conversión: sale de 'autocultivo' y vuelve al camino normal en
  // 'esperando_codigo'. Son las modalidades excluyentes de la Res. 1780/2025:
  // para vincularse a Flora tiene que renunciar al autocultivo, y eso se
  // documenta con la declaración jurada firmada.
  { id: 'ddjj_pendiente', nombre: 'Declaración pendiente', quien: 'paciente', ayuda: 'Le generamos la declaración jurada para pasarse a Flora: falta que la firme y nos la mande.' },
  { id: 'ddjj_firmada', nombre: 'Declaración firmada', quien: 'club', ayuda: 'Ya firmó: hay que dar de baja su autocultivo y arrancar la vinculación con Flora.' },
  { id: 'revisar', nombre: 'A revisar', quien: 'club', ayuda: 'Viene del Excel sin dato claro: hay que confirmar en qué anda.' },
  { id: 'rechazado', nombre: 'Rechazado', quien: 'club', ayuda: 'El organismo lo rechazó.' },
  { id: 'vencido', nombre: 'Vencido', quien: 'club', ayuda: 'El certificado venció: hay que renovar.' },
];
