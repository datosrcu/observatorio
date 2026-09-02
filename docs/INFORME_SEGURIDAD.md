# Informe de seguridad — Observatorio de Gestión Municipal (OGM)

**Municipalidad de Río Cuarto — Secretaría de Economía e Innovación / Dirección General de Recursos**

Este documento describe el estado vigente de los controles de seguridad del Observatorio de Gestión Municipal (observatorio.datosriocuarto.gob.ar), a la fecha indicada. Está pensado para dos lectores: quien necesita una visión de conjunto sin entrar al código (gestión, auditoría) y quien desarrolla o mantiene el sistema (referencia técnica de lo que hoy rige y no debe romperse sin evaluación previa).

**Fecha**: 2 de septiembre de 2026.

**Alcance**: aplica al código que corre hoy en producción (`observatorio.datosriocuarto.gob.ar`), que refleja el mismo estado que las ramas de trabajo `main` y `development` del repositorio.

---

## 1. Resumen ejecutivo

El Observatorio es un sistema web (Node.js/Express + MySQL, desplegado en contenedores Docker vía Dokploy) que centraliza tableros de indicadores de gestión pública municipal, con distintos niveles de sensibilidad de la información expuesta.

El acceso al sistema requiere autenticación mediante Firebase Authentication. Las acciones administrativas (gestión de usuarios, tableros, categorías, configuración) exigen, además de estar autenticado, un rol verificado contra la base de datos en cada solicitud — nunca se confía en un rol declarado por el cliente.

El acceso a un tablero o informe específico marcado como confidencial no se otorga de forma automática ni discrecional: pasa por un circuito de solicitud, queda registrado, y requiere aprobación de un usuario con rol de administrador o fiscal municipal. Una vez aprobado, el permiso tiene una fecha de vencimiento.

El código fuente del servidor, los scripts internos y los archivos de configuración no son descargables públicamente: existe un filtro explícito que solo permite servir los archivos necesarios para el funcionamiento del sitio. El acceso a los archivos de los propios tableros (subidos como HTML/ZIP, o desplegados desde repositorios de GitHub) está gobernado por el mismo circuito de permisos que decide si un usuario puede verlos, no solo por si el enlace aparece o no en la interfaz.

La cuenta administradora principal tiene doble factor de autenticación obligatorio en Google Workspace.

**Limitaciones conocidas, vigentes hoy** (detalladas en las secciones correspondientes): el registro de actividad de usuarios depende parcialmente de que el propio navegador del usuario lo reporte, por lo que no constituye evidencia de auditoría forense completa; y algunos tableros que usan proveedores externos (Power BI en su modo gratuito de "Publicar en la web") no admiten restricción de acceso por parte de esos proveedores — están en proceso de migración hacia el mecanismo propio de control de acceso.

---

## 2. Autenticación

- El inicio de sesión se realiza con **Firebase Authentication** (Google OAuth 2.0 o email/contraseña).
- El cliente obtiene un ID Token (JWT) de Firebase y lo envía en cada solicitud protegida (`Authorization: Bearer <token>`).
- El servidor verifica la firma criptográfica de ese token contra Firebase Admin SDK antes de procesar cualquier solicitud protegida. Un token inválido, manipulado o expirado se rechaza (401/403).
- La cuenta administradora principal (`datos@riocuarto.gov.ar`) tiene **segundo factor de autenticación obligatorio** en Google Workspace.

## 3. Autorización basada en roles (RBAC)

Existen cuatro roles, almacenados en la base de datos (`usuarios_perfiles.role`): `admin`, `fiscal`, `lector` y `usuario` (asignado por defecto al registrarse).

Estar autenticado no otorga automáticamente permisos administrativos. Cada ruta administrativa del servidor exige, además del token válido, que un control de rol confirme el permiso consultando la base de datos **en el momento de cada solicitud** — nunca se confía en un rol declarado por el cliente, ni en el token, ni en el cuerpo de la petición.

Están protegidas por rol, entre otras: gestión de usuarios y roles, alta/edición/borrado de tableros e informes, categorías, configuración general, contactos, logs de actividad, consentimientos, solicitudes de acceso y productos estadísticos.

El rol `lector` es de solo lectura: permite ver todos los tableros e informes sin necesidad de estar habilitado individualmente en cada uno, pero no otorga ningún permiso de administración.

## 4. Circuito de autorización de acceso a tableros e informes

Cada tablero o informe tiene, en la base de datos: si requiere sesión (`require_login`), la lista de usuarios habilitados (`allowed_users`), y el vencimiento de ese permiso por usuario (`access_expirations`).

El otorgamiento de acceso a contenido confidencial no queda librado a que el enlace no se muestre en la interfaz: un usuario solicita acceso a un tablero, la solicitud queda registrada en la base de datos, y requiere revisión y aprobación de un usuario con rol `admin` o `fiscal`. Los permisos otorgados tienen fecha de vencimiento (por defecto, 12 meses, salvo que se personalice el plazo).

Este circuito gobierna también el **acceso directo al archivo**, no solo qué aparece habilitado en la interfaz: la descarga o visualización de un tablero/informe con `require_login` activo exige un token de acceso firmado digitalmente (HMAC) y de corta duración (15 minutos), emitido únicamente para usuarios que figuren en la lista de habilitados con permiso vigente. Sin ese token válido, el archivo no se sirve, independientemente de si se conoce o no su URL.

**Excepción explícita, por diseño**: la cuenta administradora principal y cualquier usuario con rol `lector` tienen acceso de lectura a todos los tableros e informes, sin necesidad de figurar individualmente en la lista de usuarios habilitados de cada uno — pensado para roles de supervisión que necesitan visibilidad completa.

## 5. Servido de archivos y protección del código fuente

El servidor solo entrega públicamente los archivos necesarios para el funcionamiento del sitio (páginas HTML del panel público y de administración, scripts de cliente identificados explícitamente, y un conjunto acotado de carpetas de recursos públicos). Cualquier otro archivo del proyecto —incluido el código fuente del servidor, scripts internos, archivos de configuración y credenciales— está bloqueado por defecto: no se sirve salvo que esté explícitamente autorizado.

Esto incluye una lista de veinte tipos de extensión bloqueados por defecto (lenguajes de servidor, backups, configuración, credenciales), independientemente de si el archivo está o no en la lista explícita de excepciones.

## 6. Publicación de tableros

Los tableros pueden construirse de tres formas:

- **Enlace externo embebido** (Power BI, Google Data Studio) — ver limitaciones en la Sección 7.
- **Archivo subido** (HTML, ZIP, PDF o imagen, hasta 50 MB): los ZIP se descomprimen en el servidor de forma segura (verificado que la extracción sanea las rutas internas del archivo, sin riesgo de escritura fuera del directorio destino).
- **Repositorio de GitHub**: el servidor descarga el contenido del repositorio (incluidos repositorios privados) usando una credencial que se usa exclusivamente del lado del servidor — nunca viaja al navegador del usuario ni queda embebida en ninguna URL visible. El tablero desplegado de esta forma queda sirviéndose bajo el mismo mecanismo de control de acceso de la Sección 4. Las actualizaciones se aplican por verificación periódica de cambios en el repositorio, o mediante redespliegue manual desde el panel, siempre con verificación de rol de administrador.

En todos los casos, el archivo resultante queda sujeto al mismo circuito de acceso (`require_login`, `allowed_users`, `access_expirations`) descripto en la Sección 4.

## 7. Tableros externos — Power BI y Google Data Studio (ex Looker Studio)

- **Power BI**: los tableros publicados con la función "Publicar en la web" de Microsoft son, por diseño de esa plataforma en su modalidad gratuita, completamente públicos e indexables por buscadores — no existe una opción de restringirlos a un dominio u organización dentro de esa función. Están en proceso de migración hacia tableros propios (bajo el control de acceso descripto en la Sección 4) o hacia embebido con token, según la licencia disponible.
- **Google Data Studio**: la versión gratuita no ofrece una lista de dominios permitidos para embebido. El control disponible es restringir el informe a cuentas o al dominio de Google Workspace del municipio — mitigación válida hoy porque los tableros con datos confidenciales se comparten únicamente con personal municipal, que posee cuenta institucional; los usuarios externos (sociedad civil, educación, sector privado) acceden solo a tableros públicos.

## 8. Datos personales

La tabla de perfiles de usuario contiene DNI, CUIT y enlaces a documentación legal de cada persona registrada. El acceso de lectura a esa información está restringido a rol `admin`.

## 9. Registro de actividad

Existe un registro de navegación y accesos asociado a usuario y fecha/hora. Una parte de esos eventos la reporta el propio navegador del cliente — no son, por sí solos, evidencia autoritativa de auditoría, ya que un cliente podría evitar que se registre una acción determinada. Los accesos concedidos a archivos protegidos por el circuito de la Sección 4, en cambio, sí quedan registrados de forma autoritativa por el propio servidor en el momento de conceder cada token de acceso.

## 10. Entorno de despliegue

El sistema corre en contenedores Docker administrados con Dokploy. El código de producción refleja el mismo estado documentado en este informe — no hay una versión de desarrollo con controles adicionales que no estén también vigentes en producción.

---

## 11. Limitaciones vigentes y próximos pasos

- El registro de actividad de usuarios (Sección 9) depende en parte del reporte del propio cliente para ciertos eventos de navegación general (no para los accesos a archivos protegidos, que sí son autoritativos).
- La migración de tableros de Power BI y la evaluación de licencias de Google Data Studio para restricción de dominio (Sección 7) están en curso.
- Se está evaluando extender el registro autoritativo de accesos a la totalidad de las interacciones del sistema, no solo a la apertura de archivos protegidos.
