/*
 * SBR — Fix de trayectoria acumulada
 * Fuente de trayectoria: payload.serie_mensual (ventas mensuales reales).
 * No modifica datos ni KPIs; solo reemplaza la visualización del capítulo 03.
 *
 * Reglas:
 * - Visualización desde 2023.
 * - Cada año acumula desde su primer mes con venta real.
 * - Proveedores que iniciaron operaciones durante el año comienzan en ese mes.
 * - Se respeta la fecha operativa del snapshot.
 * - Las etiquetas finales usan una columna fija dentro del SVG para evitar recortes.
 */

(function () {
  const ANIO_INICIO = 2023;

  function construirTrayectorias(payload, snap) {
    const fecha = String(snap?.fecha_operativa || "");
    const anioOperativo = Number(fecha.slice(0, 4));
    const mesOperativo = Number(fecha.slice(5, 7));

    const mensual = Array.isArray(payload?.serie_mensual)
      ? payload.serie_mensual
      : [];

    const porAnio = {};

    mensual.forEach(row => {
      const mesTxt = String(row?.mes || "");
      const anio = Number(mesTxt.slice(0, 4));
      const mes = Number(mesTxt.slice(5, 7));
      const valor = Number(row?.valor);

      if (
        !Number.isFinite(anio) ||
        !Number.isFinite(mes) ||
        !Number.isFinite(valor) ||
        anio < ANIO_INICIO ||
        anio > anioOperativo ||
        mes < 1 ||
        mes > 12 ||
        (anio === anioOperativo && mes > mesOperativo)
      ) return;

      if (!porAnio[anio]) porAnio[anio] = [];
      porAnio[anio].push({ mes, valor });
    });

    const series = {};

    Object.keys(porAnio).forEach(anio => {
      const filas = porAnio[anio]
        .sort((a, b) => a.mes - b.mes);

      let acumulado = 0;

      series[anio] = filas.map(p => {
        acumulado += p.valor;
        return { mes: p.mes, valor: acumulado };
      });
    });

    return series;
  }

  function renderTendenciasCorregida(payload, snap) {
    const MESES = [
      "",
      "Enero","Febrero","Marzo","Abril","Mayo","Junio",
      "Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"
    ];

    const series = construirTrayectorias(payload, snap);

    const aniosVisibles = Object.keys(series)
      .map(Number)
      .filter(a => a >= ANIO_INICIO)
      .sort((a, b) => a - b)
      .filter(a => Array.isArray(series[a]) && series[a].length > 0);

    const todas = aniosVisibles.flatMap(a => series[a].map(p => p.valor));
    const max = todas.length ? Math.max(...todas) : 1;
    const rango = Math.max(max, 1);

    const colores = {};
    aniosVisibles.forEach((anio, i) => {
      if (i === aniosVisibles.length - 1) colores[anio] = "#1C3D5A";
      else if (i === aniosVisibles.length - 2) colores[anio] = "#4C6C87";
      else colores[anio] = "#A9B0B5";
    });

    const primerosMeses = aniosVisibles
      .map(a => series[a][0]?.mes)
      .filter(Number.isFinite);

    const primerMesGlobal =
      aniosVisibles.length === 1 && primerosMeses.length
        ? Math.min(...primerosMeses)
        : 1;

    const fechaOperativa = String(snap?.fecha_operativa || "");
    const mesOperativo = Number(fechaOperativa.slice(5, 7)) || 12;
    const ultimoMesGlobal = Math.max(
      primerMesGlobal,
      Math.min(12, mesOperativo)
    );

    const mesesEje = [];
    for (let mes = primerMesGlobal; mes <= ultimoMesGlobal; mes++) {
      mesesEje.push(mes);
    }

    const X_INICIO = 58;
    const X_FIN = 700;
    const Y_BOTTOM = 190;
    const Y_TOP = 35;
    const N = Math.max(mesesEje.length, 1);

    const xPos = mes => N === 1
      ? (X_INICIO + X_FIN) / 2
      : X_INICIO + ((mes - primerMesGlobal) * ((X_FIN - X_INICIO) / (N - 1)));

    const yPos = valor =>
      Y_BOTTOM - (Number(valor) / rango) * (Y_BOTTOM - Y_TOP);

    const lines = aniosVisibles.map(anio => {
      const serie = series[anio];

      const pts = serie.map(p =>
        `${xPos(p.mes).toFixed(1)},${yPos(p.valor).toFixed(1)}`
      ).join(" ");

      return `
        <polyline
          points="${pts}"
          fill="none"
          stroke="${colores[anio]}"
          stroke-width="${anio === aniosVisibles[aniosVisibles.length - 1] ? 2.8 : 1.6}"
          stroke-linejoin="round"
          stroke-linecap="round"
        />
      `;
    }).join("");

    const grid = [0.25, 0.5, 0.75, 1].map(ratio => {
      const y = Y_BOTTOM - ratio * (Y_BOTTOM - Y_TOP);
      return `
        <line
          x1="${X_INICIO}" y1="${y.toFixed(1)}"
          x2="${X_FIN}" y2="${y.toFixed(1)}"
          stroke="#E4E5E0" stroke-dasharray="3 5"
        />
        <text
          x="4" y="${(y + 3).toFixed(1)}"
          class="wf-label"
        >${fmtMonto(max * ratio)}</text>
      `;
    }).join("");

    const finales = aniosVisibles.map(anio => {
      const serie = series[anio];
      const ultimo = serie[serie.length - 1];

      return {
        anio,
        valorFinal: ultimo.valor,
        px: xPos(ultimo.mes),
        py: yPos(ultimo.valor)
      };
    });

    const LABEL_X = 718;
    const LABEL_MIN_Y = 38;
    const LABEL_MAX_Y = 178;
    const LABEL_GAP = 19;

    const ordenadas = [...finales].sort((a, b) => a.py - b.py);

    let ultimoY = LABEL_MIN_Y - LABEL_GAP;
    ordenadas.forEach(item => {
      item.labelY = Math.max(item.py, ultimoY + LABEL_GAP);
      ultimoY = item.labelY;
    });

    if (ordenadas.length) {
      const exceso = ordenadas[ordenadas.length - 1].labelY - LABEL_MAX_Y;
      if (exceso > 0) {
        ordenadas.forEach(item => {
          item.labelY -= exceso;
        });
      }
    }

    const etiquetasFinales = finales.map(item => `
      <line
        x1="${item.px.toFixed(1)}"
        y1="${item.py.toFixed(1)}"
        x2="${LABEL_X - 8}"
        y2="${item.labelY.toFixed(1)}"
        stroke="#C9CBC4"
        stroke-width="1"
      />
      <circle
        cx="${item.px.toFixed(1)}"
        cy="${item.py.toFixed(1)}"
        r="2.8"
        fill="${colores[item.anio]}"
      />
      <text
        x="${LABEL_X}"
        y="${(item.labelY + 3).toFixed(1)}"
        class="wf-value"
        fill="${colores[item.anio]}"
        text-anchor="start"
      >${item.anio} · ${fmtMonto(item.valorFinal)}</text>
    `).join("");

    const mom = snap.momentum_mensual || [];
    const momVals = mom.slice(1)
      .map(m => Number(m.mom_pct))
      .filter(Number.isFinite);

    const momMax = Math.max(
      ...momVals.map(v => Math.abs(v)),
      1
    );

    const momentumRows = mom.map((m, idx) => {
      const pct = Number(m.mom_pct);
      const valor = Number(m.valor) || 0;
      const comparable = idx > 0 && Number.isFinite(pct);
      const width = comparable
        ? Math.min(Math.abs(pct) / momMax * 100, 100)
        : 0;

      const pctTexto = comparable ? fmtPct(pct) : "—";
      const color = comparable
        ? (pct >= 0 ? "var(--positive)" : "var(--negative)")
        : "var(--ink-faint)";

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
        delta:fmtR12Delta(payload, snap),
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

    const nota = aniosVisibles.length
      ? `La comparación se realiza sobre meses equivalentes hasta la fecha operativa disponible. La trayectoria se reconstruye desde las ventas mensuales reales del proveedor. Cada año comienza en su primer mes con venta; por ello, proveedores que iniciaron operaciones durante el año comienzan su línea en ese mes. La visualización inicia en 2023. Los valores al cierre se muestran en Córdobas (C$).`
      : "No hay datos históricos suficientes para construir la trayectoria.";

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
          viewBox="0 0 860 240"
          width="100%"
          height="240"
          aria-label="Evolución acumulada de ventas por año"
        >
          ${grid}

          <line
            x1="${X_INICIO}" y1="${Y_BOTTOM}"
            x2="${X_FIN}" y2="${Y_BOTTOM}"
            stroke="#E4E5E0"
          />

          ${lines}

          ${etiquetasFinales}

          ${mesesEje.map(mes => `
            <text
              x="${xPos(mes).toFixed(1)}"
              y="208"
              class="wf-label"
              text-anchor="middle"
            >${MESES[mes].slice(0,3)}</text>
          `).join("")}
        </svg>

        <div style="display:flex;gap:22px;flex-wrap:wrap;font-size:11.5px;color:var(--ink-muted);margin-top:4px;">
          ${aniosVisibles.map(anio => `
            <span>
              <span style="display:inline-block;width:8px;height:8px;margin-right:5px;background:${colores[anio]};vertical-align:middle;"></span>
              ${anio}
            </span>
          `).join("")}
        </div>

        <div class="panel-note">
          ${nota}
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

  function instalar() {
    if (typeof RENDERERS === "undefined" || typeof render === "undefined") {
      console.warn("SBR trayectoria fix: app.js todavía no está disponible.");
      return false;
    }

    RENDERERS.tendencias = renderTendenciasCorregida;
    window.SBR_TRAYECTORIA_FIX = "2026-09-02-serie-mensual-2023-plus";
    render();
    return true;
  }

  if (!instalar()) {
    window.addEventListener("load", instalar, { once:true });
  }
})();
