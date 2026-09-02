# Estado del trabajo de cumplimiento normativo — OG RCU

Actualizado: 2 de septiembre de 2026. Complementa `docs/CUMPLIMIENTO_NORMATIVO.md` (el análisis de brechas). Ese documento dice qué exige cada norma y qué hace el sistema; éste dice qué se hizo, qué falta y con qué está bloqueado.

**Traspaso.** El trabajo quedó en la rama `feat/cumplimiento-normativo`. Quien continúe: leer primero `CUMPLIMIENTO_NORMATIVO.md`, después la entrada más reciente de `SECURITY_LOG.md`, y tener presente la regla de oro de `AGENTS.md` — esto es producción con usuarios reales.

## Hecho

**Análisis.** Leídas completas la Ordenanza 162/25 y las Resoluciones 64, 72 y 73. Los cuatro PDF son escaneos sin capa de texto y se leyeron página por página. Resultado: 22 brechas norma↔código en `CUMPLIMIENTO_NORMATIVO.md` — 6 previas (H-01 a H-06) y 16 nuevas (N-01 a N-16). Ninguna de las 6 previas se matiza; cuatro se agravan.

**Alcance de la Resolución 72**, que era el bloqueo principal: es estrecha. Renombra el OGM como **OG RCU** y designa autoridad de aplicación a la **Dirección de Estadística, Control de Calidad y Procesos** (la Subsecretaría de Estadística dejó de existir con la Ordenanza 350/2026). No toca los artículos sustantivos de la Resolución 64 — categorías, Gestor/a de Datos, fuentes, RUF, RUG —, así que **N-01 a N-09 quedan como estaban**; cambia sólo quién es el sujeto obligado. Queda resuelta la discrepancia de dependencia entre la Res. 64 y la Res. 73: rige la Dirección de Estadística, Control de Calidad y Procesos.

**Código.** Rama `feat/cumplimiento-normativo`, creada desde `development`:

- **Tanda 1, sin cambios de esquema:**
  - **H-02** — `/api/enviar-bienvenida` exigía `requireRole('admin')` y su único llamador es el registro de un usuario común: la ruta era inalcanzable y el acuse obligatorio del Anexo I Art. 14 no se enviaba nunca. Pasa a autorización propia, con el destinatario tomado del token verificado y no del body, más un limitador por usuario (10/hora). `/api/rce` devuelve ahora `insertId` y `timestamp` como número de registro y fecha de aceptación — no hizo falta columna nueva. `auth.js` encadena ambas llamadas y deja de silenciar los fallos. La plantilla incorpora el bloque de constancia.
  - **H-03** — eran tres ramas de denegación en dos guardias, no una. Se registran los dos 403 (`/uploads` y proxy de GitHub) con `registrarAccesoDenegado()`. El 404 del proxy queda fuera por decisión explícita, comentada en el código: es una ruta inexistente, no la denegación de un acceso, y generaría ruido que hoy ninguna purga contiene.
  - **N-12** — la Resolución 72 se incorporó al repositorio y se enlazó en el desplegable de normativa del portal, entre la Res. 64 y la Res. 73.
  - `CUMPLIMIENTO_NORMATIVO.md` versionado; `SECURITY_LOG.md` y `SECURITY_POLICY.md` (secciones 3 y 9) actualizados en el mismo commit, como pide `AGENTS.md`.
- **Transcripciones** de las cuatro normas a markdown, cotejadas artículo por artículo contra los PDF. Los originales son escaneos: no se pueden buscar ni citar.

**Verificado.** `node --check` en `server.js` y `auth.js`. Prueba aislada del formato de la constancia (zona Córdoba, versión, número de registro, y los casos sin dato → "No disponible"). Prueba aislada del limitador con `express-rate-limit` 8.7: 12 peticiones del mismo usuario cortan en la 11, y 8 usuarios distintos detrás de la misma IP pasan todos. Esto último motivó un cambio de diseño: limitar por IP habría negado el acuse a partir del sexto registrante en una jornada de altas desde una oficina municipal.

**No verificado.** El envío real. Sin `RESEND_API_KEY` configurada el endpoint simula el envío y no prueba nada. Tampoco se probó el render del desplegable de normativa tras sumar la Res. 72.

**Atención al retomar.** La Tanda 1 cambia comportamiento visible: una ruta que era exclusiva de admin pasa a ser invocable por cualquier usuario autenticado, acotada a su propia dirección. `AGENTS.md` pide avisar antes de aplicar algo así.

## Pendiente

### Bloqueado por insumos

1. **Responsable del tratamiento, Delegado de Datos y canal de reclamo** — sin esos tres datos no se puede escribir el texto nuevo de la Política de Privacidad (H-05, H-06, N-06, N-15). Requiere además validación jurídica antes de publicarse.
2. **Contenido real de la tabla `categorias`** en producción — necesario para cerrar N-04. No se resuelve leyendo el código.
3. **Art. 15° del Anexo I** — enumera los medios de contacto oficiales que hay que publicar (N-15). El Anexo I no está en el PDF de la Res. 73: vive en `normativas/Terminos/Terminos_y_Condiciones_OGM_RioCuarto_v1.htm`. Confirmar ahí el listado exacto.
4. **Decisión normativa** — el derecho de supresión (N-06) choca con la retención obligatoria del RCE por 5 años (Anexo I Art. 13). Definir qué se suprime, qué se anonimiza y qué se conserva, antes de escribir código.

### Trabajo de código

- **Cerrar la Tanda 1** — revisar el diff, probar el envío end-to-end donde `RESEND_API_KEY` esté configurada, y recién ahí evaluar el merge. No mergear a `development` sin revisión explícita (`AGENTS.md`).
- **Tanda 2**, requiere `ALTER TABLE`: H-01 (campos faltantes del RCE e integridad del registro), **N-14** (número de resolución y fecha de entrada en vigor de cada versión de los T&C — sin la fecha de vigencia almacenada, el plazo de 5 días hábiles del Art. 5° ni siquiera es computable, así que esto va antes que H-04), N-09 (`resolved_by` y `resolved_at` en `solicitudes_acceso`: hoy no queda quién aprobó un acceso ni cuándo), N-03 (metadatos de tableros — falta hasta la columna `description`), N-08 (fundamento normativo de cada restricción de acceso), N-10 (calendario de actualización y vigencia del dato), y persistir la prueba de envío y recepción del acuse.
- **Tanda 3 y siguientes**: H-04 (suspensión automática a 5 días hábiles, después de N-14), N-01 (Registro Único de Fuentes), N-02 (Registro Único de Gestores y rol Gestor de Datos), N-05 (plazo máximo de conservación y purga), N-06 (endpoints de acceso, rectificación y supresión), N-07 (publicación en formato abierto), N-11 (capacidad de producir evidencia para la auditoría externa anual del Art. 20°), N-13 (procedimiento de notificación de incidentes a la Secretaría).
- **N-16**, cuando convenga: el sistema usa `OGM` 18 veces y `OG RCU` una sola, pero la denominación oficial cambió con la Res. 72 Art. 1°. Alcanza al asunto del correo de bienvenida, a `plantilla_bienvenida_ogm.html` y al nombre del archivo de T&C. No es un find-and-replace ciego: esos nombres de archivo están referenciados en `server.js` y en el filtro de estáticos.

### Detalles menores

- Los `.md` de `normativas/` no se sirven al público: `.md` está en `BLOCKED_EXTENSIONS` y ese filtro corre antes que `PUBLIC_STATIC_PREFIXES`. Para exponerlos hay que sumarlos a `PUBLIC_STATIC_ALLOWLIST` uno por uno — no aflojar el filtro. Los `.pdf` sí se sirven.
- `SECURITY_POLICY.md` sección 3 dice "tres roles"; son cuatro (`admin`, `fiscal`, `lector`, `usuario`). No se corrigió para no mezclar con lo normativo.
