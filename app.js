const API_URL = "https://script.google.com/macros/s/AKfycbwBIDKN21f3b3N0lxfuOTVlb6OfduAoFOasFHF4ObxLN1C6zV7JWgrDQvCkZTwSgfmtSw/exec";
const CLAVE_KEY = "compras_clave";
const CONFIG_KEY = "compras_config_cache";
const DB_NOMBRE = "compras-offline";
const DB_VERSION = 1;
const TIENDA_COLA = "cola";
if (window.pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
}

// ---------------------------------------------------------------------------------------------- utilidades
const $ = (id) => document.getElementById(id);

function mostrarToast(texto, ms = 3000) {
  const t = $("toast");
  t.textContent = texto;
  t.classList.remove("oculto");
  clearTimeout(mostrarToast._t);
  mostrarToast._t = setTimeout(() => t.classList.add("oculto"), ms);
}

function hoyIso() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function idNuevo() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
}

function fileABase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1]);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

// ---------------------------------------------------------------------------------------------- llamadas al backend
async function llamar(accion, datos = {}) {
  const clave = localStorage.getItem(CLAVE_KEY);
  const cuerpo = JSON.stringify(Object.assign({ clave, accion }, datos));
  const resp = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: cuerpo,
  });
  if (!resp.ok) throw new Error("HTTP " + resp.status);
  const json = await resp.json();
  if (!json.ok) {
    if (json.error === "Clave incorrecta") {
      // la clave guardada en este celular ya no sirve (la cambiaron desde Ajustes.gs): vuelve a pedirla
      localStorage.removeItem(CLAVE_KEY);
      location.reload();
    }
    throw new Error(json.error || "Error desconocido");
  }
  return json;
}

// ---------------------------------------------------------------------------------------------- IndexedDB (cola sin conexion)
function abrirDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NOMBRE, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(TIENDA_COLA)) {
        db.createObjectStore(TIENDA_COLA, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function encolar(payload) {
  const db = await abrirDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(TIENDA_COLA, "readwrite");
    tx.objectStore(TIENDA_COLA).put({ id: payload.id, payload, creado: Date.now() });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function listarCola() {
  const db = await abrirDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(TIENDA_COLA, "readonly");
    const req = tx.objectStore(TIENDA_COLA).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function quitarDeCola(id) {
  const db = await abrirDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(TIENDA_COLA, "readwrite");
    tx.objectStore(TIENDA_COLA).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function sincronizarCola() {
  let cola;
  try { cola = await listarCola(); } catch { return; }
  if (!cola.length) { actualizarAvisoCola(0); return; }
  let subidas = 0;
  for (const item of cola) {
    try {
      await llamar("agregar", item.payload);
      await quitarDeCola(item.id);
      subidas++;
    } catch (e) {
      // sigue sin conexion o fallo puntual: se reintenta en la proxima sincronizacion
      break;
    }
  }
  const restante = (await listarCola()).length;
  actualizarAvisoCola(restante);
  if (subidas > 0) {
    mostrarToast(subidas === 1 ? "1 compra pendiente se subio" : `${subidas} compras pendientes se subieron`);
    cargarResumenYLista();
  }
}

function actualizarAvisoCola(n) {
  const aviso = $("aviso-cola");
  if (n > 0) {
    aviso.textContent = `⏳ ${n} compra${n === 1 ? "" : "s"} guardada${n === 1 ? "" : "s"} en el celular, esperando subir…`;
    aviso.classList.remove("oculto");
  } else {
    aviso.classList.add("oculto");
  }
}

// ---------------------------------------------------------------------------------------------- pantalla de clave
async function intentarEntrar(clave) {
  localStorage.setItem(CLAVE_KEY, clave);
  try {
    await llamar("ping");
    return true;
  } catch (e) {
    localStorage.removeItem(CLAVE_KEY);
    return false;
  }
}

function mostrarApp() {
  $("pantalla-clave").classList.add("oculto");
  $("app").classList.remove("oculto");
  iniciarApp();
}

$("form-clave").addEventListener("submit", async (e) => {
  e.preventDefault();
  const boton = $("boton-entrar");
  const clave = $("input-clave").value.trim();
  if (!clave) return;
  boton.disabled = true;
  boton.textContent = "Entrando…";
  $("error-clave").textContent = "";
  const ok = await intentarEntrar(clave);
  boton.disabled = false;
  boton.textContent = "Entrar";
  if (ok) {
    mostrarApp();
  } else {
    $("error-clave").textContent = navigator.onLine
      ? "Clave incorrecta."
      : "Sin conexion para verificar la clave. Intenta de nuevo con internet la primera vez.";
  }
});

$("boton-salir").addEventListener("click", () => {
  if (!confirm("¿Cerrar sesion en este celular?")) return;
  localStorage.removeItem(CLAVE_KEY);
  location.reload();
});

// ---------------------------------------------------------------------------------------------- config (categorias/metodos/moneda)
let configCache = null;

async function obtenerConfig() {
  try {
    const c = await llamar("config");
    configCache = c;
    localStorage.setItem(CONFIG_KEY, JSON.stringify(c));
    return c;
  } catch (e) {
    const guardado = localStorage.getItem(CONFIG_KEY);
    if (guardado) { configCache = JSON.parse(guardado); return configCache; }
    throw e;
  }
}

function llenarSelect(select, opciones, seleccionar) {
  select.innerHTML = "";
  opciones.forEach(({ valor, texto }) => {
    const op = document.createElement("option");
    op.value = valor;
    op.textContent = texto;
    select.appendChild(op);
  });
  if (seleccionar) select.value = seleccionar;
}

function llenarFormularioConConfig(prefijo = "c", moneda = "PEN", metodo = "empresa") {
  if (!configCache) return;
  llenarSelect($(prefijo + "-moneda"), configCache.monedas.map((m) => ({ valor: m, texto: m })), moneda);
  llenarSelect($(prefijo + "-categoria"), configCache.categorias.map((c) => ({ valor: c, texto: c })));
  llenarSelect($(prefijo + "-metodo"), Object.entries(configCache.metodos).map(([k, v]) => ({ valor: k, texto: v })), metodo);
}

// ---------------------------------------------------------------------------------------------- resumen y lista
function formatoMoneda(n, moneda) {
  return `${moneda} ${Number(n).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const MES_HOY = hoyIso().slice(0, 7);
let mesActual = MES_HOY;

function irAMes(nuevo) {
  if (nuevo > MES_HOY) return; // no tiene sentido navegar al futuro
  mesActual = nuevo;
  $("resumen-mes-label").textContent = mesActual === MES_HOY ? `Este mes (${mesActual})` : mesActual;
  $("resumen-total").textContent = "Cargando…";
  $("resumen-detalle").innerHTML = "";
  $("conciliacion-estado").innerHTML = "";
  conciliacionAbierta = false;
  cargarResumenYLista();
}

function desplazarMes(delta) {
  const [a, m] = mesActual.split("-").map(Number);
  const d = new Date(a, m - 1 + delta, 1);
  irAMes(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
}

$("mes-anterior").addEventListener("click", () => desplazarMes(-1));
$("mes-siguiente").addEventListener("click", () => desplazarMes(1));

$("resumen-mes-label").addEventListener("click", () => {
  const input = $("selector-mes-input");
  input.value = mesActual;
  input.max = MES_HOY;
  if (input.showPicker) input.showPicker(); else input.click();
});
$("selector-mes-input").addEventListener("change", (e) => { if (e.target.value) irAMes(e.target.value); });

let ultimaConciliacion = null;
let conciliacionAbierta = false;
let ultimasCompras = [];

$("lista-compras").addEventListener("click", (e) => {
  const item = e.target.closest(".compra-item");
  if (!item) return;
  const compra = ultimasCompras[Number(item.dataset.idx)];
  if (compra) abrirEditar(compra);
});

function renderConciliacion(conc, alternarAbierto) {
  if (alternarAbierto) conciliacionAbierta = !conciliacionAbierta;
  const sinFactura = conc.movimientos_sin_factura;
  const sinMovimiento = conc.gastos_sin_movimiento;
  const estado = $("conciliacion-estado");

  if (!sinFactura.length && !sinMovimiento.length) {
    estado.className = "ok";
    estado.innerHTML = "✓ Mes conciliado: todo el banco tiene factura";
    return;
  }

  estado.className = "pendiente";
  const partes = [];
  if (sinFactura.length) partes.push(`${sinFactura.length} movimiento${sinFactura.length === 1 ? "" : "s"} sin factura`);
  if (sinMovimiento.length) partes.push(`${sinMovimiento.length} factura${sinMovimiento.length === 1 ? "" : "s"} sin movimiento`);
  let html = `<div class="conciliacion-resumen">⚠ ${partes.join(", ")} <span class="ver-mas">${conciliacionAbierta ? "ocultar" : "ver cuales"}</span></div>`;

  if (conciliacionAbierta) {
    sinMovimiento.forEach((g) => {
      html += `<div class="conciliacion-item">🧾 ${escaparHtml(g.proveedor)} — ${g.fecha} — ${formatoMoneda(g.monto, g.moneda)}<div class="conciliacion-motivo">Registrada como "${escaparHtml(g.metodo)}" pero no aparece cargo bancario que le calce</div></div>`;
    });
    sinFactura.forEach((m, i) => {
      html += `<div class="conciliacion-item">🏦 ${escaparHtml(m.descripcion)} — ${m.fecha} — ${formatoMoneda(Math.abs(m.monto), m.moneda)}<div class="conciliacion-motivo">Salio del banco (${escaparHtml(m.cuenta)}) y no tiene ninguna compra registrada que le calce</div><button class="boton-resolver" type="button" data-idx="${i}">Resolver</button></div>`;
    });
  }
  estado.innerHTML = html;
}

$("conciliacion-estado").addEventListener("click", (e) => {
  const boton = e.target.closest(".boton-resolver");
  if (boton) {
    e.stopPropagation();
    const mov = ultimaConciliacion.movimientos_sin_factura[Number(boton.dataset.idx)];
    if (mov) abrirResolver(mov);
    return;
  }
  if (ultimaConciliacion) renderConciliacion(ultimaConciliacion, true);
});

async function cargarResumenYLista() {
  $("mes-siguiente").disabled = mesActual >= MES_HOY;
  const mes = mesActual;
  try {
    const [resumen, lista, conc] = await Promise.all([
      llamar("resumen", { mes }), llamar("listar", { mes }), llamar("conciliacion", { mes }),
    ]);
    if (mes !== mesActual) return; // el usuario ya cambio de mes de nuevo mientras esto cargaba

    $("devolver-total").textContent = resumen.por_devolver.n > 0
      ? "USD " + resumen.por_devolver.usd.toFixed(2) : "Al dia, nada pendiente";

    $("resumen-total").textContent = "USD " + resumen.gasto.usd.toFixed(2) + " aprox.";
    let detalle = "";
    ["PEN", "USD", "EUR"].forEach((m) => {
      if (resumen.gasto[m]) detalle += `<div class="resumen-fila"><span>${m}</span><span>${resumen.gasto[m].toFixed(2)}</span></div>`;
    });
    $("resumen-detalle").innerHTML = detalle;

    ultimaConciliacion = conc;
    renderConciliacion(conc, false);

    const cont = $("lista-compras");
    ultimasCompras = lista.compras.slice(0, 15);
    if (!ultimasCompras.length) {
      cont.innerHTML = '<div class="vacio">Sin compras este mes todavia</div>';
    } else {
      cont.innerHTML = ultimasCompras.map((c, i) => `
        <div class="compra-item" data-idx="${i}">
          <div class="compra-info">
            <div class="compra-proveedor">${escaparHtml(c.proveedor)}</div>
            <div class="compra-meta">${c.fecha} · ${escaparHtml(c.categoria)}${c.estado === "Pendiente" ? '<span class="pill pendiente">por devolver</span>' : ""}</div>
          </div>
          <div class="compra-monto">${formatoMoneda(c.monto, c.moneda)}</div>
        </div>
      `).join("");
    }
  } catch (e) {
    if (!navigator.onLine) {
      $("lista-compras").innerHTML = '<div class="vacio">Sin conexion — conectate para ver el resumen</div>';
    } else {
      $("lista-compras").innerHTML = '<div class="vacio">No se pudo cargar</div>';
    }
  }
}

function escaparHtml(s) {
  const d = document.createElement("div");
  d.textContent = s == null ? "" : String(s);
  return d.innerHTML;
}

// ---------------------------------------------------------------------------------------------- pantalla de registro
let fotoActual = null; // { mime, base64 }

function abrirRegistro() {
  fotoActual = null;
  $("form-compra").reset();
  $("c-fecha").value = hoyIso();
  llenarFormularioConConfig();
  $("captura-zona").classList.remove("tiene-foto");
  $("captura-zona").innerHTML = '<span class="icono">📷</span><div>Toca para elegir una foto, PDF o tomar la foto ahora</div><input type="file" accept="image/*,application/pdf" id="input-foto" class="oculto">';
  $("input-foto").addEventListener("change", onFotoSeleccionada);
  $("estado-lectura").classList.add("oculto");
  $("pantalla-registro").classList.remove("oculto");
}

function cerrarRegistro() {
  $("pantalla-registro").classList.add("oculto");
}

$("boton-nueva").addEventListener("click", abrirRegistro);
$("boton-cerrar-registro").addEventListener("click", cerrarRegistro);
$("boton-cancelar-registro").addEventListener("click", cerrarRegistro);
$("captura-zona").addEventListener("click", () => $("input-foto").click());

async function onFotoSeleccionada(e) {
  const file = e.target.files[0];
  if (!file) return;
  const base64 = await fileABase64(file);
  fotoActual = { mime: file.type || "image/jpeg", base64 };

  const zona = $("captura-zona");
  zona.classList.add("tiene-foto");
  const url = URL.createObjectURL(file);
  zona.innerHTML = fotoActual.mime === "application/pdf"
    ? `<div class="pdf-preview">📄 ${escaparHtml(file.name)}</div>`
    : `<img src="${url}" alt="">`;
  const nuevoInput = document.createElement("input");
  nuevoInput.type = "file"; nuevoInput.accept = "image/*,application/pdf";
  nuevoInput.id = "input-foto"; nuevoInput.className = "oculto";
  zona.appendChild(nuevoInput);
  nuevoInput.addEventListener("change", onFotoSeleccionada);

  if (!navigator.onLine) return; // sin conexion: se llena a mano, no se intenta leer
  $("estado-lectura").classList.remove("oculto");
  try {
    const r = await llamar("leer_factura", { archivo: fotoActual });
    if (r.proveedor) $("c-proveedor").value = r.proveedor;
    if (r.fecha) $("c-fecha").value = r.fecha;
    if (r.monto) $("c-monto").value = r.monto;
    if (r.moneda) $("c-moneda").value = r.moneda;
    if (r.comprobante) $("c-comprobante").value = r.comprobante;
    if (r.categoria_sugerida && configCache && configCache.categorias.includes(r.categoria_sugerida)) {
      $("c-categoria").value = r.categoria_sugerida;
    }
  } catch (err) {
    // la lectura automatica es "best effort": si falla, el usuario llena a mano sin bloquear nada
  } finally {
    $("estado-lectura").classList.add("oculto");
  }
}

$("boton-guardar").addEventListener("click", async () => {
  const proveedor = $("c-proveedor").value.trim();
  const monto = parseFloat($("c-monto").value);
  const fecha = $("c-fecha").value;
  if (!proveedor || !fecha || !monto || monto <= 0) {
    mostrarToast("Falta proveedor, fecha o monto valido");
    return;
  }
  const payload = {
    id: idNuevo(),
    fecha,
    proveedor,
    concepto: $("c-concepto").value.trim(),
    categoria: $("c-categoria").value,
    comprobante: $("c-comprobante").value.trim(),
    moneda: $("c-moneda").value,
    monto,
    metodo: $("c-metodo").value,
    nota: $("c-nota").value.trim(),
  };
  if (fotoActual) payload.archivo = fotoActual;

  const boton = $("boton-guardar");
  boton.disabled = true; boton.textContent = "Guardando…";
  try {
    await llamar("agregar", payload);
    mostrarToast("Compra registrada");
    cerrarRegistro();
    cargarResumenYLista();
  } catch (e) {
    if (!navigator.onLine || e.message === "Failed to fetch") {
      await encolar(payload);
      actualizarAvisoCola((await listarCola()).length);
      mostrarToast("Sin conexion: guardado en el celular, se subira solo");
      cerrarRegistro();
    } else {
      mostrarToast("Error: " + e.message);
    }
  } finally {
    boton.disabled = false; boton.textContent = "Guardar";
  }
});

// ---------------------------------------------------------------------------------------------- pantalla de editar
let compraEnEdicion = null;

function abrirEditar(compra) {
  compraEnEdicion = compra;
  $("e-fecha").value = compra.fecha;
  $("e-proveedor").value = compra.proveedor;
  $("e-monto").value = compra.monto;
  $("e-comprobante").value = compra.comprobante || "";
  $("e-concepto").value = compra.concepto || "";
  $("e-nota").value = compra.nota || "";

  const claveMetodo = configCache ? Object.entries(configCache.metodos).find(([, v]) => v === compra.metodo) : null;
  llenarFormularioConConfig("e", compra.moneda, claveMetodo ? claveMetodo[0] : "empresa");
  $("e-categoria").value = compra.categoria;

  const esPropio = configCache && compra.metodo === configCache.metodos.propio;
  const zona = $("editar-estado-zona");
  if (esPropio) {
    zona.classList.remove("oculto");
    $("editar-estado-texto").textContent = "Estado actual: " + compra.estado;
    $("boton-marcar-devuelto").classList.toggle("oculto", compra.estado === "Pagada");
  } else {
    zona.classList.add("oculto");
  }

  $("pantalla-editar").classList.remove("oculto");
}

function cerrarEditar() {
  $("pantalla-editar").classList.add("oculto");
  compraEnEdicion = null;
}

$("boton-cerrar-editar").addEventListener("click", cerrarEditar);
$("boton-cancelar-editar").addEventListener("click", cerrarEditar);

$("boton-guardar-editar").addEventListener("click", async () => {
  if (!compraEnEdicion) return;
  const proveedor = $("e-proveedor").value.trim();
  const monto = parseFloat($("e-monto").value);
  const fecha = $("e-fecha").value;
  if (!proveedor || !fecha || !monto || monto <= 0) {
    mostrarToast("Falta proveedor, fecha o monto valido");
    return;
  }
  const boton = $("boton-guardar-editar");
  boton.disabled = true; boton.textContent = "Guardando…";
  try {
    await llamar("editar", {
      id: compraEnEdicion.id,
      campos: {
        fecha, proveedor, monto,
        categoria: $("e-categoria").value,
        moneda: $("e-moneda").value,
        metodo: $("e-metodo").value,
        comprobante: $("e-comprobante").value.trim(),
        concepto: $("e-concepto").value.trim(),
        nota: $("e-nota").value.trim(),
      },
    });
    mostrarToast("Cambios guardados");
    cerrarEditar();
    cargarResumenYLista();
  } catch (e) {
    mostrarToast("Error: " + e.message);
  } finally {
    boton.disabled = false; boton.textContent = "Guardar cambios";
  }
});

$("boton-marcar-devuelto").addEventListener("click", async () => {
  if (!compraEnEdicion) return;
  if (!confirm("¿Confirmas que ya te devolviste este dinero?")) return;
  try {
    await llamar("estado", { id: compraEnEdicion.id, estado: "Pagada" });
    mostrarToast("Marcado como devuelto");
    cerrarEditar();
    cargarResumenYLista();
  } catch (e) {
    mostrarToast("Error: " + e.message);
  }
});

// ---------------------------------------------------------------------------------------------- solicitud de devolucion
function aFechaPe(iso) {
  const [a, m, d] = iso.split("-");
  return `${d}/${m}/${a}`;
}

const MESES_ES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre",
                  "Noviembre", "Diciembre"];

/** TC del mes (o el ultimo disponible antes de ese mes, o el de respaldo): misma logica que tcDe_ en Code.gs. */
function tcParaMes(mes) {
  if (configCache && configCache.tc && configCache.tc[mes]) return configCache.tc[mes];
  const anteriores = configCache && configCache.tc ? Object.keys(configCache.tc).filter((m) => m < mes).sort() : [];
  if (anteriores.length) return configCache.tc[anteriores[anteriores.length - 1]];
  return { pen: 3.5, eur: 1.08 };
}

function montoEnUsd(c) {
  const tc = tcParaMes(c.fecha.slice(0, 7));
  if (c.moneda === "USD") return c.monto;
  if (c.moneda === "PEN") return c.monto / tc.pen;
  if (c.moneda === "EUR") return c.monto * tc.eur;
  return c.monto;
}

/** Etiqueta del periodo para el encabezado del Excel, a partir de los filtros Desde/Hasta (AAAA-MM o vacios). */
function etiquetaPeriodo(desde, hasta) {
  if (!desde && !hasta) return "Todo lo pendiente (corte al " + aFechaPe(hoyIso()) + ")";
  const nombreMes = (m) => { const [a, mm] = m.split("-"); return `${MESES_ES[Number(mm) - 1]} ${a}`; };
  if (desde && hasta && desde === hasta) return nombreMes(desde);
  if (desde && hasta) return `${nombreMes(desde)} a ${nombreMes(hasta)}`;
  if (desde) return `Desde ${nombreMes(desde)}`;
  return `Hasta ${nombreMes(hasta)}`;
}

const NOTA_TC_DEVOLUCION = "Nota: cada fila se convierte a USD con el tipo de cambio del mes de su fecha (o el ultimo disponible antes de ese mes). Verifica el TC con Contabilidad antes de enviar.";
const AZUL_ARGB = "FF131629";
const CIAN_ARGB = "FF00F5D4";
const BORDE_FINO = { top: { style: "thin" }, left: { style: "thin" }, bottom: { style: "thin" }, right: { style: "thin" } };

/** Calcula filas + totales una sola vez; Excel y PDF arman su propio documento a partir de esto. */
function calcularFilasDevolucion(compras) {
  let totalUsd = 0, subPen = 0, subUsd = 0, subEur = 0;
  const filas = compras.map((c) => {
    const usd = Math.round(montoEnUsd(c) * 100) / 100;
    totalUsd += usd;
    if (c.moneda === "PEN") subPen += c.monto;
    else if (c.moneda === "USD") subUsd += c.monto;
    else if (c.moneda === "EUR") subEur += c.monto;
    return {
      fecha: aFechaPe(c.fecha), id: c.comprobante || "", proveedor: c.proveedor, concepto: c.concepto || "",
      usd: c.moneda === "USD" || c.moneda === "EUR" ? c.monto : null,
      pen: c.moneda === "PEN" ? c.monto : null,
      montoUsd: usd,
    };
  });
  return { filas, totalUsd: Math.round(totalUsd * 100) / 100, subPen, subUsd, subEur };
}

async function construirExcelDevolucion(compras, periodoLabel) {
  const { filas, totalUsd, subPen, subUsd, subEur } = calcularFilasDevolucion(compras);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Solicitud Devolucion");
  ws.columns = [{ width: 12 }, { width: 16 }, { width: 26 }, { width: 30 }, { width: 10 }, { width: 10 }, { width: 14 }];

  ws.mergeCells("A1:G1");
  ws.getCell("A1").value = "AUGEO INVESTMENTS E.I.R.L.";
  ws.getCell("A1").font = { bold: true, size: 14 };

  ws.mergeCells("A2:G2");
  ws.getCell("A2").value = "SOLICITUD DE DEVOLUCIÓN - GASTOS PAGADOS CON TARJETA PERSONAL";
  ws.getCell("A2").font = { bold: true, size: 12 };

  ws.getCell("A3").value = "PERIODO";
  ws.getCell("A3").font = { bold: true };
  ws.mergeCells("B3:C3");
  ws.getCell("B3").value = periodoLabel;
  ws.getCell("E3").value = "RESPONSABLE:";
  ws.getCell("E3").font = { bold: true };
  ws.getCell("F3").value = "FERNANDO FLORES";

  const filaHeader = 5;
  ws.getRow(filaHeader).values = ["FECHA", "N° / ID", "PROVEEDOR", "CONCEPTO", "USD", "S/.", "MONTO USD"];
  ws.getRow(filaHeader).eachCell((celda) => {
    celda.font = { bold: true, color: { argb: "FFFFFFFF" } };
    celda.fill = { type: "pattern", pattern: "solid", fgColor: { argb: AZUL_ARGB } };
    celda.border = BORDE_FINO;
    celda.alignment = { horizontal: "center", vertical: "middle" };
  });

  let fila = filaHeader + 1;
  filas.forEach((f) => {
    const r = ws.getRow(fila);
    r.values = [f.fecha, f.id, f.proveedor, f.concepto, f.usd, f.pen, f.montoUsd];
    ["E", "F", "G"].forEach((col) => { r.getCell(col).numFmt = "#,##0.00"; });
    r.eachCell({ includeEmpty: true }, (celda) => { celda.border = BORDE_FINO; });
    fila++;
  });

  fila++; // fila en blanco
  const filaTotal = fila;
  ws.mergeCells(`A${filaTotal}:C${filaTotal}`);
  ws.getCell(`A${filaTotal}`).value = "Responsable: FERNANDO FLORES";
  ws.mergeCells(`D${filaTotal}:F${filaTotal}`);
  ws.getCell(`D${filaTotal}`).value = "TOTAL A REEMBOLSAR (USD)";
  ws.getCell(`G${filaTotal}`).value = totalUsd;
  ws.getCell(`G${filaTotal}`).numFmt = "#,##0.00";
  ws.getRow(filaTotal).eachCell({ includeEmpty: true }, (celda) => {
    celda.font = { bold: true };
    celda.fill = { type: "pattern", pattern: "solid", fgColor: { argb: CIAN_ARGB } };
    celda.border = BORDE_FINO;
  });

  fila++;
  ws.getCell(`C${fila}`).value = "Subtotales por moneda original (referencia):";
  ws.getCell(`E${fila}`).value = subUsd || null;
  ws.getCell(`F${fila}`).value = subPen || null;
  ws.getCell(`G${fila}`).value = subEur || null;
  ["E", "F", "G"].forEach((col) => { ws.getCell(col + fila).numFmt = "#,##0.00"; });

  fila += 2;
  ws.mergeCells(`A${fila}:G${fila}`);
  ws.getCell(`A${fila}`).value = NOTA_TC_DEVOLUCION;
  ws.getCell(`A${fila}`).font = { italic: true, size: 9 };
  ws.getCell(`A${fila}`).alignment = { wrapText: true };

  return wb;
}

async function descargarExcel(wb, nombre) {
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = nombre; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function construirPdfDevolucion(compras, periodoLabel) {
  const { filas, totalUsd, subUsd, subPen, subEur } = calcularFilasDevolucion(compras);
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ orientation: "landscape", unit: "pt" });

  doc.setFont("helvetica", "bold"); doc.setFontSize(14);
  doc.text("AUGEO INVESTMENTS E.I.R.L.", 40, 40);
  doc.setFontSize(11);
  doc.text("SOLICITUD DE DEVOLUCIÓN - GASTOS PAGADOS CON TARJETA PERSONAL", 40, 58);
  doc.setFont("helvetica", "normal"); doc.setFontSize(10);
  doc.text(`Periodo: ${periodoLabel}    Responsable: FERNANDO FLORES`, 40, 76);

  doc.autoTable({
    startY: 92,
    head: [["FECHA", "N° / ID", "PROVEEDOR", "CONCEPTO", "USD", "S/.", "MONTO USD"]],
    body: filas.map((f) => [f.fecha, f.id, f.proveedor, f.concepto,
      f.usd != null ? f.usd.toFixed(2) : "", f.pen != null ? f.pen.toFixed(2) : "", f.montoUsd.toFixed(2)]),
    foot: [["", "", "", "TOTAL A REEMBOLSAR (USD)", "", "", totalUsd.toFixed(2)]],
    styles: { fontSize: 9, cellPadding: 4 },
    headStyles: { fillColor: [19, 22, 41], textColor: 255, fontStyle: "bold" },
    footStyles: { fillColor: [0, 245, 212], textColor: [19, 22, 41], fontStyle: "bold" },
    columnStyles: { 4: { halign: "right" }, 5: { halign: "right" }, 6: { halign: "right" } },
  });

  const y = doc.lastAutoTable.finalY + 20;
  doc.setFontSize(9);
  doc.text(`Subtotales por moneda original: USD ${subUsd.toFixed(2)}   S/. ${subPen.toFixed(2)}${subEur ? "   EUR " + subEur.toFixed(2) : ""}`, 40, y);
  doc.setFont("helvetica", "italic");
  doc.text(NOTA_TC_DEVOLUCION, 40, y + 16, { maxWidth: 760 });

  return doc;
}

function arrayBufferABase64(buf) {
  let binario = "";
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.byteLength; i++) binario += String.fromCharCode(bytes[i]);
  return btoa(binario);
}

function comprasSeleccionadasDevolver() {
  const ids = Array.from($("devolver-lista").querySelectorAll("input[type=checkbox]:checked")).map((el) => el.dataset.id);
  return pendientesDevolver.filter((c) => ids.includes(c.id));
}

async function exportarSolicitudDevolucion() {
  const compras = comprasSeleccionadasDevolver();
  if (!compras.length) { mostrarToast("Selecciona al menos una compra"); return; }
  const periodo = etiquetaPeriodo($("devolver-desde").value, $("devolver-hasta").value);
  const boton = $("boton-exportar-devolucion");
  const textoOriginal = boton.textContent;
  boton.disabled = true; boton.textContent = "Generando…";
  try {
    if ($("devolver-formato").value === "xlsx") {
      const wb = await construirExcelDevolucion(compras, periodo);
      await descargarExcel(wb, `Solicitud de Devolucion - Fernando Flores - ${hoyIso()}.xlsx`);
    } else {
      construirPdfDevolucion(compras, periodo).save(`Solicitud de Devolucion - Fernando Flores - ${hoyIso()}.pdf`);
    }
  } catch (e) {
    mostrarToast("Error: " + e.message);
  } finally {
    boton.disabled = false; boton.textContent = textoOriginal;
  }
}

$("boton-exportar-devolucion").addEventListener("click", exportarSolicitudDevolucion);

let todosPendientesDevolver = [];
let pendientesDevolver = [];

async function abrirDevolver() {
  $("devolver-desde").value = "";
  $("devolver-hasta").value = "";
  $("devolver-lista").innerHTML = "";
  $("devolver-vacio").textContent = "Cargando…";
  $("devolver-vacio").classList.remove("oculto");
  $("devolver-comprobante").value = "";
  $("devolver-solicitud").value = "";
  $("pantalla-devolver").classList.remove("oculto");
  try {
    const r = await llamar("listar", { metodo: "propio", estados: ["Pendiente", "En solicitud"] });
    todosPendientesDevolver = r.compras.slice().sort((a, b) => a.fecha.localeCompare(b.fecha));
  } catch (e) {
    todosPendientesDevolver = [];
  }
  filtrarYRenderizarDevolver();
}

function filtrarYRenderizarDevolver() {
  const desde = $("devolver-desde").value;
  const hasta = $("devolver-hasta").value;
  pendientesDevolver = todosPendientesDevolver.filter((c) => {
    const mes = c.fecha.slice(0, 7);
    return (!desde || mes >= desde) && (!hasta || mes <= hasta);
  });
  const cont = $("devolver-lista");
  if (!pendientesDevolver.length) {
    $("devolver-vacio").textContent = todosPendientesDevolver.length
      ? "Nada pendiente en ese periodo." : "No hay compras pendientes de devolver.";
    $("devolver-vacio").classList.remove("oculto");
    cont.innerHTML = "";
    return;
  }
  $("devolver-vacio").classList.add("oculto");
  cont.innerHTML = pendientesDevolver.map((c) => `
    <label class="devolver-item">
      <input type="checkbox" data-id="${c.id}" checked>
      <div>
        <div>${escaparHtml(c.proveedor)}</div>
        <div class="compra-meta">${c.fecha} · ${escaparHtml(c.categoria)}</div>
      </div>
      <div class="r-monto">${formatoMoneda(c.monto, c.moneda)}</div>
    </label>
  `).join("");
}

$("devolver-desde").addEventListener("change", filtrarYRenderizarDevolver);
$("devolver-hasta").addEventListener("change", filtrarYRenderizarDevolver);

function cerrarDevolver() {
  $("pantalla-devolver").classList.add("oculto");
  todosPendientesDevolver = [];
  pendientesDevolver = [];
}

$("boton-abrir-devolver").addEventListener("click", abrirDevolver);
$("boton-cerrar-devolver").addEventListener("click", cerrarDevolver);

$("boton-confirmar-devolver").addEventListener("click", async () => {
  const compras = comprasSeleccionadasDevolver();
  if (!compras.length) { mostrarToast("Selecciona al menos una compra"); return; }
  const boton = $("boton-confirmar-devolver");
  boton.disabled = true; boton.textContent = "Guardando…";
  try {
    // El PDF de la solicitud que se marca como pagada queda archivado en Drive como sustento, ademas del
    // comprobante de la transferencia si lo adjuntas — asi queda el "que se pidio" junto al "que se pago".
    const periodo = etiquetaPeriodo($("devolver-desde").value, $("devolver-hasta").value);
    const pdfDoc = construirPdfDevolucion(compras, periodo);
    const datos = {
      ids: compras.map((c) => c.id),
      solicitud: $("devolver-solicitud").value.trim(),
      solicitud_pdf: { mime: "application/pdf", base64: arrayBufferABase64(pdfDoc.output("arraybuffer")) },
    };
    const file = $("devolver-comprobante").files[0];
    if (file) datos.archivo = { mime: file.type || "application/pdf", base64: await fileABase64(file) };
    await llamar("marcar_devueltas", datos);
    mostrarToast(compras.length === 1 ? "1 compra marcada como pagada" : `${compras.length} compras marcadas como pagadas`);
    cerrarDevolver();
    cargarResumenYLista();
  } catch (e) {
    mostrarToast("Error: " + e.message);
  } finally {
    boton.disabled = false; boton.textContent = "✓ Marcar pagado";
  }
});

// ---------------------------------------------------------------------------------------------- pantalla de resolver movimiento
let movimientoEnResolucion = null;
let gastosParaVincular = [];

async function abrirResolver(mov) {
  movimientoEnResolucion = mov;
  $("resolver-info").innerHTML = `
    <div class="compra-proveedor">${escaparHtml(mov.descripcion)}</div>
    <div class="compra-meta">${mov.fecha} · ${escaparHtml(mov.cuenta)}</div>
    <p class="resumen-total">${formatoMoneda(Math.abs(mov.monto), mov.moneda)}</p>
  `;
  $("resolver-buscar").value = "";
  $("resolver-nota").value = "";
  $("resolver-resultados").innerHTML = "";
  $("pantalla-resolver").classList.remove("oculto");

  try {
    const r = await llamar("listar", { estados: ["Pendiente", "En solicitud", "Pagada", "No aplica"] });
    gastosParaVincular = r.compras;
  } catch (e) {
    gastosParaVincular = [];
  }
  renderResultadosResolver("");
}

function cerrarResolver() {
  $("pantalla-resolver").classList.add("oculto");
  movimientoEnResolucion = null;
}

function renderResultadosResolver(texto) {
  const q = texto.trim().toLowerCase();
  const cont = $("resolver-resultados");
  const candidatos = gastosParaVincular.filter((g) => !q || g.proveedor.toLowerCase().includes(q)).slice(0, 20);
  if (!candidatos.length) {
    cont.innerHTML = '<div class="vacio">Sin resultados</div>';
    return;
  }
  cont.innerHTML = candidatos.map((g) => `
    <div class="resultado-item" data-id="${g.id}">
      <div>
        <div>${escaparHtml(g.proveedor)}</div>
        <div class="compra-meta">${g.fecha} · ${escaparHtml(g.categoria)}</div>
      </div>
      <div class="r-monto">${formatoMoneda(g.monto, g.moneda)}</div>
    </div>
  `).join("");
}

$("resolver-buscar").addEventListener("input", (e) => renderResultadosResolver(e.target.value));

$("resolver-resultados").addEventListener("click", async (e) => {
  const item = e.target.closest(".resultado-item");
  if (!item || !movimientoEnResolucion) return;
  const gasto = gastosParaVincular.find((g) => g.id === item.dataset.id);
  if (!gasto) return;
  if (!confirm(`¿Vincular este movimiento a "${gasto.proveedor}" (${formatoMoneda(gasto.monto, gasto.moneda)})?`)) return;
  try {
    await llamar("marcar_movimiento", { id: movimientoEnResolucion.id, estado: "Vinculado", gasto_id: gasto.id });
    mostrarToast("Vinculado");
    cerrarResolver();
    cargarResumenYLista();
  } catch (e) {
    mostrarToast("Error: " + e.message);
  }
});

$("boton-resolver-justificado").addEventListener("click", async () => {
  if (!movimientoEnResolucion) return;
  const nota = $("resolver-nota").value.trim();
  if (!nota) { mostrarToast("Escribe el motivo"); return; }
  try {
    await llamar("marcar_movimiento", { id: movimientoEnResolucion.id, estado: "Sin factura (justificado)", nota });
    mostrarToast("Marcado como sin factura (justificado)");
    cerrarResolver();
    cargarResumenYLista();
  } catch (e) {
    mostrarToast("Error: " + e.message);
  }
});

$("boton-resolver-ignorar").addEventListener("click", async () => {
  if (!movimientoEnResolucion) return;
  if (!confirm("¿Marcar este movimiento como Ignorado (nunca necesita factura)?")) return;
  try {
    await llamar("marcar_movimiento", { id: movimientoEnResolucion.id, estado: "Ignorado" });
    mostrarToast("Marcado como ignorado");
    cerrarResolver();
    cargarResumenYLista();
  } catch (e) {
    mostrarToast("Error: " + e.message);
  }
});

$("boton-cerrar-resolver").addEventListener("click", cerrarResolver);

// ---------------------------------------------------------------------------------------------- importar estado de cuenta
const MESES_ES_IDX = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7,
  agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
};

function numeroConComas(s) {
  return parseFloat(String(s).replace(/,/g, ""));
}

/** Junta los "items" de texto de pdf.js en lineas (por coordenada Y) y los ordena por X, como una lectura normal. */
function agruparLineasPDF(items) {
  const filas = [];
  const TOL = 2;
  for (const it of items) {
    const y = it.transform[5];
    let fila = filas.find((f) => Math.abs(f.y - y) <= TOL);
    if (!fila) { fila = { y, partes: [] }; filas.push(fila); }
    fila.partes.push({ x: it.transform[4], texto: it.str });
  }
  filas.sort((a, b) => b.y - a.y);
  return filas.map((f) => {
    f.partes.sort((a, b) => a.x - b.x);
    return f.partes.map((p) => p.texto).join(" ").replace(/\s+/g, " ").trim();
  });
}

/** Estado de cuenta negocios de Interbank (PDF, sin clave). Misma logica que importador.py, portada a JS. */
async function leerInterbankPDF(file, moneda) {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  let lineas = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    lineas = lineas.concat(agruparLineasPDF(content.items));
  }
  const texto = lineas.join("\n");
  const mMes = texto.match(/Mes:\s*(\S+)\s+(\d{4})/i);
  if (!mMes) throw new Error("No encontre \"Mes: <nombre> <año>\" en el PDF — ¿es un estado de cuenta de Interbank?");
  const mesNum = MESES_ES_IDX[mMes[1].toLowerCase()];
  const anio = mMes[2];
  if (!mesNum) throw new Error("Mes \"" + mMes[1] + "\" no reconocido");

  const FILA = /^(\d{2})\/(\d{2})\s+\d{2}\/\d{2}\s+(.+?)\s+(-?[\d,]+\.\d{2})\s+[\d,]+\.\d{2}$/;
  const filas = [];
  for (const linea of lineas) {
    const m = FILA.exec(linea.trim());
    if (!m) continue;
    const [, dd, mm, detalle, montoStr] = m;
    filas.push({ fecha: `${anio}-${mm}-${dd}`, descripcion: detalle.trim(), moneda, monto: numeroConComas(montoStr), operacion: "" });
  }
  return filas;
}

/** Excel de "banca por internet" del BCP: columnas Fecha, Descripcion, Moneda, Monto, Numero de Operacion. */
async function leerBcpExcel(file, moneda) {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const crudas = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: "" });
  if (!crudas.length) return [];
  const encabezado = crudas[0].map((c) => String(c || "").trim().toLowerCase());
  const iFecha = encabezado.indexOf("fecha");
  const iDesc = encabezado.indexOf("descripcion");
  const iMonto = encabezado.indexOf("monto");
  const iOp = encabezado.indexOf("numero de operacion");
  if (iFecha < 0 || iMonto < 0) throw new Error("El Excel no tiene las columnas esperadas (Fecha, Descripcion, Monto, ...)");

  const filas = [];
  for (let r = 1; r < crudas.length; r++) {
    const fila = crudas[r];
    const fecha = fila[iFecha];
    const monto = fila[iMonto];
    if (!fecha || monto === "" || monto === undefined) continue;
    const partes = String(fecha).split("/");
    if (partes.length !== 3) continue;
    const [dd, mm, aaaa] = partes;
    filas.push({
      fecha: `${aaaa}-${mm}-${dd}`,
      descripcion: String(fila[iDesc] || "").trim(),
      moneda,
      monto: numeroConComas(monto),
      operacion: String(fila[iOp] || ""),
    });
  }
  return filas;
}

let filasImportar = [];

function abrirImportar() {
  filasImportar = [];
  $("i-archivo").value = "";
  $("importar-estado").textContent = "";
  $("importar-preview").innerHTML = "";
  $("importar-resultado").classList.add("oculto");
  $("boton-confirmar-importar").disabled = true;
  $("boton-confirmar-importar").classList.remove("oculto");
  $("boton-cancelar-importar").textContent = "Cancelar";
  if (configCache) {
    llenarSelect($("i-cuenta"), (configCache.cuentas || []).map((c) => ({ valor: c, texto: c })));
    llenarSelect($("i-moneda"), configCache.monedas.map((m) => ({ valor: m, texto: m })), "PEN");
  }
  $("pantalla-importar").classList.remove("oculto");
}

function cerrarImportar() {
  $("pantalla-importar").classList.add("oculto");
}

$("boton-importar-eecc").addEventListener("click", abrirImportar);
$("boton-cerrar-importar").addEventListener("click", cerrarImportar);
$("boton-cancelar-importar").addEventListener("click", cerrarImportar);

$("i-archivo").addEventListener("change", async () => {
  const file = $("i-archivo").files[0];
  const estado = $("importar-estado");
  const prev = $("importar-preview");
  filasImportar = [];
  prev.innerHTML = "";
  $("boton-confirmar-importar").disabled = true;
  if (!file) { estado.textContent = ""; return; }

  estado.textContent = "Leyendo archivo…";
  const moneda = $("i-moneda").value;
  try {
    if (/\.xlsx$/i.test(file.name)) {
      filasImportar = await leerBcpExcel(file, moneda);
    } else if (/\.pdf$/i.test(file.name)) {
      filasImportar = await leerInterbankPDF(file, moneda);
    } else {
      throw new Error("Solo se aceptan archivos .xlsx (BCP) o .pdf (Interbank)");
    }
    if (!filasImportar.length) throw new Error("No se encontraron movimientos en el archivo");

    estado.textContent = `${filasImportar.length} movimientos encontrados — revisa antes de importar:`;
    prev.innerHTML = filasImportar.map((f) => `
      <div class="resultado-item">
        <div><div>${escaparHtml(f.descripcion)}</div><div class="compra-meta">${f.fecha}${f.operacion ? " · Op. " + escaparHtml(f.operacion) : ""}</div></div>
        <div class="r-monto">${formatoMoneda(f.monto, moneda)}</div>
      </div>
    `).join("");
    $("boton-confirmar-importar").disabled = false;
  } catch (e) {
    estado.textContent = "⚠ " + e.message;
  }
});

$("boton-confirmar-importar").addEventListener("click", async () => {
  if (!filasImportar.length) return;
  const boton = $("boton-confirmar-importar");
  boton.disabled = true; boton.textContent = "Importando…";
  try {
    const r = await llamar("importar_movimientos", { cuenta: $("i-cuenta").value, filas: filasImportar });
    const res = $("importar-resultado");
    res.classList.remove("oculto");
    res.innerHTML = `
      <h2>Resultado</h2>
      <div class="resumen-fila"><span>Nuevos</span><span>${r.nuevos}</span></div>
      <div class="resumen-fila"><span>Ya estaban (repetidos)</span><span>${r.repetidos}</span></div>
      <div class="resumen-fila"><span>Vinculados solos</span><span>${r.vinculados_solos}</span></div>
      <div class="resumen-fila"><span>Por revisar</span><span>${r.por_revisar}</span></div>
      ${r.ejemplos_por_revisar.length ? "<div class=\"importar-subtitulo\">Ejemplos sin cruzar:</div>" + r.ejemplos_por_revisar.map((e) => `<div class="conciliacion-item">${escaparHtml(e)}</div>`).join("") : ""}
    `;
    $("importar-preview").innerHTML = "";
    $("importar-estado").textContent = "";
    $("i-archivo").value = "";
    filasImportar = [];
    boton.classList.add("oculto");
    $("boton-cancelar-importar").textContent = "Listo";
    cargarResumenYLista();
  } catch (e) {
    mostrarToast("Error: " + e.message);
  } finally {
    boton.disabled = false; boton.textContent = "Importar";
  }
});

// ---------------------------------------------------------------------------------------------- arranque
function actualizarAvisoOffline() {
  $("aviso-offline").classList.toggle("oculto", navigator.onLine);
}

async function iniciarApp() {
  actualizarAvisoOffline();
  await obtenerConfig().catch(() => {});
  actualizarAvisoCola((await listarCola().catch(() => [])).length);
  cargarResumenYLista();
  sincronizarCola();
}

window.addEventListener("online", () => { actualizarAvisoOffline(); sincronizarCola(); });
window.addEventListener("offline", actualizarAvisoOffline);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("service-worker.js").catch(() => {});
  });
}

(function arrancar() {
  const clave = localStorage.getItem(CLAVE_KEY);
  if (clave) {
    mostrarApp();
  }
})();
