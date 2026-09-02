/* SBR — Trayectoria acumulada responsive
 * Corrección estructural del Cap. 03.
 * Fuente: serie_mensual real del proveedor.
 * Visualización: 2023 en adelante. 2022 permanece solo en histórico.
 * Desktop y móvil usan SVG independientes para evitar escalado ilegible.
 */
(function () {
  const ANIO_INICIO = 2023;
  const MESES = ["","Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];

  function construirSeries(payload, snap) {
    const fecha = String(snap?.fecha_operativa || "");
    const anioOp = Number(fecha.slice(0,4));
    const mesOp = Number(fecha.slice(5,7));
    const mensual = Array.isArray(payload?.serie_mensual) ? payload.serie_mensual : [];
    const porAnio = {};

    mensual.forEach(r => {
      const txt = String(r?.mes || "");
      const anio = Number(txt.slice(0,4));
      const mes = Number(txt.slice(5,7));
      const valor = Number(r?.valor);
      if (!Number.isFinite(anio) || !Number.isFinite(mes) || !Number.isFinite(valor)) return;
      if (anio < ANIO_INICIO || anio > anioOp || mes < 1 || mes > 12) return;
      if (anio === anioOp && mes > mesOp) return;
      if (!porAnio[anio]) porAnio[anio] = [];
      porAnio[anio].push({mes, valor});
    });

    const series = {};
    Object.keys(porAnio).forEach(a => {
      const filas = porAnio[a].sort((x,y) => x.mes-y.mes);
      let acumulado = 0;
      const puntos = [];
      filas.forEach(p => {
        acumulado += p.valor;
        puntos.push({mes:p.mes, valor:acumulado});
      });
      const primero = puntos.findIndex(p => p.valor > 0);
      if (primero >= 0) series[a] = puntos.slice(primero);
    });
    return series;
  }

  function colores(anios) {
    const out = {};
    anios.forEach((a,i) => {
      if (i === anios.length-1) out[a] = "#1C3D5A";
      else if (i === anios.length-2) out[a] = "#4C6C87";
      else out[a] = "#A9B0B5";
    });
    return out;
  }

  function distribuirEtiquetas(items, minY, maxY, gap) {
    const orden = [...items].sort((a,b) => a.py-b.py);
    if (!orden.length) return items;
    let prev = minY-gap;
    orden.forEach(x => {
      x.labelY = Math.max(x.py, prev+gap);
      prev = x.labelY;
    });
    const exceso = orden[orden.length-1].labelY-maxY;
    if (exceso > 0) orden.forEach(x => { x.labelY -= exceso; });
    const deficit = minY-orden[0].labelY;
    if (deficit > 0) orden.forEach(x => { x.labelY += deficit; });
    return items;
  }

  function generarSvg(series, anios, max, primerMes, ultimoMes, mobile) {
    const W = mobile ? 360 : 820;
    const H = mobile ? 255 : 245;
    const X0 = mobile ? 32 : 58;
    const X1 = mobile ? 235 : 690;
    const Y0 = mobile ? 205 : 190;
    const Y1 = mobile ? 35 : 35;
    const labelX = mobile ? 247 : 708;
    const n = Math.max(ultimoMes-primerMes+1,1);
    const rango = Math.max(max,1);
    const x = mes => n === 1 ? (X0+X1)/2 : X0 + ((mes-primerMes)/(n-1))*(X1-X0);
    const y = valor => Y0 - (Number(valor)/rango)*(Y0-Y1);

    const grid = [0.25,0.5,0.75,1].map(r => {
      const yy = Y0-r*(Y0-Y1);
      return '<line x1="'+X0+'" y1="'+yy.toFixed(1)+'" x2="'+X1+'" y2="'+yy.toFixed(1)+'" stroke="#E4E5E0" stroke-dasharray="3 5"/>' +
             '<text x="'+(mobile?2:4)+'" y="'+(yy+3).toFixed(1)+'" class="trajectory-grid-label">C$'+(max*r/1000000).toFixed(2)+'M</text>';
    }).join("");

    const lines = anios.map(anio => {
      const pts = series[anio].map(p => x(p.mes).toFixed(1)+","+y(p.valor).toFixed(1)).join(" ");
      const sw = anio === anios[anios.length-1] ? 2.8 : 1.7;
      return '<polyline points="'+pts+'" fill="none" stroke="'+colores(anios)[anio]+'" stroke-width="'+sw+'" stroke-linejoin="round" stroke-linecap="round"/>';
    }).join("");

    const finales = anios.map(anio => {
      const s = series[anio];
      const last = s[s.length-1];
      return {anio, valor:last.valor, px:x(last.mes), py:y(last.valor)};
    });
    distribuirEtiquetas(finales, mobile?34:38, mobile?216:178, mobile?19:18);

    const labels = finales.map(f => {
      const c = colores(anios)[f.anio];
      const lineEnd = labelX-7;
      return '<line x1="'+f.px.toFixed(1)+'" y1="'+f.py.toFixed(1)+'" x2="'+lineEnd+'" y2="'+f.labelY.toFixed(1)+'" stroke="#C9CBC4" stroke-width="1"/>' +
             '<circle cx="'+f.px.toFixed(1)+'" cy="'+f.py.toFixed(1)+'" r="'+(mobile?3:2.8)+'" fill="'+c+'"/>' +
             '<text x="'+labelX+'" y="'+(f.labelY+4).toFixed(1)+'" class="trajectory-value" fill="'+c+'">'+f.anio+' · C$'+(f.valor/1000000).toFixed(2)+'M</text>';
    }).join("");

    const meses = [];
    for (let m=primerMes;m<=ultimoMes;m++) meses.push(
      '<text x="'+x(m).toFixed(1)+'" y="'+(Y0+20)+'" class="trajectory-axis" text-anchor="middle">'+MESES[m]+'</text>'
    );

    return '<svg class="'+(mobile?'trajectory-mobile':'trajectory-desktop')+'" viewBox="0 0 '+W+' '+H+'" width="100%" height="'+H+'" role="img" aria-label="Trayectoria acumulada por año">' +
      grid +
      '<line x1="'+X0+'" y1="'+Y0+'" x2="'+X1+'" y2="'+Y0+'" stroke="#E4E5E0"/>' +
      lines + labels + meses.join("") +
      '</svg>';
  }

  function renderTendenciasCorregida(payload, snap) {
    const series = construirSeries(payload, snap);
    const anios = Object.keys(series).map(Number).filter(Number.isFinite).sort((a,b)=>a-b);
    const fecha = String(snap?.fecha_operativa || "");
    const mesOp = Number(fecha.slice(5,7)) || 12;

    if (!anios.length) {
      return '<div class="kicker">Capítulo 03 — Tendencias</div><h1 class="thesis">Evolución acumulada y señales de aceleración comercial</h1><div class="section"><h2 class="section-title">Trayectoria acumulada por año</h2><div class="panel-note">No hay datos históricos suficientes para construir la trayectoria.</div></div>';
    }

    const max = Math.max(...anios.flatMap(a => series[a].map(p=>p.valor)),1);
    const primeros = anios.map(a=>series[a][0]?.mes).filter(Number.isFinite);
    const primerMes = anios.length === 1 ? Math.min(...primeros) : 1;
    const ultimoMes = Math.max(primerMes, Math.min(12,mesOp));

    const qoq = snap.qoq;
    const kpis = [
      {label:"MAT / R12",value:fmtR12Value(payload,snap),delta:fmtR12Delta(payload,snap),deltaClass:deltaClass(snap.kpis.yoy_mat_pct)},
      {label:"Venta YTD",value:fmtMonto(snap.kpis.venta_ytd),delta:fmtPct(snap.kpis.yoy_ytd_pct),deltaClass:deltaClass(snap.kpis.yoy_ytd_pct)}
    ];
    if (qoq) kpis.push({label:'QoQ ('+qoq.trimestre_actual+' vs. '+qoq.trimestre_anterior+')',value:fmtPct(qoq.qoq_pct),delta:qoq.trimestre_actual_completo?'Trimestre completo':'Último trimestre completo',deltaClass:deltaClass(qoq.qoq_pct)});

    const mom = snap.momentum_mensual || [];
    const momVals = mom.slice(1).map(m=>Number(m.mom_pct)).filter(Number.isFinite);
    const momMax = Math.max(...momVals.map(v=>Math.abs(v)),1);
    const momentumRows = mom.map((m,i)=>{
      const pct=Number(m.mom_pct), valor=Number(m.valor)||0, comparable=i>0&&Number.isFinite(pct);
      const width=comparable?Math.min(Math.abs(pct)/momMax*100,100):0;
      const pctTexto=comparable?fmtPct(pct):"—";
      const color=comparable?(pct>=0?"var(--positive)":"var(--negative)"):"var(--ink-faint)";
      return '<div style="display:grid;grid-template-columns:90px 1fr 70px 80px;gap:18px;align-items:center;min-height:38px;border-bottom:1px solid var(--line);">' +
        '<div style="font-size:13px;">'+(["","Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"][m.mes]||("Mes "+m.mes))+'</div>' +
        '<div style="height:6px;background:var(--line);overflow:hidden;"><div style="height:100%;width:'+width+'%;min-width:'+(comparable?"2px":"0")+';background:'+color+';"></div></div>' +
        '<div style="font-size:13px;font-weight:600;text-align:right;white-space:nowrap;color:'+color+';">'+pctTexto+'</div>' +
        '<div style="font-size:11.5px;color:var(--ink-muted);text-align:right;white-space:nowrap;">'+fmtMontoK(valor)+'</div></div>';
    }).join("");

    return '<div class="kicker">Capítulo 03 — Tendencias</div>' +
      '<h1 class="thesis">Evolución acumulada y señales de aceleración comercial</h1>' +
      '<p class="dek">Lectura de la trayectoria de ventas, comparación interanual y momentum mensual hasta la fecha operativa del período.</p>' +
      kpiStrip(kpis) +
      renderExecSummary(snap.hallazgos["03"]) +
      '<div class="section">' +
        '<div class="section-kicker">¿Cómo evoluciona la venta acumulada?</div>' +
        '<h2 class="section-title">Trayectoria acumulada por año</h2>' +
        '<div class="trajectory-chart-wrap">' +
          generarSvg(series,anios,max,primerMes,ultimoMes,false) +
          generarSvg(series,anios,max,primerMes,ultimoMes,true) +
        '</div>' +
        '<div class="trajectory-legend">'+anios.map(a=>'<span><span style="display:inline-block;width:8px;height:8px;margin-right:5px;background:'+colores(anios)[a]+';vertical-align:middle;"></span>'+a+'</span>').join("")+'</div>' +
        '<div class="panel-note">La comparación se realiza sobre meses equivalentes hasta la fecha operativa disponible. La trayectoria se reconstruye desde las ventas mensuales reales del proveedor. Cada año comienza en su primer mes con venta; por ello, proveedores que iniciaron operaciones durante el año comienzan su línea en ese mes. La visualización inicia en 2023. Los valores al cierre se muestran en Córdobas (C$).</div>' +
      '</div>' +
      '<div class="section">' +
        '<div class="section-kicker">¿Está acelerando o desacelerando?</div><h2 class="section-title">Momentum mensual</h2>' +
        '<div style="display:grid;grid-template-columns:90px 1fr 70px 80px;gap:18px;width:100%;max-width:760px;padding:0 0 9px;border-bottom:1px solid var(--line-strong);font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-faint);font-weight:600;"><span>Mes</span><span>Variación MoM</span><span style="text-align:right;">%</span><span style="text-align:right;">Venta</span></div>' +
        '<div style="width:100%;max-width:760px;">'+momentumRows+'</div>' +
        '<div class="panel-note">MoM compara cada mes contra el mes inmediatamente anterior. La primera observación no representa una variación comparable y se muestra como “—”.</div>' +
      '</div>' +
      renderOportunidadesRiesgos(snap.hallazgos["03"]) +
      renderRecomendacionesCapitulo(snap.recomendaciones,"03");
  }

  function instalarEstilos() {
    if (document.getElementById("sbr-trayectoria-responsive-css")) return;
    const style=document.createElement("style");
    style.id="sbr-trayectoria-responsive-css";
    style.textContent=
      ".trajectory-chart-wrap{width:100%;max-width:100%;overflow:hidden;margin-top:4px;}" +
      ".trajectory-desktop,.trajectory-mobile{display:block;width:100%;height:auto;max-width:100%;}" +
      ".trajectory-mobile{display:none;}" +
      ".trajectory-value{font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:11.5px;font-weight:600;}" +
      ".trajectory-grid-label,.trajectory-axis{font-family:Inter,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:10px;fill:#6B7178;}" +
      ".trajectory-legend{display:flex;gap:22px;flex-wrap:wrap;font-size:11.5px;color:var(--ink-muted);margin-top:8px;}" +
      "@media (max-width:760px){.trajectory-desktop{display:none!important}.trajectory-mobile{display:block!important}.trajectory-value{font-size:11.5px}.trajectory-grid-label{font-size:9px}.trajectory-axis{font-size:10px}.trajectory-legend{gap:10px 16px;margin-top:7px}}" +
      "@media (max-width:430px){.trajectory-value{font-size:10.5px}.trajectory-chart-wrap{margin-left:0;margin-right:0}}"
    document.head.appendChild(style);
  }

  function instalar() {
    if (typeof RENDERERS==="undefined") return false;
    instalarEstilos();
    RENDERERS.tendencias=renderTendenciasCorregida;
    window.SBR_TRAYECTORIA_FIX="2026-09-02-responsive-v2";
    return true;
  }

  function esperar() {
    if (!instalar()) { setTimeout(esperar,100); return; }
    if (typeof PROVEEDORES==="undefined" || !PROVEEDORES.length || !proveedorActual || !DATA?.[proveedorActual] || !fechaActual) {
      setTimeout(esperar,100); return;
    }
    render();
  }
  esperar();
})();
