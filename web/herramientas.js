const API = "api/";
const APPS = ["Calle", "InDrive", "Uber", "DiDi", "Cabify", "Otra"];
const DOCS = [
  ["soat", "SOAT"],
  ["revision", "Revisión técnica"],
  ["gas", "Certificación GNV/GLP"],
  ["brevete", "Brevete"],
];
const hoyLocal = () => new Date().toLocaleDateString("sv-SE");
const mediana = (v) => { const s = [...v].sort((a, b) => a - b); const n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null; };
const fechaLarga = (d) => new Date(d + "T12:00:00").toLocaleDateString("es-PE", { weekday: "short", day: "numeric", month: "short" });

state.jornadas = store.get("jornadas", {});
state.mant = store.get("mant", { aceiteCada: 5000 });
state.jApp = store.get("jApp", "Calle");

// --- Lima hoy ---
function graficoTendencia(pts) {
  const W = 600, H = 150, v = pts.map((p) => p[1]), lo = Math.min(...v), hi = Math.max(...v);
  const y = (p) => (hi > lo ? H - 18 - ((p - lo) / (hi - lo)) * (H - 36) : H / 2);
  const xy = pts.map((p, i) => [(i / (pts.length - 1)) * W, y(p[1])]);
  const linea = xy.map(([x, yy]) => `${x.toFixed(1)},${yy.toFixed(1)}`).join(" ");
  return `<svg class="tend-grande" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-label="Mediana diaria de los últimos ${pts.length} días">
    <polygon points="0,${H} ${linea} ${W},${H}" fill="currentColor" opacity=".12"/>
    <polyline points="${linea}" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/></svg>
    <div class="ejes"><span>${fechaCorta(pts[0][0])} · ${soles(pts[0][1])}</span><span>min ${soles(lo)} · max ${soles(hi)}</span><span>${fechaCorta(pts.at(-1)[0])} · ${soles(pts.at(-1)[1])}</span></div>`;
}

function barras(filas, lo, hi) {
  return filas.map(([n, med, c]) => `<div class="barra"><span title="${esc(n)}">${esc(n)}</span><div><i style="width:${hi > lo ? 8 + ((med - lo) / (hi - lo)) * 92 : 50}%"></i></div><b>${soles(med)}</b><small>${c} grifos</small></div>`).join("");
}

function renderLima() {
  const k = state.prod, u = unidadDe(k);
  const frescos = grifos.filter((g) => g.precios[k] && diasDesde(g.precios[k].f) <= 7);
  const agrupar = (clave, min) => {
    const m = new Map();
    for (const g of frescos) { const c = clave(g); if (c) (m.get(c) || m.set(c, []).get(c)).push(g.precios[k].p); }
    return [...m].filter(([, v]) => v.length >= min).map(([n, v]) => [n, mediana(v), v.length]).sort((a, b) => a[1] - b[1]);
  };
  const dist = agrupar((g) => g.distrito, 3);
  const marcas = agrupar((g) => (g.marca === "Otra" ? null : g.marca), 5);
  const todos = dist.map((d) => d[1]);
  const bajaron = frescos.filter((g) => g.precios[k].prev != null && g.precios[k].p < g.precios[k].prev && diasDesde(g.precios[k].desde) <= 7)
    .sort((a, b) => (a.precios[k].p - a.precios[k].prev) - (b.precios[k].p - b.precios[k].prev)).slice(0, 8);
  const pts = (meta.tendencia || {})[k] || [];
  $("lima-cont").innerHTML = `
    <div class="seg mini-seg" id="lima-prod">${PRODUCTOS.map(([kk, n]) => `<button type="button" role="radio" data-k="${kk}" aria-checked="${kk === k}">${n}</button>`).join("")}</div>
    ${pts.length > 7 ? `<h3>Mediana de Lima, ${pts.length} días</h3>${graficoTendencia(pts)}` : ""}
    <h3>📉 Bajaron de precio esta semana</h3>
    ${bajaron.length ? `<ol class="bajaron">${bajaron.map((g) => `<li><button type="button" data-ir="${esc(g.id)}"><span><b>${esc(titulo(g))}</b><small>${esc(g.marca)} · ${esc(g.distrito)}</small></span>
      <span class="baja">▼ ${soles(g.precios[k].prev - g.precios[k].p)}</span><b>${soles(g.precios[k].p)}</b></button></li>`).join("")}</ol>` : "<p class='ayuda'>Ningún grifo bajó este combustible en los últimos 7 días.</p>"}
    <h3>🏘️ Distritos más baratos</h3>${barras(dist.slice(0, 8), todos[0], todos.at(-1))}
    ${dist.length > 10 ? `<h3>Distritos más caros</h3>${barras(dist.slice(-3).reverse(), todos[0], todos.at(-1))}` : ""}
    <h3>🏷️ Por marca</h3>${barras(marcas, marcas[0]?.[1], marcas.at(-1)?.[1])}
    <p class="ayuda">Medianas por ${u} con precios reportados en los últimos 7 días.</p>`;
}
$("abrir-lima").addEventListener("click", () => { renderLima(); $("dlg-lima").showModal(); });
$("lima-cont").addEventListener("click", (e) => {
  const k = e.target.closest("[data-k]")?.dataset.k;
  if (k) { state.prod = k; store.set("prod", k); renderProductos(); render(); return renderLima(); }
  const id = e.target.closest("[data-ir]")?.dataset.ir;
  if (id) irAGrifo(id, "dlg-lima");
});

function irAGrifo(id, dialogo) {
  $(dialogo)?.close();
  if (state.ruta) quitarRuta();
  if (location.hash === `#g=${encodeURIComponent(id)}`) abrirDesdeEnlace();
  else location.hash = `g=${encodeURIComponent(id)}`;
}

// --- Conversión a gas ---
function renderConversion() {
  const actual = $("cv-actual").value || "regular";
  const km = Number($("cv-km").value) || 0;
  const porKm = (k) => { const m = medianaLima(k); return m ? m / state.perfil[k].rend : null; };
  const base = porKm(actual);
  if (!base) { $("cv-res").innerHTML = ""; return; }
  $("cv-res").innerHTML = ["gnv", "glp"].map((k) => {
    const pk = porKm(k);
    if (!pk) return "";
    const ahorro = km * (base - pk), costo = Number($(`cv-${k}`).value) || 0;
    const meses = costo && ahorro > 0 ? costo / ahorro : null;
    return `<div class="kpi ancho"><b>${ahorro > 0 ? soles(ahorro) : "—"}</b><small>ahorro al mes con ${nombreDe(k)} (${soles(pk)}/km vs ${soles(base)}/km)${meses ? ` · recuperas la conversión en <b>${meses < 1 ? "menos de 1 mes" : `${meses.toFixed(1)} meses`}</b>` : costo ? "" : " · pon el costo de tu cotización para ver en cuánto la recuperas"}</small></div>`;
  }).join("") + `<p class="ayuda">Con la mediana de precios de Lima y tu rendimiento de cada combustible (Cuaderno → Mi auto). No incluye mantenimiento ni certificaciones del sistema a gas.</p>`;
}
$("cv-actual").innerHTML = PRODUCTOS.filter(([k]) => !["gnv", "glp"].includes(k)).map(([k, n]) => `<option value="${k}">${n}</option>`).join("");
["cv-actual", "cv-km", "cv-gnv", "cv-glp"].forEach((id) => $(id).addEventListener("input", renderConversion));
$("abrir-calc").addEventListener("click", renderConversion);

// --- Cuaderno ---
function mostrarTab(tab) {
  document.querySelectorAll("#dlg-cuaderno [role=tab]").forEach((b) => b.setAttribute("aria-selected", b.dataset.tab === tab));
  document.querySelectorAll("#dlg-cuaderno [data-panel]").forEach((p) => { p.hidden = p.dataset.panel !== tab; });
}
function abrirCuaderno(tab) {
  mostrarTab(tab);
  renderPerfil();
  renderJornada();
  renderMant();
  if (!$("dlg-cuaderno").open) $("dlg-cuaderno").showModal();
}
$("abrir-cuaderno").addEventListener("click", () => abrirCargas(null));
$("dlg-cuaderno").addEventListener("click", (e) => { const t = e.target.closest("[role=tab]")?.dataset.tab; if (t) mostrarTab(t); });
$("dlg-cuaderno").addEventListener("close", () => { render(); renderAvisos(); });

function kmActual() {
  const v = [...state.cargas.map((c) => c.km || 0), ...Object.values(state.jornadas).flatMap((j) => [j.ini || 0, j.fin || 0])];
  return Math.max(0, ...v);
}
function precioCombustible() {
  const ult = [...state.cargas].reverse().find((c) => c.prod === state.prod);
  return ult?.precio ?? medianaLima(state.prod) ?? 0;
}

function resumenDia(j) {
  const ingresos = j.carreras.reduce((s, c) => s + c.monto, 0);
  const km = j.ini && j.fin && j.fin > j.ini ? j.fin - j.ini : j.carreras.reduce((s, c) => s + (c.km || 0), 0);
  const combustible = (km / state.perfil[state.prod].rend) * precioCombustible();
  const ts = j.carreras.map((c) => Date.parse(c.t));
  const horas = ts.length > 1 ? (Math.max(...ts) - Math.min(...ts)) / 3600e3 : 0;
  return { n: j.carreras.length, ingresos, km, combustible, neto: ingresos - combustible, horas };
}

function renderJornada() {
  $("j-app").innerHTML = APPS.map((a) => `<button type="button" class="chip" data-app="${a}" aria-pressed="${a === state.jApp}">${a}</button>`).join("");
  const j = state.jornadas[hoyLocal()] || { carreras: [] };
  $("j-ini").value = j.ini || "";
  $("j-fin").value = j.fin || "";
  const r = resumenDia(j);
  $("j-resumen").innerHTML = r.n ? `<div class="kpis">
      <div class="kpi"><b>${soles(r.ingresos)}</b><small>${r.n} carrera${r.n === 1 ? "" : "s"} hoy</small></div>
      <div class="kpi"><b>${soles(r.combustible)}</b><small>combustible (${r.km.toFixed(0)} km)</small></div>
      <div class="kpi"><b class="${r.neto >= 0 ? "baja" : "sube"}">${soles(r.neto)}</b><small>te queda hoy</small></div>
      ${r.horas >= 1 ? `<div class="kpi"><b>${soles(r.neto / r.horas)}</b><small>por hora</small></div>` : ""}</div>
      <p class="ayuda">Combustible estimado con ${nombreDe(state.prod)} a ${soles(precioCombustible())} y ${state.perfil[state.prod].rend} km/${unidadDe(state.prod)}.${r.km ? "" : " Anota los km para que lo calcule."}</p>` : "";
  $("j-lista").innerHTML = j.carreras.slice().reverse().map((c) => `<li><span>${new Date(c.t).toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit" })} · ${esc(c.app)}${c.km ? ` · ${c.km} km` : ""}</span><b>${soles(c.monto)}</b><button type="button" class="mini" data-borrar-carrera="${c.t}" title="Borrar">✕</button></li>`).join("");
  const dias = Object.keys(state.jornadas).sort().reverse().filter((d) => d !== hoyLocal() && state.jornadas[d].carreras.length).slice(0, 7);
  $("j-semana").innerHTML = dias.length ? `<h3>Días anteriores</h3><table class="tabla"><tr><th>Día</th><th>Carreras</th><th>Cobrado</th><th>Te quedó</th></tr>${dias.map((d) => {
    const x = resumenDia(state.jornadas[d]);
    return `<tr><td>${fechaLarga(d)}</td><td>${x.n}</td><td>${soles(x.ingresos)}</td><td>${soles(x.neto)}</td></tr>`;
  }).join("")}</table>` : "";
}
function guardarJornadas() { store.set("jornadas", state.jornadas); renderJornada(); }
const jornadaHoy = () => (state.jornadas[hoyLocal()] ||= { carreras: [] });
$("j-app").addEventListener("click", (e) => { const a = e.target.closest("[data-app]")?.dataset.app; if (a) { state.jApp = a; store.set("jApp", a); renderJornada(); } });
$("j-agregar").addEventListener("click", () => {
  const monto = Number($("j-monto").value);
  if (!(monto > 0)) return toast("Pon cuánto cobraste");
  jornadaHoy().carreras.push({ t: new Date().toISOString(), monto, km: Number($("j-km").value) || null, app: state.jApp });
  $("j-monto").value = ""; $("j-km").value = "";
  guardarJornadas();
  toast(`✓ Carrera de ${soles(monto)} anotada`);
});
for (const id of ["j-ini", "j-fin"]) {
  $(id).addEventListener("change", (e) => { jornadaHoy()[id === "j-ini" ? "ini" : "fin"] = Number(e.target.value) || null; guardarJornadas(); });
}
$("j-lista").addEventListener("click", (e) => {
  const t = e.target.closest("[data-borrar-carrera]")?.dataset.borrarCarrera;
  if (!t || !confirm("¿Borrar esta carrera?")) return;
  const j = jornadaHoy();
  j.carreras = j.carreras.filter((c) => c.t !== t);
  guardarJornadas();
});
$("j-csv").addEventListener("click", () => {
  const filas = [["fecha", "hora", "app", "monto", "km"]];
  for (const [d, j] of Object.entries(state.jornadas).sort()) for (const c of j.carreras) {
    filas.push([d, new Date(c.t).toLocaleTimeString("es-PE"), c.app, c.monto, c.km ?? ""]);
  }
  descargarCSV(filas, "mis-carreras.csv");
});
function descargarCSV(filas, nombre) {
  const csv = filas.map((f) => f.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
  descargar(new Blob(["﻿" + csv], { type: "text/csv" }), nombre);
}
function descargar(blob, nombre) {
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: nombre });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// --- Mantenimiento ---
function diasHasta(fecha) { return Math.round((Date.parse(fecha + "T12:00:00") - Date.parse(hoyLocal() + "T12:00:00")) / 864e5); }
function estadoDoc(f) {
  if (!f) return "";
  const d = diasHasta(f);
  return d < 0 ? `<span class="sube">venció hace ${-d} días</span>` : d <= 15 ? `<span class="viejo">vence en ${d} días</span>` : `<span class="ayuda">en ${d} días</span>`;
}
function aceite() {
  const m = state.mant, km = kmActual();
  if (!m.aceiteUltimo || !km) return null;
  return m.aceiteUltimo + (m.aceiteCada || 5000) - km;
}
function renderMant() {
  const m = state.mant, falta = aceite(), km = kmActual();
  $("mant").innerHTML = `<div class="fila">
      <label>Aceite cada (km) <input type="number" inputmode="numeric" data-mant="aceiteCada" value="${m.aceiteCada || 5000}"></label>
      <label>Último cambio a los (km) <input type="number" inputmode="numeric" data-mant="aceiteUltimo" value="${m.aceiteUltimo || ""}" placeholder="${km || "odómetro"}"></label>
    </div>
    <p class="ayuda">${falta == null ? "Anota el último cambio y tus km en Cargas o Jornada para avisarte." : falta > 0 ? `🛢️ Faltan <b>${falta.toLocaleString("es-PE")} km</b> para el cambio de aceite (vas en ${km.toLocaleString("es-PE")} km).` : `🛢️ <b class="sube">Ya toca el cambio de aceite</b>: te pasaste ${(-falta).toLocaleString("es-PE")} km.`}</p>
    ${DOCS.map(([k, n]) => `<div class="fila doc"><label>${n} vence <input type="date" data-mant="${k}" value="${m[k] || ""}"></label>
      <span>${estadoDoc(m[k])}</span>${m[k] ? `<button type="button" class="mini" data-ics="${k}" title="Agregar recordatorio al calendario del teléfono">📅 Recordar</button>` : ""}</div>`).join("")}`;
}
$("mant").addEventListener("change", (e) => {
  const k = e.target.dataset.mant;
  if (!k) return;
  state.mant[k] = e.target.type === "date" ? e.target.value || null : Number(e.target.value) || null;
  store.set("mant", state.mant);
  renderMant();
});
$("mant").addEventListener("click", (e) => {
  const k = e.target.closest("[data-ics]")?.dataset.ics;
  if (!k) return;
  const n = DOCS.find((d) => d[0] === k)[1], f = state.mant[k].replaceAll("-", "");
  const ics = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Grifos Lima//ES", "BEGIN:VEVENT",
    `UID:${k}-${f}@grifos.debugsito.click`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, "").slice(0, 15)}Z`,
    `DTSTART;VALUE=DATE:${f}`, `SUMMARY:Vence ${n}`, `DESCRIPTION:Renueva ${n} a tiempo para evitar multas.`,
    "BEGIN:VALARM", "TRIGGER:-P7D", "ACTION:DISPLAY", `DESCRIPTION:En 7 días vence ${n}`, "END:VALARM",
    "BEGIN:VALARM", "TRIGGER:-P1D", "ACTION:DISPLAY", `DESCRIPTION:Mañana vence ${n}`, "END:VALARM",
    "END:VEVENT", "END:VCALENDAR"].join("\r\n");
  descargar(new Blob([ics], { type: "text/calendar" }), `vence-${k}.ics`);
});

function renderAvisos() {
  const avisos = [];
  const falta = aceite();
  if (falta != null && falta <= 500) avisos.push(falta > 0 ? `🛢️ Cambio de aceite en ${falta.toLocaleString("es-PE")} km` : "🛢️ Ya toca el cambio de aceite");
  for (const [k, n] of DOCS) {
    const f = state.mant[k];
    if (!f) continue;
    const d = diasHasta(f);
    if (d <= 15) avisos.push(d < 0 ? `📄 ${n}: venció hace ${-d} días` : d === 0 ? `📄 ${n} vence hoy` : `📄 ${n} vence en ${d} días`);
  }
  $("avisos").innerHTML = avisos.map((a) => `<button type="button" class="aviso" data-aviso>${a}</button>`).join("");
}
$("avisos").addEventListener("click", (e) => { if (e.target.closest("[data-aviso]")) { abrirCargas(null); mostrarTab("auto"); } });

// --- Ideas ---
function votante() {
  let v = store.get("votante", null);
  if (!v) { v = crypto.randomUUID?.() || [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, "0")).join(""); store.set("votante", v); }
  return v;
}
let ideas = [];
async function renderIdeas() {
  try {
    const [f, v] = await Promise.all([
      fetch("features.json", { cache: "no-cache" }).then((r) => r.json()),
      fetch(`${API}votos?v=${votante()}`).then((r) => (r.ok ? r.json() : { votos: {}, mios: [] })),
    ]);
    ideas = f.map((x) => ({ ...x, votos: v.votos[x.id] || 0, mio: v.mios.includes(x.id) }));
  } catch {
    ideas = ideas.length ? ideas : [];
  }
  ideas.sort((a, b) => b.votos - a.votos);
  $("ideas-lista").innerHTML = ideas.length ? ideas.map((x) => `<li><span><b>${esc(x.titulo)}</b><small>${esc(x.detalle)}</small></span>
      <button type="button" class="voto" data-voto="${esc(x.id)}" aria-pressed="${x.mio}">👍 <span>${x.votos}</span></button></li>`).join("")
    : "<li class='ayuda'>No pude cargar las ideas. Revisa tu conexión.</li>";
}
$("abrir-ideas").addEventListener("click", () => { renderIdeas(); $("dlg-ideas").showModal(); });
$("ideas-lista").addEventListener("click", async (e) => {
  const b = e.target.closest("[data-voto]");
  if (!b) return;
  b.disabled = true;
  try {
    const r = await fetch(`${API}votos`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: b.dataset.voto, v: votante() }) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error);
    const x = ideas.find((i) => i.id === j.id);
    Object.assign(x, { votos: j.votos, mio: j.votado });
    b.setAttribute("aria-pressed", j.votado);
    b.querySelector("span").textContent = j.votos;
    if (j.votado) toast("👍 Gracias por tu voto");
  } catch (err) {
    toast(err.message || "No se pudo votar ahora");
  } finally {
    b.disabled = false;
  }
});
$("idea-enviar").addEventListener("click", async () => {
  const texto = $("idea-texto").value.trim();
  if (texto.length < 8) return toast("Cuéntanos un poco más");
  $("idea-enviar").disabled = true;
  try {
    const r = await fetch(`${API}sugerencias`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texto, contacto: $("idea-contacto").value.trim(), web: $("idea-web").value, v: votante() }) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error);
    $("idea-texto").value = "";
    toast("💡 ¡Gracias! Tu idea llegó");
  } catch (err) {
    toast(err.message || "No se pudo enviar ahora");
  } finally {
    $("idea-enviar").disabled = false;
  }
});

// --- Top 5 para compartir ---
function zonaActual() {
  if (state.ruta) return `en tu ruta a ${state.ruta.nombre}`;
  if (state.radio === 0) return "en todo Lima";
  const cerca = grifos.reduce((a, g) => (!a || g.dist < a.dist ? g : a), null);
  return `a ${state.radio} km de ${cerca?.distrito || "tu ubicación"}`;
}
function recortar(ctx, txt, max) {
  if (ctx.measureText(txt).width <= max) return txt;
  while (txt.length > 3 && ctx.measureText(txt + "…").width > max) txt = txt.slice(0, -1);
  return txt + "…";
}
async function compartirTop5() {
  const k = state.prod, u = unidadDe(k);
  const top = [...visibles].sort((a, b) => a.precios[k].p - b.precios[k].p || a.dist - b.dist).slice(0, 5);
  if (!top.length) return toast("No hay grifos para compartir");
  const W = 1080, H = 1350, c = Object.assign(document.createElement("canvas"), { width: W, height: H }), ctx = c.getContext("2d");
  const fuente = (peso, px) => `${peso} ${px}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  const fondo = ctx.createLinearGradient(0, 0, W, H);
  fondo.addColorStop(0, "#0b1a3a"); fondo.addColorStop(1, "#0e1116");
  ctx.fillStyle = fondo; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#fff"; ctx.font = fuente(800, 68);
  ctx.fillText(`⛽ Top 5 ${nombreDe(k)} más barato`, 64, 130);
  ctx.fillStyle = "#98a2b3"; ctx.font = fuente(500, 36);
  ctx.fillText(recortar(ctx, `${zonaActual()} · ${new Date().toLocaleDateString("es-PE", { weekday: "long", day: "numeric", month: "long" })}`, W - 128), 64, 190);
  top.forEach((g, i) => {
    const y = 250 + i * 196, pr = g.precios[k];
    ctx.fillStyle = i === 0 ? "#12361f" : "#171b23";
    ctx.beginPath(); ctx.roundRect(48, y, W - 96, 172, 28); ctx.fill();
    ctx.fillStyle = i === 0 ? "#4ade80" : "#78a9ff"; ctx.font = fuente(800, 54);
    ctx.fillText(`${i + 1}`, 84, y + 104);
    ctx.fillStyle = "#fff"; ctx.font = fuente(700, 42);
    ctx.fillText(recortar(ctx, titulo(g), 560), 160, y + 74);
    ctx.fillStyle = COLORES[g.marca] || "#9aa3b2";
    ctx.font = fuente(700, 28);
    const mw = ctx.measureText(g.marca).width + 32;
    ctx.beginPath(); ctx.roundRect(160, y + 100, mw, 44, 22); ctx.fill();
    ctx.fillStyle = "#fff"; ctx.fillText(g.marca, 176, y + 132);
    ctx.fillStyle = "#98a2b3"; ctx.font = fuente(500, 30);
    const dd = diasDesde(pr.f);
    ctx.fillText(recortar(ctx, `${g.distrito} · ${state.ruta ? `desvío ${g.desvio.toFixed(1)} km` : `${g.dist.toFixed(1)} km`} · ${dd <= 0 ? "hoy" : dd === 1 ? "ayer" : `hace ${dd} d`}`, 600 - mw), 176 + mw, y + 132);
    ctx.textAlign = "right";
    ctx.fillStyle = i === 0 ? "#4ade80" : "#fff"; ctx.font = fuente(800, 64);
    ctx.fillText(`S/ ${pr.p.toFixed(2)}`, W - 84, y + 100);
    ctx.fillStyle = "#98a2b3"; ctx.font = fuente(500, 28);
    ctx.fillText(`por ${u}`, W - 84, y + 140);
    ctx.textAlign = "left";
  });
  ctx.fillStyle = "#98a2b3"; ctx.font = fuente(500, 30);
  ctx.fillText("Precios reportados a Osinergmin", 64, H - 92);
  ctx.fillStyle = "#78a9ff"; ctx.font = fuente(700, 36);
  ctx.fillText("grifos.debugsito.click", 64, H - 44);

  const texto = `⛽ Top 5 ${nombreDe(k)} más barato ${zonaActual()}:\n` +
    top.map((g, i) => `${i + 1}. ${soles(g.precios[k].p)} – ${titulo(g)} (${g.marca}, ${g.distrito})`).join("\n") +
    `\nMira el mapa: ${location.origin}${location.pathname}`;
  const blob = await new Promise((r) => c.toBlob(r, "image/png"));
  const file = new File([blob], `top5-${k}.png`, { type: "image/png" });
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], text: texto }); } catch { /* cancelado */ }
  } else {
    descargar(blob, file.name);
    try { await navigator.clipboard.writeText(texto); toast("Imagen descargada y texto copiado"); } catch { toast("Imagen descargada"); }
  }
}
$("resumen").addEventListener("click", (e) => { if (e.target.closest("#top5")) compartirTop5(); });

// --- Presupuesto ---
function renderPresupuesto() {
  const presu = store.get("presupuesto", null);
  $("r-presu").value = presu || "";
  if (!presu) { $("r-presu-res").innerHTML = ""; return; }
  const ahora = new Date(), dia = ahora.getDate(), diasMes = new Date(ahora.getFullYear(), ahora.getMonth() + 1, 0).getDate();
  const gastado = state.cargas.filter((c) => { const d = new Date(c.t); return d.getMonth() === ahora.getMonth() && d.getFullYear() === ahora.getFullYear(); })
    .reduce((s, c) => s + c.soles, 0);
  const proy = (gastado / dia) * diasMes, pct = Math.min(100, (gastado / presu) * 100);
  const cls = gastado > presu ? "sube" : proy > presu ? "viejo" : "baja";
  $("r-presu-res").innerHTML = `<div class="progreso"><i class="${cls}" style="width:${pct}%"></i></div>
    <p class="ayuda">${soles(gastado)} de ${soles(presu)} · ${gastado > presu ? `<b class="sube">te pasaste ${soles(gastado - presu)}</b>`
      : `te quedan <b>${soles(presu - gastado)}</b> para ${diasMes - dia} días`}${dia >= 3 && gastado ? ` · a este ritmo cerrarías el mes en <b class="${cls}">${soles(proy)}</b>` : ""}</p>`;
}
$("r-presu").addEventListener("change", (e) => { store.set("presupuesto", Number(e.target.value) || null); renderPresupuesto(); });

// --- Respaldo ---
const RESPALDO = ["cargas", "jornadas", "mant", "perfil", "favs", "lugares", "recientes", "presupuesto", "prod", "votante", "ocultarMala"];
$("respaldo").addEventListener("click", () => {
  const datos = Object.fromEntries(RESPALDO.map((k) => [k, store.get(k, null)]));
  descargar(new Blob([JSON.stringify({ app: "grifos-lima", version: 1, fecha: new Date().toISOString(), datos }, null, 1)], { type: "application/json" }),
    `grifos-respaldo-${hoyLocal()}.json`);
  toast("💾 Respaldo descargado: guárdalo o mándatelo por WhatsApp");
});
$("restaurar").addEventListener("click", () => $("restaurar-archivo").click());
$("restaurar-archivo").addEventListener("change", async (e) => {
  const f = e.target.files[0];
  e.target.value = "";
  if (!f) return;
  try {
    const j = JSON.parse(await f.text());
    if (j.app !== "grifos-lima" || typeof j.datos !== "object") throw new Error();
    if (!confirm(`¿Reemplazar lo que hay en este teléfono con el respaldo del ${new Date(j.fecha).toLocaleDateString("es-PE")}?`)) return;
    for (const k of RESPALDO) if (j.datos[k] != null) store.set(k, j.datos[k]);
    location.reload();
  } catch {
    toast("Ese archivo no es un respaldo de Grifos Lima");
  }
});
$("cambiar-vehiculo").addEventListener("click", () => { $("dlg-cuaderno").close(); abrirInicio(); });
