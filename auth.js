/*
 * SUINSA SBR — Autenticación
 * Login con Supabase Auth + validación del perfil activo en public.sbr_profiles.
 *
 * Blindaje de datos:
 * - app.js no consume directamente data/*.json.
 * - Las lecturas pasan por la Edge Function sbr-data con JWT obligatorio.
 * - El servidor determina el proveedor según sbr_profiles.
 * - Un usuario proveedor recibe únicamente su proveedor y su snapshot más reciente.
 * - Gerencia conserva acceso al manifiesto y snapshots completos.
 */

const SUPABASE_URL = "https://vagahrksyoniwutgqztl.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_R5n6jz_XjWlqMuFH_cA9mA_z6eunWy_";

const { createClient } = window.supabase;
const supabaseClient = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

window.SBR_AUTH_READY = new Promise(resolve => {
  window.__resolveSbrAuth = resolve;
});

function crearTimeout(ms, mensaje) {
  return new Promise((_, reject) => setTimeout(() => reject(new Error(mensaje)), ms));
}

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
      const loginPromise = supabaseClient.auth.signInWithPassword({ email, password });
      const loginResult = await Promise.race([
        loginPromise,
        crearTimeout(15000, "TIMEOUT_AUTH")
      ]);

      const { data, error: authError } = loginResult;
      if (authError || !data.user) {
        errorBox.textContent = authError?.message || "No fue posible iniciar sesión.";
        button.disabled = false;
        button.textContent = "Ingresar al SBR";
        return;
      }

      button.textContent = "Validando perfil…";
      await Promise.race([
        validarPerfilYEntrar(data.user),
        crearTimeout(15000, "TIMEOUT_PROFILE")
      ]);
    } catch (err) {
      if (err?.message === "TIMEOUT_AUTH") {
        errorBox.textContent = "Supabase Auth no respondió en 15 segundos. El problema está en la conexión/autenticación.";
      } else if (err?.message === "TIMEOUT_PROFILE") {
        errorBox.textContent = "La autenticación respondió, pero el perfil SBR no terminó de validarse en 15 segundos. El siguiente paso es revisar sbr_profiles/RLS.";
      } else {
        errorBox.textContent = "Error de conexión con el servicio de autenticación. Intenta nuevamente.";
      }
      button.disabled = false;
      button.textContent = "Ingresar al SBR";
      console.error("SBR login error", err);
    }
  });
}

async function sbrDataInvoke(action, providerId = null) {
  const body = { action };
  if (providerId) body.provider_id = providerId;

  const { data: { session } } = await supabaseClient.auth.getSession();
  const accessToken = session?.access_token;
  if (!accessToken) throw new Error("SBR_NO_ACCESS_TOKEN");

  const { data, error } = await supabaseClient.functions.invoke("sbr-data", {
    body,
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (error) throw error;
  if (!data || data.error) throw new Error(data?.error || "SBR_DATA_ERROR");
  return data;
}

function configurarRestriccionProveedor(perfil) {
  window.SBR_ALLOWED_PROVIDER = perfil.rol === "proveedor" ? perfil.proveedor : null;
  window.SBR_ALLOWED_PROVIDER_ID = null;

  if (window.__sbrFetchOriginal) return;
  window.__sbrFetchOriginal = window.fetch.bind(window);

  window.fetch = async function(input, init) {
    const requestUrl = new URL(input instanceof Request ? input.url : input, window.location.href);
    const pathname = requestUrl.pathname;

    if (pathname.endsWith("/data/proveedores.json")) {
      try {
        const manifest = await sbrDataInvoke("manifest");
        const permitido = manifest.proveedores?.[0];
        window.SBR_ALLOWED_PROVIDER_ID = permitido?.id || null;
        return new Response(JSON.stringify(manifest), {
          status: 200,
          headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
        });
      } catch (error) {
        console.error("SBR manifest error", error);
        return new Response(JSON.stringify({ error: "No fue posible cargar el manifiesto SBR" }), {
          status: 502,
          headers: { "Content-Type": "application/json" }
        });
      }
    }

    const match = pathname.match(/\/data\/([^/]+)\.json$/);
    if (match) {
      const idSolicitado = match[1];
      try {
        const payload = await sbrDataInvoke("provider", idSolicitado);
        return new Response(JSON.stringify(payload), {
          status: 200,
          headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
        });
      } catch (error) {
        console.error("SBR provider data error", error);
        return new Response(JSON.stringify({ error: "Proveedor no autorizado o datos no disponibles" }), {
          status: 403,
          headers: { "Content-Type": "application/json" }
        });
      }
    }

    return window.__sbrFetchOriginal(input, init);
  };
}

async function validarPerfilYEntrar(user) {
  const profilePromise = supabaseClient.rpc("get_my_sbr_profile");
  const { data: perfiles, error } = await Promise.race([
    profilePromise,
    crearTimeout(15000, "TIMEOUT_PROFILE_RPC")
  ]);
  const perfil = Array.isArray(perfiles) ? (perfiles[0] || null) : perfiles;

  if (error) {
    console.error("SBR profile RPC error", error);
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
    // Importante: getSession() no debe poder dejar la pantalla inicial bloqueada indefinidamente.
    const sessionResult = await Promise.race([
      supabaseClient.auth.getSession(),
      crearTimeout(10000, "TIMEOUT_SESSION")
    ]);
    const { data: { session } } = sessionResult;

    if (session?.user) {
      await validarPerfilYEntrar(session.user);
    } else {
      mostrarLogin();
      window.__resolveSbrAuth(null);
    }
  } catch (err) {
    console.error("SBR auth initialization error", err);
    mostrarLogin(
      err?.message === "TIMEOUT_SESSION"
        ? "La sesión de Supabase no respondió en 10 segundos. Puedes intentar iniciar sesión nuevamente."
        : "No fue posible conectar con el servicio de acceso. Recarga la página e intenta nuevamente."
    );
    window.__resolveSbrAuth(null);
  }
}

supabaseClient.auth.onAuthStateChange(async (event) => {
  if (event === "SIGNED_OUT") {
    window.location.reload();
  }
});

iniciarAutenticacion();
