const PRODUCTOS = [
  ["regular", "Regular", "gal"],
  ["premium", "Premium", "gal"],
  ["diesel", "Diésel", "gal"],
  ["glp", "GLP", "gal"],
  ["gnv", "GNV", "m³"],
];
const PERFIL_BASE = {
  regular: { rend: 35, carga: 10 }, premium: { rend: 35, carga: 10 }, diesel: { rend: 40, carga: 12 },
  glp: { rend: 28, carga: 10 }, gnv: { rend: 13, carga: 15 },
};
const COLORES = {
  Repsol: "#e8641b", Primax: "#d4202c", Pecsa: "#2e8b3a", "Petroperú": "#1f5fa8", Terpel: "#c8102e",
  Gazel: "#0a8f8f", Energigas: "#6b4fbb", "PetroAmérica": "#b8860b", Mobil: "#0b4ea2", Shell: "#d6a400",
};
const LIMA = [-12.0464, -77.0428];
const DIAS_VIEJO = 15;
const FACTOR_VIA = 1.3;

const store = {
  get(k, d) { try { const v = localStorage.getItem("grifos." + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem("grifos." + k, JSON.stringify(v)); } catch { /* sin almacenamiento */ } },
};

const state = {
  prod: store.get("prod", "regular"),
  radio: store.get("radio", 3),
  edadMax: store.get("edadMax", 15),
  orden: store.get("orden", "conviene"),
  marcas: new Set(store.get("marcas", [])),
  lista: store.get("lista", ""),
  favs: new Set(store.get("favs", [])),
  soloFavs: store.get("soloFavs", false),
  perfil: { ...PERFIL_BASE, ...store.get("perfil", {}) },
  cargas: store.get("cargas", []),
  origen: store.get("origen", LIMA),
  sel: null,
  q: "",
  cargaGrifo: null,
  ruta: null,
  elegirDestino: false,
};
const RUTA_MAX_DESVIO = 4;

const $ = (id) => document.getElementById(id);
const unidadDe = (k) => PRODUCTOS.find((p) => p[0] === k)[2];
const nombreDe = (k) => PRODUCTOS.find((p) => p[0] === k)[1];
const soles = (n) => (n < -0.005 ? `−S/ ${(-n).toFixed(2)}` : `S/ ${Math.abs(n).toFixed(2)}`);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const titulo = (g) => (g.nombre && g.nombre.toLowerCase() !== g.marca.toLowerCase() ? g.nombre : g.razon) || g.nombre || g.marca;
const color = (g) => COLORES[g.marca] || "#9aa3b2";

const mapa = L.map("mapa", { zoomControl: true }).setView(state.origen, 14);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19, attribution: "© OpenStreetMap",
}).addTo(mapa);
const capa = L.layerGroup().addTo(mapa);
const Botonera = L.Control.extend({
  options: { position: "topright" },
  onAdd() {
    const d = L.DomUtil.create("div", "botonera");
    d.innerHTML = `<button type="button" id="gps" title="Mi ubicación" aria-label="Mi ubicación">📍</button>
      <button type="button" id="fab-manejo" title="Modo manejo: el mejor grifo en grande, con voz" aria-label="Modo manejo">🚗</button>`;
    L.DomEvent.disableClickPropagation(d);
    return d;
  },
});
new Botonera().addTo(mapa);
const vibrar = () => navigator.userActivation?.isActive && navigator.vibrate?.(12);
const normal = (t) => String(t ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const origenMk = L.marker(state.origen, { icon: L.divIcon({ className: "", html: '<div class="origen"></div>', iconSize: [16, 16], iconAnchor: [8, 8] }), zIndexOffset: 2000 }).addTo(mapa);
const circulo = L.circle(state.origen, { radius: 0, color: "#0f62fe", weight: 1, fillOpacity: 0.04 }).addTo(mapa);
const precision = L.circle(state.origen, { radius: 0, stroke: false, fillColor: "#0f62fe", fillOpacity: 0.16, interactive: false }).addTo(mapa);

let grifos = [];
let meta = {};
let visibles = [];
let marcadores = new Map();

function distKm(a, b) {
  const R = 6371, r = Math.PI / 180;
  const dLat = (b[0] - a[0]) * r, dLon = (b[1] - a[1]) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function diasDesde(f) {
  const hoyLima = new Date(Date.now() - 5 * 3600e3).toISOString().slice(0, 10);
  return Math.round((Date.parse(hoyLima) - Date.parse(f.slice(0, 10))) / 86400000);
}

function edad(f) {
  const d = diasDesde(f);
  const txt = d <= 0 ? "hoy" : d === 1 ? "ayer" : `hace ${d} d`;
  return d > DIAS_VIEJO ? `<span class="viejo" title="Precio reportado hace más de ${DIAS_VIEJO} días">⚠ ${txt}</span>` : txt;
}

const fechaCorta = (iso) => new Date(iso + "T12:00:00").toLocaleDateString("es-PE", { day: "numeric", month: "short" });

function cambio(pr) {
  if (pr.prev == null) return "";
  const d = pr.p - pr.prev;
  if (Math.abs(d) < 0.005) return "";
  const cls = d > 0 ? "sube" : "baja";
  return `<span class="${cls}" title="Antes ${soles(pr.prev)}">${d > 0 ? "▲" : "▼"} ${soles(Math.abs(d))} desde ${fechaCorta(pr.desde)}</span>`;
}

const insignias = (g) => (g.listas || []).map((l) => `<span class="lista" title="Aparece en ${esc(l)}">★ ${esc(l)}</span>`).join("");

function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("on");
  clearTimeout(toast.h);
  toast.h = setTimeout(() => t.classList.remove("on"), 2600);
}

function setOrigen(latlng, centrar, margen = 0) {
  state.origen = [latlng[0], latlng[1]];
  store.set("origen", state.origen);
  origenMk.setLatLng(state.origen);
  precision.setLatLng(state.origen).setRadius(margen);
  if (centrar && !state.ruta) mapa.setView(state.origen, state.radio && state.radio <= 2 ? 15 : 14);
  if (state.ruta) return trazarRuta(state.ruta.dest, state.ruta.nombre);
  render();
}

function renderProductos() {
  $("productos").innerHTML = PRODUCTOS.map(([k, n]) =>
    `<button type="button" role="radio" aria-checked="${k === state.prod}" data-k="${k}">${n}</button>`).join("");
}

const enRadio = (g) => (state.ruta ? g.desvio != null && g.desvio <= RUTA_MAX_DESVIO : state.q || state.radio === 0 || g.dist <= state.radio);
const coincide = (g) => !state.q || normal(state.q).split(/\s+/).every((t) => g._txt.includes(t));
const enLista = (g) => !state.lista || (g.listas || []).includes(state.lista);

function renderMarcas(base) {
  const cuenta = new Map();
  for (const g of base) cuenta.set(g.marca, (cuenta.get(g.marca) || 0) + 1);
  const orden = [...cuenta.entries()].sort((a, b) => (a[0] === "Otra") - (b[0] === "Otra") || b[1] - a[1]);
  for (const m of state.marcas) if (!cuenta.has(m)) orden.push([m, 0]);
  const nFav = base.filter((g) => state.favs.has(g.id)).length;
  $("marcas").innerHTML =
    `<button type="button" class="chip fav" data-favs aria-pressed="${state.soloFavs}">♥ Favoritos <small>${nFav}</small></button>` +
    `<button type="button" class="chip" data-m="" aria-pressed="${state.marcas.size === 0}">Todas</button>` +
    orden.map(([m, n]) => `<button type="button" class="chip" data-m="${esc(m)}" aria-pressed="${state.marcas.has(m)}" style="--c:${COLORES[m] || "#9aa3b2"}"><span class="dot"></span>${esc(m)} <small>${n}</small></button>`).join("");
}

// Costo total de cargar en g: lo que pagas más el combustible del desvío (km extra por pista).
function costoCarga(g) {
  const { rend, carga } = state.perfil[state.prod];
  const p = g.precios[state.prod].p;
  return p * carga + (g.desvio / rend) * p;
}

function render() {
  const unidad = unidadDe(state.prod);
  for (const g of grifos) {
    g.dist = distKm(state.origen, [g.lat, g.lon]);
    g.desvio = 2 * FACTOR_VIA * g.dist;
  }
  if (state.ruta) calcularDesvios();
  const base = grifos.filter((g) => g.precios[state.prod] && enRadio(g) && enLista(g) && coincide(g) &&
    (state.edadMax === 0 || diasDesde(g.precios[state.prod].f) <= state.edadMax));
  renderMarcas(base);
  visibles = base.filter((g) => (state.marcas.size === 0 || state.marcas.has(g.marca)) && (!state.soloFavs || state.favs.has(g.id)));

  const ref = visibles.reduce((a, g) => (!a || g.desvio < a.desvio ? g : a), null);
  for (const g of visibles) g.ahorro = ref ? costoCarga(ref) - costoCarga(g) : 0;
  const pr = (g) => g.precios[state.prod].p;
  visibles.sort(
    state.orden === "precio" ? (a, b) => pr(a) - pr(b) || a.dist - b.dist
      : state.orden === "distancia" ? (a, b) => a.desvio - b.desvio
        : (a, b) => b.ahorro - a.ahorro || a.dist - b.dist);

  const precios = visibles.map(pr);
  const min = Math.min(...precios), max = Math.max(...precios);
  const prom = precios.reduce((s, p) => s + p, 0) / (precios.length || 1);

  circulo.setLatLng(state.origen).setRadius(state.ruta || state.q ? 0 : state.radio * 1000);
  capa.clearLayers();
  marcadores = new Map();
  for (const g of visibles) {
    const p = pr(g);
    const t = max > min ? (p - min) / (max - min) : 0;
    const h = Math.round(130 - 130 * t);
    const cls = ["pin", g.aprox ? "aprox" : "", state.favs.has(g.id) ? "esfav" : "", g.id === state.sel ? "sel" : ""].join(" ");
    const estrella = !state.lista && g.listas ? "★ " : "";
    const mk = L.marker([g.lat, g.lon], {
      icon: L.divIcon({ className: "", html: `<div class="${cls}" style="--h:${h}">${estrella}${p.toFixed(2)}</div>`, iconSize: [0, 0] }),
      zIndexOffset: g.id === state.sel ? 1000 : Math.round(1000 - 900 * t),
    }).bindPopup(() => popup(g), { maxWidth: 300, autoPanPaddingTopLeft: [50, 10] });
    mk.on("click", () => seleccionar(g.id, false));
    mk.addTo(capa);
    marcadores.set(g.id, mk);
  }

  renderTendencia();
  renderRutaInfo();
  renderMejor(ref, unidad);
  $("resumen").innerHTML = visibles.length
    ? `<span><b>${visibles.length}</b> grifos${state.ruta ? " en tu camino" : ""} · más barato <b>${soles(min)}</b> · promedio ${soles(prom)} · más caro ${soles(max)} por ${unidad}</span>
       <button type="button" class="mini" id="top5" title="Imagen con los 5 más baratos para WhatsApp">📤 Top 5</button>`
    : state.q ? `Ningún grifo con ${nombreDe(state.prod)} coincide con «${esc(state.q)}». Prueba con otro combustible o menos palabras.`
      : state.ruta ? "No hay grifos con ese combustible cerca de tu ruta. Prueba con otra antigüedad de precio o marca."
      : "No hay grifos con ese combustible en el radio elegido. Amplía el radio, la antigüedad del precio o cambia de marca.";
  $("lista").innerHTML = visibles.slice(0, 150).map((g) => item(g, ref, unidad)).join("");
  if (state.ruta) refinarDesvios(visibles);
  actualizarFiltrosBoton();
  ajustarHoja();
  if ($("dlg-manejo").open) renderManejo();
}

const textoDistancia = (g) => (state.ruta ? `↪ desvío ${g.desvio < 0.1 ? "0" : "+" + g.desvio.toFixed(1)} km${g.desvioReal ? "" : " aprox."}` : `${g.dist.toFixed(1)} km`);

function sparkline(pts) {
  const v = pts.map((p) => p[1]);
  const lo = Math.min(...v), hi = Math.max(...v), W = 120, H = 30;
  const xy = v.map((y, i) => `${(i / (v.length - 1)) * W},${hi > lo ? H - 2 - ((y - lo) / (hi - lo)) * (H - 4) : H / 2}`);
  return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true"><polyline points="${xy.join(" ")}" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>`;
}

function renderTendencia() {
  const pts = (meta.tendencia || {})[state.prod] || [];
  if (pts.length < 8) { $("tendencia").innerHTML = ""; return; }
  const hoy = pts.at(-1)[1];
  const delta = (n) => (pts.length > n ? hoy - pts.at(-1 - n)[1] : null);
  const fmt = (d, txt) => (d == null ? "" : Math.abs(d) < 0.01 ? `<span>= ${txt}</span>` : `<span class="${d > 0 ? "sube" : "baja"}">${d > 0 ? "▲" : "▼"} ${soles(Math.abs(d))} ${txt}</span>`);
  const d7 = delta(7);
  const lectura = d7 == null || Math.abs(d7) < 0.1 ? "Estable esta semana" : d7 > 0 ? "Viene subiendo" : "Viene bajando";
  $("tendencia").innerHTML = `<div class="tend ${d7 > 0.1 ? "sube" : d7 < -0.1 ? "baja" : ""}">${sparkline(pts)}
    <div><b>${nombreDe(state.prod)} en Lima: ${soles(hoy)}</b> <small>mediana</small><br>
    <small>${lectura} · ${fmt(d7, "en 7 días")} · ${fmt(delta(30), "en 30 días")}</small></div></div>`;
}

function renderMejor(ref, unidad) {
  if (state.orden !== "conviene" || visibles.length < 2) { $("mejor").innerHTML = ""; return; }
  const best = visibles[0];
  const { carga } = state.perfil[state.prod];
  const cerca = state.ruta ? "al de menor desvío" : "al más cercano";
  const msg = best === ref || best.ahorro < 0.5
    ? `${state.ruta ? "El de menor desvío" : "El más cercano"} ya es lo que más te conviene: ninguno compensa el desvío al cargar ${carga} ${unidad}.`
    : `Ahorras <b>${soles(best.ahorro)}</b> frente ${cerca} (${esc(titulo(ref))}, ${soles(ref.precios[state.prod].p)}) al cargar ${carga} ${unidad}, ya descontado el desvío.`;
  $("mejor").innerHTML = `<div class="mejor" data-id="${esc(best.id)}">
    <div class="m-top"><span>🏆 Te conviene</span><b>${soles(best.precios[state.prod].p)}</b></div>
    <div class="nombre">${esc(titulo(best))} <span class="marca" style="--c:${color(best)}">${esc(best.marca)}</span></div>
    <div class="m-txt">${textoDistancia(best)} · ${msg}</div>
    <div class="m-btns">${enlaces(best, true)}</div></div>`;
}

function enlaces(g, grandes) {
  const c = grandes ? "btn" : "";
  return `<a class="${c}" href="https://www.google.com/maps/dir/?api=1&destination=${g.lat},${g.lon}" target="_blank" rel="noopener">🧭 Google Maps</a>
    <a class="${c}" href="https://waze.com/ul?ll=${g.lat},${g.lon}&navigate=yes" target="_blank" rel="noopener">🚙 Waze</a>`;
}

function acciones(g) {
  const fav = state.favs.has(g.id);
  return `<button type="button" class="mini" data-accion="fav" data-id="${esc(g.id)}" aria-pressed="${fav}" title="${fav ? "Quitar de" : "Agregar a"} favoritos">${fav ? "♥" : "♡"}</button>
    <button type="button" class="mini" data-accion="share" data-id="${esc(g.id)}" title="Compartir">📤</button>
    <button type="button" class="mini" data-accion="carga" data-id="${esc(g.id)}" title="Registrar que cargué aquí">⛽ Cargué</button>`;
}

function etiquetaAhorro(g, ref) {
  if (g === ref) return `<span class="cerca">📍 ${state.ruta ? "Menor desvío" : "El más cercano"}</span>`;
  if (g.ahorro >= 0.5) return `<span class="ahorro">💰 Ahorras ${soles(g.ahorro)}</span>`;
  if (g.ahorro <= -0.5) return `<span class="pierde">Pagas ${soles(-g.ahorro)} más</span>`;
  return `<span>≈ igual que ${state.ruta ? "el de menor desvío" : "el más cercano"}</span>`;
}

function item(g, ref, unidad) {
  const pr = g.precios[state.prod];
  return `<li data-id="${esc(g.id)}" class="${g.id === state.sel ? "sel" : ""}">
    <div><span class="marca" style="--c:${color(g)}">${esc(g.marca)}</span><span class="nombre">${esc(titulo(g))}</span> ${insignias(g)}</div>
    <div class="precio">${soles(pr.p)}<small>por ${unidad}</small></div>
    <div class="dir">${esc(g.direccion)} · ${esc(g.distrito)}</div>
    <div class="extra"><span>${textoDistancia(g)}</span>${etiquetaAhorro(g, ref)}<span>${edad(pr.f)}</span>${cambio(pr)}${minimo(pr)}${g.aprox ? "<span title='Ubicada por la calle, no por el número'>📌 aprox.</span>" : ""}</div>
    <div class="extra">${enlaces(g)}${acciones(g)}</div>
  </li>`;
}

function minimo(pr) {
  const v = (pr.h || []).map((x) => x[1]);
  return v.length > 1 && pr.p <= Math.min(...v) && Math.max(...v) - pr.p >= 0.1 ? `<span class="minimo" title="Su precio más bajo de los últimos 60 días">🔥 Mínimo de 60 días</span>` : "";
}

function graficoGrifo(g) {
  const pr = g.precios[state.prod];
  const h = pr?.h;
  if (!h || h.length < 2) return "";
  const pts = [...h, [pr.f.slice(0, 10), pr.p]];
  const t = (d) => Date.parse(d);
  const t0 = t(pts[0][0]), t1 = Math.max(t(pts.at(-1)[0]), t0 + 1);
  const v = pts.map((x) => x[1]), lo = Math.min(...v), hi = Math.max(...v);
  const W = 240, H = 54, y = (p) => (hi > lo ? H - 6 - ((p - lo) / (hi - lo)) * (H - 14) : H / 2);
  let d = "";
  pts.forEach(([f, p], i) => {
    const x = ((t(f) - t0) / (t1 - t0)) * W;
    d += i ? ` H${x.toFixed(1)} V${y(p).toFixed(1)}` : `M0 ${y(p).toFixed(1)}`;
  });
  d += ` H${W}`;
  const cambios = h.length - 1;
  return `<div class="graf"><small>${nombreDe(state.prod)}, últimos 60 días · ${cambios} cambio${cambios === 1 ? "" : "s"} · entre ${soles(lo)} y ${soles(hi)}</small>
    <svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" preserveAspectRatio="none" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="2"/></svg></div>`;
}

function popup(g) {
  const filas = PRODUCTOS.filter(([k]) => g.precios[k]).map(([k, n, u]) =>
    `<tr><td>${n}</td><td><b>${soles(g.precios[k].p)}</b>/${u}</td><td>${edad(g.precios[k].f)} ${cambio(g.precios[k])} ${minimo(g.precios[k])}</td></tr>`).join("");
  return `<b>${esc(titulo(g))}</b> <span class="marca" style="--c:${color(g)}">${esc(g.marca)}</span> ${insignias(g)}<br>
    ${esc(g.razon && g.razon !== titulo(g) ? g.razon : "")}<br>
    <small>${esc(g.direccion)} · ${esc(g.distrito)}</small>
    <table>${filas}</table>${graficoGrifo(g)}${g.aprox ? "<small>📌 Ubicación aproximada (por calle)</small><br>" : ""}
    <div class="pop-acc">${enlaces(g)}</div><div class="pop-acc">${acciones(g)}</div>`;
}

function seleccionar(id, abrir) {
  state.sel = id;
  document.querySelectorAll("#lista li").forEach((li) => li.classList.toggle("sel", li.dataset.id === id));
  document.querySelectorAll(".pin.sel").forEach((p) => p.classList.remove("sel"));
  const mk = marcadores.get(id);
  if (!mk) return;
  mk.getElement()?.querySelector(".pin")?.classList.add("sel");
  if (abrir) {
    if (esMovil()) hojaA("peek");
    const abajo = margenHoja();
    mapa.setView(mk.getLatLng(), Math.max(mapa.getZoom(), 15), { animate: false });
    if (abajo) mapa.panBy([0, abajo / 2], { animate: false });
    mk.getPopup().options.autoPanPaddingBottomRight = [10, abajo + 10];
    mk.openPopup();
  } else {
    document.querySelector(`#lista li[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
}

const porId = (id) => grifos.find((g) => g.id === id);

function toggleFav(id) {
  if (state.favs.has(id)) state.favs.delete(id); else state.favs.add(id);
  store.set("favs", [...state.favs]);
  vibrar();
  toast(state.favs.has(id) ? "♥ Guardado en favoritos" : "Quitado de favoritos");
  render();
}

async function compartir(g) {
  const pr = g.precios[state.prod];
  const url = `${location.origin}${location.pathname}#g=${encodeURIComponent(g.id)}`;
  const text = `⛽ ${nombreDe(state.prod)} a ${soles(pr.p)}/${unidadDe(state.prod)} en ${titulo(g)} (${g.marca}), ${g.direccion}, ${g.distrito}. Reportado ${diasDesde(pr.f) <= 0 ? "hoy" : `hace ${diasDesde(pr.f)} días`} a Osinergmin.\nCómo llegar: https://www.google.com/maps/dir/?api=1&destination=${g.lat},${g.lon}`;
  if (navigator.share) {
    try { await navigator.share({ title: "Grifos Lima", text, url }); } catch { /* cancelado */ }
  } else {
    window.open(`https://wa.me/?text=${encodeURIComponent(`${text}\n${url}`)}`, "_blank", "noopener");
  }
}

// --- Mi auto ---
function renderPerfil() {
  $("perfil").innerHTML = `<div class="fila perfil cab"><span></span><small>Rinde</small><small>Cargas de una vez</small></div>` +
    PRODUCTOS.map(([k, n, u]) => `<div class="fila perfil">
    <b>${n}</b>
    <label><input type="number" inputmode="decimal" min="1" step="0.5" data-k="${k}" data-campo="rend" value="${state.perfil[k].rend}" aria-label="${n}: km por ${u}"> km/${u}</label>
    <label><input type="number" inputmode="decimal" min="1" step="0.5" data-k="${k}" data-campo="carga" value="${state.perfil[k].carga}" aria-label="${n}: ${u} por carga"> ${u}</label>
  </div>`).join("");
}
$("perfil").addEventListener("input", (e) => {
  const { k, campo } = e.target.dataset;
  const v = Number(e.target.value);
  if (!k || !(v > 0)) return;
  state.perfil[k] = { ...state.perfil[k], [campo]: v };
  store.set("perfil", state.perfil);
});

// --- Calculadora ---
const medianaLima = (k) => ((meta.tendencia || {})[k] || []).at(-1)?.[1];
function precioReferencia() {
  const g = state.sel && porId(state.sel);
  return g?.precios[state.prod]?.p ?? visibles.find(Boolean)?.precios[state.prod].p ?? medianaLima(state.prod) ?? 0;
}
function renderCalc() {
  const u = unidadDe(state.prod), { rend } = state.perfil[state.prod];
  const s = Number($("c-soles").value) || 0, p = Number($("c-precio").value) || 0;
  $("c-cant").innerHTML = p > 0 ? `Te dan <b>${(s / p).toFixed(2)} ${u}</b> de ${nombreDe(state.prod)} · alcanza para ~${Math.round((s / p) * rend)} km` : "";
  const km = (Number($("c-km").value) || 0) * ($("c-vuelta").checked ? 2 : 1);
  $("c-carrera").innerHTML = p > 0 ? `Gastas <b>${soles((km / rend) * p)}</b> en combustible (${(km / rend).toFixed(2)} ${u}) · ${soles(p / rend)} por km` : "";
  const filas = PRODUCTOS.map(([k, n, uu]) => ({ k, n, uu, m: medianaLima(k) })).filter((x) => x.m)
    .map((x) => ({ ...x, km: x.m / state.perfil[x.k].rend })).sort((a, b) => a.km - b.km);
  const tope = Math.max(...filas.map((x) => x.km));
  $("c-porkm").innerHTML = filas.map((x) => `<div class="barra"><span>${x.n}</span><div><i style="width:${(x.km / tope) * 100}%"></i></div><b>${soles(x.km)}</b><small>${soles(x.m)}/${x.uu} · ${state.perfil[x.k].rend} km/${x.uu}</small></div>`).join("");
}
["c-soles", "c-precio", "c-km", "c-vuelta"].forEach((id) => $(id).addEventListener("input", renderCalc));

// --- Mis cargas ---
function abrirCargas(g) {
  state.cargaGrifo = g || null;
  $("r-prod").innerHTML = PRODUCTOS.map(([k, n]) => `<option value="${k}" ${k === state.prod ? "selected" : ""}>${n}</option>`).join("");
  const p = g?.precios[state.prod]?.p ?? precioReferencia();
  $("r-precio").value = p ? p.toFixed(2) : "";
  $("r-soles").value = p ? Math.round(p * state.perfil[state.prod].carga) : "";
  $("r-km").value = "";
  $("r-grifo").textContent = g ? `En ${titulo(g)} (${g.marca}), ${g.distrito}` : "";
  renderCargas();
  abrirCuaderno("cargas");
}
function renderCargas() {
  const c = state.cargas;
  const mesDe = (d) => `${d.getFullYear()}-${d.getMonth()}`;
  const delMes = c.filter((x) => mesDe(new Date(x.t)) === mesDe(new Date()));
  const total = delMes.reduce((s, x) => s + x.soles, 0);
  const conKm = c.filter((x) => x.km > 0).sort((a, b) => a.km - b.km);
  let rinde = "";
  if (conKm.length >= 2) {
    const km = conKm.at(-1).km - conKm[0].km;
    const cant = conKm.slice(1).reduce((s, x) => s + x.cant, 0);
    const gasto = conKm.slice(1).reduce((s, x) => s + x.soles, 0);
    if (km > 0 && cant > 0) rinde = `<div class="kpi"><b>${(km / cant).toFixed(1)}</b><small>km por ${unidadDe(conKm.at(-1).prod)} reales</small></div><div class="kpi"><b>${soles(gasto / km)}</b><small>por km recorrido</small></div>`;
  }
  $("r-resumen").innerHTML = c.length ? `<div class="kpis"><div class="kpi"><b>${soles(total)}</b><small>gastado este mes</small></div><div class="kpi"><b>${delMes.length}</b><small>cargas este mes</small></div>${rinde}</div>` : "";
  $("r-lista").innerHTML = c.slice().reverse().slice(0, 30).map((x) => `<li><span>${new Date(x.t).toLocaleDateString("es-PE", { day: "numeric", month: "short" })} · ${nombreDe(x.prod)} · ${x.cant.toFixed(2)} ${unidadDe(x.prod)} a ${soles(x.precio)}${x.km ? ` · ${x.km} km` : ""}${x.grifo ? `<br><small>${esc(x.grifo)}</small>` : ""}</span><b>${soles(x.soles)}</b><button type="button" class="mini" data-borrar="${x.t}" title="Borrar">✕</button></li>`).join("");
  renderPresupuesto();
}
$("r-guardar").addEventListener("click", () => {
  const s = Number($("r-soles").value), p = Number($("r-precio").value);
  if (!(s > 0 && p > 0)) return toast("Pon cuánto pagaste y el precio");
  const g = state.cargaGrifo;
  state.cargas.push({ t: new Date().toISOString(), prod: $("r-prod").value, soles: s, precio: p, cant: s / p,
    km: Number($("r-km").value) || null, grifo: g ? `${titulo(g)} (${g.marca}), ${g.distrito}` : null });
  store.set("cargas", state.cargas);
  state.cargaGrifo = null;
  $("r-grifo").textContent = "";
  $("r-km").value = "";
  renderCargas();
  vibrar();
  toast("✓ Carga registrada");
});
$("r-lista").addEventListener("click", (e) => {
  const t = e.target.closest("[data-borrar]")?.dataset.borrar;
  if (!t || !confirm("¿Borrar esta carga?")) return;
  state.cargas = state.cargas.filter((x) => x.t !== t);
  store.set("cargas", state.cargas);
  renderCargas();
});
$("r-csv").addEventListener("click", () => {
  const filas = [["fecha", "combustible", "soles", "precio", "cantidad", "km", "grifo"],
    ...state.cargas.map((x) => [x.t, x.prod, x.soles, x.precio, x.cant.toFixed(3), x.km ?? "", x.grifo ?? ""])];
  const csv = filas.map((f) => f.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv" })), download: "mis-cargas.csv" });
  a.click();
  URL.revokeObjectURL(a.href);
});

// --- Eventos ---
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-accion]");
  if (!b) return;
  const g = porId(b.dataset.id);
  if (!g) return;
  e.stopPropagation();
  if (b.dataset.accion === "fav") toggleFav(g.id);
  else if (b.dataset.accion === "share") compartir(g);
  else if (b.dataset.accion === "carga") abrirCargas(g);
}, true);

$("productos").addEventListener("click", (e) => {
  const k = e.target.closest("button")?.dataset.k;
  if (!k) return;
  state.prod = k; store.set("prod", k);
  renderProductos(); render();
});
$("marcas").addEventListener("click", (e) => {
  const b = e.target.closest("button");
  if (!b) return;
  if ("favs" in b.dataset) {
    state.soloFavs = !state.soloFavs; store.set("soloFavs", state.soloFavs);
    if (state.soloFavs && !state.favs.size) toast("Aún no tienes favoritos: toca ♡ en un grifo");
    return render();
  }
  const m = b.dataset.m;
  if (!m) state.marcas.clear();
  else if (state.marcas.has(m)) state.marcas.delete(m);
  else state.marcas.add(m);
  store.set("marcas", [...state.marcas]);
  render();
});
$("radio").addEventListener("change", (e) => { state.radio = Number(e.target.value); store.set("radio", state.radio); render(); });
$("orden").addEventListener("change", (e) => { state.orden = e.target.value; store.set("orden", state.orden); render(); });
$("edad").addEventListener("change", (e) => { state.edadMax = Number(e.target.value); store.set("edadMax", state.edadMax); render(); });
$("lista-filtro").addEventListener("change", (e) => { state.lista = e.target.value; store.set("lista", state.lista); render(); });
$("lista").addEventListener("click", (e) => {
  if (e.target.closest("a, button")) return;
  const li = e.target.closest("li");
  if (li) seleccionar(li.dataset.id, true);
});
$("mejor").addEventListener("click", (e) => {
  if (e.target.closest("a, button")) return;
  const id = e.target.closest(".mejor")?.dataset.id;
  if (id) seleccionar(id, true);
});

// La primera lectura suele venir de la red (Wi-Fi o antenas); se sigue escuchando hasta que el GPS afine.
const PRECISION_BUENA = 25, PRECISION_MALA = 300, ESPERA_GPS = 25000;
let rastreo = null;
function ubicar(silencioso) {
  if (!navigator.geolocation) {
    if (!silencioso) toast("Tu navegador no permite obtener la ubicación. Toca el mapa para elegir un punto.");
    return;
  }
  if (rastreo) terminarRastreo(rastreo);
  const r = { mejor: Infinity, silencioso };
  rastreo = r;
  $("gps").classList.add("buscando");
  $("aviso-gps").innerHTML = "";
  r.id = navigator.geolocation.watchPosition((pos) => {
    const acc = Math.round(pos.coords.accuracy), p = [pos.coords.latitude, pos.coords.longitude];
    if (acc >= r.mejor) return;
    const primero = r.mejor === Infinity;
    r.mejor = acc;
    if (primero || distKm(p, state.origen) * 1000 > Math.max(15, acc / 2)) setOrigen(p, primero, acc);
    else precision.setLatLng(state.origen).setRadius(acc);
    if (acc <= PRECISION_BUENA) terminarRastreo(r);
  }, (err) => {
    if (r.mejor < Infinity) return terminarRastreo(r);
    terminarRastreo(r);
    if (!silencioso || err.code === 1) avisoUbicacion(err.code === 1 ? "denegada" : "sin-senal");
  }, { enableHighAccuracy: true, maximumAge: 0, timeout: ESPERA_GPS });
  r.t = setTimeout(() => terminarRastreo(r), ESPERA_GPS);
}
function terminarRastreo(r) {
  if (r.fin) return;
  r.fin = true;
  navigator.geolocation.clearWatch(r.id);
  clearTimeout(r.t);
  if (rastreo === r) rastreo = null;
  $("gps").classList.remove("buscando");
  if (r.mejor === Infinity) return;
  if (r.mejor > PRECISION_MALA) avisoUbicacion("aproximada", r.mejor);
  else if (!r.silencioso) toast(`📍 Ubicado con precisión de ±${r.mejor} m`);
}

function avisoUbicacion(tipo, acc) {
  const ua = navigator.userAgent, android = /Android/i.test(ua), ios = /iPhone|iPad|iPod/i.test(ua);
  const km = acc >= 1000 ? `${(acc / 1000).toFixed(1)} km` : `${acc} m`;
  const como = ios
    ? "En Ajustes → Privacidad y seguridad → Localización → Safari (o Chrome) elige «Al usar la app» y activa <b>Ubicación exacta</b>."
    : android
      ? "En Ajustes → Ubicación activa la <b>precisión de la ubicación de Google</b>, y en Ajustes → Apps → Chrome → Permisos → Ubicación activa <b>Usar ubicación precisa</b>."
      : "En una computadora la ubicación sale de tu conexión a internet y puede caer lejos. Ábrela en tu celular o toca el mapa en tu punto exacto.";
  const titulo = tipo === "denegada" ? "📍 No diste permiso de ubicación"
    : tipo === "sin-senal" ? "📍 No llegó señal de ubicación"
      : `📍 Tu ubicación es aproximada (±${km})`;
  const detalle = tipo === "denegada"
    ? `Para ver los grifos cerca de ti, permite la ubicación para este sitio (candado 🔒 junto a la dirección → Permisos → Ubicación). ${android || ios ? como : ""}`
    : tipo === "sin-senal" ? "Activa la ubicación (GPS) del teléfono y prueba otra vez, de preferencia al aire libre. También puedes tocar el mapa en tu punto."
      : `${android || ios ? "El teléfono le está dando al navegador solo la ubicación aproximada, que sale de la red. " : ""}${como}`;
  $("aviso-gps").innerHTML = `<div class="aviso-gps"><b>${titulo}</b><p>${detalle}</p>
    <div class="acc"><button type="button" class="mini primario" data-gps="otra">Intentar otra vez</button><button type="button" class="mini" data-gps="cerrar">Entendido</button></div></div>`;
  ajustarHoja();
}
$("aviso-gps").addEventListener("click", (e) => {
  const b = e.target.closest("[data-gps]");
  if (!b) return;
  $("aviso-gps").innerHTML = "";
  if (b.dataset.gps === "otra") ubicar(false);
  ajustarHoja();
});
$("gps").addEventListener("click", () => ubicar(false));
mapa.on("click", (e) => {
  if (state.elegirDestino) return elegirDestinoEn([e.latlng.lat, e.latlng.lng]);
  setOrigen([e.latlng.lat, e.latlng.lng], false);
});

$("abrir-calc").addEventListener("click", () => {
  $("c-precio").value = precioReferencia().toFixed(2);
  renderCalc();
  $("dlg-calc").showModal();
});
for (const d of document.querySelectorAll("dialog")) d.addEventListener("click", (e) => { if (e.target === d) d.close(); });

let promptInstalar = null;
addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); promptInstalar = e; $("instalar").hidden = false; });
$("instalar").addEventListener("click", async () => {
  if (!promptInstalar) return;
  promptInstalar.prompt();
  await promptInstalar.userChoice;
  promptInstalar = null;
  $("instalar").hidden = true;
});
if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});

$("radio").value = String(state.radio);
$("orden").value = state.orden;
$("edad").value = String(state.edadMax);
renderProductos();

function abrirDesdeEnlace() {
  const id = decodeURIComponent((location.hash.match(/^#g=(.+)$/) || [])[1] || "");
  const g = id && porId(id);
  if (!g) return false;
  const prod = PRODUCTOS.find(([k]) => g.precios[k])?.[0];
  if (!g.precios[state.prod] && prod) { state.prod = prod; renderProductos(); }
  setOrigen([g.lat, g.lon], true);
  seleccionar(g.id, true);
  return true;
}

fetch("data/grifos.json", { cache: "no-cache" })
  .then((r) => r.json())
  .then((data) => {
    meta = data.meta;
    grifos = data.grifos.filter((g) => g.lat != null && Object.keys(g.precios).length);
    for (const g of grifos) g._txt = normal([g.nombre, g.razon, g.marca, g.distrito, g.direccion, ...(g.listas || [])].join(" "));
    const listas = meta.listas || [];
    if (listas.length) {
      $("lista-filtro").insertAdjacentHTML("beforeend", listas.map((l) => `<option value="${esc(l.nombre)}">${esc(l.nombre)} (${l.cruzados})</option>`).join(""));
      $("lista-wrap").hidden = false;
    }
    if (!listas.some((l) => l.nombre === state.lista)) state.lista = "";
    $("lista-filtro").value = state.lista;
    const fecha = (s) => new Date(s).toLocaleString("es-PE", { dateStyle: "medium", timeStyle: "short" });
    $("meta").innerHTML = `Precios: Osinergmin (SCOP), último reporte ${esc(meta.ultimo_registro)} · ${meta.grifos_con_precio} grifos con precio, ${meta.ubicados_osm} ubicados con OpenStreetMap y ${meta.ubicacion_aproximada} por calle · actualizado ${fecha(meta.generado)} · Toca el mapa para buscar desde otro punto.`;
    render();
    renderAvisos();
    if (!abrirDesdeEnlace()) {
      if (!store.get("inicioListo", false)) abrirInicio();
      else navigator.permissions?.query({ name: "geolocation" }).then((p) => { if (p.state === "granted") ubicar(true); }).catch(() => {});
    }
  })
  .catch((e) => { $("resumen").textContent = "No se pudo cargar data/grifos.json. Corre primero: python3 build.py"; console.error(e); });
addEventListener("hashchange", abrirDesdeEnlace);
