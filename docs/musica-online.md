# Música con YouTube

En **Música**, elige **YouTube** o **Mis archivos**. Al cambiar de origen se pausa la música local.

## YouTube

Puedes pegar un enlace de vídeo y reproducirlo inmediatamente con el reproductor oficial, sin descargarlo ni configurar una clave. Si el navegador bloquea el inicio automático, pulsa Play dentro del vídeo. Si el propietario no permite incrustarlo, usa su enlace de YouTube.

Para buscar desde el panel:

1. Activa **YouTube Data API v3** en un proyecto de [Google Cloud](https://console.cloud.google.com/apis/library/youtube.googleapis.com).
2. Crea una clave de API y guárdala en **Configurar YouTube**. Puedes restringirla a esa API; la búsqueda sale desde el servidor local, no desde una web con referente HTTP.
3. Busca por texto o usa **Épica**, **Electrónica** y **Ambiente**. Los resultados muestran autor, enlace original y botón de reproducción. Los términos «no copyright» son búsquedas, no una verificación de licencia.

El vídeo suena en el navegador del panel. Mantén esa pestaña abierta y captura su audio en OBS. **Parar YouTube** detiene el reproductor; seleccionar otro origen también lo detiene. Los cambios de sección del panel mantienen el vídeo. No se instala una fuente de navegador adicional en OBS.

Las búsquedas repetidas se reutilizan durante cinco minutos para ahorrar cuota. Si la API rechaza la clave o se agota la cuota, puedes seguir pegando enlaces.

## Datos y validación

La llamada a YouTube y la lectura de títulos se han adaptado de `IdealFlow/src/lib/youtube.ts`. Se conservan sus mensajes diferenciados para cuota agotada y clave inválida; el buscador de música no aplica el filtro de expertos de Idealflow, que excluía canales musicales. La configuración de YouTube de este PC ya se ha importado a la base de datos local y se ha comprobado con una búsqueda real. No hace falta volver a copiar la clave ni mantener Idealflow abierto. Ambos proyectos comparten la cuota del proyecto de Google mientras usen esa misma clave.

La clave se guarda en la base de datos local, en `musica_online`. El navegador solo recibe el estado de configuración.

Referencias: [búsqueda de YouTube](https://developers.google.com/youtube/v3/docs/search/list), [reproductor incrustado](https://developers.google.com/youtube/player_parameters).
