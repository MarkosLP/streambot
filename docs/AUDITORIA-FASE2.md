# Auditoría: fase 2

Trabajo en `codex-fase2`. Las verificaciones usan SQLite en memoria, transportes falsos y un navegador exclusivo. No se ha arrancado el bot, usado el panel 7070, conectado a OBS real ni llamado a IA de pago.

## Arreglos

| Punto | Cambio | Commit |
| --- | --- | --- |
| 4 | La retirada del jefe anterior no oculta al siguiente | `14f21ed` |
| 5 | Chat conserva nodos, nueve mensajes y su caducidad | `fcb6fda` |
| 1 | Tiempo máximo por petición OBS y cancelación del trabajo | `2cbee08` |
| 3 | Lectura pública de música separada de reportes autenticados | `e133128` |
| 2 | Validación inconcluyente del avatar conserva la base | `4db33a1` |
| 6 | Una reserva idéntica a la base no cuenta como reparación | `bdc8e47` |
| 7 | Fundido limitado a la máscara y respetando transparencia | `0aaf5a2` |
| 8 | Carga completa del retrato, recuperación y actualización | `df67a9a` |
| 9 | Confirmación de máximos reales de imágenes y avisos de costes | `7e3a264` |
| 10 | Vista del rotativo proporcional en panel estrecho | `9e20861` |
| 12 | Consultas sin solapamiento, con timeout y cancelación | `c321404` |
| 13 | Colas y memoria acotadas, caducidad y reinicio de sesión | `12f4ef0` |
| 14 | Pestañas accesibles con flechas/Home/End y textos precisos | `807f01e` |
| 11 | Retirados desenfoques y mezcla screen de los overlays | `05adc70` |

Se conservan también las correcciones intermedias de heartbeat y persistencia de credencial de música y la importación de Terremoto.

## Prototipo de parpadeo local

En **Escenas → Avatar → Calibrar parpadeo local · gratis**:

1. Seleccionar el personaje. Marcar las dos esquinas de cada ojo de izquierda a derecha, según se ve la imagen. También se pueden añadir y ajustar por teclado con coordenadas porcentuales.
2. Ajustar la altura si la almendra no cubre el ojo. Calcular las vistas localmente.
3. Revisar **Abierto**, **Medio** y **Cerrado**. Cada vista queda congelada. Cambiar esquinas o altura anula la revisión.
4. Marcar la revisión y pulsar **Guardar y activar**. Se guarda en SQLite; no se editan imágenes ni archivos de calibración a mano. **Desactivar local** vuelve a las variantes anteriores disponibles.

El algoritmo copia piel/escamas próximas de la propia base y comprime la abertura del ojo. Solo modifica RGB dentro de las dos almendras; conserva exactamente el exterior y el canal alfa. No genera sonrisas. Es un prototipo: una esquina o altura mal calibrada puede dejar restos del iris o un párpado poco natural, por eso se exige revisar los tres estados.

La calibración se vincula al SHA-256 de la base. Si cambia la imagen o se corrompen los datos, las variantes locales vuelven a la base, sin reactivar automáticamente las antiguas. Si falta la base, el overlay conserva el último retrato cargado. Las cachés tienen límite de ocho entradas.

Probado primero con **Chico de pelo negro** (`oscuro-2026-09-27T09-12-36`) y **Magmarex** (`oscuro-2026-09-27T17-18-25`). Las esquinas se introdujeron mediante clics en el panel de prueba; la activación de estas pruebas vive solo en SQLite en memoria. No se ha activado nada en el bot real. Los JSON exportados junto a las capturas documentan las coordenadas revisadas, no son archivos de configuración que haya que editar.

## Evidencia y repetición

- `npm run check`: TypeScript correcto y 573 pruebas aprobadas.
- `node --import tsx scripts/pruebas-visuales.mjs 10`: anchuras 390, 768 y 1366; sin desbordamiento, escala correcta.
- `node --import tsx scripts/pruebas-visuales.mjs 14`: teclado real en navegador, anchuras 390 y 1366.
- `node --import tsx scripts/pruebas-visuales.mjs 11-antes` / `11`: capturas de escena, avatar y jefe; comprobación de ausencia de blur/backdrop-filter/mix-blend-mode. El modo antes solo sirve para ejecutar sobre la revisión anterior.
- `node --import tsx scripts/pruebas-visuales.mjs avatar`: clics de calibración, vistas congeladas, revisión obligatoria, invalidación al editar, persistencia, integración del overlay y panel estrecho.

El script bloquea solicitudes externas, usa puertos efímeros y cierra su navegador y servidor. Requiere Edge local (`EDGE_BIN` permite indicar otra ubicación). Las pruebas de raster cubren conservación del exterior/alfa, límites, datos inválidos, revisión, cambio de base y reserva segura; las HTTP cubren protección de escritura y rutas inválidas.

Capturas: `D:\Descargas\StreamerBotApi-fase2-capturas`. Baselines: `jefe*.png`, `charla.png`, `avatar.png`, `escenas-*.png`, `overlays-*.png`, `loot-*.png`. Resultados por punto: `04-`, `05-`, `08-`, `09-`, `10-`, `11-`, `14-`; el prototipo tiene `avatar-chico-*`, `avatar-magmarex-*` y `avatar-herramienta-390-despues.png`.

Estas comprobaciones no miden FPS, GPU ni consumo del OBS real. La tipografía puede usar la alternativa local porque el navegador de prueba bloquea recursos externos. No se han probado todas las combinaciones posibles de jefes y estilos ni eventos reales de Twitch.
