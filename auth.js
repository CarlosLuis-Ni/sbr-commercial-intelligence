/*
 * SUINSA SBR — Autenticación
 * Login con Supabase Auth + validación del perfil activo en public.sbr_profiles.
 * No contiene la Secret key; la Publishable key está diseñada para uso en frontend.
 */

const SUPABASE_URL = "https://vagahrksyoniwutgqztl.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_R5n6jz_XjWlqMuFH_cA9mA_z6eunWy_";

const { createClient } = window.supabase;
const supabaseClient = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);

window.SBR_AUTH_READY = new Promise(resolve => {
  window.__resolveSbrAuth = resolve;
});

function mostrarLogin() {
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
          <div id="login-error" class="auth-error" role="alert"></div>
        </form>
      </div>
    </div>`;

  document.getElementById("login-form").addEventListener("submit", async event => {
    event.preventDefault();
    const button = event.currentTarget.querySelector("button");
    const error = document.getElementById("login-error");
    button.disabled = true;
    button.textContent = "Verificando…";
    error.textContent = "";

    const email = document.getElementById("login-email").value.trim();
    const password = document.getElementById("login-password").value;

    const { data, error: authError } = await supabaseClient.auth.signInWithPassword({ email, password });

    if (authError || !data.user) {
      error.textContent = "Correo o contraseña incorrectos. Verifica tus credenciales.";
      button.disabled = false;
      button.textContent = "Ingresar al SBR";
      return;
    }

    await validarPerfilYEntrar(data.user);
  });
}

async function validarPerfilYEntrar(user) {
  const { data: perfil, error } = await supabaseClient
    .from("sbr_profiles")
    .select("nombre, rol, proveedor, activo")
    .eq("id", user.id)
    .maybeSingle();

  if (error || !perfil || perfil.activo !== true) {
    await supabaseClient.auth.signOut();
    const errorBox = document.getElementById("login-error");
    if (errorBox) {
      errorBox.textContent = "Tu usuario no tiene un perfil SBR activo. Contacta al administrador.";
    }
    const button = document.querySelector("#login-form button");
    if (button) {
      button.disabled = false;
      button.textContent = "Ingresar al SBR";
    }
    return;
  }

  window.SBR_CURRENT_USER = { ...user, profile: perfil };
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
    position: "fixed",
    top: "18px",
    right: "18px",
    zIndex: "9999",
    border: "1px solid #C9CBC4",
    background: "#FAFAF8",
    color: "#6B7178",
    padding: "7px 11px",
    font: "500 11px Inter, sans-serif",
    cursor: "pointer"
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
    document.getElementById("app").innerHTML = `<div class="loading">No fue posible cargar la aplicación SBR.</div>`;
  };
  document.body.appendChild(script);
}

async function iniciarAutenticacion() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (session?.user) {
    await validarPerfilYEntrar(session.user);
  } else {
    mostrarLogin();
    window.__resolveSbrAuth(null);
  }
}

supabaseClient.auth.onAuthStateChange(async (event) => {
  if (event === "SIGNED_OUT") {
    window.location.reload();
  }
});

iniciarAutenticacion();
