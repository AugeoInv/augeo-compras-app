// Pagina de solo consulta para el contador. Usa el mismo backend que la app principal, pero con su propia
// clave (de solo lectura: el backend la rechaza para cualquier accion que no sea listar/config/resumen/conciliacion)
// y su propio almacenamiento, para no mezclarse nunca con la sesion de la app de registro.
const API_URL = "https://script.google.com/macros/s/AKfycbwBIDKN21f3b3N0lxfuOTVlb6OfduAoFOasFHF4ObxLN1C6zV7JWgrDQvCkZTwSgfmtSw/exec";
const CLAVE_KEY = "compras_contador_clave";

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

function escaparHtml(s) {
  const d = document.createElement("div");
  d.textContent = s == null ? "" : String(s);
  return d.innerHTML;
}

function formatoMoneda(n, moneda) {
  return `${moneda} ${Number(n).toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

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
      localStorage.removeItem(CLAVE_KEY);
      location.reload();
    }
    throw new Error(json.error || "Error desconocido");
  }
  return json;
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
    $("error-clave").textContent = "Clave incorrecta.";
  }
});

$("boton-salir").addEventListener("click", () => {
  if (!confirm("¿Cerrar sesion?")) return;
  localStorage.removeItem(CLAVE_KEY);
  location.reload();
});

// ---------------------------------------------------------------------------------------------- config
let configCache = null;
const MES_HOY = hoyIso().slice(0, 7);

async function obtenerConfig() {
  const c = await llamar("config");
  configCache = c;
  return c;
}

// ---------------------------------------------------------------------------------------------- panel de consulta
let panelVista = "compras";
let panelMes = MES_HOY;
let panelQuery = "";
let panelComprasTodas = null;
let panelMovimientosTodas = null;

function ocultarPanelDetalle() {
  $("panel-detalle-fondo").classList.remove("visible");
}

function mostrarPanelDetalleUI() {
  $("panel-detalle-fondo").classList.add("visible");
}

$("panel-detalle-cerrar").addEventListener("click", ocultarPanelDetalle);
$("panel-detalle-fondo").addEventListener("click", (e) => { if (e.target.id === "panel-detalle-fondo") ocultarPanelDetalle(); });

document.querySelectorAll(".tab-panel-btn").forEach((b) => {
  b.addEventListener("click", async () => {
    if (b.dataset.vista === panelVista) return;
    panelVista = b.dataset.vista;
    panelQuery = "";
    $("panel-buscar").value = "";
    $("panel-buscar").placeholder = panelVista === "compras"
      ? "Buscar por proveedor, N° de comprobante o concepto…"
      : "Buscar por descripción, cuenta o N° de operación…";
    document.querySelectorAll(".tab-panel-btn").forEach((x) => x.classList.toggle("activo", x === b));
    $("panel-lista-titulo").textContent = panelVista === "compras" ? "Compras" : "Movimientos (EECC)";
    $("panel-desglose-titulo").textContent = panelVista === "compras" ? "Gasto por categoría" : "Movimientos por cuenta";
    ocultarPanelDetalle();
    await cargarPanelDatos();
  });
});

let panelConciliacionCache = {};

async function cargarPanelMeses() {
  const meses = configCache && configCache.meses ? configCache.meses.slice(-6) : [MES_HOY];
  $("panel-meses").innerHTML = meses.map((m) => `
    <button type="button" class="mes-panel-pill ${m === panelMes ? "activo" : ""}" data-mes="${m}">
      <span class="mp-nombre">${m}</span><span class="mp-estado">Cargando…</span>
    </button>
  `).join("");
  document.querySelectorAll(".mes-panel-pill").forEach((btn) => {
    btn.addEventListener("click", async () => {
      panelMes = btn.dataset.mes;
      panelQuery = "";
      $("panel-buscar").value = "";
      document.querySelectorAll(".mes-panel-pill").forEach((b) => b.classList.toggle("activo", b === btn));
      ocultarPanelDetalle();
      await cargarPanelDatos();
    });
  });
  const resultados = await Promise.all(meses.map((m) => llamar("conciliacion", { mes: m }).catch(() => null)));
  resultados.forEach((r, i) => {
    if (!r) return;
    panelConciliacionCache[meses[i]] = r;
    const pill = document.querySelector(`.mes-panel-pill[data-mes="${meses[i]}"] .mp-estado`);
    if (!pill) return;
    const total = r.movimientos_sin_factura.length + r.gastos_sin_movimiento.length;
    pill.className = "mp-estado " + (total === 0 ? "ok" : "pendiente");
    pill.textContent = total === 0 ? "✓ Conciliado" : `${total} por revisar`;
  });
  if (panelConciliacionCache[panelMes]) pintarKpisConciliacion(panelConciliacionCache[panelMes]);
}

function pintarKpisConciliacion(c) {
  const sf = c.movimientos_sin_factura.length;
  const sm = c.gastos_sin_movimiento.length;
  $("panel-kpi-sinfactura").textContent = sf;
  $("panel-kpi-sinmovimiento").textContent = sm;
  $("panel-kpi-sinfactura-caja").className = "kpi-panel" + (sf > 0 ? " warn" : " ok");
  $("panel-kpi-sinmovimiento-caja").className = "kpi-panel" + (sm > 0 ? " warn" : " ok");
}

async function cargarPanelDatos() {
  $("panel-lista").innerHTML = '<div class="vacio">Cargando…</div>';
  try {
    const resumen = await llamar("resumen", { mes: panelMes });
    $("panel-kpi-gasto").textContent = "USD " + resumen.gasto.usd.toFixed(2);
    $("panel-kpi-devolver").textContent = "USD " + resumen.por_devolver.usd.toFixed(2);
    $("panel-kpi-devolver").parentElement.className = "kpi-panel" + (resumen.por_devolver.n > 0 ? " warn" : "");

    if (!panelConciliacionCache[panelMes]) {
      panelConciliacionCache[panelMes] = await llamar("conciliacion", { mes: panelMes }).catch(() => null);
    }
    if (panelConciliacionCache[panelMes]) pintarKpisConciliacion(panelConciliacionCache[panelMes]);

    if (panelVista === "compras") {
      if (!panelComprasTodas) {
        const r = await llamar("listar", { estados: ["Pendiente", "En solicitud", "Pagada", "No aplica"] });
        panelComprasTodas = r.compras;
      }
      renderPanelDesgloseCategorias(resumen.por_categoria);
      renderPanelListaCompras();
    } else {
      if (!panelMovimientosTodas) {
        const r = await llamar("listar_movimientos", {});
        panelMovimientosTodas = r.movimientos;
      }
      renderPanelDesgloseCuentas();
      renderPanelListaMovimientos();
    }
  } catch (e) {
    $("panel-lista").innerHTML = `<div class="vacio">No se pudo cargar: ${e.message}</div>`;
  }
}

function panelComprasFiltradas() {
  const q = panelQuery.trim().toLowerCase();
  const base = q
    ? panelComprasTodas.filter((c) => c.proveedor.toLowerCase().includes(q)
        || (c.comprobante || "").toLowerCase().includes(q) || (c.concepto || "").toLowerCase().includes(q))
    : panelComprasTodas.filter((c) => c.fecha.slice(0, 7) === panelMes);
  return base.slice().sort((a, b) => b.fecha.localeCompare(a.fecha));
}

function panelMovimientosFiltrados() {
  const q = panelQuery.trim().toLowerCase();
  const base = q
    ? panelMovimientosTodas.filter((m) => m.descripcion.toLowerCase().includes(q)
        || m.cuenta.toLowerCase().includes(q) || (m.operacion || "").toLowerCase().includes(q))
    : panelMovimientosTodas.filter((m) => m.fecha.slice(0, 7) === panelMes);
  return base.slice().sort((a, b) => b.fecha.localeCompare(a.fecha));
}

function pillEstadoCompraPanel(c) {
  if (c.estado === "Pendiente") return `<span class="pill pendiente">Por devolver</span>`;
  if (c.estado === "Pagada") return `<span class="pill ok">Devuelto</span>`;
  return `<span class="pill">No aplica</span>`;
}

function pillEstadoMovPanel(m) {
  if (m.estado === "Vinculado") return `<span class="pill ok">Vinculado</span>`;
  if (m.estado === "Sin vincular") return `<span class="pill pendiente">Sin vincular</span>`;
  return `<span class="pill">${escaparHtml(m.estado)}</span>`;
}

function renderPanelListaCompras() {
  const filas = panelComprasFiltradas();
  $("panel-contexto").textContent = panelQuery.trim() ? `${filas.length} resultado(s)` : `${filas.length} en ${panelMes}`;
  if (!filas.length) { $("panel-lista").innerHTML = '<div class="vacio">Sin resultados</div>'; return; }
  $("panel-lista").innerHTML = filas.map((c, i) => `
    <div class="compra-item" data-idx="${i}">
      <div class="compra-info">
        <div class="compra-proveedor">${escaparHtml(c.proveedor)}</div>
        <div class="compra-meta">${c.fecha} · ${escaparHtml(c.categoria)} ${pillEstadoCompraPanel(c)}</div>
      </div>
      <div class="compra-monto">${formatoMoneda(c.monto, c.moneda)}</div>
    </div>
  `).join("");
  $("panel-lista").querySelectorAll(".compra-item").forEach((el) => {
    el.addEventListener("click", () => mostrarPanelDetalleCompra(filas[Number(el.dataset.idx)]));
  });
}

function renderPanelListaMovimientos() {
  const filas = panelMovimientosFiltrados();
  $("panel-contexto").textContent = panelQuery.trim() ? `${filas.length} resultado(s)` : `${filas.length} en ${panelMes}`;
  if (!filas.length) { $("panel-lista").innerHTML = '<div class="vacio">Sin resultados</div>'; return; }
  $("panel-lista").innerHTML = filas.map((m, i) => `
    <div class="movimiento-item" data-idx="${i}">
      <div>
        <div class="mi-desc">${escaparHtml(m.descripcion)}</div>
        <div class="compra-meta">${m.fecha} · ${escaparHtml(m.cuenta)} ${pillEstadoMovPanel(m)}</div>
      </div>
      <div class="mi-monto">${formatoMoneda(Math.abs(m.monto), m.moneda)}</div>
    </div>
  `).join("");
  $("panel-lista").querySelectorAll(".movimiento-item").forEach((el) => {
    el.addEventListener("click", () => mostrarPanelDetalleMovimiento(filas[Number(el.dataset.idx)]));
  });
}

function renderPanelBarras(contId, entradas, vacio) {
  const cont = $(contId);
  if (!entradas.length) { cont.innerHTML = `<div class="vacio">${vacio}</div>`; return; }
  const max = entradas[0][1];
  cont.innerHTML = entradas.slice(0, 6).map(([nombre, usd]) => `
    <div class="desglose-fila">
      <span class="df-nombre">${escaparHtml(nombre)}</span>
      <span class="desglose-barra-pista"><span class="desglose-barra" style="width:${Math.max(6, (usd / max) * 100)}%"></span></span>
      <span class="df-monto">USD ${usd.toFixed(2)}</span>
    </div>
  `).join("");
}

function renderPanelDesgloseCategorias(porCategoria) {
  const entradas = porCategoria.map((c) => [c.categoria, c.usd]).sort((a, b) => b[1] - a[1]);
  renderPanelBarras("panel-desglose", entradas, "Sin compras este mes");
}

function renderPanelDesgloseCuentas() {
  const filas = panelMovimientosTodas.filter((m) => m.fecha.slice(0, 7) === panelMes);
  const tc = configCache && configCache.tc && configCache.tc[panelMes] ? configCache.tc[panelMes] : { pen: 3.5, eur: 1.08 };
  const porCuenta = {};
  filas.forEach((m) => {
    const abs = Math.abs(m.monto);
    const usd = m.moneda === "PEN" ? abs / tc.pen : m.moneda === "EUR" ? abs * tc.eur : abs;
    porCuenta[m.cuenta] = (porCuenta[m.cuenta] || 0) + usd;
  });
  renderPanelBarras("panel-desglose", Object.entries(porCuenta).sort((a, b) => b[1] - a[1]), "Sin movimientos este mes");
}

function mostrarPanelDetalleCompra(c) {
  $("panel-detalle-campos").innerHTML = `
    <div class="resumen-fila"><span>Fecha</span><span>${c.fecha}</span></div>
    <div class="resumen-fila"><span>Categoría</span><span>${escaparHtml(c.categoria)}</span></div>
    <div class="resumen-fila"><span>Monto</span><span>${formatoMoneda(c.monto, c.moneda)}</span></div>
    <div class="resumen-fila"><span>N° comprobante</span><span>${escaparHtml(c.comprobante || "—")}</span></div>
    <div class="resumen-fila"><span>Método</span><span>${escaparHtml(c.metodo)}</span></div>
    <div class="resumen-fila"><span>Estado</span><span>${pillEstadoCompraPanel(c)}</span></div>
    ${c.concepto ? `<div class="resumen-fila-ancha"><span>Concepto</span><span>${escaparHtml(c.concepto)}</span></div>` : ""}
    ${c.nota ? `<div class="resumen-fila-ancha"><span>Nota</span><span>${escaparHtml(c.nota)}</span></div>` : ""}
  `;
  if (c.foto) {
    $("panel-voucher-nombre").textContent = "Comprobante adjunto";
    $("panel-voucher-link").href = c.foto;
    $("panel-voucher-caja").classList.remove("oculto");
  } else {
    $("panel-voucher-caja").classList.add("oculto");
  }
  mostrarPanelDetalleUI();
}

async function mostrarPanelDetalleMovimiento(m) {
  if (!panelComprasTodas) {
    try {
      const r = await llamar("listar", { estados: ["Pendiente", "En solicitud", "Pagada", "No aplica"] });
      panelComprasTodas = r.compras;
    } catch (e) { panelComprasTodas = []; }
  }
  const gastoVinculado = m.gasto ? panelComprasTodas.find((g) => g.id === m.gasto) : null;

  $("panel-detalle-campos").innerHTML = `
    <div class="resumen-fila"><span>Fecha</span><span>${m.fecha}</span></div>
    <div class="resumen-fila"><span>Cuenta</span><span>${escaparHtml(m.cuenta)}</span></div>
    <div class="resumen-fila"><span>Monto</span><span>${formatoMoneda(Math.abs(m.monto), m.moneda)}</span></div>
    <div class="resumen-fila"><span>N° operación</span><span>${escaparHtml(m.operacion || "—")}</span></div>
    <div class="resumen-fila"><span>¿Pide factura?</span><span>${m.necesita_factura ? "Sí" : "No"}</span></div>
    <div class="resumen-fila"><span>Estado</span><span>${pillEstadoMovPanel(m)}</span></div>
    <div class="resumen-fila-ancha"><span>Descripción</span><span>${escaparHtml(m.descripcion)}</span></div>
    ${gastoVinculado ? `<div class="resumen-fila-ancha"><span>Vinculado a</span><span>${escaparHtml(gastoVinculado.proveedor)} — ${formatoMoneda(gastoVinculado.monto, gastoVinculado.moneda)}</span></div>` : ""}
    ${m.nota ? `<div class="resumen-fila-ancha"><span>Nota</span><span>${escaparHtml(m.nota)}</span></div>` : ""}
  `;
  if (gastoVinculado && gastoVinculado.foto) {
    $("panel-voucher-nombre").textContent = "Comprobante de la compra vinculada";
    $("panel-voucher-link").href = gastoVinculado.foto;
    $("panel-voucher-caja").classList.remove("oculto");
  } else {
    $("panel-voucher-caja").classList.add("oculto");
  }
  mostrarPanelDetalleUI();
}

$("panel-buscar").addEventListener("input", (e) => {
  panelQuery = e.target.value;
  ocultarPanelDetalle();
  if (panelVista === "compras") { if (panelComprasTodas) renderPanelListaCompras(); }
  else if (panelMovimientosTodas) renderPanelListaMovimientos();
});

// ---------------------------------------------------------------------------------------------- arranque
async function iniciarApp() {
  try {
    await obtenerConfig();
  } catch (e) {
    mostrarToast("No se pudo cargar la configuración: " + e.message);
    return;
  }
  panelMes = MES_HOY;
  cargarPanelMeses();
  await cargarPanelDatos();
}

(function arrancar() {
  const clave = localStorage.getItem(CLAVE_KEY);
  if (clave) mostrarApp();
})();
