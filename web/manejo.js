const manejo = { wake: null, watch: null };

function mejoresParaManejo() {
  return [...visibles].sort((a, b) => b.ahorro - a.ahorro || a.desvio - b.desvio).slice(0, 3);
}

function renderManejo() {
  const u = unidadDe(state.prod), top = mejoresParaManejo();
  $("mj-prod").textContent = nombreDe(state.prod);
  $("mj-sub").textContent = state.ruta ? `En tu ruta a ${state.ruta.nombre}` : state.radio ? `A ${state.radio} km de ti` : "En todo Lima";
  $("mj-lista").innerHTML = top.length ? top.map((g, i) => `<li class="${i === 0 ? "primero" : ""}">
      <div class="mj-precio">${soles(g.precios[state.prod].p)}<small>/${u}</small></div>
      <div class="mj-nombre">${esc(titulo(g))}</div>
      <div class="mj-info">${state.ruta ? `desvío +${g.desvio.toFixed(1)} km` : `${g.dist.toFixed(1)} km`}${g.ahorro >= 0.5 ? ` · <b>ahorras ${soles(g.ahorro)}</b>` : ""} · ${esc(g.marca)}</div>
      <div class="mj-btns">
        <a class="btn" href="https://waze.com/ul?ll=${g.lat},${g.lon}&navigate=yes" target="_blank" rel="noopener">🚙 Waze</a>
        <a class="btn" href="https://www.google.com/maps/dir/?api=1&destination=${g.lat},${g.lon}" target="_blank" rel="noopener">🧭 Maps</a>
      </div></li>`).join("")
    : `<li class="vacio">No hay grifos con ${nombreDe(state.prod)} cerca. Cierra y amplía el radio.</li>`;
}

const enSoles = (p) => {
  const s = Math.floor(p), c = Math.round((p - s) * 100);
  return `${s} soles${c ? ` con ${c}` : ""}`;
};
function hablar() {
  const top = mejoresParaManejo();
  if (!("speechSynthesis" in window)) return toast("Tu teléfono no puede leer en voz alta");
  if (!top.length) return;
  const [g, h] = top;
  const lejos = state.ruta ? `con un desvío de ${g.desvio.toFixed(1).replace(".", " punto ")} kilómetros` : `a ${g.dist.toFixed(1).replace(".", " punto ")} kilómetros`;
  let texto = `Te conviene ${titulo(g)}, ${lejos}. ${nombreDe(state.prod)} a ${enSoles(g.precios[state.prod].p)}.`;
  if (g.ahorro >= 0.5) texto += ` Ahorras ${enSoles(g.ahorro)}.`;
  if (h) texto += ` La segunda opción es ${titulo(h)}, a ${enSoles(h.precios[state.prod].p)}.`;
  speechSynthesis.cancel();
  const voz = new SpeechSynthesisUtterance(texto);
  const voces = speechSynthesis.getVoices();
  voz.voice = voces.find((v) => v.lang === "es-PE") || voces.find((v) => v.lang === "es-US" || v.lang === "es-419" || v.lang === "es-MX") || voces.find((v) => v.lang.startsWith("es")) || null;
  voz.lang = voz.voice?.lang || "es-PE";
  voz.rate = 1.02;
  speechSynthesis.speak(voz);
}

async function pedirPantalla() {
  try { manejo.wake = await navigator.wakeLock?.request("screen"); } catch { /* no soportado */ }
}
function abrirManejo() {
  renderManejo();
  $("dlg-manejo").showModal();
  pedirPantalla();
  if (navigator.geolocation && manejo.watch == null) {
    manejo.watch = navigator.geolocation.watchPosition((pos) => {
      const p = [pos.coords.latitude, pos.coords.longitude], acc = Math.round(pos.coords.accuracy);
      if (acc <= PRECISION_MALA && distKm(p, state.origen) > 0.2) setOrigen(p, false, acc);
    }, () => {}, { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 });
  }
}
function cerrarManejo() {
  window.speechSynthesis?.cancel();
  manejo.wake?.release().catch(() => {});
  manejo.wake = null;
  if (manejo.watch != null) navigator.geolocation.clearWatch(manejo.watch);
  manejo.watch = null;
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && $("dlg-manejo").open) pedirPantalla(); });
$("fab-manejo").addEventListener("click", abrirManejo);
$("mj-cerrar").addEventListener("click", () => $("dlg-manejo").close());
$("dlg-manejo").addEventListener("close", cerrarManejo);
$("mj-voz").addEventListener("click", hablar);
$("mj-otro").addEventListener("click", () => {
  const i = PRODUCTOS.findIndex(([k]) => k === state.prod);
  state.prod = PRODUCTOS[(i + 1) % PRODUCTOS.length][0];
  store.set("prod", state.prod);
  renderProductos();
  render();
});
window.speechSynthesis?.getVoices();
