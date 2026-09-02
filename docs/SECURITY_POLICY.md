# Política de seguridad — Observatorio de Gestión Municipal (OGM)

Este documento describe las reglas de seguridad que rigen hoy el Observatorio: cómo se autentica a los usuarios, quién puede hacer qué, y cómo se protege el acceso a los tableros. Está pensado para dos lectores distintos: quien desarrolla sobre este proyecto (para saber qué no puede romper al agregar una funcionalidad) y quien necesita una visión de conjunto sin entrar al código (gestión, auditoría).

Cada sección indica su estado de implementación:

- ✅ **Implementado** — la regla se aplica hoy, verificada en el código.
- ⚠️ **Implementado con excepciones conocidas** — la regla existe pero tiene brechas identificadas, detalladas en `SECURITY_LOG.md`.
- 🔲 **Pendiente** — la regla está definida pero no aplicada, o no se verificó todavía.

**Mantenimiento**: cuando se resuelve o se descubre algo, este documento se actualiza en el mismo commit o *pull request* que el cambio correspondiente, y se agrega la entrada equivalente en `SECURITY_LOG.md`. Este archivo describe el estado vigente; `SECURITY_LOG.md` describe cómo se llegó a él.

---

## 1. Resumen ejecutivo

El acceso al Observatorio requiere autenticación (Firebase Authentication) y las acciones administrativas requieren, además, un rol verificado contra la base de datos en cada solicitud — no alcanza con estar logueado. El otorgamiento de acceso a un tablero específico pasa por un circuito de solicitud con aprobación escalada según la sensibilidad del dato. La cuenta administradora tiene doble factor de autenticación obligatorio.

Quedan dos frentes abiertos, ya identificados y priorizados: el acceso directo a los archivos de tableros subidos (`/uploads`) no respeta todavía las reglas de permiso configuradas por tablero, y el filtro que protege el código de servidor de descargas públicas tiene dos excepciones conocidas de riesgo bajo. Ambos están detallados más abajo y en la bitácora.

## 2. Autenticación — ✅ Implementado

- El inicio de sesión se hace con Firebase Authentication (Google OAuth 2.0 o email/contraseña).
- El cliente obtiene un ID Token (JWT) de Firebase y lo envía en cada solicitud protegida (`Authorization: Bearer <token>`).
- El backend verifica la firma criptográfica de ese token contra Firebase Admin SDK antes de procesar cualquier solicitud protegida (middleware `verifyToken`, `server.js`). Un token inválido o expirado se rechaza con 401/403.
- La cuenta administradora maestra (`datos@riocuarto.gov.ar`) tiene segundo factor de autenticación obligatorio en Google Workspace.

## 3. Autorización basada en roles (RBAC) — ✅ Implementado

Existen tres roles, almacenados en `usuarios_perfiles.role`: `admin`, `fiscal`, `usuario` (asignado por defecto al registrarse).

Un usuario autenticado **no** tiene automáticamente permiso para actuar como administrador. Cada ruta administrativa exige, además del token válido, que el middleware `requireRole(...roles)` confirme el rol consultando la base de datos en el momento de la solicitud — nunca se confía en un rol declarado por el cliente, ni en el token, ni en el cuerpo de la petición.

Rutas protegidas por rol (no exhaustivo, ver `server.js` para el listado completo): gestión de usuarios y roles, alta/edición/borrado de tableros, categorías, configuración general, contactos, logs de actividad, consentimientos (RCE), solicitudes de acceso y productos estadísticos.

Antes de este control, cualquier cuenta registrada podía, entre otras cosas, otorgarse a sí misma el rol de administrador con una sola solicitud HTTP. Detalle completo en `SECURITY_LOG.md`. Una corrección posterior extendió el mismo control a las rutas de `/api/informes`, que se habían quedado afuera del barrido original.

**Excepción documentada — `POST /api/enviar-bienvenida`.** Es la única ruta que no usa `requireRole` y aun así distingue por rol. Envía el acuse de recibo del RCE, que por norma debe llegarle al propio usuario apenas se registra: exigir rol `admin` la dejaba inalcanzable. Autoriza por cuenta propia — un usuario autenticado sólo puede disparar el acuse hacia **su propia dirección**, tomada del token verificado, nunca del cuerpo de la petición; un admin puede disparar el de cualquiera. El rol se resuelve con `getUserRole()`, que consulta `usuarios_perfiles` en el momento de la solicitud, igual que `requireRole`. La ruta tiene además su propio límite de tasa (`bienvenidaLimiter`, 5/hora por IP). Detalle en `SECURITY_LOG.md`.

## 4. Circuito de autorización de acceso a tableros — ✅ Implementado (pendiente de configurar variable de entorno antes de desplegar)

Cada tablero (o informe) tiene, en la base de datos: `require_login`, `allowed_users` (correos autorizados), `access_expirations` (vencimientos por usuario) y `sensitivity_level` (Bajo, Medio, Alto, Confidencial).

El otorgamiento de acceso no es discrecional de un solo actor: un usuario solicita acceso a un tablero, y según la sensibilidad del dato:

- Si el dato es público, autoriza el funcionario responsable de esa información.
- Si el dato es confidencial, autoriza primero el fiscal municipal y, recién después, el funcionario responsable.

Todo el circuito queda registrado en `solicitudes_acceso`. Los vencimientos son, por defecto, a 12 meses, salvo que el usuario sea un funcionario con cargo de vencimiento anterior (en cuyo caso el permiso hereda esa fecha) o que se personalice el plazo caso por caso.

Desde `feat/security`, este circuito gobierna también el acceso directo al archivo, no solo qué aparece habilitado en la interfaz: la ruta `/uploads` valida, por cada archivo, si el tablero/informe correspondiente exige sesión y, de ser así, exige un token de acceso firmado y de corta duración (15 minutos), emitido únicamente para usuarios que ya figuran en `allowed_users` con `access_expirations` vigente — el mismo criterio que gobierna la aprobación de solicitudes, no uno nuevo. Detalle técnico completo en `SECURITY_LOG.md`.

**Requisito operativo antes de desplegar esta rama**: configurar la variable de entorno `TABLERO_ACCESS_SECRET` en Dokploy. Sin ella, el sistema falla cerrado — los tableros/informes con `require_login = 1` no se abren para nadie, en vez de quedar sin protección. Es intencional (falla segura), pero hay que configurarla antes de desplegar, no después.

**Excepción explícita, por diseño (2026-08-24)**: la cuenta administradora maestra (`datos@riocuarto.gov.ar`) y cualquier usuario con rol `lector` en `usuarios_perfiles` tienen acceso de lectura a todos los tableros/informes, sin pasar por `allowed_users` — no necesitan figurar en la lista de usuarios permitidos de cada tablero individual. La interfaz de administración (`admin.js`) ya venía mostrando a estas dos categorías como "Acceso Total" en el checklist de usuarios permitidos, pero esa marca era solo visual: nunca se traducía en un permiso real, porque el checkbox queda deshabilitado y su email no se agrega a `allowed_users` al guardar. `isEntitled`/`hasBlanketAccess` en `server.js` implementa ahora, del lado del servidor, lo que la interfaz ya prometía.

**Hallazgo relacionado, sin resolver**: `GET /api/tableros` sigue devolviendo `allowed_users` y `access_expirations` completos a cualquier visitante. Se protegió el acceso al archivo, no los metadatos de permisos del listado — tocar eso requiere primero confirmar que no rompe la lógica actual del frontend que decide, con esos mismos campos, si mostrar "solicitar acceso". Ver `SECURITY_LOG.md`.

## 5. Servido de archivos estáticos del proyecto — ✅ Implementado

Por defecto, Express sirve todo el directorio raíz del proyecto (`app.use(express.static(path.join(__dirname)))`). Sin filtro, esto exponía el código fuente del backend (`server.js`, `migrate.js`, `evaluar-db.js`, scripts de prueba) a cualquiera en internet.

Se agregó un filtro previo que:

- Bloquea explícitamente una lista de archivos sensibles conocidos (`server.js`, `migrate.js`, `evaluar-db.js`, `test-admin.js`, `test-mock.js`, `package.json`, `package-lock.json`, `Dockerfile`, `.env`, `.gitignore`, `docker-compose.yml`).
- Bloquea por defecto cualquier archivo `.js`, `.py`, `.sh` o `.sql` que no esté en la lista explícita de archivos públicos permitidos (`admin.js`, `auth.js`, `firebase-config.js`, `requests.js`, entre otros — confirmados como scripts de cliente, referenciados con `<script src>` desde las páginas HTML).
- Permite explícitamente los prefijos `recursos/` y `normativas/`. (El prefijo `atlas y monitor/` existió hasta la migración del Atlas Estadístico y el Monitor RCU al mecanismo de tableros con control de acceso — ver `SECURITY_LOG.md`; hoy esa ruta está cerrada.)
- Bloquea, además, cualquier `.html`/`.htm` que no esté cubierto por la lista blanca o por un prefijo público (cerrado — antes se permitía cualquier `.html` sin verificar).
- La lista de extensiones bloqueadas por defecto cubre veintiún tipos de archivo (lenguajes de servidor, backups, configuración, credenciales y documentación en Markdown), no solo cuatro.
- `.md` se agregó a la lista el 2026-09-02: hasta esa fecha, cualquier archivo `.md` del proyecto —incluidos los de `docs/`, como este mismo documento— se servía públicamente sin restricción. Ver `SECURITY_LOG.md` para el detalle.

Detalle de la corrección en `SECURITY_LOG.md`. Queda como nota, no como excepción de seguridad, que algunos archivos sueltos sin uso en la aplicación (`2.png`, `formulario.md`, etc.) siguen siendo servidos — no son sensibles, es una cuestión de prolijidad pendiente.

## 6. Subida y publicación de tableros propios (HTML/ZIP) — 🔲 Pendiente de revisión

- Los tableros propios se suben vía `multer`, con límite de 50 MB y extensiones permitidas (`.pdf`, `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.html`, `.htm`, `.zip`).
- Los ZIP se descomprimen en el servidor con la librería `adm-zip` (`extractAllTo`). **Verificado**: la versión en uso (`0.5.17`) sanea las entradas del ZIP y las mantiene dentro del directorio de destino — no es vulnerable a *Zip Slip*. Detalle de la verificación en `SECURITY_LOG.md`.
- Los nombres de archivo generados combinan timestamp y un número aleatorio de hasta seis dígitos — no son criptográficamente impredecibles, aunque esto deja de ser relevante una vez resuelta la Sección 4 (si el acceso exige permiso, adivinar el nombre no alcanza).

### 6.1 Tableros desde repositorios de GitHub — 🔄 Implementado, pendiente de probar en producción

- **Modelo vigente (tipo Vercel)**: el servidor descarga el repositorio (zipball de la API de GitHub) y lo extrae en `uploads/tableros/project_<id>/`, de modo que el tablero clonado se sirve exactamente por la misma guardia de `/uploads` que los ZIP subidos a mano (Sección 4): `require_login`, `allowed_users`, `access_expirations` y token firmado de corta duración.
- **Credencial del servidor**: `GITHUB_DEPLOY_TOKEN` (PAT de solo lectura) se usa exclusivamente server-side para descargar los zipballs, incluidos repos privados. Nunca viaja al navegador ni se embebe en URLs de iframes (a diferencia del mecanismo anterior, que incrustaba el token OAuth del administrador en la URL — ver `SECURITY_LOG.md`).
- **Actualizaciones**: auto-deploy por polling del SHA de la rama (sin webhooks ni endpoints públicos nuevos) y redeploy manual desde el panel admin (`POST /api/tableros/:id/redeploy`, con rol admin verificado en cada request).
- **Mecanismos deprecados, aún vivos para tableros legados**: GitHub Pages (URL pública sin control) y el proxy interno `/api/github/proxy/*` (sin autenticación propia). El formulario ya no genera ninguno de los dos; los tableros existentes se migran automáticamente al arranque del servidor. Una vez confirmada la migración completa, el proxy debe eliminarse.

## 7. Tableros externos — Power BI y Looker Studio — 🔄 En migración

- **Power BI**: los tableros publicados con "Publicar en la web" son, por diseño de Microsoft, completamente públicos e indexables — no existe una opción de restringirlos a un dominio u organización dentro de esa función. En proceso de migración hacia tableros propios (HTML, bajo este mismo control de acceso) o hacia embebido con token, según lo que permita la licencia disponible.
- **Looker Studio**: se confirmó el uso de la versión gratuita (ex Data Studio), que no ofrece una lista de dominios permitidos para embebido. El control disponible es restringir el informe a cuentas o al dominio de Google Workspace del municipio. Es una mitigación válida en este caso porque los tableros con datos confidenciales solo se comparten con personal municipal, que posee cuenta institucional; los usuarios externos (sociedad civil, educación, sector privado) acceden únicamente a tableros públicos.

## 8. Datos personales

`usuarios_perfiles` contiene DNI, CUIT y enlaces a documentación legal de cada persona registrada. El acceso de lectura a esa tabla (`GET /api/usuarios`) está restringido a rol `admin` desde la implementación de RBAC (Sección 3).

## 9. Registro y auditoría — 🔄 Parcialmente implementado

Existe una tabla `logs_actividad` que registra navegación, clics y recursos abiertos, asociados a usuario y timestamp. **Verificado**: estos eventos los reporta el propio navegador del cliente (`POST /api/log-actividad`, con `action` y `details` provistos por el cliente) — no son un registro autoritativo del servidor. Un usuario puede evitar que se registre una acción simplemente no llamando a ese endpoint. Hoy, `logs_actividad` sirve como métrica de uso, no como evidencia de auditoría ante un incidente.

La trazabilidad autoritativa de accesos a contenido protegido **ya está implementada** en las dos guardias de la Sección 4: la de `/uploads` y `githubProxyGuard`. Ambas registran, del lado del servidor, tanto las concesiones (`acceso_archivo_protegido`, `acceso_tablero_github`) como las denegaciones (`acceso_denegado_archivo`, `acceso_denegado_github`). El registro de denegaciones se agregó para cumplir el Anexo I Art. 16.3 de la Resolución 73, que exige traza de accesos permitidos y denegados con retención mínima de 2 años.

Excepción deliberada: el 404 del proxy de GitHub ("prefijo no vinculado a ningún tablero") no se registra — es una ruta inexistente, no la denegación de un acceso, y se dispara con los recursos relativos de la página embebida. Ver `SECURITY_LOG.md`.

**Sigue pendiente** (ver `docs/CUMPLIMIENTO_NORMATIVO.md`): no hay plazo máximo de conservación ni purga programada para `logs_actividad`, y la única vía de consulta (`GET /api/logs`) devuelve los últimos 500 eventos sin paginación, filtro por fecha ni exportación — insuficiente para la auditoría externa anual que exige la Ordenanza 162/25 Art. 20°.

## 10. Integración con GitHub como fuente de tableros — ⚠️ Implementado con excepción conocida, importante

Permite conectar una cuenta de GitHub y usar un archivo de un repositorio (rama y ruta específicas) como fuente de un tablero, servido a través de `/api/github/proxy/...`.

- **Acceso a la ruta que sirve el contenido**: protegido con el mismo token de acceso firmado que `/uploads` (Sección 4) — sin sesión válida y permiso sobre ese tablero específico, no se puede acceder a un tablero confidencial de fuente GitHub.
- **Gestión de repositorios/ramas desde el panel** (`/api/github/repos`, `/api/github/branches`): requieren sesión de administrador del Observatorio, además del token de GitHub.

**Excepción importante, sin resolver**: el token de autorización de GitHub (permiso `repo`, lectura y escritura sobre todos los repositorios del usuario) se guarda hoy dentro de `tableros.iframe_url` y también en `localStorage` del navegador. No hay, todavía, un diseño donde ese token quede exclusivamente del lado del servidor. Mientras esto no se resuelva, cualquiera con acceso de administrador al Observatorio —o cualquiera que consiga ese `iframe_url`— tiene, en los hechos, ese token.

**Mitigación aplicada (2026-08-21)**: se rotó `GITHUB_CLIENT_SECRET` (desplegado en Dokploy) y se revocaron todos los tokens de acceso emitidos hasta esa fecha ("Revoke all user tokens" en la OAuth App), lo que invalida cualquier token que hubiera quedado expuesto en `iframe_url` o `localStorage`. Esto sanea la credencial concreta, pero no cambia el diseño: el próximo token que se emita, al reconectar, va a volver a guardarse de la misma forma insegura hasta que se haga el rediseño. Ver `SECURITY_LOG.md` para el detalle.

**Recomendación operativa mientras tanto**: usar esta función con una cuenta de GitHub dedicada, con acceso acotado solo a los repositorios que realmente se vayan a usar como tableros — no con la cuenta personal de un administrador con acceso a otros repositorios de la organización.
