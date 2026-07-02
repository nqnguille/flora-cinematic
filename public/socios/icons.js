// Iconos compartidos para tags de sabor/efecto — usados en /socios/genetica y /socios/admin/geneticas.
// Set completo del mundo cannábico (no solo lo del catálogo actual) para genéticas futuras.
// Estilo: viewBox 24x24, stroke currentColor 1.7, round caps.
const _S = (p) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${p}</svg>`

window.FLORA_TAG_ICONS = {
  sabor: {
    // ── Cítricos ──
    citrico:  { label: 'Cítrico',  svg: _S('<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5v17M4.7 7.3l14.6 9.4M4.7 16.7l14.6-9.4"/>') },
    limon:    { label: 'Limón',    svg: _S('<path d="M5.5 13c0-3.3 2.9-5.6 6.5-5.6S18.5 9.7 18.5 13s-2.9 5.4-6.5 5.4S5.5 16.3 5.5 13z"/><path d="M12 7.4c.3-1.4 1.7-2.3 3.2-2"/>') },
    naranja:  { label: 'Naranja',  svg: _S('<circle cx="12" cy="13.2" r="6.2"/><path d="M12 7c.3-1.3 1.6-2 3-1.6"/><circle cx="12" cy="7.1" r="0.4" fill="currentColor" stroke="none"/>') },
    pomelo:   { label: 'Pomelo',   svg: _S('<circle cx="12" cy="12" r="8.2"/><path d="M12 3.8v16.4M3.8 12h16.4M6.15 6.15 17.85 17.85M17.85 6.15 6.15 17.85"/>') },
    agrio:    { label: 'Agrio',    svg: _S('<path d="M12 3v3.2M12 21c-4.5-1-7-4.6-7-8.6C5 9 7.2 6.5 12 6.5s7 2.5 7 5.9c0 4-2.5 7.6-7 8.6z"/><path d="M9 12.5l1.5 1.8L15 10"/>') },

    // ── Frutas ──
    frutal:        { label: 'Frutal',       svg: _S('<circle cx="8.5" cy="15.5" r="4"/><circle cx="16" cy="14" r="3.2"/><path d="M8.5 11.5V5c0-1 .8-2.2 2.4-2.2M16 10.8V6.5"/>') },
    'frutos-rojos':{ label: 'Frutos rojos', svg: _S('<circle cx="8.8" cy="14.5" r="3"/><circle cx="15.2" cy="14.5" r="3"/><circle cx="12" cy="9.8" r="3"/><path d="M12 6.8V4.2"/>') },
    frutilla:      { label: 'Frutilla',     svg: _S('<path d="M12 20.5c-3.7 0-6.3-2.9-6.3-6.1C5.7 11.3 8.2 9.4 12 9.4s6.3 1.9 6.3 5c0 3.2-2.6 6.1-6.3 6.1z"/><path d="M12 9.4V6M8.6 6.4 12 5.9l3.4.5"/>') },
    uva:           { label: 'Uva',          svg: _S('<circle cx="12" cy="8" r="2.1"/><circle cx="9.3" cy="12" r="2.1"/><circle cx="14.7" cy="12" r="2.1"/><circle cx="12" cy="16" r="2.1"/><path d="M12 5.9V3.4c1.4 0 2.4-.6 2.9-1.4"/>') },
    manzana:       { label: 'Manzana',      svg: _S('<path d="M12 8.4c-1-1.5-3-2-4.6-1C5.4 8.6 5 11 5.5 13.5 6 16.3 8 20 12 20s6-3.7 6.5-6.5c.5-2.5.1-4.9-1.9-5.9-1.6-1-3.6-.5-4.6.8z"/><path d="M12 8.4V6c0-1.4 1-2.5 2.5-2.6"/>') },
    durazno:       { label: 'Durazno',      svg: _S('<circle cx="12" cy="13.6" r="6.3"/><path d="M12 7.4c0 2-1 4-1.2 6M12 7.2c.5-1.2 1.8-1.8 3-1.4"/>') },
    banana:        { label: 'Banana',       svg: _S('<path d="M4.5 9c1 5 5 8.7 9.5 8.7 2.4 0 4.4-.8 5.8-2-2.9.5-8.5-1-11-4.4C6.9 8.7 6.4 6.8 6.7 4.8 5 5.8 4.1 7 4.5 9z"/>') },
    mango:         { label: 'Mango',        svg: _S('<path d="M15.4 6.6c3 1.5 4 5 2.5 8.4-1.6 3.6-5.2 5.4-8.8 4-3-1.2-4.1-4-3-6.9 1.4-3.5 5.4-7.2 9.3-5.5z"/><path d="M14.4 8c.8-1.2 2-1.6 3.3-1.2"/>') },
    tropical:      { label: 'Tropical',     svg: _S('<path d="M8.5 21h7c1 0 1.5-.7 1.5-1.7v-5.8c0-2.8-2.2-4.8-5-4.8s-5 2-5 4.8v5.8c0 1 .5 1.7 1.5 1.7z"/><path d="M12 8.7V6M12 6c-1.5 0-2.5-1-2.5-2.5C11 3.5 12 4.5 12 6zM12 6c1.5 0 2.5-1 2.5-2.5C13 3.5 12 4.5 12 6z"/><path d="M9.6 12.5l2 2 2-2 1.4 2"/>') },
    melon:         { label: 'Melón',        svg: _S('<circle cx="12" cy="12" r="8.5"/><path d="M6 7c2 2.5 2 7.5 0 10M12 4c-1.5 3.5-1.5 12.5 0 16M18 7c-2 2.5-2 7.5 0 10"/>') },
    sandia:        { label: 'Sandía',       svg: _S('<path d="M3.6 8.2h16.8"/><path d="M20.4 8.2a8.4 8.4 0 0 1-16.8 0"/><circle cx="9" cy="11.2" r="0.5" fill="currentColor" stroke="none"/><circle cx="12" cy="12.4" r="0.5" fill="currentColor" stroke="none"/><circle cx="15" cy="11.2" r="0.5" fill="currentColor" stroke="none"/>') },

    // ── Dulces ──
    dulce:     { label: 'Dulce',     svg: _S('<path d="M8 8l-3.5-3.5M16 8l3.5-3.5M8 16l-3.5 3.5M16 16l3.5 3.5"/><path d="M8.5 8.5a5 5 0 0 1 7 7 5 5 0 0 1-7-7z"/>') },
    caramelo:  { label: 'Caramelo',  svg: _S('<circle cx="12" cy="12" r="4"/><path d="M8 12 4 9.3v5.4zM16 12l4-2.7v5.4z"/>') },
    vainilla:  { label: 'Vainilla',  svg: _S('<path d="M9 3.5c-1.1 6-1.1 11 .5 17M13 4c1.6 5.5 1.6 10.5 0 16"/>') },
    chocolate: { label: 'Chocolate', svg: _S('<rect x="5" y="6" width="14" height="12" rx="1.5"/><path d="M5 10h14M5 14h14M9.7 6v12M14.3 6v12"/>') },
    miel:      { label: 'Miel',      svg: _S('<path d="M9 4h6l3 5-3 5H9l-3-5z"/><path d="M12 14v6"/>') },
    cafe:      { label: 'Café',      svg: _S('<path d="M5 9h11v3.5a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4z"/><path d="M16 10h1.6a2 2 0 0 1 0 4H16"/><path d="M8 3.5c-.6.8-.6 1.7 0 2.5M12 3.5c-.6.8-.6 1.7 0 2.5"/>') },
    nuez:      { label: 'Nuez',      svg: _S('<path d="M12 3c4 2 6 5.5 6 9 0 4.5-3 8-6 9-3-1-6-4.5-6-9 0-3.5 2-7 6-9z"/><path d="M12 4v16M8.2 9c2 1 5.6 1 7.6 0M7.6 14c2.6 1.2 6.2 1.2 8.8 0"/>') },

    // ── Terroso / especias / gas ──
    terroso:    { label: 'Terroso',    svg: _S('<path d="M3 19h18M12 19V9M12 9 7 4M12 9l5-5M12 13 8 9.5M12 13l4.5-3.5"/>') },
    amaderado:  { label: 'Amaderado',  svg: _S('<circle cx="12" cy="12" r="8.5"/><path d="M12 12m-5 -0.5a5 4.5 0 1 0 10 0a5 4.5 0 1 0 -10 0"/><path d="M12 12m-2 0a2 1.6 0 1 0 4 0a2 1.6 0 1 0 -4 0"/>') },
    pino:       { label: 'Pino',       svg: _S('<path d="M12 3 7.5 10H10l-3.2 5H10l-1 4h6l-1-4h3.2L14 10h2.5z"/><path d="M12 19v2"/>') },
    herbal:     { label: 'Herbal',     svg: _S('<path d="M12 21c-4-2-6-6-6-11 4 1 6 4 6 8M12 21c4-2 6-6 6-11-4 1-6 4-6 8M12 21V8"/>') },
    lavanda:    { label: 'Lavanda',    svg: _S('<path d="M12 21v-8"/><path d="M12 13c-1.5-1-2-3-1.5-4.5.5 1 1.5 1.5 1.5 1.5s1-.5 1.5-1.5C15 10 14.5 12 12 13z"/><path d="M12 8c-1.3-.9-1.7-2.6-1.3-4 .5.9 1.3 1.3 1.3 1.3s.8-.4 1.3-1.3c.4 1.4 0 3.1-1.3 4z"/>') },
    mentolado:  { label: 'Mentolado',  svg: _S('<path d="M12 21s7-5.2 7-11.4A7 6.4 0 0 0 12 3a7 6.4 0 0 0-7 6.6C5 15.8 12 21 12 21z"/><path d="M12 21V9"/>') },
    floral:     { label: 'Floral',     svg: _S('<circle cx="12" cy="12" r="2.3"/><path d="M12 9.7C10 8 10 4.5 12 3c2 1.5 2 5 0 6.7zM12 14.3c2 1.7 2 5.2 0 6.7-2-1.5-2-5 0-6.7zM14.3 12c1.7-2 5.2-2 6.7 0-1.5 2-5 2-6.7 0zM9.7 12C8 14 4.5 14 3 12c1.5-2 5-2 6.7 0z"/>') },
    picante:    { label: 'Picante',    svg: _S('<path d="M9 4c2 0 2.5 1.6 2.5 2.8 0 2-2 2-2 4.4 0 1.6 1.2 2 1.2 3.6C10.7 17.5 8.6 19 6.5 19 4 19 3 16.8 3 15c0-3.5 2.8-4 2.8-6.6C5.8 6 7 4 9 4z"/><path d="M13 6c2.3 0 4.5 1.8 4.5 5.5S16 19 13.5 19"/>') },
    pimienta:   { label: 'Pimienta',   svg: _S('<circle cx="8.5" cy="9" r="1.7"/><circle cx="15" cy="8" r="1.5"/><circle cx="12" cy="14.5" r="1.9"/><path d="M8.5 6.5v-1M6.3 9H5.3M15 5.9v-1M17.2 8h1M12 11.9v-1M9.6 14.5h-1M15.4 14.5h1"/>') },
    diesel:     { label: 'Diesel',     svg: _S('<path d="M5 20V6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v14"/><path d="M4 20h10"/><path d="M6.5 8h5"/><path d="M13 9l2.2 2.2V16a1.4 1.4 0 0 0 2.8 0V9.2l-1.8-1.8"/>') },
    queso:      { label: 'Queso',      svg: _S('<path d="M3.5 17 14 8l5.5 9z"/><circle cx="10" cy="15" r="0.7" fill="currentColor" stroke="none"/><circle cx="14" cy="14.5" r="0.6" fill="currentColor" stroke="none"/>') },
    skunk:      { label: 'Skunk',      svg: _S('<path d="M5 8c2-2 4 2 6 0s4-2 6 0M5 13c2-2 4 2 6 0s4-2 6 0M5 18c2-2 4 2 6 0s4-2 6 0"/>') },
  },

  efecto: {
    // ── Estado de ánimo ──
    feliz:       { label: 'Feliz',        svg: _S('<circle cx="12" cy="12" r="9"/><path d="M8.5 14c.8 1.5 2 2.3 3.5 2.3s2.7-.8 3.5-2.3"/><circle cx="9" cy="10" r="0.6" fill="currentColor" stroke="none"/><circle cx="15" cy="10" r="0.6" fill="currentColor" stroke="none"/>') },
    euforico:    { label: 'Eufórico',     svg: _S('<circle cx="12" cy="12" r="4.3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1"/>') },
    risa:        { label: 'Risa',         svg: _S('<circle cx="12" cy="12" r="9"/><path d="M7 13h10a5 5 0 0 1-10 0z"/><path d="M8 9.2l2 1M16 9.2l-2 1"/>') },
    creativo:    { label: 'Creativo',     svg: _S('<path d="M9 18h6M10 21h4M8 9.5A4 4 0 0 1 12 5.5a4 4 0 0 1 4 4c0 2-1.3 2.8-2 4-.4.7-.6 1.3-.6 2.5H10.6c0-1.2-.2-1.8-.6-2.5-.7-1.2-2-2-2-4z"/>') },
    social:      { label: 'Social',       svg: _S('<circle cx="8.5" cy="8" r="3"/><circle cx="16.5" cy="9.5" r="2.3"/><path d="M3 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5M14 15.2c2.7.2 4.7 1.9 4.7 4.3"/>') },
    locuaz:      { label: 'Locuaz',       svg: _S('<path d="M4 5h11a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H9l-4 3v-3H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z"/>') },
    afrodisiaco: { label: 'Afrodisíaco',  svg: _S('<path d="M12 20.5S4.5 16 4.5 10.2A3.8 3.8 0 0 1 12 8a3.8 3.8 0 0 1 7.5 2.2C19.5 16 12 20.5 12 20.5z"/><path d="M12 8c0-1.5 1-2 1-3.2 0 0 1.5 1 1.5 2.7"/>') },

    // ── Energía / mente ──
    energizante:   { label: 'Energizante',   svg: _S('<path d="M13 3 5 13.5h5.5L11 21l8-11h-5.5z"/>') },
    estimulante:   { label: 'Estimulante',   svg: _S('<path d="M4 16l5-5 3 3 8-8M15 6h5v5"/>') },
    concentracion: { label: 'Concentración', svg: _S('<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="0.6" fill="currentColor" stroke="none"/>') },
    cerebral:      { label: 'Cerebral',      svg: _S('<path d="M12 4.5C10 3 7 4 7 7c-2 .5-2.5 3-1 4.5-1 1.5 0 3.5 2 3.5.5 1.5 2 2.5 4 2z"/><path d="M12 4.5C14 3 17 4 17 7c2 .5 2.5 3 1 4.5 1 1.5 0 3.5-2 3.5-.5 1.5-2 2.5-4 2z"/><path d="M12 4.5V17"/>') },
    introspectivo: { label: 'Introspectivo',svg: _S('<path d="M13.5 12a1.5 1.5 0 1 1-1.5-1.5 4 4 0 1 1 4 4 6.5 6.5 0 1 1-6.5-6.5"/>') },
    meditativo:    { label: 'Meditativo',    svg: _S('<circle cx="12" cy="5.5" r="2"/><path d="M12 8v3.5M12 11.5c-3 0-5 2-5 4.5h10c0-2.5-2-4.5-5-4.5zM7.5 16 5 18M16.5 16 19 18"/>') },

    // ── Cuerpo / relax ──
    relajante:    { label: 'Relajante',      svg: _S('<path d="M20.5 14.5A8.5 8.2 0 1 1 9.5 3.5a6.8 6.5 0 0 0 11 11z"/>') },
    calmante:     { label: 'Calmante',       svg: _S('<path d="M12 20c-2-1-3.5-3.5-3.5-6.5 0-2.5 1.3-4.6 3.5-6.5 2.2 1.9 3.5 4 3.5 6.5 0 3-1.5 5.5-3.5 6.5z"/><path d="M12 20c-4 0-7-2.4-7-5.8 2 0 3.6.8 4.6 2M12 20c4 0 7-2.4 7-5.8-2 0-3.6.8-4.6 2"/>') },
    somnoliento:  { label: 'Somnoliento',    svg: _S('<path d="M4 8h5l-5 6h5M11 5h4l-4 5h4M17.5 4h3l-3 4h3"/>') },
    'couch-lock': { label: 'Relax profundo', svg: _S('<path d="M4 13V9.5A1.5 1.5 0 0 1 5.5 8h13A1.5 1.5 0 0 1 20 9.5V13"/><path d="M4.5 13A1.5 1.5 0 0 0 3 14.5v3a1.5 1.5 0 0 0 1.5 1.5h15a1.5 1.5 0 0 0 1.5-1.5v-3a1.5 1.5 0 0 0-3 0V16H7.5v-1.5A1.5 1.5 0 0 0 4.5 13z"/><path d="M6 19v1.5M18 19v1.5"/>') },
    corporal:     { label: 'Corporal',       svg: _S('<circle cx="12" cy="5" r="2.3"/><path d="M12 7.5v7M12 10 7.5 8.2M12 10l4.5-1.8M12 14.5l-3 6.5M12 14.5l3 6.5"/>') },
    equilibrado:  { label: 'Equilibrado',    svg: _S('<path d="M12 3v15M6 8h12M6 8l-3 6h6zM18 8l-3 6h6z"/><path d="M8 21h8"/>') },

    // ── Medicinal ──
    terapeutico:      { label: 'Terapéutico',     svg: _S('<path d="M12 21s-7.5-4.7-9.8-9.4C.8 8 2.6 4.5 6 4c2.3-.3 4.3.9 6 3 1.7-2.1 3.7-3.3 6-3 3.4.5 5.2 4 3.8 7.6C19.5 16.3 12 21 12 21z"/><path d="M12 8v6M9 11h6"/>') },
    analgesico:       { label: 'Alivio del dolor',svg: _S('<rect x="2.8" y="9" width="18.4" height="6" rx="3" transform="rotate(-45 12 12)"/><path d="M10 10l4 4M14 10l-4 4"/>') },
    antiinflamatorio: { label: 'Antiinflamatorio',svg: _S('<path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z"/><path d="M9 12l2 2 4-4"/>') },
    antinauseas:      { label: 'Antináuseas',     svg: _S('<circle cx="12" cy="12" r="9"/><path d="M6.5 13c1.5-1.5 3-1.5 5 0s3.5 1.5 6 0"/>') },
    apetito:          { label: 'Apetito',         svg: _S('<path d="M7 3v18M5 3v5.5M9 3v5.5M5 8.5h4"/><path d="M17 3v18M17 3c-2 0-2 6.5 0 6.5"/>') },
    sedante:          { label: 'Sedante',         svg: _S('<path d="M4 18h8M6 14h6M8 10h6M6 18l6-8M8 10l4-6"/>') },
  },
}
