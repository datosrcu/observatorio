# Informe Técnico: Diagnóstico y Solución sobre Revocación / Eliminación Involuntaria de Accesos a Tableros

**Fecha:** 3 de septiembre de 2026  
**Sistema:** Observatorio de Gestión Municipal (OGM) — Río Cuarto  
**Componentes analizados:** Backend Node.js/Express (`server.js`), Frontend Administrativo (`admin.js`), Módulo de Autenticación (`auth.js`), Base de Datos MySQL.  
**Estado:** Diagnóstico completado — Remediación lista para aplicar.

---

## 1. Resumen Ejecutivo

Se investigó el comportamiento anómalo reportado en el cual, tras otorgar accesos a tableros protegidos (como por ejemplo *"Feria Incentiva: Diagnostico de Juventudes RCU"* a los usuarios `tomydiazbergonzi@gmail.com` y `malonso@riocuarto.gov.ar`), los accesos previamente concedidos se pierden o revocan automáticamente al día siguiente.

El análisis exhaustivo del código reveló que **no se trata de un error humano ni de un vencimiento legítimo de fechas**, sino de una **falla de tipado y parsing de datos en el backend (`server.js`)**, agravada por una **desincronización de caché en el panel de administración (`admin.js`)**.

El hallazgo principal radica en que **cada vez que se aprueba una nueva solicitud para un tablero, el backend vacía la lista existente de usuarios autorizados (`allowed_users = []`) debido a un error de ejecución de JavaScript, dejando únicamente al último usuario aprobado y eliminando a todos los anteriores**.

---

## 2. Casos Testigo Analizados

- **Tablero afectado:** *Feria Incentiva: Diagnostico de Juventudes RCU*
- **Usuarios afectados:** 
  - Tomás Díaz (`tomydiazbergonzi@gmail.com`)
  - Miguel Alonso (`malonso@riocuarto.gov.ar`)
- **Comportamiento observado:** Se aprueba el acceso a Tomás Díaz; horas después o al día siguiente se aprueba el acceso a Miguel Alonso (u otro usuario); inmediatamente Tomás Díaz pierde el acceso físico en la base de datos (su correo desaparece del array `allowed_users`).

---

## 3. Diagnóstico Técnico de Causas Raíz

### Causa Raíz 1 (Crítica — Backend): Error de tipo de dato en `/api/solicitudes/:id/aprobar`

En la base de datos MySQL, la columna `allowed_users` de las tablas `tableros` e `informes` está definida con tipo nativo **`JSON`** (`allowed_users JSON`).

El driver de conexión Node.js (`mysql2`) devuelve las columnas de tipo `JSON` **directamente como objetos o arrays nativos de JavaScript** (es decir, `tablero.allowed_users` ya es un `Array`, por ejemplo: `["tomydiazbergonzi@gmail.com"]`).

Sin embargo, en `server.js` (líneas 1483 a 1500 para tableros, y 1517 a 1535 para informes):

```javascript
// server.js (Líneas 1483 - 1500)
if (tablero) {
    let allowed = [];
    try {
        const val = (tablero.allowed_users || '').trim(); // 💥 ERROR EN RUNTIME
        allowed = val ? JSON.parse(val) : [];
    } catch (jsonErr) {
        console.error("Error parsing allowed_users:", jsonErr);
        allowed = []; // 💥 RESETEA LA LISTA A VACÍA []
    }

    let expirations = {};
    try {
        const val = (tablero.access_expirations || '').trim(); // 💥 ERROR EN RUNTIME
        expirations = val ? JSON.parse(val) : {};
    } catch (jsonErr) {
        console.error("Error parsing access_expirations:", jsonErr);
        expirations = {}; // 💥 RESETEA EXPIRACIONES A {}
    }
    
    // Agrega únicamente al nuevo solicitante a la lista vacía
    if (!allowed.map(u => u.toLowerCase()).includes(email.toLowerCase())) allowed.push(email);
    if (expiry_iso) expirations[email.toLowerCase()] = expiry_iso;

    await connection.execute(
        'UPDATE tableros SET allowed_users = ?, access_expirations = ? WHERE id = ?',
        [JSON.stringify(allowed), JSON.stringify(expirations), tablero.id]
    );
}
```

#### Mecanismo del fallo:
1. Al intentar ejecutar `(tablero.allowed_users || '').trim()`, dado que `tablero.allowed_users` es un `Array` (no un `String`), JavaScript lanza la excepción:
   ```text
   TypeError: (tablero.allowed_users || "").trim is not a function
   ```
2. La excepción es capturada por el bloque `catch (jsonErr)`.
3. El bloque `catch` ejecuta `allowed = [];`, **vaciando completamente la lista de usuarios autorizados existentes**.
4. A continuación, `allowed.push(email)` inserta **únicamente al usuario de la solicitud actual**.
5. Se ejecuta el `UPDATE` en MySQL guardando una lista que contiene **solo al último usuario**.
6. **Efecto:** Cada aprobación para un tablero elimina a todos los usuarios previamente aprobados para ese mismo tablero. Al día siguiente, cuando entra una nueva aprobación o cuando el usuario anterior intenta ingresar, ya fue removido.

---

### Causa Raíz 2 (Alta — Frontend): Desincronización de caché en `admin.js`

En `admin.js`, al completar la aprobación de una solicitud:

```javascript
// admin.js (Líneas 787 - 795)
await callApi(`/api/solicitudes/${requestId}/aprobar`, 'POST', {
    email,
    tablero_id: buttonId,
    expiry_iso: expiryISO
});

closeDurationModal();
await loadRequests(); // ⚠️ Se recargan las solicitudes, pero NO los tableros
```

1. La variable global en memoria `allBoardsFetched` contiene el estado de los tableros tal como estaban al abrir la pestaña del panel de administración.
2. Al aprobar una solicitud, la base de datos se actualiza, pero `allBoardsFetched` en el navegador del administrador **no se refresca**.
3. Si el administrador posteriormente se dirige a la pestaña **Tableros** y edita el tablero (para ajustar título, icono, orden, categoría o habilitación) y presiona "Guardar Tablero" ([admin.js:L1584](file:///c:/Users/Usuario/Desktop/Antigravity/web-subse/admin.js#L1584)):
   Se envía la lista de usuarios que estaba en memoria **antes** de la aprobación, sobreescribiendo en MySQL `allowed_users` y revirtiendo la base de datos a su estado anterior.

---

### Causa Raíz 3 (Media — Frontend): Filtrado excluyente en el modal de edición de tableros

En `admin.js`:

```javascript
// admin.js (Líneas 1370 y 1546)
const allowedUsersList = currentlySelectedUsers.filter(email =>
    allUsersFetched.some(u => u.email.toLowerCase() === email) ||
    ADMIN_EMAILS.map(e => e.toLowerCase()).includes(email)
);
```

Si un usuario fue aprobado pero su perfil aún no se encuentra sincronizado en la variable `allUsersFetched` (por ejemplo, si el usuario aún no completó su primer inicio de sesión o hubo una demora de red al obtener `/api/usuarios`), el filtro descarta su dirección de correo y, al presionar "Guardar Tablero", se elimina de `allowed_users`.

---

### Causa Raíz 4 (Higiene / Seguridad — Backend): Ruta duplicada `PATCH /api/tableros/:id`

En `server.js` existen dos definiciones de `PATCH /api/tableros/:id`:
- La primera en la línea 1620 (con verificación de rol `admin`).
- La segunda en la línea 2055 (con lógica completa de serialización JSON).

Express despacha únicamente a la primera. La versión activa (línea 1620) toma `fields.allowed_users` directamente del cuerpo de la petición sin asegurar que sea un string JSON antes de pasarlo a `mysql2.execute`, lo que ante ciertas llamadas REST puede generar inconsistencias en la columna tipo `JSON` de MySQL.

---

## 4. Solución Técnica Propuesta

### Cambio 1: Normalización robusta en `server.js` (Aprobación de Solicitudes)

Modificar tanto el bloque de `tableros` como el de `informes` en `/api/solicitudes/:id/aprobar` para aceptar de forma segura tanto tipos nativos de MySQL (`Array` / `Object`) como cadenas de texto JSON:

```javascript
// server.js - /api/solicitudes/:id/aprobar (reemplazo líneas 1483-1503 y 1517-1537)

// 1. Obtener y parsear allowed_users de forma segura
let allowed = [];
try {
    const rawAllowed = tablero.allowed_users;
    if (Array.isArray(rawAllowed)) {
        allowed = rawAllowed;
    } else if (typeof rawAllowed === 'string' && rawAllowed.trim() !== '') {
        allowed = JSON.parse(rawAllowed);
    }
} catch (jsonErr) {
    console.error("Error parsing allowed_users:", jsonErr);
    allowed = [];
}
if (!Array.isArray(allowed)) allowed = [];

// 2. Obtener y parsear access_expirations de forma segura
let expirations = {};
try {
    const rawExp = tablero.access_expirations;
    if (typeof rawExp === 'object' && rawExp !== null && !Array.isArray(rawExp)) {
        expirations = rawExp;
    } else if (typeof rawExp === 'string' && rawExp.trim() !== '') {
        expirations = JSON.parse(rawExp);
    }
} catch (jsonErr) {
    console.error("Error parsing access_expirations:", jsonErr);
    expirations = {};
}
if (typeof expirations !== 'object' || expirations === null || Array.isArray(expirations)) expirations = {};

// 3. Incorporar el nuevo usuario preservando todos los existentes
const lowerEmail = email.toLowerCase();
if (!allowed.map(u => String(u).toLowerCase()).includes(lowerEmail)) {
    allowed.push(email);
}
if (expiry_iso) {
    expirations[lowerEmail] = expiry_iso;
}
```

*(Aplicar idéntica lógica para la sección de `informes` en las líneas 1517-1544).*

---

### Cambio 2: Actualización de caché en `admin.js` tras aprobaciones

En `admin.js` (función `processApproval`):

```javascript
// admin.js (Línea 794)
await callApi(`/api/solicitudes/${requestId}/aprobar`, 'POST', {
    email,
    tablero_id: buttonId,
    expiry_iso: expiryISO
});

closeDurationModal();
await loadRequests();
await loadBoards(); // 🟢 AGREGAR: Mantiene sincronizada la lista de tableros en memoria
```

---

### Cambio 3: Saneamiento del filtro en edición de tableros (`admin.js`)

En `admin.js` (líneas 1370 y 1546), evitar eliminar usuarios existentes que ya figuren en `allowedUsers` del tablero:

```javascript
// Preservar usuarios que ya estaban autorizados en el tablero, incluso si no figuran temporalmente en allUsersFetched
const allowedUsersList = currentlySelectedUsers.filter(email =>
    allUsersFetched.some(u => u.email.toLowerCase() === email) ||
    ADMIN_EMAILS.map(e => e.toLowerCase()).includes(email) ||
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) // 🟢 Permite preservar emails válidos preexistentes
);
```

---

## 5. Plan de Acción Recomendado

1. **Aplicar la corrección en `server.js` y `admin.js`.**
2. **Restaurar manualmente en la base de datos MySQL los accesos afectados:**
   Para el tablero *"Feria Incentiva: Diagnostico de Juventudes RCU"*, incluir explícitamente en `allowed_users` a `tomydiazbergonzi@gmail.com` y a `malonso@riocuarto.gov.ar`.
3. **Prueba de regresión:**
   - Crear una solicitud de prueba A y aprobarla.
   - Crear una solicitud de prueba B para el mismo tablero y aprobarla.
   - Verificar en la base de datos que `allowed_users` contenga a ambos usuarios simultáneamente: `["usuarioA@...", "usuarioB@..."]`.
