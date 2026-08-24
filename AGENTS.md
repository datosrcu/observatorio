# Instrucciones para agentes — Observatorio de Gestión Municipal (OGM)

Este archivo lo lee cualquier agente de IA (Claude Code, Cursor, Copilot u otro) que trabaje en este repositorio. Si estás asistiendo a alguien en este proyecto, estas reglas aplican, independientemente de quién te esté pidiendo el cambio.

## Qué es esto

Backend Node.js/Express (`server.js`) + MySQL + Firebase Authentication, desplegado con Docker vía Dokploy. Sirve tableros de indicadores de gestión pública (Power BI, Looker Studio, y desarrollos HTML/ZIP subidos al propio servidor) a través de un panel con control de acceso (`admin.html`, `observatorio-gestion.html`).

Hay un trabajo de seguridad en curso, con su propia bitácora y política documentadas. **Leelas antes de tocar cualquiera de estas áreas**: autenticación, roles y permisos, servido de archivos (`/uploads`, el filtro de estáticos de la raíz), o variables de entorno relacionadas con eso.

- `docs/SECURITY_POLICY.md` — el estado vigente: qué controles existen hoy y qué falta.
- `docs/SECURITY_LOG.md` — la bitácora: qué se encontró, cuándo, y cómo se resolvió.

## Regla de oro

Este sistema está en producción, con usuarios reales. **No cambies el comportamiento actual salvo que ese comportamiento sea exactamente la falla que estás corrigiendo.**

- Preferí siempre el cambio más chico y más aislado que resuelva el problema.
- Si un cambio puede hacer que algo que hoy funciona deje de funcionar (una URL que respondía y deja de responder, un endpoint que empieza a exigir algo que antes no exigía), **no lo apliques en silencio**. Explicá qué se rompe, para quién, y esperá confirmación antes de aplicarlo.
- Ante la duda entre "arreglarlo silenciosamente" y "preguntar", preguntá.
- Esto no es un freno al desarrollo de funcionalidades nuevas — es específicamente sobre no romper lo que ya funciona ni reabrir algo que ya se cerró por seguridad.

## Reglas concretas al tocar el backend

**Toda ruta administrativa nueva necesita rol, no solo sesión.** `verifyToken` únicamente confirma que el usuario está autenticado — no que tenga permiso para administrar. El patrón correcto:

```js
app.post('/api/lo-que-sea', verifyToken, requireRole('admin'), async (req, res) => { ... });
```

`requireRole('admin', 'fiscal')` acepta más de un rol si corresponde. Nunca confíes en un rol que venga en el body o en el token del cliente — `requireRole` ya lo revalida contra `usuarios_perfiles.role` en cada request; no dupliques esa lógica a mano ni la omitas "porque total ya está logueado".

**Ningún archivo subido por un usuario se sirve directo sin pasar por el chequeo de `require_login`.** Los tableros/informes subidos por admin.html tienen `require_login`, `allowed_users` y `access_expirations` en su fila de base de datos — esos campos gobiernan el acceso real al archivo (vía el middleware de `/uploads` en `server.js`), no solo qué se muestra en la interfaz. Si agregás un tipo de contenido nuevo que se sube y se sirve como archivo, tiene que pasar por el mismo mecanismo — no un `express.static` nuevo sin guardia.

**No agregues rutas de servido de estáticos sin revisar el filtro que ya existe** (`PUBLIC_STATIC_ALLOWLIST`, `PUBLIC_STATIC_PREFIXES`, `BLOCKED_EXTENSIONS` en `server.js`). Cualquier archivo nuevo en la raíz del proyecto que no esté explícitamente permitido queda bloqueado por defecto — es intencional. Si un archivo legítimo nuevo necesita ser público, agregalo a la lista blanca explícitamente; no relajes el filtro en general para resolverlo.

**Variables de entorno de seguridad.** Antes de desplegar, confirmá que están configuradas en Dokploy (no alcanza con tenerlas en un `.env.local` local):

| Variable | Para qué | Si falta |
|---|---|---|
| `FIREBASE_SERVICE_ACCOUNT` | Verificar tokens de sesión | El servidor no puede autenticar a nadie |
| `DATABASE_URL` (o `DB_HOST`/`DB_USER`/`DB_PASS`/`DB_NAME`/`DB_PORT`) | Conexión a MySQL | El servidor no arranca funcionalmente |
| `TABLERO_ACCESS_SECRET` | Firma los tokens de acceso a tableros/informes con `require_login=1` | Esos tableros/informes quedan inaccesibles para todos (falla segura, no silenciosa) |
| `RESEND_API_KEY` | Envío de emails transaccionales | Se deshabilita el envío, sin crashear |
| `GITHUB_DEPLOY_TOKEN` | Descargar repositorios (zipballs) para desplegar tableros de origen GitHub — incluidos los privados. Solo se usa server-side, nunca viaja al cliente | Los tableros GitHub solo se pueden desplegar desde repos públicos; la migración/auto-deploy de repos privados falla (queda registrado, el tablero legado sigue por el mecanismo anterior) |

Opcional: `GITHUB_POLL_MINUTES` (intervalo en minutos del auto-deploy por polling; por defecto 10).

**Nunca subas `.env`, `.env.local` ni ninguna variante al repositorio.** El `.gitignore` ya los excluye (`.env.*`) — si alguna vez ves uno como `untracked` a punto de agregarse, pará y avisá.

## Después de cualquier cambio relacionado con seguridad

Actualizá `docs/SECURITY_LOG.md` (agregá la entrada: qué se encontró/cambió, severidad, estado) y `docs/SECURITY_POLICY.md` (si cambia el estado de una sección) **en el mismo commit** que el cambio de código. Un fix de seguridad sin su entrada correspondiente en la bitácora es un fix a medio documentar.

## Ramas

- `development` — rama de trabajo compartida del equipo.
- `feat/security` — donde se concentra el trabajo de seguridad. No mergees a `development` sin que se revise explícitamente.

## Antes de dar algo por terminado

- ¿Corriste `node --check server.js` como mínimo?
- ¿Alguna prueba real (no solo lectura de código) confirma que lo que decís que funciona, funciona? Si no pudiste probarlo en vivo, decilo explícitamente en vez de asumir que anda.
- ¿Actualizaste la bitácora y la política si corresponde?
- ¿Hay algo que vaya a cambiar comportamiento visible para un usuario actual? Si sí, ¿se avisó antes de aplicarlo?
