-- Panel del club v2 — esquema de finanzas (D1: flora-finanzas)
-- Modelo de cobro: contado devenga al retirar; débito automático = suscripción MP
-- con 20% renovable cada 3 meses seguidos. Saldo de gramos: débito acumula,
-- contado no genera saldo, los planes prepagos llevan el suyo por ventana.

-- Padrón: manda la hoja Pacientes del Excel; el email se completa cuando el
-- socio entra con Google (el login sigue en KV SOCIOS, acá vive la ficha).
CREATE TABLE socios (
  id INTEGER PRIMARY KEY,
  numero INTEGER UNIQUE,               -- nº de socio de la hoja Pacientes
  nombre TEXT NOT NULL,
  email TEXT UNIQUE,
  telefono TEXT,
  estado TEXT NOT NULL DEFAULT 'activo',      -- activo | inactivo
  reprocann TEXT,                      -- vinculado | autocultivo | pendiente…
  origen TEXT,
  nota TEXT,
  alta TEXT,                           -- ISO
  creado TEXT NOT NULL DEFAULT (datetime('now')),
  actualizado TEXT
);
CREATE INDEX idx_socios_nombre ON socios(nombre);

-- Listas de precios con vigencia: el histórico no se mueve cuando cambia la lista.
CREATE TABLE listas_precios (
  id INTEGER PRIMARY KEY,
  vigente_desde TEXT NOT NULL,
  tc_referencia REAL,                  -- ancla en dólares para actualizar
  nota TEXT,
  creada_por TEXT,
  creado TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE precios (
  id INTEGER PRIMARY KEY,
  lista_id INTEGER NOT NULL REFERENCES listas_precios(id),
  item TEXT NOT NULL,                  -- SMALL | MEDIUM | … | gotero-q1 | cartucho-thc-1ml | plan-15x12 | cuota-ong
  tipo TEXT NOT NULL,                  -- membresia | producto | plan | cuota_ong | preroll
  gramos REAL,                         -- membresías y planes
  valor_usd REAL,                      -- precio de referencia (no se cobra)
  contado INTEGER,                     -- ARS
  debito INTEGER,                      -- ARS con el 20%
  cupo INTEGER,
  UNIQUE (lista_id, item)
);

-- Qué membresía tiene cada socio y en qué modalidad. hasta NULL = vigente.
CREATE TABLE membresias (
  id INTEGER PRIMARY KEY,
  socio_id INTEGER NOT NULL REFERENCES socios(id),
  tier TEXT NOT NULL,                  -- SMALL/MEDIUM/LARGE/XL o plan-15x12/20x18/30x24
  modalidad TEXT NOT NULL,             -- contado | debito | plan
  gramos_mes REAL,
  desde TEXT NOT NULL,
  hasta TEXT,
  nota TEXT
);
CREATE INDEX idx_memb_socio ON membresias(socio_id, hasta);

-- Suscripciones de Mercado Pago (débito automático).
CREATE TABLE suscripciones (
  id INTEGER PRIMARY KEY,
  socio_id INTEGER NOT NULL REFERENCES socios(id),
  mp_preapproval_id TEXT UNIQUE,
  estado TEXT NOT NULL DEFAULT 'pendiente',   -- pendiente | activa | pausada | cancelada
  monto INTEGER NOT NULL,
  racha_meses INTEGER NOT NULL DEFAULT 0,     -- meses seguidos debitados; cada 3 renueva el 20%
  creado TEXT NOT NULL DEFAULT (datetime('now')),
  actualizado TEXT
);

-- El libro: todo ingreso y egreso. Los cargados por socios de la ONG quedan
-- pendiente_aprobacion hasta el visto bueno del dueño.
CREATE TABLE movimientos (
  id INTEGER PRIMARY KEY,
  fecha TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('ingreso','egreso')),
  categoria TEXT NOT NULL,             -- ingreso: membresia|producto|extra_gramos|cuota_ong|servicio — egreso: sueldos|alquiler|servicios|insumos|profesionales|seguridad|otros
  concepto TEXT NOT NULL,
  socio_id INTEGER REFERENCES socios(id),
  persona TEXT,                        -- egresos: quién pagó / a quién
  bruto INTEGER,
  comision INTEGER NOT NULL DEFAULT 0, -- comisión MP
  neto INTEGER NOT NULL,
  medio TEXT,                          -- efectivo | transferencia | mp | canje
  estado TEXT NOT NULL DEFAULT 'confirmado', -- pendiente_aprobacion | confirmado | anulado
  gramos REAL,                         -- membresías: gramos que habilita el pago
  origen TEXT NOT NULL DEFAULT 'manual',      -- manual | mp_webhook | reserva | migracion
  ref TEXT,                            -- id externo (pago MP, pedido)
  cargado_por TEXT NOT NULL,
  aprobado_por TEXT,
  creado TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_mov_fecha ON movimientos(fecha);
CREATE INDEX idx_mov_socio ON movimientos(socio_id, fecha);
CREATE INDEX idx_mov_tipo ON movimientos(tipo, categoria, fecha);

-- Plantilla de gastos fijos: el día 1 se generan como movimientos pendientes
-- con el monto del mes anterior. solo_dueno = sueldos y retiros.
CREATE TABLE gastos_fijos (
  id INTEGER PRIMARY KEY,
  nombre TEXT NOT NULL,
  categoria TEXT NOT NULL,
  persona TEXT,
  monto_estimado INTEGER,
  dia_vencimiento INTEGER,
  solo_dueno INTEGER NOT NULL DEFAULT 0,
  activo INTEGER NOT NULL DEFAULT 1
);

-- El mostrador: cada retiro físico. Descuenta saldo de gramos y stock.
CREATE TABLE dispensas (
  id INTEGER PRIMARY KEY,
  fecha TEXT NOT NULL,
  socio_id INTEGER NOT NULL REFERENCES socios(id),
  genetica_id TEXT,                    -- id del catálogo (KV GENETICAS)
  producto TEXT,                       -- aceites/cartuchos/cremas
  gramos REAL,
  unidades REAL,
  nota TEXT,
  cargado_por TEXT,
  creado TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_disp_socio ON dispensas(socio_id, fecha);
CREATE INDEX idx_disp_fecha ON dispensas(fecha);

-- Kardex: entradas (+) y salidas (−) por ítem. El saldo vivo es SUM(cantidad).
CREATE TABLE stock_mov (
  id INTEGER PRIMARY KEY,
  fecha TEXT NOT NULL,
  item TEXT NOT NULL,                  -- genetica_id o sku de producto
  clase TEXT NOT NULL,                 -- flor | preroll | aceite | cartucho | crema | bateria
  cantidad REAL NOT NULL,              -- gramos (flor) o unidades; + entrada, − salida
  motivo TEXT NOT NULL,                -- cosecha | compra | dispensa | ajuste | merma
  dispensa_id INTEGER REFERENCES dispensas(id),
  ubicacion TEXT,                      -- box 1…5
  nota TEXT,
  cargado_por TEXT,
  creado TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_stock_item ON stock_mov(item, fecha);

-- Capital fundacional en USD: aportes de socios y cuotas de la compra de la ONG.
-- Libro aparte del operativo; visible para todos los socios de la ONG.
CREATE TABLE aportes (
  id INTEGER PRIMARY KEY,
  fecha TEXT NOT NULL,
  aportante TEXT NOT NULL,
  tipo TEXT NOT NULL,                  -- aporte | gasto | cuota_compra
  concepto TEXT NOT NULL,
  monto_ars INTEGER,
  tc REAL,
  monto_usd REAL NOT NULL,
  destino TEXT,                        -- efectivo | banco | mp
  estado TEXT NOT NULL DEFAULT 'recibido',    -- recibido | pendiente
  nota TEXT
);

-- Personal: ficha por persona, solo la ve el dueño.
CREATE TABLE personal (
  id INTEGER PRIMARY KEY,
  nombre TEXT NOT NULL,
  rol TEXT,
  monto_mensual INTEGER,
  frecuencia TEXT NOT NULL DEFAULT 'mensual', -- mensual | semanal
  activo INTEGER NOT NULL DEFAULT 1,
  nota TEXT
);

-- Roles del panel (reemplaza ADMIN_EMAILS/SUPER_ADMIN_EMAILS):
-- dueno: todo · socio_ong: lectura total salvo sueldos · socio_ong_carga:
-- además carga movimientos (quedan pendientes) · mostrador: retiros y cobros del día.
CREATE TABLE accesos (
  email TEXT PRIMARY KEY,
  nombre TEXT,
  rol TEXT NOT NULL CHECK (rol IN ('dueno','socio_ong','socio_ong_carga','mostrador')),
  creado TEXT NOT NULL DEFAULT (datetime('now'))
);
