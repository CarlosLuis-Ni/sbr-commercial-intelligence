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

async function cargarProveedor(id) {
  if (DATA[id]) return DATA[id];
  // cache-busting: evita que el navegador sirva una copia vieja del JSON
  // cuando el archivo en disco ya se actualizó (python -m http.server no
  // envía cabeceras de caché).
  const res = await fetch(`data/${id}.json?v=${Date.now()}`);
  DATA[id] = await res.json();
  return DATA[id];
}

const fmtMonto = v => `C$${(v/1_000_000).toFixed(2)}M`;
const fmtMontoK = v => Math.abs(v) >= 1_000_000 ? fmtMonto(v) : `C$${(v/1000).toFixed(0)}K`;
const fmtPct = v => (v === null || v === undefined) ? "—" : `${v>0?"+":""}${v.toFixed(1)}%`;
const deltaClass = v => (v===null||v===undefined) ? "" : v>0 ? "up" : v<0 ? "down" : "";
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
  // Todos los productos se conservan como puntos (con tooltip nativo al
  // pasar el mouse). Las etiquetas de texto en el gráfico se reservan solo
  // para los productos estratégicamente relevantes (mayor participación,
  // o los extremos de crecimiento), para que la zona con muchos productos
  // chicos no quede ilegible por superposición de texto.
  const conCrecimiento = matriz.filter(m => m.yoy_pct !== null);
  const yoys = conCrecimiento.map(m => m.yoy_pct);
  const minY = Math.min(...yoys, -10), maxY = Math.max(...yoys, 10);
  const maxPct = Math.max(...matriz.map(m => m.pct_participacion));
  const x = v => 40 + ((v - minY) / (maxY - minY)) * 640;
  const y = v => 340 - (v / maxPct) * 300;
  const zeroX = x(0);

  // Productos relevantes a etiquetar: top 5 por participación + los
  // extremos de crecimiento (mayor y menor YoY), sin duplicar.
  const porParticipacion = [...conCrecimiento].sort((a,b) => b.pct_participacion - a.pct_participacion);
  const relevantesSet = new Set(porParticipacion.slice(0, 5).map(m => m.marca));
  const mayorCrecimiento = conCrecimiento.reduce((best, m) => m.yoy_pct > best.yoy_pct ? m : best, conCrecimiento[0]);
  const menorCrecimiento = conCrecimiento.reduce((worst, m) => m.yoy_pct < worst.yoy_pct ? m : worst, conCrecimiento[0]);
  if (mayorCrecimiento) relevantesSet.add(mayorCrecimiento.marca);
  if (menorCrecimiento) relevantesSet.add(menorCrecimiento.marca);

  // Posicionamiento de etiquetas: se ordenan por X y se escalona la altura
  // cuando dos quedarían demasiado cerca, para reducir superposición.
  const relevantes = conCrecimiento
    .filter(m => relevantesSet.has(m.marca))
    .sort((a, b) => x(a.yoy_pct) - x(b.yoy_pct));
  let ultimoX = -Infinity, nivel = 0;
  const etiquetas = relevantes.map(m => {
    const px = x(m.yoy_pct), py = y(m.pct_participacion);
    const r = Math.max(8, Math.sqrt(m.pct_participacion) * 6);
    if (px - ultimoX < 140) { nivel = (nivel + 1) % 4; } else { nivel = 0; }
    ultimoX = px;
    const offset = r + 14 + nivel * 18;
    const nombreCorto = m.marca.split(" (")[0].slice(0, 22);
    return `<line x1="${px}" y1="${py - r - 2}" x2="${px}" y2="${py - offset + 3}" stroke="#C9CBC4" stroke-width="1"/>
      <text x="${px}" y="${py - offset}" class="matrix-point" text-anchor="middle">${nombreCorto}</text>`;
  }).join("");

  const puntos = conCrecimiento.map(m => {
    const r = Math.max(8, Math.sqrt(m.pct_participacion) * 6);
    const color = m.yoy_pct >= 0 ? "#3F6B52" : "#7A4038";
    return `<circle cx="${x(m.yoy_pct)}" cy="${y(m.pct_participacion)}" r="${r}" fill="${color}" opacity="0.75">
      <title>${m.marca} — Participación ${m.pct_participacion.toFixed(1)}% · Crecimiento ${fmtPct(m.yoy_pct)}</title>
    </circle>`;
  }).join("");

  return `<svg viewBox="0 0 720 380" width="100%" height="380">
    <line x1="${zeroX}" y1="10" x2="${zeroX}" y2="345" stroke="#E4E5E0"/>
    <line x1="20" y1="345" x2="700" y2="345" stroke="#E4E5E0"/>
    <text x="700" y="362" class="matrix-label" text-anchor="end">Crecimiento YoY →</text>
    <text x="24" y="20" class="matrix-label">↑ Participación</text>
    ${puntos}
    ${etiquetas}
  </svg>
  <div class="panel-note">Pase el cursor sobre cualquier punto para ver el detalle completo · etiquetas visibles: mayor participación y extremos de crecimiento</div>`;
}

function renderExecSummary(hallazgos) {
  if (!hallazgos || hallazgos.length === 0) return "";
  return `
    <div class="section-kicker">Executive Summary</div>
    <div>
      ${hallazgos.map(h => `
        <div class="entry">
          <div class="entry-title">${h.texto}</div>
          <div class="entry-body">${h.implicacion}</div>
        </div>`).join("")}
    </div>`;
}

function renderOportunidadesRiesgos(hallazgos) {
  const oportunidades = (hallazgos || []).filter(h => h.tipo === "oportunidad");
  const riesgos = (hallazgos || []).filter(h => h.tipo === "riesgo");
  if (oportunidades.length === 0 && riesgos.length === 0) return "";
  const col = (items, vacio) => items.length
    ? items.map(h => `<div class="entry"><div class="entry-title">${h.texto}</div><div class="entry-body">${h.implicacion}</div></div>`).join("")
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
          <td><b>${r.titulo}</b><br><span style="color:var(--ink-muted);font-size:12px;">${r.detalle}</span></td>
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
      {label:"MAT / R12", value:fmtMonto(k.mat_r12), delta:`${fmtPct(k.yoy_mat_pct)} vs. periodo anterior`, deltaClass:deltaClass(k.yoy_mat_pct)},
      {label:"Clientes activos", value:k.clientes_activos, delta:`${k.clientes_activos_anterior} en periodo anterior`},
      {label:"Churn de cartera", value:`${k.churn_pct}%`, delta:`${wf.n_perdidos} clientes perdidos`, deltaClass:"down"},
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
      {label:"MAT / R12", value:fmtMonto(snap.kpis.mat_r12), delta:`${fmtPct(snap.kpis.yoy_mat_pct)}`, deltaClass:deltaClass(snap.kpis.yoy_mat_pct)},
      {label:"Churn de cartera", value:`${snap.kpis.churn_pct}%`, delta:`${wf.n_perdidos} de ${wf.n_perdidos+wf.n_retenidos} clientes 2025`},
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

  const multi = snap.serie_multianual || {};
  const anios = Object.keys(multi).sort((a,b) => Number(a) - Number(b));

  const allVals = anios.flatMap(a => multi[a] || []);
  const min = allVals.length ? Math.min(...allVals) : 0;
  const max = allVals.length ? Math.max(...allVals) : 1;
  const rango = Math.max(max - min, 1);

  const colors = {};
  anios.forEach((a, i) => {
    if (i === anios.length - 1) colors[a] = "#1C3D5A";
    else if (i === anios.length - 2) colors[a] = "#4C6C87";
    else colors[a] = "#A9B0B5";
  });

  const n = Math.max(...anios.map(a => (multi[a] || []).length), 1);

  const lines = anios.map(a => {
    const serie = multi[a] || [];
    if (!serie.length) return "";

    const pts = serie.map((v,i) => {
      const px = n === 1 ? 380 : 30 + (i * (700 / (n - 1)));
      const py = 190 - ((v - min) / rango) * 155;
      return `${px.toFixed(1)},${py.toFixed(1)}`;
    }).join(" ");

    return `
      <polyline
        points="${pts}"
        fill="none"
        stroke="${colors[a]}"
        stroke-width="${a === anios[anios.length - 1] ? 2.8 : 1.6}"
        stroke-linejoin="round"
        stroke-linecap="round"
      />
    `;
  }).join("");

  const mom = snap.momentum_mensual || [];
  const momVals = mom.slice(1).map(m => Number(m.mom_pct) || 0);
  const momMax = Math.max(...momVals.map(v => Math.abs(v)), 1);

  const momentumRows = mom.map((m, idx) => {
    const pct = Number(m.mom_pct) || 0;
    const valor = Number(m.valor) || 0;
    const comparable = idx > 0;
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
      value:fmtMonto(snap.kpis.mat_r12),
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
      delta:qoq.trimestre_actual_completo
        ? "Trimestre completo"
        : "Último trimestre completo",
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

        ${anios.map(a => {
          const serie = multi[a] || [];
          if (!serie.length) return "";
          const i = serie.length - 1;
          const px = n === 1 ? 380 : 30 + (i * (700 / (n - 1)));
          const py = 190 - ((serie[i] - min) / rango) * 155;
          return `
            <circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="2.8" fill="${colors[a]}"/>
            <text x="${Math.min(px + 9, 752).toFixed(1)}" y="${(py + 3).toFixed(1)}" class="wf-value" fill="${colors[a]}">${fmtMonto(serie[i])}</text>
          `;
        }).join("")}

        ${Array.from({length:n}, (_,i) => {
          const x = n === 1 ? 380 : 30 + (i * (700 / (n - 1)));
          const mes = i + 1;
          return `<text x="${x.toFixed(1)}" y="208" class="wf-label" text-anchor="middle">${MESES[mes] ? MESES[mes].slice(0,3) : mes}</text>`;
        }).join("")}
      </svg>

      <div style="display:flex;gap:22px;flex-wrap:wrap;font-size:11.5px;color:var(--ink-muted);margin-top:4px;">
        ${anios.map(a => `
          <span>
            <span style="display:inline-block;width:8px;height:8px;margin-right:5px;background:${colors[a]};vertical-align:middle;"></span>
            ${a}
          </span>
        `).join("")}
      </div>

      <div class="panel-note">
        La comparación se realiza sobre meses equivalentes hasta la fecha
        operativa disponible. Los valores al cierre de cada trayectoria se muestran en Córdobas (C$).
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
    <details open style="margin-top:20px;">
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
      {label:"Clientes activos", value:snap.kpis.clientes_activos, delta:`${snap.kpis.clientes_activos_anterior} en periodo anterior`},
      {label:"Churn", value:`${snap.kpis.churn_pct}%`, delta:`${snap.waterfall.n_perdidos} perdidos`, deltaClass:"down"},
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
    <h1 class="thesis">${recos.length} compromisos generados por el motor de recomendaciones</h1>
    <p class="dek">Compromisos priorizados por impacto en la venta, con responsable y plazo.</p>
    ${kpiStrip([
      {label:"Acciones consolidadas", value:recos.length, delta:"de 4 capítulos"},
      {label:"Prioridad alta", value:alta, delta:"ligadas a los mayores impactos en C$"},
    ])}
    <table class="exec-table">
      <thead><tr><th>Acción</th><th>Origen</th><th>Responsable</th><th>Plazo</th><th>Prioridad</th></tr></thead>
      <tbody>
        ${recos.map(r => `<tr>
          <td><b>${r.titulo}</b><br><span style="color:var(--ink-muted);font-size:12px;">${r.detalle}</span></td>
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
  const snap = payload.snapshots[fechaActual];
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