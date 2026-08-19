# Bitácora de seguridad — Observatorio de Gestión Municipal (OGM)

Registro cronológico (más reciente primero) de hallazgos de seguridad, su análisis y su remediación. Este archivo documenta *cómo se llegó* al estado descrito en `SECURITY_POLICY.md` — ese otro documento describe el estado vigente; este describe la historia.

Cada entrada indica: qué se encontró, por qué importa, qué se hizo (o qué falta hacer), y dónde verificarlo.

---

## [ABIERTO] Acceso sin autenticación a los tableros subidos (`/uploads`)

- **Severidad**: Crítica.
- **Estado**: Abierto — es el próximo punto a resolver en `feat/security`.
- **Dónde**: `server.js`, ruta `app.use('/uploads', express.static(UPLOADS_PATH))`.

**Hallazgo**: la ruta que sirve los tableros e informes subidos (HTML, ZIP descomprimido, PDF, imágenes) no tiene ningún middleware de autenticación ni de autorización delante. Cualquier persona con la URL del archivo accede sin sesión, sin importar cómo esté configurado `require_login` o `allowed_users` para ese tablero en la base de datos. El campo `iframe_url` que recibe el frontend, para los tableros subidos como archivo, apunta directamente a esta ruta sin protección.

**Por qué importa**: es el equivalente, en infraestructura propia, al problema original de "Publicar en la web" de Power BI — pero peor en un sentido, porque el propio sistema tiene un campo (`require_login`) que declara la intención de restringirlo y ese campo no tiene ningún efecto sobre el archivo real. El circuito de aprobación con fiscal y funcionario (ver `SECURITY_POLICY.md`, sección 4) queda vaciado de contenido si el archivo se puede pedir directo, sin pasar por ese circuito.

**Actualización — por qué sigue abierto**: al diseñar la corrección se encontró una restricción real del modelo de autenticación actual, no solo de implementación. Toda la autenticación del sistema se hace hoy vía `Authorization: Bearer <token de Firebase>`, agregado a mano en cada llamada `fetch`/XHR desde el frontend. Un `<iframe src="...">` no es una llamada de ese tipo — es una navegación del navegador, que no puede llevar ese encabezado. Es decir: **el mecanismo de autenticación que protege el resto del sistema no puede, tal cual está, proteger directamente la carga del iframe.**

La corrección real requiere, además de la ruta guardada, un mecanismo de token firmado y de vida corta embebido en la propia URL (minteado por el backend en el momento en que arma la lista de tableros, para un usuario y un tablero específicos), más un cambio en el frontend (`auth.js`) para que use esa URL con token en lugar de la ruta cruda. Es decir: no es un cambio contenido solo en `server.js`. Diseño y decisión de alcance pendientes con el equipo — ver `SECURITY_POLICY.md`, sección 4, y la entrada siguiente.

**Hallazgo relacionado, encontrado durante este análisis**: `GET /api/tableros` es público (sin `verifyToken`) y devuelve `SELECT * FROM tableros` completo — todas las columnas, de todos los tableros, a cualquier visitante anónimo. Esto incluye `allowed_users` (los correos específicos autorizados a cada tablero confidencial) y `access_expirations`, no solo `iframe_url`. Hoy el filtrado de qué tablero mostrar parece resolverse del lado del cliente; el listado crudo, con metadatos de permisos incluidos, ya es público independientemente de si se soluciona el acceso al archivo. No se tocó todavía — depende de la misma decisión de diseño de arriba, porque la forma correcta de resolverlo (dejar de exponer `allowed_users` a quien no lo necesita) está atada al mismo cambio de autenticación en este endpoint.

---

## [RESUELTO] Escalamiento de privilegios — rutas administrativas sin verificación de rol

- **Severidad**: Crítica.
- **Estado**: Resuelto.
- **Commit**: `4618c4a` *(feat(security): implementar middleware requireRole (RBAC) y blindar endpoints administrativos)*, mergeado a `development` en `0fb7d04`.

**Hallazgo**: el middleware `verifyToken` solo confirmaba que el token de Firebase fuera válido — no verificaba el rol del usuario. Cualquier cuenta registrada, con el rol `usuario` que se asigna por defecto al registrarse, podía llamar directamente a `PATCH /api/usuarios/:email/role` con `{ "role": "admin" }` sobre su propio correo y quedar administrador con una sola solicitud HTTP, sin pasar por el panel ni por ninguna aprobación. El mismo patrón (falta de chequeo de rol) se repetía en la gestión de usuarios, tableros, categorías, logs, configuración y otras rutas administrativas.

**Remediación**: middleware `requireRole(...roles)` que consulta `usuarios_perfiles.role` en MySQL en cada solicitud (nunca confía en el rol declarado por el cliente) y se aplicó a la totalidad de rutas administrativas identificadas. Verificado por revisión de diff: 18 rutas actualizadas, incluida la de cambio de rol.

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
