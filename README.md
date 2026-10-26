# Grifos Lima

Mapa de precios de combustible en Lima Metropolitana y Callao: grifos cercanos, filtro por
marca y por combustible (Regular, Premium, Diésel, GLP, GNV). Publicado en
https://grifos.debugsito.click.

## Qué hace

- **Más conviene**: ordena por ahorro neto frente al grifo más cercano, con la carga y el
  rendimiento de «Mi auto», descontando el combustible de ir y volver a la ruta (distancia en
  línea recta × 1.3).
- **Tendencia**: mediana diaria de Lima de los últimos 60 días y cambio de precio por grifo.
- **Calcular**: soles → cantidad, combustible de una carrera, costo por km de cada combustible.
- **Mis cargas**: registro de cargas, gasto del mes, rendimiento real si se anota el
  kilometraje y exportación a CSV. Se guarda en el navegador.
- **Favoritos**, **compartir** (WhatsApp o el menú del teléfono, con enlace `#g=<id>`) e
  instalación como app (PWA, funciona sin conexión con los últimos datos).
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
detrás del Caddy de `~/inventario`. El build corre en esta máquina con el timer de usuario
`grifos-publicar.timer` (13:30 y 19:30, hora de Lima; si la máquina estaba apagada, corre al
encender), que ejecuta `deploy/publicar.sh`: `build.py` y `rsync` de `web/`.

```bash
deploy/publicar.sh                              # publicar a mano
systemctl --user list-timers grifos-publicar.timer
journalctl --user -u grifos-publicar -n 50
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
