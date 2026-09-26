# DOCUMENTO 7 — Efectos del chat con Channel Points

**Fecha:** 24 de septiembre de 2026.
**Qué es:** guía paso a paso para montar en Streamer.bot los efectos que el chat
lanza con puntos de canal. Nada de esto necesita nuestro código: vive entero en
Streamer.bot y OBS.

---

## 1. La moneda: Oros 🪙

| | Propuesta |
|---|---|
| Nombre | **Oros** (Twitch pide 4 letras como mínimo; "Oro" no cabía) |
| Icono | Una moneda de oro, estilo pixel o icono de MMO |
| Por qué | Todo el que juega a un MMO lo entiende sin explicación. "Gastar 500 de oro en maldecir al streamer" se lee solo. |

Las esferas del dragón no encajan con un canal de MMO, y además apuntan a una
franquicia concreta que no es la tuya.

Dónde se cambia: **Panel de creador → Comunidad → Puntos de canal → Configuración**.
Twitch pide el icono en PNG con fondo transparente en tres tamaños:
**18×18, 36×36 y 72×72**.

Alternativas si Oro te suena demasiado genérico: **Maná** 💧, **Fragmentos** 💎, **Esencia** ✨.

---

## 2. Precios

Un espectador gana de media **unos 300 puntos por hora** (lo que da Twitch por
tiempo viendo más el cofre que hay que reclamar). Con pocos espectadores,
**lo barato tiene que estar al alcance en la primera hora**, o nadie lo usará.

| Nivel | Coste | Para qué |
|---|---:|---|
| Barato | 500 – 750 | Algo que se usa una vez por directo |
| Medio | 1.500 – 2.500 | Algo que se ahorra durante un par de directos |
| Caro | 3.000 – 5.000 | Algo especial, de vez en cuando |

**Revisado el 25 sep 2026:** los precios de arranque (300-1.500) invitaban al
spam. Lo que de verdad lo frena son los límites de Twitch: tiempo de espera,
máximo por directo y máximo por persona y directo. El precio decide lo especial
que se siente cada canje.

---

## 3. Los efectos

Los tres primeros funcionan con **OBS tal cual, sin plugins**. Los dos últimos
necesitan un plugin gratuito.

| # | Recompensa | Coste | Cooldown | Qué pasa | Necesita |
|---|---|---:|---|---|---|
| 1 | **Grito de guerra** | 750 | 10 min · máx. 4 por directo, 1 por persona | Suena un sonido | Nada |
| 2 | **Poción de vida** | 500 | 10 min · máx. 2 por persona | Aparece "¡Bebe agua!" 5 s en pantalla | Nada |
| 3 | **Maldición** | 2.500 | 20 min · máx. 2 por directo, 1 por persona | La pantalla se queda en blanco y negro 10 s | Nada |
| 4 | **Terremoto** | 3.000 | 20 min · máx. 2 por directo, 1 por persona | La cámara tiembla 5 s | Plugin *Move* |
| 5 | **Lag** | 5.000 | 30 min · máx. 1 por directo | La imagen se congela 5 s | Plugin *Freeze Filter* |
| — | **Cofre del tesoro** | 1.500 | 5 min · máx. 2 por persona | Abre un cofre del Loot | Nada (lo abre el bot) |

Los plugins 4 y 5 son de Exeldro, gratuitos y de uso muy extendido. Déjalos para
cuando los tres primeros funcionen.

---

## 4. Regla importante: crea las recompensas DESDE Streamer.bot

Twitch solo deja que una aplicación active, desactive o modifique **las
recompensas que ha creado esa misma aplicación**. Si las creas en el panel de
Twitch, Streamer.bot las puede leer pero no tocar.

Si las creas desde Streamer.bot, más adelante podrás hacer cosas como
desactivarlas todas al pulsar `!apagar`, o esconderlas cuando no estés en directo.

---

## 5. Paso a paso: el primero, entero

Los nombres de menú son los de Streamer.bot v1.0.x. Si alguno no coincide
exactamente, el menú de clic derecho está ordenado por categorías y se encuentra
rápido.

### 5.1 Crear la recompensa

1. **Platforms → Twitch → Channel Point Rewards.**
2. Clic derecho en la lista → **Add**.
3. Rellena:
   - Title: `Grito de guerra`
   - Cost: `300`
   - Global cooldown: `60` segundos
   - Marca **Skip reward queue**. Así la recompensa se da por cumplida sola y no
     se te acumulan canjes pendientes.
   - Marca **Enabled**.
4. Guarda. Comprueba en tu canal de Twitch que aparece.

### 5.2 Crear la acción

1. Pestaña **Actions**.
2. Clic derecho en la lista de acciones → **Add**. Nombre: `Efecto - Grito de guerra`.
   Crea también un grupo `Efectos` para tenerlas juntas.
3. En **Triggers** (abajo a la izquierda): clic derecho → **Twitch → Channel Reward
   → Reward Redemption**, y elige `Grito de guerra`.
4. En **Sub-Actions** (abajo a la derecha): clic derecho → **Core → Sounds → Play
   Sound**. El archivo es `biblioteca/sonidos/grito-de-guerra.wav`: en la pestaña
   **Biblioteca** del panel tienes el botón **Copiar ruta**. Ajusta el volumen.
5. Opcional, otro sub-action: **Twitch → Chat → Send Message to Channel** con el
   texto `%user% lanza un grito de guerra ⚔️`.

### 5.3 Probarla sin gastar puntos

Clic derecho en la acción → **Test**. Si suena, ya está. Después pruébala de
verdad canjeándola desde tu canal.

---

## 6. El resto de efectos

La recompensa se crea igual que en 5.1 en todos los casos. Solo cambian los
sub-actions.

Todos llevan su sonido en `biblioteca/sonidos/` (se generan con `npm run
sonidos`). Pon el **Play Sound** como primer sub-action, antes que lo visual.

### 6.1 Poción de vida

**En OBS, una vez:**
1. En la escena del juego, añade una fuente **Navegador**. Llámala `FX Pocion`.
2. Marca **Archivo local** y elige `biblioteca/overlays/pocion.html`. Ancho
   `1920`, alto `1080`.
3. Marca **Apagar la fuente cuando no esté visible**. Así la animación empieza
   de cero cada vez que aparece.
4. **Ocúltala** (el icono del ojo).

El overlay dura 5 segundos, lo mismo que el Delay. Si le añades `?user=Nombre`
al final de la ruta, pone "Cortesía de Nombre".

**Sub-actions:**
1. **Core → Sounds → Play Sound** → `pocion.wav`.
2. **OBS → Sources → Set Source Visibility** → escena del juego, `FX Pocion`, **Visible**.
3. **Core → Delay** → `5000` ms.
4. **OBS → Sources → Set Source Visibility** → `FX Pocion`, **Hidden**.

### 6.2 Maldición

**En OBS, una vez:**
1. Clic derecho en la **fuente del juego** (no en la escena) → **Filtros**.
2. Añade **Corrección de color**. Llámalo `FX Maldicion`. Pon **Saturación a -1**.
3. **Desactívalo** (el icono del ojo junto al filtro).

**Sub-actions:**
1. **OBS → Filters → Set Filter State** → fuente del juego, `FX Maldicion`, **Enabled**.
2. **Core → Delay** → `10000` ms.
3. **OBS → Filters → Set Filter State** → `FX Maldicion`, **Disabled**.
4. Opcional: **Send Message to Channel** → `%user% ha maldecido al streamer 💀`.

Si en vez de la fuente del juego pones el filtro en la escena entera, se
maldice todo, cámara incluida. Queda más gracioso.

### 6.3 Terremoto *(plugin Move)*

Con el plugin **Move** instalado, se añade a la fuente de la cámara un filtro
**Move Value** que oscile la posición, y se activa y desactiva como en 6.2 con
un Delay de 5 s. Lo detallo cuando llegues aquí; depende de la versión del plugin.

### 6.4 Lag *(plugin Freeze Filter)*

Con **Freeze Filter** instalado, se añade el filtro **Freeze** a la fuente del
juego, y se activa y desactiva como en 6.2 con un Delay de 5 s.

---

## 7. Una comprobación que conviene hacer

**Canjea dos efectos a la vez.** Si "Maldición" está activa y alguien lanza otra
"Maldición", el primer temporizador la apagará antes de tiempo. El cooldown
global de 5 minutos ya lo evita, pero si algún día lo bajas, activa en la acción
**Queue → una cola bloqueante** para que los canjes se ejecuten uno detrás de otro.

---

## 8. Relación con nuestro bot

Ninguna, y es a propósito. El bot solo reacciona a la recompensa de `#5 Pregunta
a Crid4m AI` e ignora las demás. Si el bot se cae, los efectos siguen funcionando.
