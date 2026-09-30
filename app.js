const API_URL = "https://script.google.com/macros/s/AKfycbwBIDKN21f3b3N0lxfuOTVlb6OfduAoFOasFHF4ObxLN1C6zV7JWgrDQvCkZTwSgfmtSw/exec";
const CLAVE_KEY = "compras_clave";
const CONFIG_KEY = "compras_config_cache";
const DB_NOMBRE = "compras-offline";
const DB_VERSION = 1;
const TIENDA_COLA = "cola";

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

function llenarFormularioConConfig() {
  if (!configCache) return;
  llenarSelect($("c-moneda"), configCache.monedas.map((m) => ({ valor: m, texto: m })), "PEN");
  llenarSelect($("c-categoria"), configCache.categorias.map((c) => ({ valor: c, texto: c })));
  llenarSelect($("c-metodo"), Object.entries(configCache.metodos).map(([k, v]) => ({ valor: k, texto: v })), "empresa");
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
    sinFactura.forEach((m) => {
      html += `<div class="conciliacion-item">🏦 ${escaparHtml(m.descripcion)} — ${m.fecha} — ${formatoMoneda(Math.abs(m.monto), m.moneda)}<div class="conciliacion-motivo">Salio del banco (${escaparHtml(m.cuenta)}) y no tiene ninguna compra registrada que le calce</div></div>`;
    });
  }
  estado.innerHTML = html;
}

$("conciliacion-estado").addEventListener("click", () => {
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
    if (!lista.compras.length) {
      cont.innerHTML = '<div class="vacio">Sin compras este mes todavia</div>';
    } else {
      cont.innerHTML = lista.compras.slice(0, 15).map((c) => `
        <div class="compra-item">
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
  $("captura-zona").innerHTML = '<span class="icono">📷</span><div>Toca para tomar la foto de la factura o boleta</div><input type="file" accept="image/*,application/pdf" capture="environment" id="input-foto" class="oculto">';
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
  nuevoInput.type = "file"; nuevoInput.accept = "image/*,application/pdf"; nuevoInput.capture = "environment";
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
