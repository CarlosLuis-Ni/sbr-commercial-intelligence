/*
 * SUINSA Commercial Intelligence — Supplier Business Review
 * app.js: capa de presentación. NO calcula lógica de negocio —
 * toda cifra viene ya resuelta desde el JSON generado por
 * generar_sbr.py (motor_comercial/). Este archivo solo lee,
 * selecciona y renderiza — mismo principio que ya rige en
 * dashboard_ventas.html.
 *
 * Fase 3: el listado de proveedores ya NO está escrito a mano —
 * se lee de data/proveedores.json, el manifiesto que genera
 * generar_sbr.py a partir de los proveedores realmente detectados
 * en la fuente. Las fechas operativas de cada proveedor ya se leían
 * dinámicamente desde su propio JSON (Object.keys(payload.snapshots)),
 * eso no cambia.
 */

const CAPITULOS = [
  { id: "dashboard",    label: "01 · Dashboard" },
  { id: "diagnostico",  label: "02 · Diagnóstico" },
  { id: "tendencias",   label: "03 · Tendencias" },
  { id: "portafolio",   label: "04 · Portafolio" },
  { id: "clientes",     label: "05 · Clientes" },
  { id: "plan",         label: "06 · Plan de Acción" },
];

let PROVEEDORES = [];   // se puebla desde data/proveedores.json en init()
let DATA = {};
let proveedorActual = null;
let fechaActual = null;
let capituloActual = "dashboard";

async function cargarManifiestoProveedores() {
  const res = await fetch(`data/proveedores.json?v=${Date.now()}`);
  const manifiesto = await res.json();
  return manifiesto.proveedores.map(p => ({ id: p.id, label: p.nombre_display }));
}

let OVERLAY_MANIFEST = null;

async function cargarManifestOverlays() {
  if (OVERLAY_MANIFEST) return OVERLAY_MANIFEST;
  try {
    const res = await fetch(`data/overlays/manifest.json?v=${Date.now()}`);
    if (!res.ok) return null;
    OVERLAY_MANIFEST = await res.json();
    return OVERLAY_MANIFEST;
  } catch (e) {
    console.warn("No se pudo cargar manifest de overlays", e);
    return null;
  }
}

async function aplicarOverlayReciente(id, payload) {
  // Busca dinámicamente el último cierre publicado para el proveedor.
  // No contiene ninguna fecha mensual hardcodeada: septiembre, octubre,
  // noviembre, etc. entran por el mismo mecanismo.
  try {
    const manifest = await cargarManifestOverlays();
    const meta = manifest?.overlays?.[id];
    if (!meta?.archivo) return payload;

    const res = await fetch(`data/overlays/${meta.archivo}?v=${Date.now()}`);
    if (!res.ok) return payload;
    const b64 = (await res.text()).trim();
    const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
    const patch = JSON.parse(await new Response(stream).text());
    const fecha = patch.fecha_operativa || meta.fecha;

    payload.fecha_max_datos = patch.fecha_max_datos || payload.fecha_max_datos;
    if (patch.serie_mensual_append) {
      payload.serie_mensual = [
        ...(payload.serie_mensual || []).filter(x => x.mes !== patch.serie_mensual_append.mes),
        patch.serie_mensual_append
      ];
    }
    if (patch.snapshot) {
      payload.snapshots = {
        ...(payload.snapshots || {}),
        [fecha]: patch.snapshot
      };
    }
  } catch (e) {
    console.warn("No se pudo aplicar overlay reciente para", id, e);
  }
  return payload;
}

async function cargarProveedor(id) {
  if (DATA[id]) return DATA[id];
  // cache-busting: evita que el navegador sirva una copia vieja del JSON
  // cuando el archivo en disco ya se actualizó (python -m http.server no
  // envía cabeceras de caché).
  const res = await fetch(`data/${id}.json?v=${Date.now()}`);
  const payload = await res.json();
  DATA[id] = await aplicarOverlayReciente(id, payload);
  return DATA[id];
}

const fmtMonto = v => `C$${(v/1_000_000).toFixed(2)}M`;
const fmtMontoK = v => Math.abs(v) >= 1_000_000 ? fmtMonto(v) : `C$${(v/1000).toFixed(0)}K`;
const fmtPct = v => (v === null || v === undefined || Number.isNaN(Number(v))) ? "—" : `${Number(v)>0?"+" :""}${Number(v).toFixed(1)}%`;
const fmtPctPlain = v => (v === null || v === undefined || Number.isNaN(Number(v))) ? "—" : `${Number(v).toFixed(1)}%`;
const tieneHistoriaR12 = payload => Array.isArray(payload?.serie_mensual) && payload.serie_mensual.length >= 12;
const fmtR12Value = (payload, snap) => tieneHistoriaR12(payload) ? fmtMonto(snap.kpis.mat_r12) : "—";
const fmtR12Delta = (payload, snap) => tieneHistoriaR12(payload)
  ? `${fmtPct(snap.kpis.yoy_mat_pct)} vs. periodo anterior`
  : "Sin 12 meses de historia";
const fmtChurnValue = v => (v === null || v === undefined || Number.isNaN(Number(v))) ? "—" : `${Number(v).toFixed(1)}%`;
const fmtBaseClientes = snap => (snap.kpis.clientes_activos_anterior === 0 && snap.kpis.yoy_ytd_pct === null)
  ? "Base inicial"
  : `${snap.kpis.clientes_activos_anterior} en periodo anterior`;
const fmtChurnDelta = snap => (snap.kpis.churn_pct === null || snap.kpis.churn_pct === undefined)
  ? "Sin base comparable"
  : `${snap.waterfall.n_perdidos} clientes perdidos`;
const deltaClass = v => (v===null||v===undefined) ? "" : v>0 ? "up" : v<0 ? "down" : "";

/* Gobierno de transición de portafolio — ALTASA 2026.
   Regla: conservar la historia original y corregir únicamente la interpretación
   ejecutiva. La sustitución NO se aplica globalmente a nombres de productos. */
const TRANSICIONES_PORTAFOLIO = {
  "ALTASTRESS C/GINSENG 10 VIALES 15ML (ALTASA)": "STRESS FORTE CON GINSENG 10 VIALES 15ML (CAMAYA)",
  "ALTASTRESS CAJA X 30 GRAGEAS (ALTASA)": "STRESS FORTE CAJA X 30 GRAGEAS (CAMAYA)"
};

function esProductoDescontinuado(nombre) {
  return Object.prototype.hasOwnProperty.call(TRANSICIONES_PORTAFOLIO, nombre);
}

function etiquetaHistorica(nombre) {
  if (typeof nombre !== "string") return nombre;
  return esProductoDescontinuado(nombre) ? nombre + " — descontinuado" : nombre;
}

function transformarHallazgo(h) {
  if (!h) return h;
  const texto = String(h.texto || "");
  const implicacion = String(h.implicacion || "");
  const encontrado = Object.entries(TRANSICIONES_PORTAFOLIO).find(([origen]) =>
    (texto + " " + implicacion).includes(origen)
  );
  if (!encontrado) return h;

  const [origen, sucesor] = encontrado;
  const textoNuevo = texto.replace(origen, etiquetaHistorica(origen));
  let implicacionNueva = implicacion.replace(origen, etiquetaHistorica(origen));

  if (!/descontinuad|migrar|sustitut/i.test(implicacionNueva)) {
    implicacionNueva = implicacionNueva
      ? implicacionNueva + " Acción: migrar el revenue histórico hacia " + sucesor + "."
      : "Producto descontinuado. Acción: migrar el revenue histórico hacia " + sucesor + ".";
  }

  return {
    ...h,
    texto: textoNuevo,
    implicacion: implicacionNueva
  };
}

function transformarRecomendacion(r) {
  if (!r) return r;
  const texto = String(r.titulo || "") + " " + String(r.detalle || "");
  const matches = Object.entries(TRANSICIONES_PORTAFOLIO).filter(([origen]) => texto.includes(origen));
  if (!matches.length) return r;

  const sucesores = [...new Set(matches.map(([,s]) => s))];

  if (r.capitulo_origen === "02") {
    return {
      ...r,
      titulo: matches.length === 1
        ? "Gestionar la transición hacia " + sucesores[0]
        : "Gestionar la transición de ALTASTRESS hacia STRESS FORTE",
      detalle: matches.length === 1
        ? "La caída histórica corresponde a la descontinuación del SKU. No debe interpretarse como demanda recuperable. Priorizar la migración de clientes y revenue histórico hacia " + sucesores[0] + "."
        : "La caída histórica corresponde a la descontinuación de los SKU. No debe interpretarse como demanda recuperable. Priorizar la migración de clientes y revenue histórico hacia los sustitutos STRESS FORTE."
    };
  }

  if (r.capitulo_origen === "04") {
    return {
      ...r,
      titulo: matches.length === 1
        ? "Acelerar la migración hacia " + sucesores[0]
        : "Acelerar la migración hacia los sustitutos STRESS FORTE",
      detalle: matches.length === 1
        ? "ALTASA descontinuó el SKU. Priorizar cobertura, activación y seguimiento de clientes que anteriormente compraban el producto, para trasladar el revenue al sustituto vigente."
        : "ALTASA descontinuó los SKU. Priorizar cobertura, activación y seguimiento de clientes que anteriormente compraban los productos retirados, para trasladar el revenue a los sustitutos vigentes."
    };
  }

  return {
    ...r,
    titulo: String(r.titulo || "").replace(
      /ALTASTRESS C\/GINSENG 10 VIALES 15ML \(ALTASA\)|ALTASTRESS CAJA X 30 GRAGEAS \(ALTASA\)/g,
      match => etiquetaHistorica(match)
    ),
    detalle: String(r.detalle || "").replace(
      /ALTASTRESS C\/GINSENG 10 VIALES 15ML \(ALTASA\)|ALTASTRESS CAJA X 30 GRAGEAS \(ALTASA\)/g,
      match => etiquetaHistorica(match)
    )
  };
}

function prepararVista(snap) {
  const vista = {...snap};

  // Top movers y matriz conservan el nombre histórico del SKU.
  // El estado de descontinuación se comunica en hallazgos/recomendaciones,
  // no se repite en cada visualización.
  vista.top_movers = (snap.top_movers || []).map(m => ({...m}));
  vista.matriz_portafolio = (snap.matriz_portafolio || []).map(m => ({...m}));

  vista.hallazgos = Object.fromEntries(Object.entries(snap.hallazgos || {}).map(([cap,items]) =>
    [cap, (items || []).map(transformarHallazgo)]
  ));
  vista.recomendaciones = (snap.recomendaciones || []).map(transformarRecomendacion);
  return vista;
}

const MESES_LARGO = ["","enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
const fmtFechaLarga = fechaISO => {
  const [anio, mes, dia] = fechaISO.split("-").map(Number);
  return `${dia} de ${MESES_LARGO[mes]} de ${anio}`;
};

function shell(payload, snap, contenidoHtml) {
  return `
    <div class="masthead">
      <div>
        <span class="brand">SUINSA Commercial Intelligence</span>
        <span class="module">/ Supplier Business Review</span>
      </div>
      <div class="controls">
        <div class="control">
          <label>Proveedor</label>
          <select id="sel-proveedor">
            ${PROVEEDORES.map(p => `<option value="${p.id}" ${p.id===proveedorActual?"selected":""}>${p.label}</option>`).join("")}
          </select>
        </div>
        <div class="control">
          <label>Fecha Operativa</label>
          <select id="sel-fecha">
            ${Object.keys(payload.snapshots).map(f => `<option value="${f}" ${f===fechaActual?"selected":""}>${f}</option>`).join("")}
          </select>
        </div>
      </div>
    </div>
    <div class="chapter-tabs">
      ${CAPITULOS.map(c => `<button data-cap="${c.id}" class="${c.id===capituloActual?"active":""}">${c.label}</button>`).join("")}
    </div>
    ${contenidoHtml}
    <div class="footer-note">
      SUINSA Commercial Intelligence · Inteligencia comercial para decisiones de crecimiento · Información con corte al ${fmtFechaLarga(snap.fecha_operativa)}
    </div>
  `;
}

function bindShellEvents() {
  document.getElementById("sel-proveedor").addEventListener("change", async (e) => {
    proveedorActual = e.target.value;
    await cargarProveedor(proveedorActual);
    const fechas = Object.keys(DATA[proveedorActual].snapshots).sort();
    fechaActual = fechas[fechas.length - 1];
    render();
  });
  document.getElementById("sel-fecha").addEventListener("change", (e) => {
    fechaActual = e.target.value;
    render();
  });
  document.querySelectorAll(".chapter-tabs button").forEach(btn => {
    btn.addEventListener("click", () => { capituloActual = btn.dataset.cap; render(); });
  });
}

function kpiStrip(items) {
  return `<div class="kpi-strip">${items.map(it => `
    <div>
      <div class="kpi-label">${it.label}</div>
      <div class="kpi-value">${it.value}</div>
      <div class="kpi-delta ${it.deltaClass||""}">${it.delta}</div>
    </div>`).join("")}</div>`;
}

function renderWaterfall(wf) {
  const max = Math.max(wf.base_anterior, wf.actual);
  const scale = 140 / max;
  const xs = [10, 200, 390, 580, 680];
  const labels = ["Año ant.", "Perdidos", "Volumen retenidos", "Nuevos", "Actual"];
  let bars = [barSvg(xs[0], 0, wf.base_anterior, scale, "#1C3D5A", labels[0], fmtMonto(wf.base_anterior))];
  let top = wf.base_anterior;
  [wf.perdidos, wf.volumen_retenidos, wf.nuevos].forEach((delta, i) => {
    const start = delta < 0 ? top + delta : top;
    bars.push(barSvg(xs[i+1], top - Math.max(start, 0), Math.abs(delta), scale,
      delta >= 0 ? "#3F6B52" : "#7A4038", labels[i+1], fmtMontoK(delta)));
    top += delta;
  });
  bars.push(barSvg(xs[4], 0, wf.actual, scale, "#1C3D5A", labels[4], fmtMonto(wf.actual)));
  return `<svg viewBox="0 0 760 200" width="100%" height="200">
    <line x1="0" y1="172" x2="760" y2="172" stroke="#E4E5E0"/>${bars.join("")}</svg>`;
}
function barSvg(x, yOffset, height, scale, color, label, valueLabel) {
  const h = Math.max(height * scale, 3);
  const y = 172 - (yOffset * scale) - h;
  return `<rect x="${x}" y="${y}" width="70" height="${h}" fill="${color}"/>
    <text x="${x+35}" y="${y-8}" class="wf-value" text-anchor="middle">${valueLabel}</text>
    <text x="${x+35}" y="192" class="wf-label" text-anchor="middle">${label}</text>`;
}

function renderMix(mix) {
  // Productos individuales hasta ~70% acumulado (segmento A, ya calculado
  // por el motor con la metodología SUINSA), agrupando el resto en "Otras
  // marcas" — no se asume una cantidad fija de productos.
  const principales = mix.filter(m => m.segmento === "A");
  const otrasItems = mix.filter(m => m.segmento !== "A");
  const otras = otrasItems.reduce((s, m) => s + m.pct, 0);
  let html = principales.map(m => `
    <div class="mix-row">
      <div class="mix-top"><span>${m.marca}</span><span>${m.pct}%${m.yoy_pct!==undefined&&m.yoy_pct!==null?` · ${fmtPct(m.yoy_pct)}`:""}</span></div>
      <div class="mix-track"><div class="mix-fill" style="width:${m.pct}%;"></div></div>
    </div>`).join("");
  if (otrasItems.length > 0) {
    html += `<div class="mix-row">
      <div class="mix-top"><span>Otras marcas (${otrasItems.length})</span><span>${otras.toFixed(1)}%</span></div>
      <div class="mix-track"><div class="mix-fill" style="width:${otras}%;"></div></div>
    </div>`;
  }
  return html;
}

function renderAbcStack(abc) {
  const colors = {A:"#1C3D5A", B:"#4C6C87", C:"#A9BBC9"};
  const bar = abc.map(s => `<div class="stack-seg" style="width:${s.pct_venta}%;background:${colors[s.segmento]};${s.segmento==='C'?'color:#14181D;':''}">${s.segmento} · ${s.pct_venta.toFixed(0)}%</div>`).join("");
  const legend = abc.map(s => `<span><span class="legend-dot" style="background:${colors[s.segmento]};"></span>${s.segmento} — ${s.entidades} clientes</span>`).join("");
  return `<div class="stack-bar">${bar}</div><div class="stack-legend">${legend}</div>`;
}

function renderContribList(rows) {
  return `<div class="contrib-list">${rows.map(r => `
    <div class="contrib-row">
      <div><span class="contrib-name">${r.nombre}</span><span class="contrib-tag">${r.tag}</span></div>
      <div class="contrib-value ${r.valor>=0?"pos":"neg"}">${r.valorTexto}</div>
    </div>`).join("")}</div>`;
}

function renderMatrix(matriz) {
  // Todos los productos siguen siendo puntos con tooltip completo.
  // Las etiquetas visibles se reservan a los productos más relevantes para
  // mantener una lectura ejecutiva limpia, evitando superposiciones.
  const conCrecimiento = matriz.filter(m => m.yoy_pct !== null);
  if (!conCrecimiento.length) {
    return `<div class="panel-note">No hay datos suficientes para construir la matriz Revenue vs. Growth.</div>`;
  }

  const yoys = conCrecimiento.map(m => Number(m.yoy_pct));
  const minY = Math.min(...yoys, -10), maxY = Math.max(...yoys, 10);
  const maxPct = Math.max(...conCrecimiento.map(m => Number(m.pct_participacion)), 1);
  const x = v => 40 + ((v - minY) / Math.max(maxY - minY, 1)) * 640;
  const y = v => 340 - (v / maxPct) * 300;
  const zeroX = x(0);

  // Etiquetamos solo los 3 productos de mayor participación y los extremos
  // de crecimiento. El resto conserva tooltip al pasar el cursor.
  const porParticipacion = [...conCrecimiento]
    .sort((a,b) => Number(b.pct_participacion) - Number(a.pct_participacion));
  const relevantes = [];
  const addRelevant = m => {
    if (m && !relevantes.some(r => r.marca === m.marca)) relevantes.push(m);
  };
  porParticipacion.slice(0, 3).forEach(addRelevant);
  addRelevant(conCrecimiento.reduce((best, m) => Number(m.yoy_pct) > Number(best.yoy_pct) ? m : best, conCrecimiento[0]));
  addRelevant(conCrecimiento.reduce((worst, m) => Number(m.yoy_pct) < Number(worst.yoy_pct) ? m : worst, conCrecimiento[0]));

  // Colocación de etiquetas con posiciones candidatas y detección de
  // colisiones. Así evitamos que nombres cercanos se impriman uno sobre otro.
  const ocupadas = [];
  const labelWidth = texto => Math.min(175, Math.max(58, texto.length * 5.8));
  const solapa = (a,b) => !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom);

  const etiquetas = relevantes.map(m => {
    const px = x(Number(m.yoy_pct));
    const py = y(Number(m.pct_participacion));
    const r = Math.max(8, Math.sqrt(Number(m.pct_participacion)) * 6);
    const nombreCorto = String(m.marca).split(" (")[0].trim().slice(0, 24);
    const w = labelWidth(nombreCorto);
    const h = 12;

    const candidatos = [
      {dx:0, dy:-(r+18), anchor:"middle"},
      {dx:r+10, dy:-(r+8), anchor:"start"},
      {dx:-(r+10), dy:-(r+8), anchor:"end"},
      {dx:r+12, dy:5, anchor:"start"},
      {dx:-(r+12), dy:5, anchor:"end"},
      {dx:0, dy:r+20, anchor:"middle"},
      {dx:r+10, dy:r+18, anchor:"start"},
      {dx:-(r+10), dy:r+18, anchor:"end"}
    ];

    let elegido = null;
    for (const c of candidatos) {
      const tx = px + c.dx;
      const ty = py + c.dy;
      const left = c.anchor === "start" ? tx : c.anchor === "end" ? tx - w : tx - w/2;
      const right = left + w;
      const top = ty - h;
      const bottom = ty + 2;

      // Mantener las etiquetas dentro del área útil del SVG.
      if (left < 22 || right > 698 || top < 22 || bottom > 342) continue;

      const box = {left, right, top, bottom};
      if (!ocupadas.some(o => solapa(box, o))) {
        elegido = {tx, ty, anchor:c.anchor, box};
        break;
      }
    }

    // Si todas las posiciones candidatas chocan, conserva una separación
    // vertical mínima en una posición superior, priorizando legibilidad.
    if (!elegido) {
      let ty = Math.max(24, py - r - 18);
      while (ocupadas.some(o => solapa(
        {left:px-w/2,right:px+w/2,top:ty-h,bottom:ty+2}, o
      )) && ty < 335) ty += 15;
      elegido = {
        tx:Math.min(698-w/2, Math.max(22+w/2, px)),
        ty:Math.min(335, ty),
        anchor:"middle",
        box:{left:Math.max(22,px-w/2),right:Math.min(698,px+w/2),top:ty-h,bottom:ty+2}
      };
    }

    ocupadas.push(elegido.box);
    const lineX2 = elegido.anchor === "start" ? elegido.tx - 4 :
                    elegido.anchor === "end" ? elegido.tx + 4 : elegido.tx;
    const lineY2 = elegido.ty - 3;

    return `<line x1="${px.toFixed(1)}" y1="${(py-r-2).toFixed(1)}" x2="${lineX2.toFixed(1)}" y2="${lineY2.toFixed(1)}" stroke="#C9CBC4" stroke-width="1"/>
      <text x="${elegido.tx.toFixed(1)}" y="${elegido.ty.toFixed(1)}" class="matrix-point" text-anchor="${elegido.anchor}">${nombreCorto}</text>`;
  }).join("");

  const puntos = conCrecimiento.map(m => {
    const r = Math.max(8, Math.sqrt(Number(m.pct_participacion)) * 6);
    const color = Number(m.yoy_pct) >= 0 ? "#3F6B52" : "#7A4038";
    return `<circle cx="${x(Number(m.yoy_pct)).toFixed(1)}" cy="${y(Number(m.pct_participacion)).toFixed(1)}" r="${r.toFixed(1)}" fill="${color}" opacity="0.75">
      <title>${m.marca} — Participación ${Number(m.pct_participacion).toFixed(1)}% · Crecimiento ${fmtPct(Number(m.yoy_pct))}</title>
    </circle>`;
  }).join("");

  return `<svg viewBox="0 0 720 380" width="100%" height="380">
    <line x1="${zeroX.toFixed(1)}" y1="10" x2="${zeroX.toFixed(1)}" y2="345" stroke="#E4E5E0"/>
    <line x1="20" y1="345" x2="700" y2="345" stroke="#E4E5E0"/>
    <text x="700" y="362" class="matrix-label" text-anchor="end">Crecimiento YoY →</text>
    <text x="24" y="20" class="matrix-label">↑ Participación</text>
    ${puntos}
    ${etiquetas}
  </svg>
  <div class="panel-note">Pase el cursor sobre cualquier punto para ver el detalle completo · etiquetas visibles: top 3 por participación y extremos de crecimiento</div>`;
}
function normalizarTextoEjecutivo(texto) {
  if (texto === null || texto === undefined) return "";
  let textoStr = String(texto);

  // Hace más explícita la lógica de priorización económica en el SBR,
  // sin modificar los datos ni la lógica de cálculo del motor.
  textoStr = textoStr
    .replace(
      /^Representan (C\$[\d,.]+) — prioridad por impacto en C\$, no por volumen de clientes\.$/,
      "Representan $1 en venta potencial a recuperar; por ello, la prioridad se define por impacto económico y no por cantidad de clientes."
    )
    .replace(
      "La prioridad de contacto debe ser por impacto en C$, no por cantidad de clientes.",
      "La recuperación debe priorizarse por valor económico potencial, no por cantidad de clientes."
    );

  // En textos ejecutivos, los importes negativos menores de C$1M se muestran
  // en miles para facilitar la lectura (p.ej. -0.94M → −C$940K).
  // Los importes de C$1M o más conservan la notación en millones.
  textoStr = textoStr.replace(/([−-]?)C?\$?([0-9]+(?:\.[0-9]+)?)M\b/g, (match, signo, numero) => {
    const valor = Number(numero);
    if (!Number.isFinite(valor)) return match;
    const negativo = signo === "-" || signo === "−";
    const abs = Math.abs(valor);
    if (abs < 1) {
      const miles = Math.round(abs * 1000);
      return (negativo ? "−" : "") + "C$" + miles + "K";
    }
    return (negativo ? "−" : "") + "C$" + abs.toFixed(2) + "M";
  });

  return textoStr;
}

function renderExecSummary(hallazgos) {
  if (!hallazgos || hallazgos.length === 0) return "";
  return `
    <div class="section-kicker">Executive Summary</div>
    <div>
      ${hallazgos.map(h => `
        <div class="entry">
          <div class="entry-title">${normalizarTextoEjecutivo(h.texto)}</div>
          <div class="entry-body">${normalizarTextoEjecutivo(h.implicacion)}</div>
        </div>`).join("")}
    </div>`;
}

function renderOportunidadesRiesgos(hallazgos) {
  const oportunidades = (hallazgos || []).filter(h => h.tipo === "oportunidad");
  const riesgos = (hallazgos || []).filter(h => h.tipo === "riesgo");
  if (oportunidades.length === 0 && riesgos.length === 0) return "";
  const col = (items, vacio) => items.length
    ? items.map(h => `<div class="entry"><div class="entry-title">${normalizarTextoEjecutivo(h.texto)}</div><div class="entry-body">${normalizarTextoEjecutivo(h.implicacion)}</div></div>`).join("")
    : `<div class="entry"><div class="entry-body" style="font-style:italic;">${vacio}</div></div>`;
  return `
    <div class="two-col" style="margin-top:32px;">
      <div>
        <div class="col-kicker opp">Oportunidades</div>
        ${col(oportunidades, "Sin hallazgos de este tipo en el periodo.")}
      </div>
      <div>
        <div class="col-kicker risk">Riesgos</div>
        ${col(riesgos, "Sin hallazgos de este tipo en el periodo.")}
      </div>
    </div>`;
}

function renderRecomendacionesCapitulo(recomendaciones, capId) {
  const filtradas = (recomendaciones || []).filter(r => r.capitulo_origen === capId);
  if (filtradas.length === 0) return "";
  return `
    <div class="section-kicker" style="margin-top:36px;">Executive Recommendations</div>
    <table class="exec-table">
      <thead><tr><th>Acción</th><th>Responsable</th><th>Plazo</th><th>Prioridad</th></tr></thead>
      <tbody>
        ${filtradas.map(r => `<tr>
          <td><b>${r.titulo}</b><br><span style="color:var(--ink-muted);font-size:12px;">${normalizarTextoEjecutivo(r.detalle)}</span></td>
          <td>${r.dueno}</td><td>${r.plazo}</td>
          <td class="priority-${r.prioridad==='Alta'?'high':'media'}">${r.prioridad}</td>
        </tr>`).join("")}
      </tbody>
    </table>`;
}

function renderDashboard(payload, snap) {
  const k = snap.kpis, wf = snap.waterfall;
  return `
    <div class="kicker">Capítulo 01 — Executive Dashboard</div>
    <h1 class="thesis">Panorama ejecutivo de ${payload.nombre_display}</h1>
    <p class="dek">Fecha Operativa: ${snap.fecha_operativa}</p>
    ${kpiStrip([
      {label:"Venta YTD", value:fmtMonto(k.venta_ytd), delta:`${fmtPct(k.yoy_ytd_pct)} YoY`, deltaClass:deltaClass(k.yoy_ytd_pct)},
      {label:"MAT / R12", value:fmtR12Value(payload, snap), delta:fmtR12Delta(payload, snap), deltaClass:deltaClass(k.yoy_mat_pct)},
      {label:"Clientes activos", value:k.clientes_activos, delta:fmtBaseClientes(snap)},
      {label:"Churn de cartera", value:fmtChurnValue(k.churn_pct), delta:fmtChurnDelta(snap), deltaClass:k.churn_pct === null ? "" : "down"},
    ])}
    <div class="panel-grid">
      <div><div class="panel-title">Variación interanual (waterfall)</div>${renderWaterfall(wf)}</div>
      <div><div class="panel-title">Mix de portafolio — ABC 70/20/10</div>${renderMix(snap.mix_marca)}</div>
    </div>
    <div class="panel-grid" style="grid-template-columns:1fr;">
      <div><div class="panel-title">Segmentación de clientes</div>${renderAbcStack(snap.abc_clientes)}</div>
    </div>`;
}

function renderDiagnostico(payload, snap) {
  const wf = snap.waterfall, peor = snap.top_movers[0];
  const peores = snap.top_movers.filter(m => m.delta < 0).slice(0, 2);
  const mejores = snap.top_movers.filter(m => m.delta > 0).sort((a,b) => b.delta - a.delta).slice(0, 2);
  const rows = [...peores, ...mejores].map(m => ({
    nombre:m.marca, tag:`${fmtPct(m.yoy_pct)} YoY`, valor:m.delta, valorTexto:`${m.delta>=0?"+":""}${fmtMontoK(m.delta)}`
  }));
  return `
    <div class="kicker">Capítulo 02 — Diagnóstico del Periodo</div>
    <h1 class="thesis">${peor.delta<0 ? `${peor.marca} explica la mayor caída del periodo` : "Diagnóstico del periodo"}</h1>
    <p class="dek">Descomposición de la variación interanual del periodo.</p>
    ${kpiStrip([
      {label:"Venta YTD", value:fmtMonto(snap.kpis.venta_ytd), delta:`${fmtPct(snap.kpis.yoy_ytd_pct)} interanual`, deltaClass:deltaClass(snap.kpis.yoy_ytd_pct)},
      {label:"MAT / R12", value:fmtR12Value(payload, snap), delta:tieneHistoriaR12(payload) ? fmtPct(snap.kpis.yoy_mat_pct) : "Sin 12 meses de historia", deltaClass:deltaClass(snap.kpis.yoy_mat_pct)},
      {label:"Churn de cartera", value:fmtChurnValue(snap.kpis.churn_pct), delta:snap.kpis.churn_pct === null ? "Sin base comparable" : `${wf.n_perdidos} de ${wf.n_perdidos+wf.n_retenidos} clientes 2025`},
    ])}
    ${renderExecSummary(snap.hallazgos["02"])}
    <div class="section">
      <div class="section-kicker">¿Por qué ocurrió?</div>
      <h2 class="section-title">Descomposición interanual real</h2>
      ${renderWaterfall(wf)}
      ${renderContribList(rows)}
      ${renderOportunidadesRiesgos(snap.hallazgos["02"])}
      ${renderRecomendacionesCapitulo(snap.recomendaciones, "02")}
    </div>`;
}

function renderTendencias(payload, snap) {
  const MESES = [
    "",
    "Enero","Febrero","Marzo","Abril","Mayo","Junio",
    "Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"
  ];

  /*
   * Trayectoria acumulada por año.
   *
   * FUENTE PRIMARIA: serie_mensual del proveedor.
   * No usamos serie_multianual para años históricos cuando existe la venta
   * mensual real, porque un snapshot operativo puede traer una ventana parcial
   * (por ejemplo, solo Jul-Ago) y hacer parecer que la historia comienza en julio.
   *
   * Regla de comparabilidad:
   * - visible desde 2023;
   * - cada año se acumula desde enero (o desde su primer mes real si comenzó
   *   operaciones durante ese año);
   * - los años se cortan al mismo mes operativo;
   * - 2022 queda fuera;
   * - solo si no existe serie_mensual para un año se usa serie_multianual como
   *   fallback posicional.
   */
  const ANIO_INICIO_TRAYECTORIA = 2023;
  const fechaOperativa = String(snap.fecha_operativa || "");
  const anioOperativo = Number(fechaOperativa.slice(0,4));
  const mesOperativo = Number(fechaOperativa.slice(5,7));

  const series = {};
  const mensual = Array.isArray(payload?.serie_mensual) ? payload.serie_mensual : [];

  // Agrupar venta mensual real por año/mes.
  const mensualPorAnio = {};
  mensual.forEach(r => {
    const texto = String(r?.mes || "");
    const anio = Number(texto.slice(0,4));
    const mes = Number(texto.slice(5,7));
    const valor = Number(r?.valor);
    if (
      Number.isFinite(anio) &&
      Number.isFinite(mes) &&
      anio >= ANIO_INICIO_TRAYECTORIA &&
      anio <= anioOperativo &&
      mes >= 1 && mes <= mesOperativo &&
      Number.isFinite(valor)
    ) {
      if (!mensualPorAnio[anio]) mensualPorAnio[anio] = {};
      mensualPorAnio[anio][mes] = valor;
    }
  });

  // Construir trayectoria desde la venta mensual real.
  Object.entries(mensualPorAnio).forEach(([anioTxt, meses]) => {
    const anio = Number(anioTxt);
    const mesesDisponibles = Object.keys(meses).map(Number).sort((a,b) => a-b);
    if (!mesesDisponibles.length) return;

    // Si existe enero, arrancamos en enero. Si el proveedor comenzó después,
    // arrancamos en su primer mes con venta real.
    const primerMes = mesesDisponibles[0];
    let acumulado = 0;
    series[anio] = mesesDisponibles
      .filter(m => m <= mesOperativo)
      .map(m => {
        acumulado += meses[m];
        return {mes:m, valor:acumulado};
      });
  });

  // Fallback SOLO para años sin venta mensual disponible.
  const multianual = snap?.serie_multianual || payload?.serie_multianual || null;
  if (multianual && typeof multianual === "object") {
    Object.entries(multianual).forEach(([anioRaw, valores]) => {
      const anio = Number(anioRaw);
      if (
        !Number.isFinite(anio) ||
        anio < ANIO_INICIO_TRAYECTORIA ||
        anio > anioOperativo ||
        series[anio] ||
        !Array.isArray(valores)
      ) return;

      const puntos = valores
        .slice(0, Math.min(12, mesOperativo))
        .map((valor, idx) => ({mes:idx + 1, valor:Number(valor)}))
        .filter(p => Number.isFinite(p.valor) && p.valor >= 0);

      const primero = puntos.findIndex(p => p.valor > 0);
      if (primero >= 0) series[anio] = puntos.slice(primero);
    });
  }

  const anios = Object.keys(series)
    .map(Number)
    .filter(a => a >= ANIO_INICIO_TRAYECTORIA && a <= anioOperativo)
    .sort((a,b) => a-b);

  const trayectorias = series;
  const aniosVisibles = anios.filter(a => (trayectorias[a] || []).length > 0);
  const allVals = aniosVisibles.flatMap(a => (trayectorias[a] || []).map(p => p.valor));
  const min = 0;
  const max = allVals.length ? Math.max(...allVals) : 1;
  const rango = Math.max(max - min, 1);

  const colors = {};
  aniosVisibles.forEach((a, i) => {
    if (i === aniosVisibles.length - 1) colors[a] = "#1C3D5A";
    else if (i === aniosVisibles.length - 2) colors[a] = "#4C6C87";
    else colors[a] = "#A9B0B5";
  });

  // Un único año con inicio tardío conserva su primer mes real.
  const primerMesGlobal = (() => {
    const primeros = aniosVisibles
      .map(a => (trayectorias[a] || [])[0]?.mes)
      .filter(Number.isFinite);
    return (aniosVisibles.length === 1 && primeros.length) ? Math.min(...primeros) : 1;
  })();

  const ultimoMesGlobal = Math.max(primerMesGlobal, Math.min(12, mesOperativo || 12));
  const mesesEje = [];
  for (let m = primerMesGlobal; m <= ultimoMesGlobal; m++) mesesEje.push(m);

  const X_INICIO = 58;
  const X_FIN = 730;
  const n = Math.max(mesesEje.length, 1);
  const xPosMes = mes => n === 1
    ? (X_INICIO + X_FIN) / 2
    : X_INICIO + ((mes - primerMesGlobal) * ((X_FIN - X_INICIO) / (n - 1)));

  const lines = aniosVisibles.map(anio => {
    const serie = trayectorias[anio] || [];
    if (serie.length < 1) return "";

    const pts = serie.map(p => {
      const px = xPosMes(p.mes);
      const py = 190 - ((p.valor - min) / rango) * 155;
      return `${px.toFixed(1)},${py.toFixed(1)}`;
    }).join(" ");

    return `
      <polyline
        points="${pts}"
        fill="none"
        stroke="${colors[anio]}"
        stroke-width="${anio === aniosVisibles[aniosVisibles.length - 1] ? 2.8 : 1.6}"
        stroke-linejoin="round"
        stroke-linecap="round"
      />
    `;
  }).join("");

  const mom = snap.momentum_mensual || [];
  const momVals = mom.slice(1).map(m => Number(m.mom_pct) || 0);
  const momMax = Math.max(...momVals.map(v => Math.abs(v)), 1);

  const momentumRows = mom.map((m, idx) => {
    const pct = Number(m.mom_pct);
    const valor = Number(m.valor) || 0;
    const comparable = idx > 0 && Number.isFinite(pct);
    const width = comparable ? Math.min(Math.abs(pct) / momMax * 100, 100) : 0;
    const pctTexto = comparable ? fmtPct(pct) : "—";
    const color = comparable ? (pct >= 0 ? "var(--positive)" : "var(--negative)") : "var(--ink-faint)";

    return `
      <div style="display:grid;grid-template-columns:90px 1fr 70px 80px;gap:18px;align-items:center;min-height:38px;border-bottom:1px solid var(--line);">
        <div style="font-size:13px;">${MESES[m.mes] || `Mes ${m.mes}`}</div>
        <div style="height:6px;background:var(--line);overflow:hidden;">
          <div style="height:100%;width:${width}%;min-width:${comparable ? "2px" : "0"};background:${color};"></div>
        </div>
        <div style="font-size:13px;font-weight:600;text-align:right;white-space:nowrap;color:${color};">${pctTexto}</div>
        <div style="font-size:11.5px;color:var(--ink-muted);text-align:right;white-space:nowrap;">${fmtMontoK(valor)}</div>
      </div>
    `;
  }).join("");

  const qoq = snap.qoq;
  const kpis = [
    {
      label:"MAT / R12",
      value:fmtR12Value(payload, snap),
      delta:fmtPct(snap.kpis.yoy_mat_pct),
      deltaClass:deltaClass(snap.kpis.yoy_mat_pct)
    },
    {
      label:"Venta YTD",
      value:fmtMonto(snap.kpis.venta_ytd),
      delta:fmtPct(snap.kpis.yoy_ytd_pct),
      deltaClass:deltaClass(snap.kpis.yoy_ytd_pct)
    }
  ];

  if (qoq) {
    kpis.push({
      label:`QoQ (${qoq.trimestre_actual} vs. ${qoq.trimestre_anterior})`,
      value:fmtPct(qoq.qoq_pct),
      delta:qoq.trimestre_actual_completo ? "Trimestre completo" : "Último trimestre completo",
      deltaClass:deltaClass(qoq.qoq_pct)
    });
  }

  return `
    <div class="kicker">Capítulo 03 — Tendencias</div>

    <h1 class="thesis">
      Evolución acumulada y señales de aceleración comercial
    </h1>

    <p class="dek">
      Lectura de la trayectoria de ventas, comparación interanual y momentum
      mensual hasta la fecha operativa del período.
    </p>

    ${kpiStrip(kpis)}

    ${renderExecSummary(snap.hallazgos["03"])}

    <div class="section">

      <div class="section-kicker">
        ¿Cómo evoluciona la venta acumulada?
      </div>

      <h2 class="section-title">
        Trayectoria acumulada por año
      </h2>

      <svg
        viewBox="0 0 790 240"
        width="100%"
        height="240"
        aria-label="Evolución acumulada de ventas por año"
      >
        ${[0.25,0.5,0.75,1].map((ratio) => {
          const yGrid = 190 - (ratio * 155);
          const val = max * ratio;
          return `
            <line x1="58" y1="${yGrid.toFixed(1)}" x2="730" y2="${yGrid.toFixed(1)}" stroke="#E4E5E0" stroke-dasharray="3 5"/>
            <text x="4" y="${(yGrid+3).toFixed(1)}" class="wf-label">${fmtMonto(val)}</text>
          `;
        }).join("")}
        <line x1="58" y1="190" x2="730" y2="190" stroke="#E4E5E0"/>
        <text x="4" y="193" class="wf-label">C$0</text>

        ${lines}

        ${(() => {
          const finales = aniosVisibles.map(anio => {
            const serie = trayectorias[anio] || [];
            if (!serie.length) return null;
            const ultimo = serie[serie.length - 1];
            const px = xPosMes(ultimo.mes);
            const py = 190 - ((ultimo.valor - min) / rango) * 155;
            return { anio, valorFinal:ultimo.valor, px, py };
          }).filter(Boolean);

          // Columna fija de etiquetas a la derecha: evita que los valores
          // se monten entre sí aunque las líneas terminen muy próximas.
          const LABEL_X = 738;
          const LABEL_MIN_Y = 38;
          const LABEL_MAX_Y = 178;
          const LABEL_GAP = 17;
          const ordenadas = [...finales].sort((a,b) => a.py - b.py);
          let ultimoY = LABEL_MIN_Y - LABEL_GAP;
          ordenadas.forEach(item => {
            item.labelY = Math.max(item.py, ultimoY + LABEL_GAP);
            ultimoY = item.labelY;
          });
          if (ordenadas.length) {
            const exceso = ordenadas[ordenadas.length - 1].labelY - LABEL_MAX_Y;
            if (exceso > 0) ordenadas.forEach(item => { item.labelY -= exceso; });
          }

          return finales.map(item => {
            const y = item.labelY;
            return `<line x1="${item.px.toFixed(1)}" y1="${item.py.toFixed(1)}" x2="${LABEL_X-5}" y2="${y.toFixed(1)}" stroke="#C9CBC4" stroke-width="1"/>
              <circle cx="${item.px.toFixed(1)}" cy="${item.py.toFixed(1)}" r="2.8" fill="${colors[item.anio]}"/>
              <text x="${LABEL_X}" y="${(y+3).toFixed(1)}" class="wf-value" fill="${colors[item.anio]}" text-anchor="start">${fmtMonto(item.valorFinal)}</text>`;
          }).join("");
        })()}
        ${mesesEje.map(m => {
          const x = xPosMes(m);
          return `<text x="${x.toFixed(1)}" y="208" class="wf-label" text-anchor="middle">${MESES[m].slice(0,3)}</text>`;
        }).join("")}
      </svg>

      <div style="display:flex;gap:22px;flex-wrap:wrap;font-size:11.5px;color:var(--ink-muted);margin-top:4px;">
        ${aniosVisibles.map(anio => `
          <span>
            <span style="display:inline-block;width:8px;height:8px;margin-right:5px;background:${colors[anio]};vertical-align:middle;"></span>
            ${anio}
          </span>
        `).join("")}
      </div>

      <div class="panel-note">
        La comparación se realiza sobre meses equivalentes hasta la fecha operativa disponible.
        La trayectoria utiliza la serie multianual acumulada calculada por el motor comercial. Si el proveedor inició operaciones
        durante el año, la trayectoria comienza en su primer mes con venta. Los valores al cierre
        de cada trayectoria se muestran en Córdobas (C$).
      </div>

    </div>

    <div class="section">

      <div class="section-kicker">
        ¿Está acelerando o desacelerando?
      </div>

      <h2 class="section-title">
        Momentum mensual
      </h2>

      <div style="display:grid;grid-template-columns:90px 1fr 70px 80px;gap:18px;width:100%;max-width:760px;padding:0 0 9px;border-bottom:1px solid var(--line-strong);font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-faint);font-weight:600;">
        <span>Mes</span>
        <span>Variación MoM</span>
        <span style="text-align:right;">%</span>
        <span style="text-align:right;">Venta</span>
      </div>

      <div style="width:100%;max-width:760px;">
        ${momentumRows}
      </div>

      <div class="panel-note">
        MoM compara cada mes contra el mes inmediatamente anterior. La primera observación no representa una variación comparable y se muestra como “—”.
      </div>

    </div>

    ${renderOportunidadesRiesgos(snap.hallazgos["03"])}

    ${renderRecomendacionesCapitulo(snap.recomendaciones, "03")}
  `;
}
function renderPortafolio(payload, snap) {
  return `
    <div class="kicker">Capítulo 04 — Portafolio</div>
    <h1 class="thesis">Matriz de portafolio — Revenue vs. Growth</h1>
    <p class="dek">Participación en ventas y crecimiento interanual por producto, según Catálogo Maestro.</p>
    ${renderExecSummary(snap.hallazgos["04"])}
    <div class="section">
      <div class="section-kicker">¿Cómo se compone el portafolio?</div>
      <h2 class="section-title">Mix de portafolio — ABC 70/20/10</h2>
      ${renderMix(snap.mix_marca)}
    </div>
    <div class="section">
      <div class="section-kicker">¿Dónde está cada producto en su ciclo de vida?</div>
      <h2 class="section-title">Matriz Revenue vs. Growth</h2>
      ${renderMatrix(snap.matriz_portafolio)}
      ${renderOportunidadesRiesgos(snap.hallazgos["04"])}
      ${renderRecomendacionesCapitulo(snap.recomendaciones, "04")}
    </div>`;
}

function renderDrillDownClientesPerdidos(detalle) {
  if (!detalle || detalle.length === 0) return "";
  return `
    <details style="margin-top:20px;">
      <summary class="client-drill-summary">Ver clientes (${detalle.length})</summary>
      <div style="margin-top:16px;max-height:420px;overflow-y:auto;border:1px solid var(--line);">
        <table class="exec-table" style="margin-top:0;">
          <thead><tr><th>Cliente</th><th>Venta período anterior</th><th>Impacto perdido</th><th>Segmento</th><th>Prioridad</th></tr></thead>
          <tbody>
            ${detalle.map(c => `<tr>
              <td>${c.nombre}</td>
              <td>${fmtMontoK(c.venta_periodo_anterior)}</td>
              <td style="color:var(--negative);">−${fmtMontoK(c.impacto_perdido)}</td>
              <td>${c.segmento}</td>
              <td class="priority-${c.prioridad==='Alta'?'high':'media'}">${c.prioridad}</td>
            </tr>`).join("")}
          </tbody>
        </table>
      </div>
    </details>`;
}

function renderClientes(payload, snap) {
  const seg = snap.clientes_perdidos_por_segmento;
  const rows = Object.entries(seg).map(([s,v]) => ({
    nombre:`Clientes Segmento ${s} perdidos`, tag:`${v.n} clientes`, valor:-v.valor, valorTexto:`−${fmtMontoK(v.valor)}`
  }));
  const wf = snap.waterfall;
  const dinamica = [
    {nombre:"Clientes nuevos", tag:`${wf.n_nuevos} clientes incorporados`, valor:wf.nuevos, valorTexto:`+${fmtMontoK(wf.nuevos)}`},
    {nombre:`Clientes retenidos (${wf.n_retenidos})`, tag:"mismos clientes, variación de volumen",
     valor:snap.clientes_pct_variacion_retenidos, valorTexto:fmtPct(snap.clientes_pct_variacion_retenidos)},
    ...rows,
  ];
  const topCli = snap.top_clientes.map(c => ({
    nombre:c.nombre, tag:"Top cliente", valor:c.valor, valorTexto:fmtMontoK(c.valor)
  }));
  return `
    <div class="kicker">Capítulo 05 — Clientes</div>
    <h1 class="thesis">Segmentación ABC 70/20/10 y dinámica real de cartera</h1>
    <p class="dek">Clasificación de clientes según metodología ABC 70/20/10 de SUINSA.</p>
    ${kpiStrip([
      {label:"Clientes activos", value:snap.kpis.clientes_activos, delta:fmtBaseClientes(snap)},
      {label:"Churn", value:fmtChurnValue(snap.kpis.churn_pct), delta:snap.kpis.churn_pct === null ? "Sin base comparable" : `${snap.waterfall.n_perdidos} perdidos`, deltaClass:snap.kpis.churn_pct === null ? "" : "down"},
    ])}
    ${renderExecSummary(snap.hallazgos["05"])}
    <div class="section">
      <div class="section-kicker">¿Qué clientes explican el resultado?</div>
      <h2 class="section-title">Segmentación ABC 70/20/10</h2>
      ${renderAbcStack(snap.abc_clientes)}
      ${renderContribList(topCli)}
    </div>
    <div class="section">
      <div class="section-kicker">¿Estamos ganando o perdiendo clientes, y de qué tipo?</div>
      <h2 class="section-title">Dinámica real de cartera, por segmento</h2>
      ${renderContribList(dinamica)}
      ${renderDrillDownClientesPerdidos(snap.clientes_perdidos_detalle)}
      ${renderOportunidadesRiesgos(snap.hallazgos["05"])}
      ${renderRecomendacionesCapitulo(snap.recomendaciones, "05")}
    </div>`;
}

function renderPlan(payload, snap) {
  const recos = snap.recomendaciones;
  const alta = recos.filter(r => r.prioridad === "Alta").length;
  const CAP_NOMBRE = {"02":"Diagnóstico","03":"Tendencias","04":"Portafolio","05":"Clientes"};
  return `
    <div class="kicker">Capítulo 06 — Plan de Acción</div>
    <h1 class="thesis">${recos.length} Acciones prioritarias para capturar valor</h1>
    <p class="dek">Acciones derivadas de los principales hallazgos del período, priorizadas por impacto económico y urgencia de ejecución.</p>
    ${kpiStrip([
      {label:"Acciones prioritarias", value:recos.length, delta:"derivadas de 4 capítulos"},
      {label:"Alta prioridad", value:alta, delta:"mayor impacto económico"},
    ])}
    <table class="exec-table">
      <thead><tr><th>Acción</th><th>Origen</th><th>Responsable</th><th>Plazo</th><th>Prioridad</th></tr></thead>
      <tbody>
        ${recos.map(r => `<tr>
          <td><b>${r.titulo}</b><br><span style="color:var(--ink-muted);font-size:12px;">${normalizarTextoEjecutivo(r.detalle)}</span></td>
          <td style="color:var(--ink-faint);font-size:12px;">Cap. ${r.capitulo_origen} — ${CAP_NOMBRE[r.capitulo_origen]||""}</td>
          <td>${r.dueno}</td><td>${r.plazo}</td>
          <td class="priority-${r.prioridad==='Alta'?'high':'media'}">${r.prioridad}</td>
        </tr>`).join("")}
      </tbody>
    </table>`;
}

const RENDERERS = {
  dashboard: renderDashboard, diagnostico: renderDiagnostico, tendencias: renderTendencias,
  portafolio: renderPortafolio, clientes: renderClientes, plan: renderPlan,
};

function render() {
  const payload = DATA[proveedorActual];
  const snapFuente = payload.snapshots[fechaActual];
  const snap = prepararVista(snapFuente);
  const contenido = RENDERERS[capituloActual](payload, snap);
  document.getElementById("app").innerHTML = shell(payload, snap, contenido);
  bindShellEvents();
}

async function init() {
  PROVEEDORES = await cargarManifiestoProveedores();
  proveedorActual = PROVEEDORES[0].id;
  const payload = await cargarProveedor(proveedorActual);
  const fechas = Object.keys(payload.snapshots).sort();
  fechaActual = fechas[fechas.length - 1];  // fecha operativa más reciente por defecto
  render();
}
init();