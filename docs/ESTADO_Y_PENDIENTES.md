# Estado del trabajo de cumplimiento normativo — OG RCU

Actualizado: 2 de septiembre de 2026. Complementa `docs/CUMPLIMIENTO_NORMATIVO.md` (el análisis de brechas). Ese documento dice qué exige cada norma y qué hace el sistema; éste dice qué se hizo, qué falta y con qué está bloqueado.

**Traspaso.** El trabajo hasta acá quedó en la rama `feat/cumplimiento-normativo`, en dos commits. Quien continúe: leer primero `CUMPLIMIENTO_NORMATIVO.md`, después la entrada más reciente de `SECURITY_LOG.md`, y tener presente la regla de oro de `AGENTS.md` — esto es producción con usuarios reales.

## Hecho

**Análisis.** Leídas completas la Ordenanza 162/25, la Resolución 64/26 y la Resolución 73/26. Los tres PDF son escaneos sin capa de texto y se leyeron página por página. Resultado: 18 brechas norma↔código en `CUMPLIMIENTO_NORMATIVO.md` — 6 previas (H-01 a H-06) y 12 nuevas (N-01 a N-12). Ninguna de las 6 previas se matiza; cuatro se agravan.

**Código.** Rama `feat/cumplimiento-normativo`, creada desde `development`. Dos commits:

- **Tanda 1, sin cambios de esquema** (6 archivos, +498/−19):
  - **H-02** — `/api/enviar-bienvenida` exigía `requireRole('admin')` y su único llamador es el registro de un usuario común: la ruta era inalcanzable y el acuse obligatorio del Anexo I Art. 14 no se enviaba nunca. Pasa a autorización propia, con el destinatario tomado del token verificado y no del body, más un limitador por usuario (10/hora). `/api/rce` devuelve ahora `insertId` y `timestamp` como número de registro y fecha de aceptación — no hizo falta columna nueva. `auth.js` encadena ambas llamadas y deja de silenciar los fallos. La plantilla incorpora el bloque de constancia.
  - **H-03** — eran tres ramas de denegación en dos guardias, no una. Se registran los dos 403 (`/uploads` y proxy de GitHub) con `registrarAccesoDenegado()`. El 404 del proxy queda fuera por decisión explícita, comentada en el código: es una ruta inexistente, no la denegación de un acceso, y generaría ruido que hoy ninguna purga contiene.
  - `CUMPLIMIENTO_NORMATIVO.md` versionado; `SECURITY_LOG.md` y `SECURITY_POLICY.md` (secciones 3 y 9) actualizados en el mismo commit, como pide `AGENTS.md`.
- **Transcripciones** de las tres normas a markdown, cotejadas artículo por artículo contra los PDF (+381).

**Verificado.** `node --check` en `server.js` y `auth.js`. Prueba aislada del formato de la constancia (zona Córdoba, versión, número de registro, y los casos sin dato → "No disponible"). Prueba aislada del limitador con `express-rate-limit` 8.7: 12 peticiones del mismo usuario cortan en la 11, y 8 usuarios distintos detrás de la misma IP pasan todos. Esto último motivó un cambio de diseño: limitar por IP habría negado el acuse a partir del sexto registrante en una jornada de altas desde una oficina municipal.

**No verificado.** El envío real. Sin `RESEND_API_KEY` configurada el endpoint simula el envío y no prueba nada.

**Atención al retomar.** La Tanda 1 cambia comportamiento visible: una ruta que era exclusiva de admin pasa a ser invocable por cualquier usuario autenticado, acotada a su propia dirección. `AGENTS.md` pide avisar antes de aplicar algo así.

## Pendiente

### Bloqueado por insumos

1. **Resolución N° 72** — no está en el repositorio. El VISTO de la Res. 73 confirma que modificó a la 64. Bloquea N-12 (publicarla en el portal) y puede alterar N-01 a N-09. Resuelve además la discrepancia sobre de quién depende el OGM: la Res. 64 Art. 1° dice Subsecretaría de Estadística, la Res. 73 Art. 4° instruye a la Dirección de Estadística, Control de Calidad y Procesos como autoridad ejecutiva.
2. **Responsable del tratamiento, Delegado de Datos y canal de reclamo** — sin esos tres datos no se puede escribir el texto nuevo de la Política de Privacidad (H-05, H-06, N-06). Requiere además validación jurídica antes de publicarse.
3. **Contenido real de la tabla `categorias`** en producción — necesario para cerrar N-04. No se resuelve leyendo el código.
4. **Decisión normativa** — el derecho de supresión (N-06) choca con la retención obligatoria del RCE por 5 años (Anexo I Art. 13). Definir qué se suprime, qué se anonimiza y qué se conserva, antes de escribir código.

### Tres obligaciones detectadas y todavía no incorporadas al análisis

Surgieron al leer la Resolución 73 completa, después de cerrar `CUMPLIMIENTO_NORMATIVO.md`. Conviene sumarlas en la misma pasada en que se incorpore la Resolución 72.

- **N-13** (Res. 73 Art. 4°.e) — obligación de informar a la Secretaría ante cualquier incidente de seguridad que afecte la integridad, confidencialidad o disponibilidad del sistema. No hay procedimiento de notificación ni en el código ni en `SECURITY_POLICY.md`: la bitácora es registro interno, no aviso.
- **N-14** (Res. 73 Art. 3°) — toda modificación de los T&C exige nueva Resolución de la Secretaría, con número de versión y fecha de entrada en vigor, respetando el plazo de notificación del Art. 11 del Anexo I. Hoy `POST /api/config/:key` permite subir `terms_version` a cualquier valor, sin resolución que lo respalde, sin fecha de vigencia y sin disparar notificación. Es la otra mitad de H-04.
- **N-15** (Res. 73 Art. 4°.c) — publicar y mantener actualizados los medios de contacto oficiales del OG RCU conforme al Art. 15 del Anexo I. Refuerza N-06.

### Trabajo de código

- **Cerrar la Tanda 1** — revisar el diff, probar el envío end-to-end donde `RESEND_API_KEY` esté configurada, y recién ahí evaluar el merge. No mergear a `development` sin revisión explícita (`AGENTS.md`).
- **Tanda 2**, requiere `ALTER TABLE`: H-01 (campos faltantes del RCE e integridad del registro), N-09 (`resolved_by` y `resolved_at` en `solicitudes_acceso`: hoy no queda quién aprobó un acceso ni cuándo), N-03 (metadatos de tableros — falta hasta la columna `description`), N-08 (fundamento normativo de cada restricción de acceso), N-10 (calendario de actualización y vigencia del dato), y persistir la prueba de envío y recepción del acuse.
- **Tanda 3 y siguientes**: H-04 (suspensión automática a 5 días hábiles), N-01 (Registro Único de Fuentes), N-02 (Registro Único de Gestores y rol Gestor de Datos), N-05 (plazo máximo de conservación y purga), N-06 (endpoints de acceso, rectificación y supresión), N-07 (publicación en formato abierto), N-11 (capacidad de producir evidencia para la auditoría externa anual del Art. 20°).

### Detalles menores

- Los `.md` de `normativas/` no se sirven al público: `.md` está en `BLOCKED_EXTENSIONS` y ese filtro corre antes que `PUBLIC_STATIC_PREFIXES`. Para exponerlos hay que sumarlos a `PUBLIC_STATIC_ALLOWLIST` uno por uno — no aflojar el filtro.
- `SECURITY_POLICY.md` sección 3 dice "tres roles"; son cuatro (`admin`, `fiscal`, `lector`, `usuario`). No se corrigió para no mezclar con lo normativo.
