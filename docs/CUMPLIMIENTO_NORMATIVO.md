# Cumplimiento normativo — Observatorio de Gestión Municipal (RCU)

**Estado:** análisis de consistencia norma ↔ implementación. No incluye cambios de código.
**Fecha del análisis:** 2 de septiembre de 2026.
**Repositorio analizado:** `/Users/germansayago/Projects/Gobierno/observatorio` (rama de trabajo local).

## 0. Fuentes normativas y estado de disponibilidad

| Norma | Archivo | Estado |
|---|---|---|
| Ordenanza N° 162/2025 — Modelo de Gobernanza de Datos Públicos | `normativas/Ordenanzas/Ordenanza-162_25.pdf` | Leída completa (24 artículos). Sancionada 3/4/2025. |
| Resolución N° 64/2026 — Creación del OGM | `normativas/Decretos/Resolucion-N°-64-OGRCU.pdf` | Leída completa (11 artículos). Firmada 30/1/2026, Secretaría de Gestión y Participación Ciudadana. |
| Resolución N° 73/2026 + Anexo I (T&C v1.0) | `normativas/Resoluciones/RESOLUCION 73.pdf` | Analizada en sesión previa. |
| **Resolución N° 72/2026 (modificatoria de la 64)** | **No existe en el repositorio ni en el contexto del proyecto** | **NO LEÍDA.** |

> **Advertencia de alcance.** La Resolución N° 72 no está disponible en ninguna de las fuentes cargadas. Todo lo que sigue sobre la Resolución 64 se basa en su **texto original**. Si la 72 modificó artículos (categorías del Art. 3°, funciones del Art. 4°, registros de los Arts. 8° y 9°, o el encuadre institucional del Art. 1°), las brechas N-01 a N-09 pueden variar. **Conseguir la Res. 72 antes de ejecutar correcciones.**

**Dato de exigibilidad:** el Art. 23° de la Ordenanza 162/25 fija entrada en vigencia "en un plazo no mayor a doce meses desde la fecha de su promulgación". Sancionada el 3/4/2025, sus disposiciones son exigibles a la fecha de este análisis.

---

## 1. Obligaciones extraídas, con verificabilidad en código

### 1.1 Ordenanza N° 162/2025

| Art. | Obligación | ¿Verificable en código? |
|---|---|---|
| 5° | Los datos públicos deben constar en formato digital | Sí (parcial) |
| 6° | Datos personales: adecuados, pertinentes y **limitados a lo necesario** (minimización, Ley 25.326) | **Sí** |
| 7° | Dejar asentado explícitamente: qué datos se recogen, medida del tratamiento, fines, **entidad responsable**, derechos del titular y **mecanismos existentes para reclamar** | **Sí** |
| 8°.f | Datos estructurados, en **formatos abiertos**, procesables por máquinas | **Sí** |
| 8°.g | Principio de **no repudio**: autenticidad de las comunicaciones vía seguridad criptográfica, con **pruebas de envío y de recepción** | **Sí** |
| 9°.d | Entrega y divulgación: publicación en formato **digital y abierto** | **Sí** |
| 10° | Excepciones a la publicación deben fundarse en el Art. 16° Ord. 1513/07, confidencialidad Ley 25.326 o norma específica | **Sí** |
| 11°.d | Políticas de seguridad informática tipo ISO/IEC 27001 | Parcial (ver `docs/SECURITY_POLICY.md`) |
| 11°.f | Modalidades de registro y almacenamiento de datos | Sí |
| 11°.h | **Algoritmos implementados** documentados | Sí |
| 11°.i | **Catálogo de metadatos** | **Sí** |
| 12° | Preservación, inventario, actualización y archivo. **Establecer un límite al plazo de conservación de datos personales, favorecer su destrucción sobre su guarda, y explicitar los plazos de supresión o revisión** | **Sí** |
| 13° | **Metadatos mínimos** de las bases: identificador, título, descripción, fecha de creación, temática, autorías, **medio de contacto al autor** y datasets | **Sí** |
| 14°-15° | Área responsable de monitoreo; verificar que los datos sean exactos, completos, identificables, **accesibles por usuarios legítimos y verificables** | Parcial |
| 17° | **Delegado de Datos** designado por la Autoridad de Aplicación | **Sí** (publicidad del contacto) |
| 20° | **Auditoría externa** independiente, designación dentro de 12 meses de la puesta en funcionamiento, **periodicidad anual**, informe con hallazgos y nivel de cumplimiento | **Sí** (capacidad de producir evidencia) |
| 22° | Libre disponibilidad de datos con fines estadísticos gestionados con fondos públicos por terceros | No (contractual) |

### 1.2 Resolución N° 64/2026

| Art. | Obligación | ¿Verificable en código? |
|---|---|---|
| 1° | El OGM depende de la Subsecretaría de Estadística, designada autoridad de aplicación | No (institucional) |
| 2°.2 | Integrar y depurar información **garantizando consistencia y trazabilidad** | **Sí** |
| 2°.5 | Fortalecer la transparencia activa, **facilitando la publicación de datos abiertos cuando corresponda** | **Sí** |
| 3° | El Observatorio trabaja con **13 categorías de datos** taxativas (Gobierno y Gestión; Economía y Finanzas; Ambiente y Agua; Salud; Educación; Recreación; Seguridad; Obras y Servicios Públicos; Transporte; Participación Ciudadana; Desarrollo Social; Desarrollo Económico; Desarrollo Urbano) | **Sí** |
| 4° | Cada área designa un/a **Gestor/a de Datos** con funciones definidas (recolección, validación y carga; cumplimiento de estándares; mantener actualizadas las fuentes; integración con el Observatorio; colaboración en auditorías) | **Sí** |
| 5° | **Fuentes oficiales** del OGM (6 tipos enumerados) | **Sí** |
| 6° | Productos del OGM: tableros de control, **informes periódicos** (mensuales/trimestrales/anuales), **alertas tempranas**, reportes de transparencia | **Sí** |
| 7° | La autoridad de aplicación establecerá: **calendarios de actualización de datos**, estándares técnicos y plantillas de reporte, capacitaciones obligatorias, **protocolos de seguridad, confidencialidad y acceso a los datos** | **Sí** (parcial) |
| 8° | **Registro Único de Fuentes (RUF)**: área gestora, tipo de fuente (manual/informática/otra), alojamiento, otros | **Sí** |
| 9° | **Registro Único de Gestores de Datos (RUG)**: apellido y nombres, área, mail/teléfono, fuente gestionada | **Sí** |
| 11° | Protocolícese, notifíquese, tómese razón, archívese | No |

---

## 2. Brechas consolidadas

Notación: **H-xx** = hallazgo confirmado en la sesión previa (Res. 73/Anexo I). **N-xx** = brecha nueva, surgida de la Ordenanza 162/25 y la Resolución 64/26.

### 2.1 Hallazgos previos — efecto de las normas nuevas

#### H-01 · RCE incompleto → **AGRAVADO**

- **Exige:** Art. 13, Anexo I Res. 73 (8 campos mínimos, entre ellos finalidad declarada y tablero/s otorgados). **Se suma** Ord. 162 Art. 8°.g (no repudio: autenticidad criptográfica de las comunicaciones) y Art. 12° (registro y archivo con integridad).
- **Hoy:** `rce_consentimientos` (`server.js:1013-1022`) guarda `user_uid, user_email, user_name, dni, ip_address, terms_version, timestamp`. El endpoint `POST /api/rce` (`server.js:2335-2351`) inserta esos campos y nada más. Finalidad y tablero viven en `solicitudes_acceso.reason` / `.reason_detail` / `.dashboard_name` (`server.js:894-905`), sin FK al RCE.
- **Brecha:** faltan 2 de los 8 campos obligatorios del registro que debe conservarse 5 años. **Adicionalmente**, el registro no tiene hash, firma ni sello temporal verificable: no satisface el principio de no repudio del Art. 8°.g. Un RCE hoy es una fila mutable de MySQL sin prueba de integridad.

#### H-02 · Acuse de recibo automático no se envía → **AGRAVADO**

- **Exige:** Art. 14, Anexo I Res. 73. **Se suma** Ord. 162 Art. 8°.g, que exige explícitamente "pruebas de envío" y "pruebas de recepción".
- **Hoy:** `auth.js:2347` dispara la llamada; `POST /api/enviar-bienvenida` (`server.js:1339`) está bajo `requireRole('admin')`. Un usuario recién registrado tiene rol `usuario` → 403, silenciado en `.catch(console.warn)`. La plantilla (`plantilla_bienvenida_ogm.html`) sólo interpola el nombre: no incluye fecha/hora de aceptación ni número de registro.
- **Brecha:** el acuse no llega. Y no existe ningún registro de envío ni de recepción: el `emailId` que devuelve Resend (`server.js:1411`) no se persiste en ninguna tabla. Aunque el correo se enviara, no habría prueba de envío ni de recepción exigible por el Art. 8°.g.

#### H-03 · Denegaciones de acceso no se registran → **AGRAVADO**

- **Exige:** Art. 16.3, Anexo I Res. 73 (accesos permitidos **y denegados**, retención 2 años). **Se suma** Res. 64 Art. 2°.2 (trazabilidad) y Ord. 162 Art. 20° (auditoría externa anual sobre integridad, consistencia y seguridad).
- **Hoy:** en el guard de `/uploads`, la rama de éxito inserta en `logs_actividad` (`server.js:620-632`); la rama 403 (`server.js:615-617`) devuelve `res.status(403).send('Acceso no autorizado.')` sin escribir nada.
- **Brecha:** no hay rastro de accesos denegados. **Agravante nuevo:** el único medio de consulta de la traza, `GET /api/logs` (`server.js:2437-2450`), aplica `ORDER BY created_at DESC LIMIT 500` fijo, sin paginación, sin filtro por fecha y sin exportación. Los registros permanecen en la tabla, pero la superficie de consulta expone sólo los últimos 500 eventos: un auditor externo (Art. 20°) no puede obtener del sistema la traza de un período pasado.

#### H-04 · Suspensión automática a 5 días hábiles no implementada → **CONFIRMADO**

- **Exige:** Art. 5, Res. 73.
- **Hoy:** el único `setInterval` de `server.js` es `pollGithubBoards` (`server.js:2957`). No hay `node-cron` ni job alguno. No existe columna de estado de suspensión en `usuarios_perfiles` (`server.js:868-886`).
- **Brecha:** sin cambios respecto de lo ya establecido. Ni la Ordenanza 162 ni la Resolución 64 agregan requisitos sobre este punto.

#### H-05 · Política de Privacidad desfasada de los datos recolectados → **AGRAVADO**

- **Exige:** Anexo I Res. 73 + Ley 25.326. **Se suma** Ord. 162 **Art. 6°** (datos "adecuados, pertinentes y limitados a lo necesario") y **Art. 7°** (dejar asentado explícitamente qué datos se recogen, la medida del tratamiento, los fines, la entidad responsable, los derechos y los mecanismos para reclamar).
- **Hoy:** el modal (`Index.html:846-848`, duplicado en `observatorio-gestion.html:~1760-1790`) declara que se recolecta "nombre y correo electrónico" y que "no recolectamos datos sensibles". `POST /api/perfil` (`server.js:1293`) persiste en `usuarios_perfiles`: `dni`, `cuit`, `organization_name`, `organization_type`, `role_position`, `role_detail`, `expiry_date`, `legal_file_url` (archivo de respaldo cargado a Firebase Storage). El DNI se persiste **una segunda vez** en `rce_consentimientos.dni`.
- **Brecha (doble):**
  1. *Información*: la declaración es falsa respecto de lo que el sistema recolecta. El Art. 7° exige que esto conste explícitamente.
  2. *Minimización (nueva)*: el Art. 6° condiciona el tratamiento a que "la finalidad de su disponibilidad no pudiera lograrse razonablemente por otros medios". El `legal_file_url` — potencialmente una imagen de DNI — y la duplicación del DNI en dos tablas no tienen justificación documentada en el sistema. No hay campo, comentario ni registro que fundamente la necesidad de cada dato.

#### H-06 · La Política de Privacidad no tiene mecanismo de aceptación propio → **CONFIRMADO Y AMPLIADO**

- **Exige:** Res. 73 (por contraste con el circuito del Anexo I). **Se suma** Ord. 162 Art. 7° y Art. 17°.
- **Hoy:** `terms_accepted_version` y el RCE están atados sólo a los T&C. La Política de Privacidad es HTML hardcodeado sin versión, sin resolución de respaldo y sin registro de aceptación.
- **Brecha:** además de lo ya señalado, la política **no identifica a la entidad responsable del tratamiento** ni ofrece **canal de reclamo**. `Index.html:862` enuncia el derecho de acceso, rectificación y supresión "en el marco de la normativa vigente", pero no indica ante quién ejercerlo, por qué medio ni en qué plazo. El Art. 7° exige explicitar "los mecanismos existentes para reclamar su cumplimiento". Ver N-06.

---

### 2.2 Brechas nuevas

#### N-01 · No existe el Registro Único de Fuentes (RUF)

- **Norma:** Res. 64/2026, **Art. 8°** — "Créase el Registro único de fuentes del OGM (RUF) a cargo de la autoridad de aplicación que deberá contener datos vinculados: área gestora de los datos contenidos; tipo de fuente: manual, informática, otra; alojamiento; otros de interés". Concordante con Ord. 162 Art. 5° (fuentes oficiales del OGM) y Art. 11°.b.
- **Hoy:** cero ocurrencias de "RUF" o "fuente" como entidad en `server.js`, `admin.js`, `auth.js`. No hay tabla de fuentes entre las 13 creadas en `initializeTables` (`server.js:860-1090`). La tabla `tableros` (`server.js:979-996`) guarda `iframe_url` y `file_path` — la ubicación de la *visualización*, no la fuente del *dato*.
- **Brecha:** el registro creado por el Art. 8° no tiene ninguna representación en el sistema. No es posible responder, desde el Observatorio, qué área gestiona los datos de un tablero dado ni de qué tipo de fuente provienen.

#### N-02 · No existe el Registro Único de Gestores de Datos (RUG) ni el rol de Gestor de Datos

- **Norma:** Res. 64/2026, **Art. 9°** (RUG: apellido y nombres, área, mail/teléfono, fuente gestionada) y **Art. 4°** (cada Secretaría, Subsecretaría, Dirección o Entidad Descentralizada designa un/a Gestor/a de Datos con cinco funciones definidas).
- **Hoy:** los roles existentes en el backend son `admin` (25 endpoints), `fiscal` (6 endpoints, siempre junto a admin), `lector` (`server.js:80`) y `usuario` (default, `server.js:888`). El selector de roles del panel de administración (`admin.js:507-508`) sólo ofrece `usuario` y `lector`. Cero ocurrencias de "gestor" como rol.
- **Brecha:** el rol institucional que la Resolución 64 hace obligatorio para cada área no existe en el modelo de permisos, y el registro de esas personas y de la fuente que cada una gestiona no está implementado. Sin RUG, la función del Art. 4° "colaborar en auditorías técnicas de calidad de datos" no tiene destinatario identificable en el sistema.

#### N-03 · Metadatos mínimos ausentes en `tableros`

- **Norma:** Ord. 162/2025, **Art. 13°** — metadatos mínimos: identificador, título, descripción, fecha de creación, temática, **autorías**, **medio de contacto al autor**, **datasets**. Concordante con Art. 11°.i (catálogo de metadatos).
- **Hoy:** `CREATE TABLE tableros` (`server.js:979-996`) tiene: `id`, `title`, `icon`, `iframe_url`, `file_path`, `enabled`, `require_login`, `open_in_new_tab`, `sort_order`, `allowed_users`, `access_expirations`, `categories`, `category_legacy`, `created_at`, `updated_at`. **No existe columna `description`** (verificado: cero coincidencias de `description` en el bloque de tableros).
- **Brecha por campo:**

| Metadato Art. 13° | Estado en `tableros` |
|---|---|
| identificador | ✔ `id` |
| título | ✔ `title` |
| descripción | ✘ **no existe la columna** |
| fecha de creación | ✔ `created_at` |
| temática | ~ `categories` (parcial, ver N-04) |
| autorías | ✘ |
| medio de contacto al autor | ✘ |
| datasets | ✘ |

  La tabla `informes` (`server.js:1043-1061`) está mejor: tiene `description`, `period`, `year`, `categories`, `created_at`; le faltan igualmente autoría, contacto y datasets.

#### N-04 · Las categorías del sistema no están ancladas a las 13 categorías de datos del Art. 3°

- **Norma:** Res. 64/2026, **Art. 3°** — enumera 13 categorías de datos con las que trabaja el Observatorio, modificables sólo por la autoridad de aplicación.
- **Hoy:** la tabla `categorias` (`server.js:964-976`) es de texto libre: `id`, `name`, `description`, `icon`, `type`, `color`, `visible`, `sort_order`. Se crean y editan por `POST /api/categorias` (`server.js:1766`) sin validación contra un catálogo cerrado. Los datos de respaldo del código (`MOCK_CATEGORIES`, `server.js:~645-652`) usan un esquema distinto: "Gestión Municipal", "Hacienda y Finanzas", "Indicadores Públicos", "Clima Laboral", "Satisfacción Ciudadana".
- **Brecha:** no hay correspondencia forzada entre la taxonomía operativa del sistema y la taxonomía normativa del Art. 3°. Un tablero puede publicarse sin pertenecer a ninguna de las 13 categorías.
- **A verificar antes de decidir:** el contenido real de la tabla `categorias` en la base productiva. Los `MOCK_CATEGORIES` son datos de respaldo, no reflejan necesariamente lo cargado. Este punto no puede cerrarse desde el código.

#### N-05 · No hay plazo máximo de conservación de datos personales ni supresión implementada

- **Norma:** Ord. 162/2025, **Art. 12°** — "Se deberá establecer un límite al plazo de conservación de datos personales, debiendo **favorecer su destrucción por sobre su guarda**, y explicitar los plazos para su supresión o revisión."
- **Hoy:** cero ocurrencias de "retención", "conservación", "supresión" o "purga" en el backend. Cero `DELETE FROM logs_actividad`, `DELETE FROM rce_consentimientos` o `DELETE FROM solicitudes_acceso`. No hay job programado (único `setInterval`: `server.js:2957`, GitHub polling). Ninguna tabla tiene columna de fecha de supresión prevista.
- **Brecha:** el sistema sólo acumula. Los mínimos de retención del Anexo I (RCE 5 años, logs 2 años) están planteados como pisos; el Art. 12° exige además un **techo** y su ejecución efectiva, y ninguno de los dos existe. No hay nada en el sistema que documente ni ejecute un plazo de supresión.

#### N-06 · El derecho de acceso, rectificación y supresión no tiene canal ni implementación

- **Norma:** Ord. 162/2025, **Art. 7°** (explicitar "los mecanismos existentes para reclamar su cumplimiento") y **Art. 17°** (el Delegado de Datos tiene por función informar y asesorar sobre las obligaciones de tratamiento y supervisar el cumplimiento).
- **Hoy:**
  - El texto (`Index.html:862`, `observatorio-gestion.html:1786-1787`) enuncia el derecho sin canal, sin plazo y sin responsable.
  - No existe ningún endpoint que permita a un usuario ejercerlo: en las 60 rutas de `server.js` no hay `DELETE /api/perfil`, ni endpoint de rectificación, ni de exportación de datos propios.
  - La única baja es `DELETE /api/usuarios/:email` (`server.js:2525-2606`), bajo `requireRole('admin')`, y **es parcial**: borra la fila de `usuarios_perfiles` y limpia `allowed_users`/`access_expirations` de tableros e informes, pero **no toca** `rce_consentimientos` (que conserva nombre, email, DNI e IP), ni `logs_actividad`, ni `solicitudes_acceso`, ni `feedback_web`, ni `feedback_tableros`, ni `mensajes_contacto`, ni el archivo `legal_file_url` en Firebase Storage. La baja tampoco se registra en `logs_actividad`.
  - "Delegado" tiene cero ocurrencias en todo el frontend: el contacto del Art. 17° no está publicado.
- **Brecha:** hay un derecho declarado sin ningún mecanismo detrás. Y el mecanismo administrativo que sí existe (la baja por admin) deja datos personales identificables — DNI e IP en el RCE, la imagen de respaldo legal en Storage — sin ninguna decisión explícita sobre su destino.
- **Tensión a resolver, no a implementar a ciegas:** el RCE tiene retención obligatoria de 5 años (Anexo I Art. 13). Una supresión total al ejercer el derecho colisionaría con esa obligación. La decisión normativa sobre qué se suprime, qué se anonimiza y qué se conserva es previa al código.

#### N-07 · Sin publicación en formatos abiertos ni procesables por máquina

- **Norma:** Ord. 162/2025, **Art. 8°.f** (datos estructurados en formatos abiertos, tratables automáticamente), **Art. 9°.d** (publicación en formato digital y abierto) y Res. 64/2026 **Art. 2°.5** (transparencia activa facilitando la publicación de datos abiertos cuando corresponda).
- **Hoy:** los tableros se sirven como `iframe_url` o archivos HTML estáticos bajo `/uploads` (`server.js:979-996`, guard en `server.js:560-645`). No hay endpoint de exportación de datos, ni CSV, ni API pública de datasets (cero ocurrencias de "csv" y de "datos abiertos" en el backend). Los `informes` se sirven como `url`, `pdf`, `image` o `html` (`server.js:1049`).
- **Brecha:** el Observatorio publica visualizaciones, no datos. Ningún dato del sistema es hoy descargable en formato procesable por máquina.
- **Contradicción declarativa asociada:** los T&C del portal (`Index.html:812`) afirman que el contenido "se rige por las políticas de **Datos Abiertos** de la Municipalidad (Ordenanza 162/2025). Se autoriza su uso citando siempre la fuente oficial." La implementación real es acceso restringido por lista blanca de emails con vencimiento (`tableros.allowed_users` / `access_expirations`), sin descarga de datos y sin licencia declarada. El texto público describe un régimen que el sistema no aplica.

#### N-08 · Las restricciones de acceso no registran su fundamento normativo

- **Norma:** Ord. 162/2025, **Art. 10°** — la excepción a la obligación de publicación e intercambio procede sólo por los motivos del Art. 16° de la Ord. 1513/07, por confidencialidad en los términos de la Ley 25.326, o por normas específicas.
- **Hoy:** `tableros.require_login` e `informes.require_login` son booleanos (`server.js:985`, `server.js:1054`). No hay campo que registre la causal, la norma invocada ni el acto que dispuso la restricción. `POST /api/tableros` (`server.js:1805`) y `PATCH /api/tableros/:id` (`server.js:2056`) no la piden.
- **Brecha:** cada tablero restringido es una excepción al principio de publicidad del Art. 9°.d sin fundamento registrado. Ante una auditoría (Art. 20°) o un pedido de acceso a la información, el sistema no puede acreditar por qué un tablero determinado no es público.

#### N-09 · Trazabilidad insuficiente del acto de otorgamiento de acceso

- **Norma:** Res. 64/2026, **Art. 2°.2** (consistencia y trazabilidad) y Ord. 162/2025 **Art. 8°.g** (no repudio, autenticidad de las comunicaciones y prueba de las partes).
- **Hoy:** `POST /api/solicitudes/:id/aprobar` (`server.js:1473-1556`) agrega el email a `allowed_users`, fija el vencimiento y ejecuta `UPDATE solicitudes_acceso SET status = 'aprobado', admin_comment = ?`. La tabla `solicitudes_acceso` (`server.js:894-905`) no tiene columnas `resolved_by` ni `resolved_at`: la identidad del administrador que aprobó y el momento exacto de la decisión no se persisten en ninguna parte. `PATCH /api/solicitudes/:id/status` (`server.js:1459`) tampoco los registra. La aprobación y el rechazo no notifican al solicitante (el único envío de correo del sistema es el de bienvenida, `server.js:1411`).
- **Brecha:** no se puede reconstruir quién otorgó un acceso ni cuándo. El otorgamiento de acceso a datos restringidos es una decisión que el sistema ejecuta sin dejar autor.

#### N-10 · Sin calendario de actualización ni indicación de vigencia del dato

- **Norma:** Res. 64/2026, **Art. 7°** (la autoridad de aplicación establecerá los calendarios de actualización de datos) y Ord. 162/2025 **Art. 8°.b** (datos oportunos, actualizados en un tiempo apropiado) y **Art. 11°.e** (lineamiento de validez temporal y requerimientos de actualización por conjunto de datos).
- **Hoy:** `tableros` no tiene ningún campo de periodicidad, fecha de último dato ni próxima actualización — sólo `updated_at`, que refleja la edición del registro, no la actualización del dato. La única fecha de actualización visible al usuario está **hardcodeada en el HTML**: `observatorio-gestion.html:182` muestra "actualización: 12 de Marzo, 2026". `informes` tiene `period` y `year`, sin calendario. La tabla `productos_estadisticos` sí tiene `periodicity` (`server.js:920`), pero corresponde al circuito de pedidos a demanda, no a los tableros publicados.
- **Brecha:** el sistema no expresa la vigencia temporal de ningún tablero, y la única fecha que ve el ciudadano es un literal en el código fuente que no se actualiza solo.

#### N-11 · Sin capacidad de producir evidencia para la auditoría externa anual

- **Norma:** Ord. 162/2025, **Art. 20°** — auditoría externa independiente, designación dentro de los 12 meses de la puesta en funcionamiento, **periodicidad anual**, informe con hallazgos, recomendaciones y nivel de cumplimiento de los estándares. **Art. 15°.a**: los datos deben ser verificables.
- **Hoy:** las superficies de consulta administrativa son `GET /api/logs` (`server.js:2437-2450`, `LIMIT 500` fijo, sin filtros ni exportación) y `GET /api/rce-all` (`server.js:2453-2461`, `SELECT *` completo sin paginación). No hay endpoint de exportación, ni informes de cumplimiento, ni rol de auditor (los roles son `admin`, `fiscal`, `lector`, `usuario`).
- **Brecha:** el auditor externo del Art. 20° no tiene ninguna vía de acceso propia ni forma de obtener del sistema la evidencia de un período. `GET /api/rce-all` sin paginación es además un problema operativo a medida que crezca el RCE.

#### N-12 · Resolución N° 72 no publicada en el portal

- **Norma:** Ord. 162/2025 Art. 24° (comuníquese, publíquese) y Res. 64/2026 Art. 11° (protocolícese, notifíquese). Concordante con el principio de publicidad de los actos.
- **Hoy:** el desplegable de normativa del portal (`observatorio-gestion.html:247`, `:266`, `:279`) enlaza la Ordenanza 162/25, la Resolución 64 y la Resolución 73. La Resolución 72 no está enlazada, no existe como archivo en `normativas/` y no aparece mencionada en ningún archivo del repositorio.
- **Brecha:** la norma que modifica el acto de creación del Observatorio no está publicada en el propio Observatorio. La Resolución 64 se ofrece al público en su versión original, sin la modificatoria.

---

## 3. Obligaciones que no se resuelven en código

Se registran para separar lo que corresponde a desarrollo de lo que corresponde a decisión institucional.

| Norma | Obligación | Naturaleza |
|---|---|---|
| Ord. 162 Art. 9°.a y 11° | **Plan de Gestión de Datos** con objetivos, metas, recursos, secuencia, responsables y tiempos; y los 9 contenidos mínimos del Art. 11° (incluidos algoritmos implementados y catálogo de metadatos) | Documento a producir. No existe en `docs/`. |
| Ord. 162 Art. 14° | Designar el área o unidad responsable de monitoreo | Acto administrativo. |
| Ord. 162 Art. 17° | Designar el Delegado de Datos | Acto administrativo. Su **contacto** sí debe publicarse en el sistema → N-06. |
| Ord. 162 Art. 20°-21° | Designar auditor externo (plazo 12 meses desde puesta en funcionamiento) con los requisitos del Art. 21° | Acto administrativo. Su **capacidad de auditar** depende del sistema → N-11. |
| Ord. 162 Art. 22° | Libre disponibilidad de los datos gestionados por terceros con fondos públicos | Cláusula contractual. |
| Res. 64 Art. 7° | Capacitaciones obligatorias para Gestores de Datos; estándares técnicos y plantillas de reporte | Programa institucional. |
| Res. 64 Art. 6° | Alertas tempranas para decisiones operativas o estratégicas | Producto del OGM. No implementado (el sistema produce tableros e informes, no alertas). |

---

## 4. Resumen

| ID | Brecha | Norma | Severidad relativa |
|---|---|---|---|
| H-01 | RCE sin finalidad ni tablero; sin prueba de integridad | Anexo I Art. 13 + Ord. 162 Art. 8°.g | Alta — agravada |
| H-02 | Acuse de recibo no se envía; sin prueba de envío/recepción | Anexo I Art. 14 + Ord. 162 Art. 8°.g | Alta — agravada |
| H-03 | Denegaciones no registradas; traza consultable capada a 500 | Anexo I Art. 16.3 + Ord. 162 Art. 20° | Alta — agravada |
| H-04 | Sin suspensión automática a 5 días hábiles | Res. 73 Art. 5 | Alta — sin cambios |
| H-05 | Política de Privacidad ≠ datos recolectados; sin minimización acreditada | Ord. 162 Arts. 6° y 7° | Alta — agravada |
| H-06 | Política de Privacidad sin versión, sin aceptación, sin responsable | Ord. 162 Arts. 7° y 17° | Media — ampliada |
| N-01 | No existe el RUF | Res. 64 Art. 8° | Alta |
| N-02 | No existe el RUG ni el rol Gestor de Datos | Res. 64 Arts. 4° y 9° | Alta |
| N-03 | Metadatos mínimos ausentes (`tableros` sin `description`, autoría, contacto, datasets) | Ord. 162 Art. 13° | Alta |
| N-04 | Categorías no ancladas a las 13 del Art. 3° | Res. 64 Art. 3° | Media (verificar en BD) |
| N-05 | Sin plazo máximo de conservación ni supresión implementada | Ord. 162 Art. 12° | Alta |
| N-06 | Derecho ARCO sin canal ni implementación; baja de usuario parcial | Ord. 162 Arts. 7° y 17° | Alta |
| N-07 | Sin datos en formato abierto; T&C declaran un régimen que no se aplica | Ord. 162 Arts. 8°.f y 9°.d | Alta |
| N-08 | Restricciones de acceso sin fundamento normativo registrado | Ord. 162 Art. 10° | Media |
| N-09 | Aprobación de acceso sin autor ni fecha de decisión; sin notificación | Res. 64 Art. 2°.2 + Ord. 162 Art. 8°.g | Alta |
| N-10 | Sin calendario de actualización; fecha hardcodeada en HTML | Res. 64 Art. 7° + Ord. 162 Art. 8°.b | Media |
| N-11 | Sin capacidad de producir evidencia de auditoría | Ord. 162 Art. 20° | Media |
| N-12 | Resolución 72 no publicada en el portal | Ord. 162 Art. 24° / Res. 64 Art. 11° | Media |

**Antes de ejecutar correcciones, dos insumos pendientes:**

1. **Resolución N° 72/2026** — no disponible. Puede alterar N-01 a N-09.
2. **Contenido real de la tabla `categorias`** en producción — necesario para cerrar N-04.

**Decisión normativa previa al código:** el conflicto entre el derecho de supresión (N-06) y la retención obligatoria del RCE por 5 años (Anexo I Art. 13) debe resolverse en sede normativa antes de implementarse.
