const MOTIVOS = {
  1: [["completo", "Despacha completo"], ["rinde", "Rinde bien"], ["atencion", "Buena atención"]],
  [-1]: [["incompleto", "No despacha completo"], ["rinde-menos", "Rinde menos"], ["motor", "Falló el motor"], ["sucio", "Agua o suciedad"], ["cobro", "Cobra más que el precio"]],
};
const nombreMotivo = Object.fromEntries([...MOTIVOS[1], ...MOTIVOS[-1]]);
const cal = { datos: {}, mios: {}, grifo: null, nota: 0, motivos: new Set() };

// Mala: al menos 2 conductores y más malas que buenas. Buena: al menos 2 y el doble de buenas.
function veredicto(g) {
  const r = cal.datos[g.id];
  if (!r) return null;
  if (r.m >= 2 && r.m > r.b) return "mala";
  if (r.b >= 2 && r.b >= 2 * r.m) return "buena";
  return "mixta";
}
const calidadOk = (g) => !state.ocultarMala || veredicto(g) !== "mala";

function insigniaCalidad(g) {
  const r = cal.datos[g.id], v = veredicto(g);
  if (!v) return "";
  if (v === "mala") return `<span class="cal mala" title="Reportes de conductores">⚠️ Mala calidad · ${r.m}</span>`;
  if (v === "buena") return `<span class="cal buena" title="Reportes de conductores">✅ Buena calidad · ${r.b}</span>`;
  return `<span class="cal" title="Reportes de conductores">👍 ${r.b} · 👎 ${r.m}</span>`;
}

function detalleCalidad(g) {
  const r = cal.datos[g.id];
  const top = r ? Object.entries(r.motivos).sort((a, b) => b[1] - a[1]).slice(0, 3) : [];
  const mio = cal.mios[g.id];
  return `<div class="cal-pop">${r ? `${insigniaCalidad(g)}${top.length ? `<small>${top.map(([k, n]) => `${esc(nombreMotivo[k] || k)} (${n})`).join(" · ")}</small>` : ""}`
    : "<small>Sin reportes de calidad todavía.</small>"}
    <button type="button" class="mini" data-accion="calidad" data-id="${esc(g.id)}">${mio ? (mio.nota > 0 ? "👍 Tu nota" : "👎 Tu nota") : "👍👎 Calificar"}</button></div>`;
}

async function cargarCalidad() {
  try {
    const r = await fetch(`${API}calidad?v=${votante()}`);
    if (!r.ok) return;
    const j = await r.json();
    cal.datos = j.grifos || {};
    cal.mios = j.mios || {};
    if (grifos.length) render();
  } catch { /* sin conexión: se queda sin calificaciones */ }
}

function renderCalidad() {
  $("cal-motivos").innerHTML = cal.nota ? MOTIVOS[cal.nota].map(([k, n]) =>
    `<button type="button" class="chip" data-motivo="${k}" aria-pressed="${cal.motivos.has(k)}">${n}</button>`).join("") : "";
  $("cal-motivos-titulo").hidden = !cal.nota;
  document.querySelectorAll("#cal-notas [data-nota]").forEach((b) => b.setAttribute("aria-pressed", Number(b.dataset.nota) === cal.nota));
  $("cal-enviar").disabled = !cal.nota;
}

function pedirCalidad(g, trasCarga) {
  const mio = cal.mios[g.id];
  if (trasCarga && mio) return;
  cal.grifo = g;
  cal.nota = mio?.nota || 0;
  cal.motivos = new Set(mio?.motivos || []);
  $("cal-grifo").textContent = `${titulo(g)} (${g.marca}), ${g.distrito}`;
  $("cal-titulo").textContent = trasCarga ? "¿Qué tal el combustible aquí?" : "Calidad del grifo";
  $("cal-quitar").hidden = !mio;
  renderCalidad();
  $("dlg-calidad").showModal();
}

async function enviarCalidad(nota) {
  const g = cal.grifo;
  try {
    const r = await fetch(`${API}calidad`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ g: g.id, nota, motivos: [...cal.motivos], v: votante() }) });
    const j = await r.json();
    if (!r.ok) return toast(j.error || "No se pudo guardar, intenta luego");
    if (j.resumen.b || j.resumen.m) cal.datos[g.id] = j.resumen; else delete cal.datos[g.id];
    if (nota) cal.mios[g.id] = { nota, motivos: [...cal.motivos] }; else delete cal.mios[g.id];
    $("dlg-calidad").close();
    vibrar();
    toast(nota ? "Gracias: tu nota ayuda a otros conductores" : "Quitaste tu calificación");
    render();
  } catch {
    toast("Sin conexión: intenta otra vez");
  }
}

$("cal-notas").addEventListener("click", (e) => {
  const n = Number(e.target.closest("[data-nota]")?.dataset.nota);
  if (!n) return;
  if (n !== cal.nota) cal.motivos.clear();
  cal.nota = n;
  renderCalidad();
});
$("cal-motivos").addEventListener("click", (e) => {
  const k = e.target.closest("[data-motivo]")?.dataset.motivo;
  if (!k) return;
  if (cal.motivos.has(k)) cal.motivos.delete(k); else cal.motivos.add(k);
  renderCalidad();
});
$("cal-enviar").addEventListener("click", () => enviarCalidad(cal.nota));
$("cal-quitar").addEventListener("click", () => enviarCalidad(0));
$("ocultar-mala").checked = state.ocultarMala;
$("ocultar-mala").addEventListener("change", (e) => { state.ocultarMala = e.target.checked; store.set("ocultarMala", state.ocultarMala); render(); });
cargarCalidad();
