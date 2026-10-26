const movil = matchMedia("(max-width: 760px)");
const esMovil = () => movil.matches;
const panel = $("panel");
const hoja = { estado: "peek", y: 0, arrastre: null };

// --- Hoja deslizable (solo en el teléfono): peek muestra lo mejor, medio la lista, full todo ---
function posiciones() {
  const h = panel.parentElement.clientHeight;
  const ref = $("mejor").firstElementChild || $("resumen");
  const visible = Math.min(Math.max(ref.offsetTop + ref.offsetHeight + 10, 150), h * 0.6);
  return { peek: Math.round(h - visible), medio: Math.round(h * 0.42), full: 0 };
}
function moverHoja(y, animar) {
  panel.style.transition = animar ? "transform .32s cubic-bezier(.2, .8, .2, 1)" : "none";
  panel.style.transform = `translateY(${y}px)`;
  panel.style.setProperty("--y", `${y}px`);
  hoja.y = y;
}
function hojaA(estado) {
  if (!esMovil()) return;
  hoja.estado = estado;
  panel.classList.toggle("full", estado === "full");
  if (estado !== "full") panel.scrollTop = 0;
  moverHoja(posiciones()[estado], true);
}
function ajustarHoja() {
  if (esMovil() && !hoja.arrastre) moverHoja(posiciones()[hoja.estado], false);
}
function margenHoja() {
  return esMovil() ? panel.parentElement.clientHeight - hoja.y : 0;
}
function limpiarHoja() {
  panel.style.transform = panel.style.transition = "";
  panel.classList.remove("full");
}
movil.addEventListener("change", () => { if (esMovil()) hojaA("peek"); else limpiarHoja(); mapa.invalidateSize(); });

panel.addEventListener("pointerdown", (e) => {
  if (!esMovil() || e.button > 0 || e.target.closest("input, select, textarea")) return;
  const enAsa = e.target.closest("#asa");
  if (hoja.estado === "full" && !(enAsa || panel.scrollTop <= 0)) return;
  hoja.arrastre = { y0: e.clientY, base: hoja.y, t0: performance.now(), movido: false, id: e.pointerId, enAsa };
});
panel.addEventListener("pointermove", (e) => {
  const a = hoja.arrastre;
  if (!a || e.pointerId !== a.id) return;
  const dy = e.clientY - a.y0;
  if (!a.movido) {
    if (Math.abs(dy) < 8) return;
    if (hoja.estado === "full" && !a.enAsa && dy < 0) { hoja.arrastre = null; return; }
    a.movido = true;
    try { panel.setPointerCapture(e.pointerId); } catch { /* puntero ya liberado */ }
  }
  moverHoja(Math.max(0, a.base + dy), false);
});
function soltarHoja(e) {
  const a = hoja.arrastre;
  hoja.arrastre = null;
  if (!a || !a.movido) return;
  const dy = e.clientY - a.y0, v = dy / Math.max(1, performance.now() - a.t0);
  const pos = posiciones(), orden = ["full", "medio", "peek"];
  let destino;
  if (Math.abs(v) > 0.5) {
    const i = orden.indexOf(hoja.estado) + (v > 0 ? 1 : -1);
    destino = orden[Math.max(0, Math.min(2, i))];
  } else {
    destino = orden.reduce((m, k) => (Math.abs(pos[k] - hoja.y) < Math.abs(pos[m] - hoja.y) ? k : m), "peek");
  }
  hojaA(destino);
  hoja.soltado = performance.now();
}
panel.addEventListener("click", (e) => {
  if (performance.now() - (hoja.soltado || 0) < 350) { e.stopPropagation(); e.preventDefault(); }
}, true);
panel.addEventListener("pointerup", soltarHoja);
panel.addEventListener("pointercancel", () => { hoja.arrastre = null; ajustarHoja(); });
$("asa").addEventListener("click", () => hojaA(hoja.estado === "peek" ? "medio" : hoja.estado === "medio" ? "full" : "peek"));
addEventListener("resize", () => { ajustarHoja(); });

// --- Pines: punto de color al alejarse, precio al acercarse ---
function claseZoom() { $("mapa").classList.toggle("lejos", mapa.getZoom() < 13); }
mapa.on("zoomend", claseZoom);
claseZoom();
if (esMovil()) mapa.attributionControl.setPosition("topleft");

// --- Filtros ---
function actualizarFiltrosBoton() {
  const partes = [state.ruta ? "en ruta" : state.q || state.radio === 0 ? "todo Lima" : `${state.radio} km`,
    state.edadMax ? `≤ ${state.edadMax} d` : "toda fecha"];
  if (state.orden !== "conviene") partes.push(state.orden === "precio" ? "por precio" : "por distancia");
  if (state.lista) partes.push("★ lista");
  $("filtros-txt").textContent = partes.join(" · ");
}
$("abrir-filtros").addEventListener("click", () => $("dlg-filtros").showModal());
$("filtros-reset").addEventListener("click", () => {
  Object.assign(state, { radio: 3, edadMax: 15, orden: "conviene", lista: "" });
  for (const [k, v] of [["radio", 3], ["edadMax", 15], ["orden", "conviene"], ["lista", ""]]) store.set(k, v);
  $("radio").value = "3"; $("edad").value = "15"; $("orden").value = "conviene"; $("lista-filtro").value = "";
  render();
});

// --- Buscador ---
let tBuscar;
$("buscar").addEventListener("input", (e) => {
  clearTimeout(tBuscar);
  $("buscar-x").hidden = !e.target.value;
  tBuscar = setTimeout(() => {
    state.q = e.target.value.trim();
    render();
    if (!state.q || !visibles.length) return;
    if (esMovil()) hojaA("medio");
    if (visibles.length <= 60) {
      mapa.fitBounds(L.latLngBounds(visibles.map((g) => [g.lat, g.lon])).pad(0.15),
        { maxZoom: 16, paddingTopLeft: [20, 20], paddingBottomRight: [20, margenHoja() + 20] });
    }
  }, 250);
});
$("buscar").addEventListener("keydown", (e) => { if (e.key === "Enter") e.target.blur(); });
$("buscar-x").addEventListener("click", () => {
  $("buscar").value = ""; $("buscar-x").hidden = true; state.q = ""; render();
});

// --- Bienvenida ---
const PRESETS = [
  { id: "taxi-gnv", icono: "🚕", titulo: "Taxi a GNV", detalle: "13 km/m³", prod: "gnv", rend: 13, carga: 15 },
  { id: "taxi-glp", icono: "🚕", titulo: "Taxi a GLP", detalle: "28 km/gal", prod: "glp", rend: 28, carga: 10 },
  { id: "auto", icono: "🚗", titulo: "Auto a gasolina", detalle: "Regular · 35 km/gal", prod: "regular", rend: 35, carga: 10 },
  { id: "premium", icono: "🏎️", titulo: "Auto premium", detalle: "Premium · 32 km/gal", prod: "premium", rend: 32, carga: 10 },
  { id: "diesel", icono: "🛻", titulo: "Camioneta diésel", detalle: "30 km/gal", prod: "diesel", rend: 30, carga: 15 },
  { id: "moto", icono: "🏍️", titulo: "Moto", detalle: "Regular · 90 km/gal", prod: "regular", rend: 90, carga: 3 },
];
function abrirInicio() {
  const actual = store.get("preset", null);
  $("presets").innerHTML = PRESETS.map((p) => `<button type="button" class="preset" data-preset="${p.id}" aria-pressed="${p.id === actual}">
    <span>${p.icono}</span><b>${p.titulo}</b><small>${p.detalle}</small></button>`).join("");
  $("dlg-inicio").showModal();
}
$("presets").addEventListener("click", (e) => {
  const b = e.target.closest("[data-preset]");
  if (!b) return;
  const p = PRESETS.find((x) => x.id === b.dataset.preset);
  state.prod = p.prod;
  state.perfil[p.prod] = { rend: p.rend, carga: p.carga };
  store.set("prod", p.prod); store.set("perfil", state.perfil); store.set("preset", p.id);
  document.querySelectorAll(".preset").forEach((x) => x.setAttribute("aria-pressed", x === b));
  vibrar();
  renderProductos();
  render();
});
$("inicio-gps").addEventListener("click", () => { $("dlg-inicio").close(); ubicar(false); });
$("dlg-inicio").addEventListener("close", () => store.set("inicioListo", true));

if (esMovil()) requestAnimationFrame(() => hojaA("peek"));

// --- Teclado: los diálogos suben sobre él y el campo activo queda a la vista ---
const vv = window.visualViewport;
function ajustarTeclado() {
  if (!vv) return;
  const teclado = Math.max(0, Math.round(innerHeight - vv.height - vv.offsetTop));
  const raiz = document.documentElement.style;
  raiz.setProperty("--teclado", `${teclado}px`);
  raiz.setProperty("--alto-visible", `${Math.round(vv.height)}px`);
  document.documentElement.classList.toggle("con-teclado", teclado > 80);
}
vv?.addEventListener("resize", ajustarTeclado);
vv?.addEventListener("scroll", ajustarTeclado);
ajustarTeclado();
document.addEventListener("focusin", (e) => {
  const campo = e.target.closest("input:not([type=checkbox]):not([type=file]), textarea, select");
  if (!campo || !esMovil()) return;
  setTimeout(() => { ajustarTeclado(); campo.scrollIntoView({ block: "center", behavior: "smooth" }); }, 320);
});
document.addEventListener("focusout", () => setTimeout(ajustarTeclado, 120));
