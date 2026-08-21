# Bitácora de seguridad — Observatorio de Gestión Municipal (OGM)

## [RESUELTO PARCIALMENTE — CREDENCIAL YA SANEADA, REDISEÑO PENDIENTE] Integración GitHub sin control de acceso y token de GitHub persistido en la base

- **Severidad**: Crítica.
- **Estado**: Se cerró el acceso anónimo a las rutas `/api/github/*`. La credencial potencialmente filtrada ya fue saneada (ver actualización del 2026-08-21, al final de esta entrada). **No se resolvió** que el token de OAuth de GitHub (permiso `repo`, lectura y escritura) viaje en la URL y quede guardado en `tableros.iframe_url` — eso es un rediseño aparte, pendiente de charlar con quien desarrolló la función.
- **Dónde**: `server.js` (rutas `/api/auth/github/*`, `/api/github/*`), `admin.js` (modal de tableros, opción "GitHub").

**Hallazgo**: al mergear una función nueva (conectar un repositorio de GitHub como fuente de un tablero, desarrollada en paralelo), se encontró que:

1. `GET /api/github/proxy/:owner/:repo/:branch/*` no tenía ningún control de acceso — ni de sesión del Observatorio, ni de rol. Es la ruta que efectivamente sirve el contenido dentro del iframe del tablero.
2. Al crear un tablero con fuente GitHub, `admin.js` arma la URL con el token de OAuth del admin incluido como query string (`?token=...`) y esa URL completa —token adentro— se guarda tal cual en `tableros.iframe_url`. Cada vez que se pide la lista de tableros, ese token vuelve a viajar en la respuesta.
3. El token de OAuth solicitado tiene scope `repo` (lectura **y escritura** de todos los repositorios del usuario, públicos y privados), no un scope acotado de solo lectura.
4. El mismo token queda además en `localStorage` del navegador (`github_auth_event`), legible por cualquier script que corra en esa página.

Es la misma familia de problema que motivó todo este trabajo (contenido servido sin control, gobernado solo por quién conoce la URL) pero con un agravante: lo que se filtra no es un tablero municipal, es una credencial con permiso de escritura sobre repositorios de GitHub.

**Remediación aplicada** (alcance acotado, ver más abajo):

- `GET /api/github/proxy/...`: ahora exige el mismo token de acceso firmado que ya protege `/uploads` (`githubProxyGuard` en `server.js`), resuelto por prefijo `owner/repo/branch` contra la fila de `tableros` correspondiente. Si el tablero es público (`require_login = 0`), se sirve igual que antes. Si es confidencial, exige el token — sin él, 403. Si no hay ningún tablero conocido con ese prefijo, se bloquea por defecto (a diferencia de `/uploads`, acá "no reconocido" no es un archivo huérfano inofensivo: es una ruta capaz de relayar cualquier contenido de GitHub).
- `GET /api/github/repos` y `GET /api/github/branches`: ya usaban el header `Authorization` para el token de GitHub, así que no podían llevar además el token de sesión del Observatorio ahí. Se agregó un segundo header, `X-Observatorio-Token`, validado con un middleware nuevo (`requireRoleViaHeader`) que exige rol `admin`. Cambio correspondiente en los dos `fetch` de `admin.js` que llaman a estas rutas.
- `/api/auth/github/login` y `/api/auth/github/callback` **quedaron sin tocar**, a propósito: se abren como ventana emergente y no pueden llevar el token del Observatorio. El riesgo ahí es menor (en el peor caso, alguien inicia el consentimiento de OAuth de GitHub para su propia cuenta, no la del Observatorio) — evaluar si vale la pena cerrarlas en una siguiente pasada.

**Explícitamente fuera de esta corrección — pendiente como rediseño**: el token de GitHub sigue viajando en la URL y guardándose en `tableros.iframe_url`, y sigue en `localStorage`. La corrección de fondo (no persistir el token; usar una credencial manejada por el servidor, ej. una GitHub App instalada con permisos acotados en vez de OAuth personal con scope `repo` completo) requiere decisiones de producto que no se tomaron unilateralmente acá — a definir con quien desarrolló la función.

**Acción urgente, independiente del código**: si esta función se llegó a usar (se creó algún tablero con fuente GitHub) en cualquier ambiente donde el token ya haya podido circular, ese token debería revocarse/regenerarse desde GitHub (Settings → Applications → Authorized OAuth Apps), sin esperar a que se despliegue el fix — el token ya emitido no se invalida solo. **A confirmar con el equipo si esto llegó a ocurrir en producción.**

**Actualización (2026-08-21)**: se generó un nuevo `GITHUB_CLIENT_SECRET` desde la OAuth App de GitHub (Client ID `Iv23li0bqEQeesaUVaoA`), cargado en las variables de entorno de Dokploy (dev y producción) y redesplegado — el servidor ya corre con el secreto nuevo. Además, se usó el botón **"Revoke all user tokens"** (pestaña Advanced de la OAuth App), que invalida de una todos los tokens de acceso emitidos hasta ese momento por esa app, para cualquier usuario — no solo el de quien conectó la cuenta. Con esto, cualquier token que hubiera quedado guardado en `tableros.iframe_url` o en `localStorage` antes de esta fecha ya no sirve. Cualquier admin que use la función de tableros con fuente GitHub va a tener que reconectar su cuenta.

**Sigue pendiente, sin cambios**: el rediseño de fondo — que el token no viaje en la URL ni quede en `tableros.iframe_url`/`localStorage`. Esto era mitigación de la credencial expuesta, no una corrección del problema estructural descripto arriba.

---

Registro cronológico (más reciente primero) de hallazgos de seguridad, su análisis y su remediación. Este archivo documenta *cómo se llegó* al estado descrito en `SECURITY_POLICY.md` — ese otro documento describe el estado vigente; este describe la historia.

Cada entrada indica: qué se encontró, por qué importa, qué se hizo (o qué falta hacer), y dónde verificarlo.

---

## [RESUELTO — PENDIENTE DE PROBAR ANTES DE DESPLEGAR] Acceso sin autenticación a los tableros subidos (`/uploads`)

- **Severidad**: Crítica.
- **Estado**: Implementado en `feat/security`, sin probar todavía contra base de datos real. **No desplegar sin antes configurar la variable de entorno `TABLERO_ACCESS_SECRET`** (ver más abajo) y probarlo.
- **Dónde**: `server.js` — middleware nuevo antes de `express.static(UPLOADS_PATH)`, más cambios en `GET /api/tableros` y `GET /api/informes`.

**Hallazgo**: la ruta que sirve los tableros e informes subidos (HTML, ZIP descomprimido, PDF, imágenes) no tiene ningún middleware de autenticación ni de autorización delante. Cualquier persona con la URL del archivo accede sin sesión, sin importar cómo esté configurado `require_login` o `allowed_users` para ese tablero en la base de datos. El campo `iframe_url` que recibe el frontend, para los tableros subidos como archivo, apunta directamente a esta ruta sin protección.

**Por qué importa**: es el equivalente, en infraestructura propia, al problema original de "Publicar en la web" de Power BI — pero peor en un sentido, porque el propio sistema tiene un campo (`require_login`) que declara la intención de restringirlo y ese campo no tiene ningún efecto sobre el archivo real. El circuito de aprobación con fiscal y funcionario (ver `SECURITY_POLICY.md`, sección 4) queda vaciado de contenido si el archivo se puede pedir directo, sin pasar por ese circuito.

**Restricción encontrada al diseñar la corrección**: toda la autenticación del sistema se hace vía `Authorization: Bearer <token de Firebase>`, agregado a mano en cada llamada `fetch`/XHR. Un `<iframe src="...">` no puede llevar ese encabezado — es una navegación del navegador. El mecanismo que protege el resto del sistema no puede, tal cual está, proteger directamente la carga del iframe.

**Diseño implementado**: como el tablero y el Observatorio son el mismo servidor (no dos sistemas distintos — se descartó explícitamente una alternativa de tipo CORS/`frame-ancestors` con clave cruzada porque resuelve un problema distinto: quién puede *embeber* el contenido, no quién puede *pedirlo* directamente), la corrección es un token firmado de corta duración:

1. `GET /api/tableros` y `GET /api/informes` ahora leen el header `Authorization` si viene, pero sin exigirlo (`getOptionalUserEmail`) — así una visita anónima sigue viendo los tableros públicos exactamente igual que hoy.
2. Para cada fila con `require_login = 1`, si el correo del solicitante está en `allowed_users` y no venció en `access_expirations` (el mismo chequeo que ya gobierna la aprobación de solicitudes), se agrega a la URL ya existente (`iframe_url` o `file_path`, según corresponda) un token: `?t=<firma HMAC-SHA256>&exp=<vencimiento>`. Vigencia: 15 minutos. Si el usuario no está habilitado, o no hay sesión, la URL queda igual que antes (sin protección adicional, pero tampoco peor que hoy).
3. El middleware que sirve `/uploads` ahora resuelve, por cada pedido, a qué tablero o informe pertenece el archivo (por `file_path` exacto, o por el id embebido en la carpeta `project_<id>/` para los tableros subidos como ZIP — así se cubren también los recursos internos del proyecto: CSS, imágenes, etc.). Si el recurso tiene `require_login = 0`, se sirve exactamente igual que antes. Si tiene `require_login = 1`, exige que `t`/`exp` sean válidos — si no, 403. Se agregó una caché en memoria de 30 segundos para no consultar MySQL en cada archivo individual de una página con múltiples recursos.
4. Registro autoritativo: cada acceso concedido a un archivo protegido queda insertado en `logs_actividad` desde el propio servidor — ya no depende de que el cliente avise (ver hallazgo de auditoría más abajo).
5. **No se tocó `auth.js` para esto** — se verificó que la vista principal (`observatorio-gestion.html`) ya usa `callApi()`, que adjunta el header de autenticación. Sí se detectó que `monitor-satisfaccion.html` pide la lista con un `fetch()` simple, sin ese header — un usuario autorizado que vea un tablero confidencial *desde esa página específica* no recibiría el token. **Pendiente**: decidir si se corrige ese único punto o si esa página nunca muestra tableros confidenciales en la práctica (a confirmar).

**Requisito antes de desplegar**: agregar la variable de entorno `TABLERO_ACCESS_SECRET` en Dokploy. Si falta, el sistema queda en modo "cerrado por defecto" — los tableros/informes con `require_login = 1` no van a poder abrirse por nadie hasta que se configure (falla segura, no silenciosa, pero sí visible: hay que hacerlo antes de desplegar esta rama, no después).

**Hallazgo relacionado, sin resolver todavía**: `GET /api/tableros` sigue devolviendo `allowed_users` y `access_expirations` completos a cualquier visitante, autorizado o no — solo se protegió la URL del archivo, no los metadatos de permisos del listado. Queda pendiente porque tocarlo puede romper la lógica del frontend que hoy decide, con esos mismos campos, si mostrar el tablero como bloqueado o con botón de "solicitar acceso" — no se tocó sin confirmar esa dependencia primero.

---

## [RESUELTO] Escalamiento de privilegios — rutas administrativas sin verificación de rol

- **Severidad**: Crítica.
- **Estado**: Resuelto.
- **Commit**: `4618c4a` *(feat(security): implementar middleware requireRole (RBAC) y blindar endpoints administrativos)*, mergeado a `development` en `0fb7d04`.

**Hallazgo**: el middleware `verifyToken` solo confirmaba que el token de Firebase fuera válido — no verificaba el rol del usuario. Cualquier cuenta registrada, con el rol `usuario` que se asigna por defecto al registrarse, podía llamar directamente a `PATCH /api/usuarios/:email/role` con `{ "role": "admin" }` sobre su propio correo y quedar administrador con una sola solicitud HTTP, sin pasar por el panel ni por ninguna aprobación. El mismo patrón (falta de chequeo de rol) se repetía en la gestión de usuarios, tableros, categorías, logs, configuración y otras rutas administrativas.

**Remediación**: middleware `requireRole(...roles)` que consulta `usuarios_perfiles.role` en MySQL en cada solicitud (nunca confía en el rol declarado por el cliente) y se aplicó a la totalidad de rutas administrativas identificadas. Verificado por revisión de diff: 18 rutas actualizadas, incluida la de cambio de rol.

**Corrección posterior — rutas que se habían escapado del barrido**: al revisar `/api/informes` para el hallazgo de `/uploads`, se encontró que `POST`, `PATCH` y `DELETE` de informes seguían con solo `verifyToken`, sin `requireRole('admin')` — cualquier usuario logueado podía crear, editar o borrar informes. Corregido en `feat/security`, mismo patrón que el resto.

**Nota de higiene, sin corregir**: existen dos definiciones de `app.patch('/api/tableros/:id', ...)` en el archivo (una con `requireRole('admin')`, cerca del resto de rutas de tableros; otra, más abajo, sin verificación de rol, con lógica más completa de normalización de campos). Express despacha siempre a la primera registrada, así que la segunda es código muerto — no representa un riesgo activo hoy, pero conviene que el equipo decida si consolidan ambas en una sola versión, porque la que efectivamente corre hoy no normaliza `allowed_users`/`access_expirations` a JSON como sí lo hace la que quedó inalcanzable. Es un posible bug funcional, no de seguridad — no se tocó.

---

## [RESUELTO] Código de servidor descargable públicamente vía el directorio raíz

- **Severidad**: Alta.
- **Estado**: Resuelto. Las dos excepciones detectadas en la primera pasada se cerraron en `feat/security` (pendiente de commit).
- **Commit**: `c4b1bdf` *(feat(security): implementar allowlist de estaticos y bloquear descarga de scripts backend)*, mergeado a `development` en `2da1c60`. Ajustes adicionales sobre esa base en `feat/security`, sin commit todavía.

**Hallazgo**: `app.use(express.static(path.join(__dirname)))` servía sin restricción todo el directorio raíz del proyecto dentro del contenedor. Cualquiera podía descargar `server.js`, `migrate.js`, `evaluar-db.js`, `test-admin.js`, `test-mock.js` y mapear por completo la lógica del backend, los nombres de tabla y las rutas de la API. `.git` no llegaba a producción por estar excluido en `.dockerignore`, pero el resto sí quedaba expuesto en el contenedor en ejecución.

**Remediación**: filtro previo al `express.static` que bloquea explícitamente los archivos sensibles conocidos y, por defecto, cualquier `.js`/`.py`/`.sh`/`.sql` que no esté en una lista explícita de archivos de cliente permitidos. Se confirmó que `admin.js`, `auth.js` y `requests.js` — incluidos en la lista blanca — son efectivamente scripts de cliente, referenciados con `<script src>` desde `Index.html`, `admin.html` y `observatorio-gestion.html`; no fue un error incluirlos.

**Excepciones detectadas y su corrección**:

1. La regla que permitía cualquier archivo `.html`/`.htm` sin pasar por la lista blanca se cerró: ahora, si un `.html`/`.htm` no está en `PUBLIC_STATIC_ALLOWLIST` ni bajo un prefijo público, se bloquea. Se verificó primero, uno por uno, que los seis archivos `.html` reales del proyecto ya estaban cubiertos por la lista blanca o por `PUBLIC_STATIC_PREFIXES` — el cambio no rompe ninguno de ellos.
2. La lista de extensiones bloqueadas por defecto pasó de cuatro (`.js`, `.py`, `.sh`, `.sql`) a veinte, incorporando otros lenguajes de servidor y archivos de configuración/credenciales (`.php`, `.rb`, `.pl`, `.cgi`, `.bak`, `.backup`, `.old`, `.log`, `.yml`, `.yaml`, `.ini`, `.conf`, `.config`, `.pem`, `.key`, `.crt`, `.swp`). El archivo `php-buttons.code-snippets (1).php` (snippet de WordPress ajeno al proyecto, usado como caso de prueba) ahora devuelve 404.

**Nota aparte, no bloqueada todavía**: existen varios archivos sueltos en la raíz (`2.png`, `Dalcar.svg`, `Digital_Glyph_White.svg`, `firebase.json`, `formulario.md`, `Index.txt`) que no están referenciados desde ningún HTML ni JS del proyecto — es decir, no los usa la aplicación en ejecución. No son sensibles y no se tocaron en esta pasada por no ser parte del alcance original, pero conviene evaluar si deberían quitarse del repositorio o del directorio servido en algún momento, simplemente por prolijidad.

---

## [RESUELTO] Segundo factor de autenticación obligatorio en la cuenta administradora

- **Severidad**: Crítica (dado que era la única cuenta con privilegios totales, sin control de rol adicional en ese momento).
- **Estado**: Resuelto — activado en Google Workspace para `datos@riocuarto.gov.ar`.

**Hallazgo**: la cuenta administradora maestra no tenía segundo factor obligatorio. Antes de la corrección de RBAC (ver entrada anterior), esa cuenta era, además, la única forma legítima de administrar el sistema — su compromiso equivalía al compromiso total de la plataforma, incluidos los propios registros de auditoría.

**Remediación**: 2FA activado. Sigue siendo recomendable, a futuro, evaluar un segundo administrador nominal para continuidad operativa si esa cuenta queda inaccesible.

---

## [EN CURSO] Exposición de tableros de Power BI vía "Publicar en la web"

- **Severidad**: Crítica para los tableros que estén en este modo y contengan datos sensibles.
- **Estado**: En migración activa por el equipo.

**Hallazgo**: "Publicar en la web" de Power BI genera un enlace público e indexable por buscadores, sin autenticación ni control de acceso — verificado que Microsoft no ofrece una opción de restringir ese modo de publicación a un dominio o cuenta específica. Cualquier tablero publicado así es, en los hechos, público en internet, independientemente de los controles de acceso del Observatorio.

**En curso**: migración de los tableros afectados hacia tableros propios (servidos por el Observatorio, bajo el mismo control de acceso que el resto) o hacia embebido con token de vida corta, si la licencia disponible lo permite.

---

## [MITIGADO — LIMITACIÓN DE PLATAFORMA] Looker Studio, control de acceso por enlace

- **Severidad**: Media, acotada por el modelo de uso actual.
- **Estado**: Mitigado con el control disponible; sin alternativa mejor dentro de la plataforma gratuita.

**Hallazgo**: Looker Studio (versión gratuita) no ofrece una lista de dominios permitidos para embebido — a diferencia de Looker Enterprise (producto distinto, de pago), que sí la tiene. El único control real disponible es restringir el informe a cuentas o al dominio de Google Workspace del organismo.

**Por qué se considera aceptable hoy**: se confirmó que los usuarios externos al municipio (sociedad civil, educación, sector privado) acceden únicamente a tableros públicos — el circuito de aprobación de la Sección 4 de `SECURITY_POLICY.md` nunca les concede acceso a un tablero confidencial. Por lo tanto, restringir por dominio institucional a los tableros sensibles no deja afuera a ningún usuario legítimo.

---

## [VERIFICADO — CONFIRMA LA SOSPECHA] Autoritatividad del registro `logs_actividad`

- **Estado**: Verificado. Es una métrica de uso, no evidencia de auditoría.
- **Dónde**: `server.js`, `POST /api/log-actividad` (línea ~1167 al momento de esta revisión).

**Confirmado**: el único punto de escritura en `logs_actividad` es este endpoint, donde `action` y `details` llegan completos desde `req.body` — los decide el cliente. El servidor solo aporta de forma confiable el identificador del usuario (`req.user.email`, del token verificado) y la IP de origen; el resto del contenido del log —qué acción se registra, y si se registra algo— depende de que el navegador del usuario decida llamar a este endpoint. Un usuario podría simplemente no hacerlo (bloqueando la llamada, o con un cliente modificado) y ninguna acción quedaría registrada, sin que el sistema lo note.

**Consecuencia práctica**: hoy no existe evidencia server-side de "quién vio qué tablero y cuándo". La ruta guardada que se diseñe para `/uploads` (hallazgo abierto más arriba) es el lugar natural para agregar un registro de acceso realmente autoritativo — un `INSERT` hecho por el propio servidor en el momento de conceder el archivo, no dependiente de que el cliente avise. Queda pendiente junto con esa corrección.

---

## [VERIFICADO — SIN VULNERABILIDAD] Protección contra *Zip Slip* en la extracción de tableros `.zip`

- **Estado**: Verificado. La versión en uso está protegida.

**Verificación realizada**: se instaló `adm-zip@0.5.17` (versión exacta resuelta en `package-lock.json`) en un entorno aislado y se inspeccionó el código fuente de `extractAllTo`. Cada entrada del ZIP pasa por `Utils.canonical()` (elimina segmentos `../`) y luego por `Utils.sanitize(prefix, name)`, que resuelve la ruta final y, si el resultado queda fuera del directorio destino, la recorta progresivamente hasta que vuelve a quedar contenida en `prefix` — con `path.basename()` como última red de contención. No es una versión vulnerable a Zip Slip. No se requiere ninguna acción adicional sobre este punto.
