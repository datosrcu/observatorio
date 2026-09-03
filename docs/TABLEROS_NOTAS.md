# Notas técnicas — Tableros

Este archivo junta problemas conocidos y decisiones no obvias relacionadas con la construcción/embebido de tableros, que no son de seguridad (para eso ver `SECURITY_POLICY.md` y `SECURITY_LOG.md`), pero conviene tener documentadas para no volver a perder tiempo investigándolas.

---

## Data Studio no muestra componentes de "URL embebida" cuando el reporte se embebe en otro sitio

**Detectado**: 2026-09-02, tablero "Matriz de Pagos en Cuotas".

Google restringe explícitamente el **embebido recursivo** en Data Studio (ex Looker Studio): cuando un reporte que contiene un componente de **"URL embebida"** (un gráfico o visualización que en realidad es una página externa incrustada dentro del reporte) se muestra, a su vez, dentro de otro iframe — como hace el Observatorio para mostrar los tableros — **ese componente interno no se renderiza**. Queda en blanco o como un ícono de imagen rota, aunque el resto del reporte cargue con normalidad.

No es un error de configuración ni algo que se pueda "habilitar" desde ningún lado — es un comportamiento intencional de Google para evitar embebidos recursivos, documentado acá: [Embed external content in reports — Looker Studio / Data Studio](https://support.google.com/looker-studio/answer/9132022?hl=en).

Esto afecta a **cualquier** reporte armado con este tipo de componente, no solo al que lo destapó — cada vez que uno de estos reportes se embeba dentro de otro sitio (el Observatorio o cualquier otro), el gráfico de URL embebida no va a cargar.

**Caso en el que se detectó**: el reporte de Data Studio cargaba bien (título, barra lateral, diseño), pero el gráfico principal, armado como componente de URL embebida apuntando a una página externa en GitHub Pages, aparecía vacío.

**Solución aplicada en ese caso**: se configuró ese tablero puntual para que se **abra en una pestaña nueva** en vez de mostrarse embebido dentro del modal del Observatorio. Al abrirse como página de nivel superior (sin quedar anidado dentro de otro iframe), el componente carga con normalidad.

**Qué tener en cuenta a futuro**: si un reporte necesita verse **embebido** dentro del Observatorio (no en pestaña aparte), no puede depender de un componente de "URL embebida" — hay que recrear esa visualización con un tipo de gráfico nativo de Data Studio. Si el reporte va a abrirse siempre en pestaña nueva, el componente de URL embebida funciona sin problema y no hace falta cambiar nada.

---

## Google renombró Looker Studio de nuevo a "Data Studio" (abril 2026)

En abril de 2026 Google revirtió el nombre de Looker Studio a Data Studio. `lookerstudio.google.com` ahora redirige a `datastudio.google.com` — este último es el dominio vigente hoy. Si en algún momento se ve código o documentación vieja que arma URLs sobre `lookerstudio.google.com`, no está "mal" (el redirect funciona), pero conviene actualizarlo al dominio actual si se toca esa parte.

`auth.js` tiene una función (`ogbFixLookerUrl`) que corrige automáticamente URLs de reporte a formato embebido (`/reporting/` → `/embed/reporting/`) — reconoce el hostname `lookerstudio.google.com`. Si se decide soportar explícitamente el dominio nuevo (`datastudio.google.com`) en esa misma función, hacerlo ahí.

**Para insertar cualquier reporte de Data Studio como tablero**: el link normal de "Compartir" no alcanza — Google bloquea el embebido por defecto (`frame-ancestors 'none'` o `'self'`, según el caso) salvo que se habilite explícitamente. Pasos: abrir el reporte → Archivo → **Insertar informe** → tildar **"Habilitar la inserción"** → usar el link que aparece ahí (no el de compartir).

---

## Persistencia acumulativa de `allowed_users` y `access_expirations` en tableros e informes

**Corregido**: 2026-09-03, endpoints `/api/solicitudes/:id/aprobar` y `PATCH /api/tableros/:id`.

- **Problema previo**: En MySQL la columna es de tipo `JSON`, por lo que el driver `mysql2` devuelve directamente un `Array` u `Object` de JavaScript. En el endpoint de aprobación de solicitudes se intentaba hacer `(tablero.allowed_users || '').trim()`, lo cual causaba una excepción `TypeError: .trim is not a function`, cayendo en el `catch` y reseteando `allowed = []`. Cada nueva aprobación borraba a los usuarios previamente autorizados para ese tablero o informe.
- **Solución implementada**: Lectura tolerante a tipos (`Array`/`Object` nativos y strings JSON) en `server.js`. La lista de usuarios autorizados ahora es acumulativa y preserva intactos a todos los autorizados previos.
- **Sincronización en el panel de administración**: `admin.js` ahora invoca `await loadBoards()` tras cada aprobación para mantener actualizada la variable en memoria `allBoardsFetched`, evitando que ediciones posteriores sobrescriban la base de datos con estados viejos. Adicionalmente, el filtro del modal de tableros preserva cualquier dirección de correo válida existente.

