/*
 * SUINSA SBR — Autenticación
 * Login con Supabase Auth + validación del perfil activo en public.sbr_profiles.
 */

const SUPABASE_URL = "https://vagahrksyoniwutgqztl.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_R5n6jz_XjWlqMuFH_cA9mA_z6eunWy_";

const { createClient } = window.supabase;
const supabaseClient = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

window.SBR_AUTH_READY = new Promise(resolve => {
  window.__resolveSbrAuth = resolve;
});

function mostrarLogin(mensaje = "") {
  document.body.classList.add("auth-required");
  document.getElementById("app").innerHTML = `
    <div class="auth-shell">
      <div class="auth-card">
        <div class="auth-brand">SUINSA Commercial Intelligence</div>
        <div class="auth-kicker">Supplier Business Review</div>
        <h1>Acceso al SBR</h1>
        <p class="auth-description">Ingresa con tu correo electrónico y contraseña para acceder al tablero comercial.</p>
        <form id="login-form" class="auth-form">
          <label>Correo electrónico</label>
          <input id="login-email" type="email" autocomplete="username" required placeholder="correo@empresa.com">
          <label>Contraseña</label>
          <input id="login-password" type="password" autocomplete="current-password" required placeholder="••••••••">
          <button type="submit">Ingresar al SBR</button>
          <div id="login-error" class="auth-error" role="alert">${mensaje}</div>
        </form>
      </div>
    </div>`;

  document.getElementById("login-form").addEventListener("submit", async event => {
    event.preventDefault();
    const button = event.currentTarget.querySelector("button");
    const errorBox = document.getElementById("login-error");
    button.disabled = true;
    button.textContent = "Verificando…";
    errorBox.textContent = "";

    const email = document.getElementById("login-email").value.trim();
    const password = document.getElementById("login-password").value;

    try {
      const { data, error: authError } = await supabaseClient.auth.signInWithPassword({ email, password });

      if (authError || !data.user) {
        errorBox.textContent = authError?.message || "No fue posible iniciar sesión.";
        button.disabled = false;
        button.textContent = "Ingresar al SBR";
        return;
      }

      await validarPerfilYEntrar(data.user);
    } catch (err) {
      errorBox.textContent = "Error de conexión con el servicio de autenticación. Intenta nuevamente.";
      button.disabled = false;
      button.textContent = "Ingresar al SBR";
      console.error("SBR login error", err);
    }
  });
}

function configurarRestriccionProveedor(perfil) {
  window.SBR_ALLOWED_PROVIDER = perfil.rol === "proveedor" ? perfil.proveedor : null;
  window.SBR_ALLOWED_PROVIDER_ID = null;

  // Primera capa de autorización: el manifiesto que consume app.js se filtra
  // según el perfil autenticado. Gerencia conserva acceso completo.
  if (window.__sbrFetchOriginal) return;
  window.__sbrFetchOriginal = window.fetch.bind(window);

  window.fetch = async function(input, init) {
    const requestUrl = new URL(input instanceof Request ? input.url : input, window.location.href);
    const pathname = requestUrl.pathname;

    if (pathname.endsWith("/data/proveedores.json") && window.SBR_ALLOWED_PROVIDER) {
      const response = await window.__sbrFetchOriginal(input, init);
      const manifest = await response.json();
      const permitido = manifest.proveedores.find(p =>
        String(p.nombre_display).trim().toUpperCase() === String(window.SBR_ALLOWED_PROVIDER).trim().toUpperCase()
      );
      const permitidos = permitido ? [permitido] : [];
      window.SBR_ALLOWED_PROVIDER_ID = permitido?.id || null;

      return new Response(JSON.stringify({ ...manifest, proveedores: permitidos }), {
        status: response.status,
        headers: { "Content-Type": "application/json" }
      });
    }

    // Para proveedores, el SBR solo expone la fotografía de la fecha operativa
    // más reciente. Los snapshots históricos siguen existiendo para SUINSA,
    // pero no llegan al navegador del usuario proveedor.
    const match = pathname.match(/\/data\/([^/]+)\.json$/);
    if (match && window.SBR_ALLOWED_PROVIDER_ID) {
      const idSolicitado = match[1];
      if (idSolicitado.toLowerCase() !== String(window.SBR_ALLOWED_PROVIDER_ID).toLowerCase()) {
        return new Response(JSON.stringify({ error: "Proveedor no autorizado" }), {
          status: 403,
          headers: { "Content-Type": "application/json" }
        });
      }

      const response = await window.__sbrFetchOriginal(input, init);
      if (!response.ok) return response;

      const payload = await response.json();
      const fechas = Object.keys(payload.snapshots || {}).sort();
      const ultimaFecha = fechas[fechas.length - 1];

      if (!ultimaFecha) {
        return new Response(JSON.stringify({ ...payload, snapshots: {} }), {
          status: response.status,
          headers: { "Content-Type": "application/json" }
        });
      }

      return new Response(JSON.stringify({
        ...payload,
        snapshots: { [ultimaFecha]: payload.snapshots[ultimaFecha] }
      }), {
        status: response.status,
        headers: { "Content-Type": "application/json" }
      });
    }

    return window.__sbrFetchOriginal(input, init);
  };
}

async function validarPerfilYEntrar(user) {
  const { data: perfil, error } = await supabaseClient
    .from("sbr_profiles")
    .select("nombre, rol, proveedor, activo")
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    console.error("SBR profile query error", error);
    const errorBox = document.getElementById("login-error");
    const button = document.querySelector("#login-form button");
    if (errorBox) errorBox.textContent = "El acceso fue autenticado, pero no se pudo validar tu perfil SBR. Verifica la configuración de acceso.";
    if (button) {
      button.disabled = false;
      button.textContent = "Ingresar al SBR";
    }
    return;
  }

  if (!perfil) {
    await supabaseClient.auth.signOut();
    mostrarLogin("Tu usuario no tiene un perfil SBR configurado.");
    return;
  }

  if (perfil.activo !== true) {
    await supabaseClient.auth.signOut();
    mostrarLogin("Tu usuario SBR está inactivo. Contacta al administrador.");
    return;
  }

  if (perfil.rol === "proveedor" && !perfil.proveedor) {
    await supabaseClient.auth.signOut();
    mostrarLogin("Tu perfil SBR no tiene un proveedor asignado. Contacta al administrador.");
    return;
  }

  window.SBR_CURRENT_USER = { ...user, profile: perfil };
  configurarRestriccionProveedor(perfil);
  document.body.classList.remove("auth-required");
  cargarAplicacion();
}

function agregarBotonCerrarSesion() {
  if (document.getElementById("sbr-logout")) return;
  const button = document.createElement("button");
  button.id = "sbr-logout";
  button.type = "button";
  button.textContent = "Cerrar sesión";
  Object.assign(button.style, {
    position: "fixed", top: "18px", right: "18px", zIndex: "9999",
    border: "1px solid #C9CBC4", background: "#FAFAF8", color: "#6B7178",
    padding: "7px 11px", font: "500 11px Inter, sans-serif", cursor: "pointer"
  });
  button.addEventListener("click", async () => {
    button.disabled = true;
    await supabaseClient.auth.signOut();
  });
  document.body.appendChild(button);
}

function cargarAplicacion() {
  if (window.__sbrAppLoaded) return;
  window.__sbrAppLoaded = true;
  const script = document.createElement("script");
  script.src = `app.js?v=${Date.now()}`;
  script.onload = () => {
    agregarBotonCerrarSesion();
    window.__resolveSbrAuth(window.SBR_CURRENT_USER);
  };
  script.onerror = () => {
    window.__sbrAppLoaded = false;
    document.getElementById("app").innerHTML = `<div class="loading">No fue posible cargar la aplicación SBR.</div>`;
  };
  document.body.appendChild(script);
}

async function iniciarAutenticacion() {
  try {
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (session?.user) {
      await validarPerfilYEntrar(session.user);
    } else {
      mostrarLogin();
      window.__resolveSbrAuth(null);
    }
  } catch (err) {
    console.error("SBR auth initialization error", err);
    mostrarLogin("No fue posible conectar con el servicio de acceso. Recarga la página e intenta nuevamente.");
    window.__resolveSbrAuth(null);
  }
}

supabaseClient.auth.onAuthStateChange(async (event) => {
  if (event === "SIGNED_OUT") {
    window.location.reload();
  }
});

iniciarAutenticacion();
