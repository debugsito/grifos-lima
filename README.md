# Grifos Lima

Mapa de precios de combustible en Lima Metropolitana y Callao: grifos cercanos, filtro por
marca y por combustible (Regular, Premium, Diésel, GLP, GNV). Publicado en
https://grifos.debugsito.click.

## Qué hace

- **Más conviene**: ordena por ahorro neto frente al grifo más cercano, con la carga y el
  rendimiento del auto, descontando el combustible del desvío (línea recta × 1.3).
- **Ruta**: con un destino (búsqueda en Nominatim o toque en el mapa) traza la ruta con OSRM,
  toma los grifos a menos de 2.5 km del camino y confirma con OSRM el desvío real de los mejores.
- **Tendencia y Lima hoy**: mediana diaria de Lima de 60 días, grifos que bajaron esta semana,
  distritos y marcas más baratos, y en cada grifo su gráfico de precio de 60 días.
- **Top 5**: imagen 1080×1350 con los cinco más baratos de la zona o la ruta, para WhatsApp.
- **Calcular**: soles → cantidad, combustible de una carrera, costo por km de cada combustible y
  ahorro mensual de convertir a GNV o GLP.
- **Cuaderno** (se guarda en el navegador):
  - **Cargas**: gasto del mes, rendimiento real con el kilometraje y exportación a CSV.
  - **Jornada**: carreras por app, combustible estimado y lo que queda por día y por hora.
  - **Mi auto**: rendimiento y carga por combustible, y cambio de aceite y vencimientos de SOAT,
    revisión técnica, certificación GNV/GLP y brevete, con avisos y recordatorio `.ics`.
- **Ideas**: votación de features (`web/features.json`) y sugerencias libres, guardadas por la
  API en el servidor. `deploy/sugerencias.sh` las muestra.
- **Favoritos**, **compartir** (enlace `#g=<id>`) e instalación como app (PWA, funciona sin
  conexión con los últimos datos).
- **Listas de My Maps**: los mapas de `mapas/fuentes.txt` (URL de exportación KML, se bajan en
  cada build) y los KML/KMZ que se dejen en `mapas/` se cruzan con los grifos (a menos de 150 m,
  o hasta 600 m si coincide la calle) y aparecen como filtro «Lista». Viene con la lista de
  estaciones Repsol Más.

## Uso

```bash
python3 build.py                              # genera web/data/grifos.json
python3 -m http.server 8765 -d web            # abre http://localhost:8765
```

Solo usa la librería estándar de Python. La primera corrida tarda unos minutos: lee en
streaming ~2.4 GB de CSV de Osinergmin y geocodifica a 1 consulta por segundo los grifos que
no están en OpenStreetMap. Las siguientes reutilizan `cache/` y solo vuelven a descargar
precios si Osinergmin publicó un archivo nuevo (compara `Last-Modified`).

| Opción | Efecto |
|---|---|
| `--force` | vuelve a descargar los precios aunque no hayan cambiado |
| `--force-osm` | vuelve a consultar OpenStreetMap (por defecto se refresca cada 7 días) |
| `--no-geocode` | no usa Nominatim; los grifos sin match en OSM quedan fuera del mapa |
| `--mapas DIR` | carpeta de KML/KMZ a cruzar (por defecto `mapas/`) |

## Publicación

El servidor `debugsito` solo sirve archivos: el contenedor `grifos` (`deploy/compose.yml`)
detrás del Caddy de `~/inventario`, más `grifos-api` (Python estándar, votos y sugerencias en
`~/grifos/api-data`). `publicar.sh` agrega `?v=<hash>` a los `.js` y `.css` porque Cloudflare les
fija su propio `max-age`. El build corre en esta máquina con el timer de usuario
`grifos-publicar.timer` (13:30 y 19:30, hora de Lima; si la máquina estaba apagada, corre al
encender), que ejecuta `deploy/publicar.sh`: `build.py` y `rsync` de `web/`.

```bash
deploy/publicar.sh                              # publicar a mano
systemctl --user list-timers grifos-publicar.timer
journalctl --user -u grifos-publicar -n 50
deploy/sugerencias.sh                           # ideas y votos de los usuarios
```

## Fuentes

- **Precios**: reporte diario del SCOP de Osinergmin, publicado en la Plataforma Nacional de
  Datos Abiertos. Trae cada cambio de precio del año por establecimiento; se toma el último
  por grifo y producto. Se actualiza cada mañana con lo reportado hasta la noche anterior.
  - `CL-Registro-precios-DMA-V-CCA-CCE.csv`: gasoholes, diésel y GNV.
  - `GLP-Registro-precios-PIC-PE-V.csv`: GLP vehicular («GLP - G», usuario final, por galón).
- **Ubicación y marca**: grifos (`amenity=fuel`) de OpenStreetMap vía Overpass, con su
  distrito y las calles a menos de 70 m.

Osinergmin no publica coordenadas ni marca, así que se cruzan ambas fuentes por distrito y
nombre de calle (incluida la esquina), número y marca deducida de la razón social. Los grifos
que no se encuentran en OSM se ubican con Nominatim a nivel de calle y se marcan como
«ubicación aproximada».

## Limitaciones

- La marca sale de OSM o de la razón social (Repsol Comercial, Coesti → Primax, etc.); un
  franquiciado que no está etiquetado en OSM aparece como «Otra».
- Un grifo que dejó de reportar conserva su último precio; la app oculta por defecto los
  precios de más de 15 días.
