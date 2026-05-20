const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const admin = require('firebase-admin');
require('dotenv').config();

// Inicializar Firebase Admin
try {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
    console.log('Firebase Admin inicializado correctamente.');
} catch (error) {
    console.error('Error al inicializar Firebase Admin:', error.message);
}

const app = express();
const PORT = process.env.PORT || 8080;

// Servir archivos estáticos desde la raíz
app.use(express.static(path.join(__dirname)));
app.use(express.json()); // Asegurar que pueda leer JSON en el body
app.use(cors());

// Middleware para verificar el Token de Firebase
const verifyToken = async (req, res, next) => {
    const idToken = req.headers.authorization?.split('Bearer ')[1];
    
    if (!idToken) {
        return res.status(401).json({ error: 'No se proporcionó un token de autenticación.' });
    }

    try {
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        req.user = decodedToken;
        next();
    } catch (error) {
        console.error('Error al verificar token:', error);
        res.status(403).json({ error: 'Token inválido o expirado.' });
    }
};

// Middleware de seguridad
app.use(helmet({
    contentSecurityPolicy: false, // Desactivado para permitir scripts externos de Firebase por ahora
}));
app.use(cors());
app.use(express.json());

// Limitador de tasa (Rate Limiting) para prevenir scraping y abusos
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutos
    max: 100, // Limita cada IP a 100 peticiones por ventana (cada 15 min)
    message: {
        error: 'Demasiadas peticiones desde esta IP. Por favor, intente de nuevo más tarde.',
        code: 'TOO_MANY_REQUESTS'
    },
    standardHeaders: true, // Retorna info de límite en las cabeceras `RateLimit-*`
    legacyHeaders: false, // Desactiva las cabeceras `X-RateLimit-*`
});

// Aplicar el limitador a todas las rutas de la API
app.use('/api/', limiter);

// Configuración de la base de datos MySQL
const getDbConnection = async () => {
    if (process.env.DATABASE_URL) {
        return await mysql.createConnection(process.env.DATABASE_URL);
    }
    return await mysql.createConnection({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER,
        password: process.env.DB_PASS || process.env.DB_PASSWORD,
        database: process.env.DB_NAME || process.env.DB_DATABASE,
        port: parseInt(process.env.DB_PORT) || 3306
    });
};

// Función para inicializar tablas automáticamente
const initializeTables = async () => {
    try {
        const connection = await getDbConnection();
        console.log('Inicializando tablas en MySQL...');

        // 1. Tabla de Perfiles de Usuario
        await connection.query(`
            CREATE TABLE IF NOT EXISTS usuarios_perfiles (
                uid VARCHAR(128) PRIMARY KEY,
                email VARCHAR(255) UNIQUE,
                full_name VARCHAR(255),
                dni VARCHAR(20),
                sector_group VARCHAR(100),
                organization_type VARCHAR(100),
                organization_name VARCHAR(255),
                role_position VARCHAR(100),
                role_detail TEXT,
                cuit VARCHAR(20),
                expiry_date DATE,
                legal_file_url TEXT,
                terms_accepted_version VARCHAR(20),
                terms_accepted_date DATETIME,
                last_login DATETIME,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )
        `);
        // Agregar columnas que pueden no existir en BBDDs previas
        await connection.query(`ALTER TABLE usuarios_perfiles ADD COLUMN IF NOT EXISTS last_login DATETIME`).catch(() => {});
        await connection.query(`ALTER TABLE usuarios_perfiles ADD COLUMN IF NOT EXISTS role VARCHAR(50) DEFAULT 'usuario'`).catch(() => {});

        // 2. Tabla de Solicitudes de Acceso
        await connection.query(`
            CREATE TABLE IF NOT EXISTS solicitudes_acceso (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_uid VARCHAR(128),
                dashboard_name VARCHAR(255),
                reason TEXT,
                reason_detail TEXT,
                terms_version VARCHAR(20),
                status ENUM('pendiente', 'aprobado', 'rechazado', 'expirado') DEFAULT 'pendiente',
                admin_comment TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);
        await connection.query("ALTER TABLE solicitudes_acceso MODIFY COLUMN status ENUM('pendiente', 'aprobado', 'rechazado', 'expirado') DEFAULT 'pendiente'").catch(() => {});

        // 3. Tabla de Productos Estadísticos
        await connection.query(`
            CREATE TABLE IF NOT EXISTS productos_estadisticos (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_uid VARCHAR(128),
                client_name VARCHAR(255),
                client_email VARCHAR(255),
                client_phone VARCHAR(50),
                client_position VARCHAR(100),
                jurisdictions JSON,
                area VARCHAR(255),
                product_types JSON,
                title VARCHAR(255),
                periodicity VARCHAR(50),
                due_date DATE,
                description TEXT,
                formats JSON,
                has_tech_contact BOOLEAN,
                tech_contact_name VARCHAR(255),
                tech_contact_email VARCHAR(255),
                tech_contact_phone VARCHAR(50),
                additional_info TEXT,
                attachment_urls JSON,
                status ENUM('pendiente', 'en_proceso', 'completado', 'rechazado') DEFAULT 'pendiente',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // 4. Tabla de Logs de Actividad
        await connection.query(`
            CREATE TABLE IF NOT EXISTS logs_actividad (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_uid VARCHAR(128),
                action VARCHAR(100),
                details JSON,
                ip_address VARCHAR(45),
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // 5. Tabla de Feedback
        await connection.query(`
            CREATE TABLE IF NOT EXISTS feedback_web (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_uid VARCHAR(128),
                is_useful BOOLEAN,
                comment TEXT,
                name_provided VARCHAR(255),
                email_provided VARCHAR(255),
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // 6. Tabla de Categorías
        await connection.query(`
            CREATE TABLE IF NOT EXISTS categorias (
                id VARCHAR(128) PRIMARY KEY,
                name VARCHAR(255),
                description TEXT,
                icon VARCHAR(50),
                type VARCHAR(100),
                color VARCHAR(7),
                visible BOOLEAN DEFAULT TRUE,
                sort_order INT DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // 7. Tabla de Tableros (Buttons)
        await connection.query(`
            CREATE TABLE IF NOT EXISTS tableros (
                id VARCHAR(128) PRIMARY KEY,
                title VARCHAR(255),
                icon VARCHAR(50),
                iframe_url TEXT,
                enabled BOOLEAN DEFAULT TRUE,
                require_login BOOLEAN DEFAULT TRUE,
                open_in_new_tab BOOLEAN DEFAULT FALSE,
                sort_order INT DEFAULT 0,
                allowed_users JSON, -- Array de emails
                access_expirations JSON, -- Objeto { email: date }
                categories JSON, -- Array de IDs de categorías
                category_legacy VARCHAR(255), -- Para compatibilidad con campo 'category' antiguo
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )
        `);

        // 8. Tabla de Mensajes/Reportes (Contacts)
        await connection.query(`
            CREATE TABLE IF NOT EXISTS mensajes_contacto (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(255),
                email VARCHAR(255),
                reason VARCHAR(255),
                message TEXT,
                type ENUM('general', 'incident') DEFAULT 'general',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // 9. Tabla de Consentimientos (RCE)
        await connection.query(`
            CREATE TABLE IF NOT EXISTS rce_consentimientos (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_uid VARCHAR(128),
                user_email VARCHAR(255),
                user_name VARCHAR(255),
                dni VARCHAR(20),
                ip_address VARCHAR(45),
                terms_version VARCHAR(20),
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // 10. Tabla de Configuración (T&C)
        await connection.query(`
            CREATE TABLE IF NOT EXISTS config_sistema (
                config_key VARCHAR(128) PRIMARY KEY,
                config_value TEXT,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )
        `);

        // Insertar versión por defecto si no existe
        await connection.query(`
            INSERT IGNORE INTO config_sistema (config_key, config_value) 
            VALUES ('terms_version', '1.2.0')
        `);

        console.log('Estructura de base de datos lista.');
        await connection.end();
    } catch (error) {
        console.error('Error al inicializar las tablas:', error);
    }
};

// Ejecutar inicialización al arrancar
initializeTables();

// Endpoint de prueba de conexión
app.get('/api/status', async (req, res) => {
    if (!process.env.DATABASE_URL && !process.env.DB_HOST) {
        return res.status(500).json({
            status: 'error',
            message: 'No se encontró DATABASE_URL ni DB_HOST en las variables de entorno.'
        });
    }

    try {
        const connection = await getDbConnection();
        await connection.ping();
        await connection.end();
        res.json({ 
            status: 'online', 
            database: 'connected',
            auth: 'ready',
            message: '¡Conexión establecida y sistema de seguridad inicializado!' 
        });
    } catch (error) {
        console.error('Error de DB:', error);
        res.status(500).json({ 
            status: 'error', 
            database: 'disconnected',
            message: error.message 
        });
    }
});

// Ruta protegida de prueba (Solo accesible con Login)
app.get('/api/protected-test', verifyToken, (req, res) => {
    res.json({
        message: '¡Felicidades! Has accedido a una ruta protegida.',
        user: {
            email: req.user.email,
            uid: req.user.uid
        }
    });
});

// --- ENDPOINTS DE LA API ---

// 0. Sincronizar usuario al hacer login (reemplaza Firestore)
app.post('/api/usuarios/sync', verifyToken, async (req, res) => {
    const { email, full_name } = req.body;
    try {
        const connection = await getDbConnection();
        await connection.execute(
            `INSERT INTO usuarios_perfiles (uid, email, full_name, last_login)
             VALUES (?, ?, ?, NOW())
             ON DUPLICATE KEY UPDATE
               uid = VALUES(uid),
               full_name = COALESCE(NULLIF(?, ''), full_name),
               last_login = NOW()`,
            [email, email, full_name, full_name]
        );
        await connection.end();
        res.json({ success: true });
    } catch (error) {
        console.error('Error syncing user:', error);
        res.status(500).json({ error: error.message });
    }
});

// 1. Guardar o actualizar perfil de usuario
// Obtener perfil propio (usado por auth.js para saber si el perfil está completo)
app.get('/api/perfil/me', verifyToken, async (req, res) => {
    try {
        const connection = await getDbConnection();
        const [[profile], [configRow]] = await Promise.all([
            connection.execute('SELECT * FROM usuarios_perfiles WHERE email = ?', [req.user.email])
                .then(([rows]) => rows),
            connection.query("SELECT config_value FROM config_sistema WHERE config_key = 'terms_version'")
                .then(([rows]) => rows)
        ]);
        await connection.end();
        res.json({
            profile: profile || null,
            termsVersion: configRow?.config_value || '1.2.0'
        });
    } catch (error) {
        console.error('Error obteniendo perfil:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/perfil', verifyToken, async (req, res) => {
    const { email: uid } = req.user; // use email as uid for readability
    const { 
        full_name, dni, sector_group, organization_type, 
        organization_name, role_position, role_detail, 
        cuit, expiry_date, legal_file_url, 
        terms_accepted_version, terms_accepted_date 
    } = req.body;

    // Parse dates safely — MySQL DATETIME rejects ISO 8601 strings with T/Z
    const parsedTermsDate = terms_accepted_date ? new Date(terms_accepted_date) : null;
    const parsedExpiryDate = (expiry_date && expiry_date !== 'No aplica' && expiry_date !== '') ? new Date(expiry_date) : null;

    try {
        const connection = await getDbConnection();
        // Use email as the conflict key so re-registration after admin delete works
        // regardless of whether the Firebase UID changed or not
        const sql = `
            INSERT INTO usuarios_perfiles
            (uid, email, full_name, dni, sector_group, organization_type, organization_name, role_position, role_detail, cuit, expiry_date, legal_file_url, terms_accepted_version, terms_accepted_date)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
            uid=VALUES(uid),
            full_name=VALUES(full_name), dni=VALUES(dni), sector_group=VALUES(sector_group),
            organization_type=VALUES(organization_type), organization_name=VALUES(organization_name),
            role_position=VALUES(role_position), role_detail=VALUES(role_detail),
            cuit=VALUES(cuit), expiry_date=VALUES(expiry_date), legal_file_url=VALUES(legal_file_url),
            terms_accepted_version=VALUES(terms_accepted_version), terms_accepted_date=VALUES(terms_accepted_date)
        `;

        await connection.execute(sql, [
            uid, req.user.email, full_name, dni, sector_group, organization_type,
            organization_name, role_position, role_detail,
            cuit, parsedExpiryDate, legal_file_url,
            terms_accepted_version, parsedTermsDate
        ]);

        await connection.end();
        res.json({ message: 'Perfil actualizado correctamente en MySQL.' });
    } catch (error) {
        console.error('Error al guardar perfil:', error);
        res.status(500).json({ error: 'Error al guardar en la base de datos.' });
    }
});

// ── SOLICITUDES DE ACCESO ──────────────────────────────────────────────────

// Listar todas las solicitudes (admin)
app.get('/api/solicitudes', verifyToken, async (_req, res) => {
    try {
        const connection = await getDbConnection();
        // Join with profiles to get the email and name even if user_uid is an old Firebase UID
        const sql = `
            SELECT s.*, u.email as user_email, u.full_name as user_name
            FROM solicitudes_acceso s
            LEFT JOIN usuarios_perfiles u ON s.user_uid = u.uid OR s.user_uid = u.email
            ORDER BY s.created_at DESC
        `;
        const [rows] = await connection.query(sql);
        await connection.end();
        res.json(rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Solicitudes propias del usuario logueado
app.get('/api/solicitudes/me', verifyToken, async (req, res) => {
    try {
        const connection = await getDbConnection();
        const [rows] = await connection.execute(
            'SELECT * FROM solicitudes_acceso WHERE user_uid = ? ORDER BY created_at DESC',
            [req.user.email]
        );
        await connection.end();
        res.json(rows);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Actualizar estado de solicitud (reject/expire)
app.patch('/api/solicitudes/:id/status', verifyToken, async (req, res) => {
    try {
        const { status, admin_comment } = req.body;
        const connection = await getDbConnection();
        await connection.execute(
            'UPDATE solicitudes_acceso SET status = ?, admin_comment = ? WHERE id = ?',
            [status, admin_comment || null, req.params.id]
        );
        await connection.end();
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Aprobar solicitud: actualiza solicitud + allowed_users del tablero
app.post('/api/solicitudes/:id/aprobar', verifyToken, async (req, res) => {
    try {
        const { email, tablero_id, expiry_iso } = req.body;
        const connection = await getDbConnection();

        // 1. Obtener tablero (por ID o por título, para compatibilidad con datos históricos)
        const [[tablero]] = await connection.execute(
            'SELECT id, allowed_users, access_expirations FROM tableros WHERE id = ? OR title = ? LIMIT 1',
            [tablero_id, tablero_id]
        );
        if (tablero) {
            const allowed = JSON.parse(tablero.allowed_users || '[]');
            const expirations = JSON.parse(tablero.access_expirations || '{}');
            if (!allowed.map(u => u.toLowerCase()).includes(email.toLowerCase())) allowed.push(email);
            if (expiry_iso) expirations[email.toLowerCase()] = expiry_iso;
            await connection.execute(
                'UPDATE tableros SET allowed_users = ?, access_expirations = ? WHERE id = ?',
                [JSON.stringify(allowed), JSON.stringify(expirations), tablero.id]
            );
        }

        // 2. Actualizar solicitud
        await connection.execute(
            "UPDATE solicitudes_acceso SET status = 'aprobado', admin_comment = ? WHERE id = ?",
            [expiry_iso ? `Vence: ${expiry_iso}` : null, req.params.id]
        );
        await connection.end();
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── CONTACTOS ──────────────────────────────────────────────────────────────

// Crear mensaje de contacto
app.post('/api/contactos', async (req, res) => {
    try {
        const { name, email, reason, message, type } = req.body;
        const connection = await getDbConnection();
        await connection.execute(
            'INSERT INTO mensajes_contacto (name, email, reason, message, type) VALUES (?, ?, ?, ?, ?)',
            [name || '', email || '', reason || '', message || '', type || 'general']
        );
        await connection.end();
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Eliminar contacto
app.delete('/api/contactos/:id', verifyToken, async (req, res) => {
    try {
        const connection = await getDbConnection();
        await connection.execute('DELETE FROM mensajes_contacto WHERE id = ?', [req.params.id]);
        await connection.end();
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── FEEDBACK ───────────────────────────────────────────────────────────────

// Eliminar feedback
app.delete('/api/feedback/:id', verifyToken, async (req, res) => {
    try {
        const connection = await getDbConnection();
        await connection.execute('DELETE FROM feedback_web WHERE id = ?', [req.params.id]);
        await connection.end();
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── CATEGORÍAS (PATCH + DELETE) ────────────────────────────────────────────

app.patch('/api/categorias/:id', verifyToken, async (req, res) => {
    try {
        const fields = req.body; // { visible, sort_order, name, ... }
        const sets = Object.keys(fields).map(k => `${k} = ?`).join(', ');
        const vals = [...Object.values(fields), req.params.id];
        const connection = await getDbConnection();
        await connection.execute(`UPDATE categorias SET ${sets} WHERE id = ?`, vals);
        await connection.end();
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/categorias/:id', verifyToken, async (req, res) => {
    try {
        const connection = await getDbConnection();
        await connection.execute('DELETE FROM categorias WHERE id = ?', [req.params.id]);
        await connection.end();
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── TABLEROS (PATCH + DELETE) ──────────────────────────────────────────────

app.patch('/api/tableros/:id', verifyToken, async (req, res) => {
    try {
        const fields = req.body;
        const sets = Object.keys(fields).map(k => `${k} = ?`).join(', ');
        const vals = [...Object.values(fields), req.params.id];
        const connection = await getDbConnection();
        await connection.execute(`UPDATE tableros SET ${sets} WHERE id = ?`, vals);
        await connection.end();
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/tableros/:id', verifyToken, async (req, res) => {
    try {
        const connection = await getDbConnection();
        await connection.execute('DELETE FROM tableros WHERE id = ?', [req.params.id]);
        await connection.end();
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ──────────────────────────────────────────────────────────────────────────

// 2. Registrar solicitud de acceso a tablero
app.post('/api/solicitud-acceso', verifyToken, async (req, res) => {
    const { email: uid } = req.user; // Usar email como uid para consistencia
    const { dashboard_name, reason, reason_detail, terms_version } = req.body;

    try {
        const connection = await getDbConnection();
        const sql = `
            INSERT INTO solicitudes_acceso (user_uid, dashboard_name, reason, reason_detail, terms_version)
            VALUES (?, ?, ?, ?, ?)
        `;
        await connection.execute(sql, [uid, dashboard_name, reason, reason_detail, terms_version]);
        await connection.end();
        res.json({ message: 'Solicitud de acceso registrada.' });
    } catch (error) {
        console.error('Error al registrar solicitud:', error);
        res.status(500).json({ error: 'Error al registrar solicitud.' });
    }
});

// 3. Registrar pedido de producto estadístico
app.post('/api/pedido-estadistico', verifyToken, async (req, res) => {
    const { email: uid } = req.user;
    const { 
        client_name, client_email, client_phone, client_position,
        jurisdictions, area, product_types, title, periodicity,
        due_date, description, formats, has_tech_contact,
        tech_contact_name, tech_contact_email, tech_contact_phone,
        additional_info, attachment_urls
    } = req.body;

    try {
        const connection = await getDbConnection();
        const sql = `
            INSERT INTO productos_estadisticos 
            (user_uid, client_name, client_email, client_phone, client_position, jurisdictions, area, product_types, title, periodicity, due_date, description, formats, has_tech_contact, tech_contact_name, tech_contact_email, tech_contact_phone, additional_info, attachment_urls)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;
        await connection.execute(sql, [
            uid, client_name, client_email, client_phone, client_position,
            JSON.stringify(jurisdictions), area, JSON.stringify(product_types), 
            title, periodicity, due_date, description, JSON.stringify(formats),
            has_tech_contact, tech_contact_name, tech_contact_email, tech_contact_phone,
            additional_info, JSON.stringify(attachment_urls)
        ]);
        await connection.end();
        res.json({ message: 'Pedido estadístico registrado exitosamente.' });
    } catch (error) {
        console.error('Error al registrar pedido estadístico:', error);
        res.status(500).json({ error: 'Error al registrar pedido.' });
    }
});

// 4. Registrar logs de actividad
app.post('/api/log-actividad', verifyToken, async (req, res) => {
    const { email } = req.user;
    const { action, details } = req.body;
    const ip_address = req.ip || req.headers['x-forwarded-for'];

    try {
        const connection = await getDbConnection();
        await connection.execute(
            'INSERT INTO logs_actividad (user_uid, action, details, ip_address) VALUES (?, ?, ?, ?)',
            [email, action, JSON.stringify(details), ip_address]
        );
        await connection.end();
        res.json({ status: 'ok' });
    } catch (error) {
        console.error('Error al guardar log:', error);
        res.status(500).json({ error: 'Error al guardar log.' });
    }
});

// 5. Registrar feedback
app.post('/api/feedback', async (req, res) => {
    const { user_uid, is_useful, comment, name_provided, email_provided } = req.body;

    try {
        const connection = await getDbConnection();
        await connection.execute(
            'INSERT INTO feedback_web (user_uid, is_useful, comment, name_provided, email_provided) VALUES (?, ?, ?, ?, ?)',
            [user_uid || null, is_useful, comment, name_provided, email_provided]
        );
        await connection.end();
        res.json({ message: 'Feedback recibido.' });
    } catch (error) {
        console.error('Error al guardar feedback:', error);
        res.status(500).json({ error: 'Error al guardar feedback.' });
    }
});

// 6. Obtener categorías
app.get('/api/categorias', async (req, res) => {
    try {
        const connection = await getDbConnection();
        const [rows] = await connection.query('SELECT * FROM categorias ORDER BY sort_order ASC');
        await connection.end();
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 6b. Guardar/Actualizar categoría (Admin)
app.post('/api/categorias', verifyToken, async (req, res) => {
    const { id, name, description, icon, type, color, visible, sort_order } = req.body;
    try {
        const connection = await getDbConnection();
        const sql = `
            INSERT INTO categorias (id, name, description, icon, type, color, visible, sort_order)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE 
            name=VALUES(name), description=VALUES(description), icon=VALUES(icon), 
            type=VALUES(type), color=VALUES(color), visible=VALUES(visible), sort_order=VALUES(sort_order)
        `;
        await connection.execute(sql, [id, name, description, icon, type, color, visible, sort_order]);
        await connection.end();
        res.json({ message: 'Categoría guardada.' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 7. Obtener tableros
app.get('/api/tableros', async (req, res) => {
    try {
        const connection = await getDbConnection();
        const [rows] = await connection.query('SELECT * FROM tableros ORDER BY sort_order ASC');
        await connection.end();
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 8. Guardar/Actualizar tablero (Admin)
app.post('/api/tableros', verifyToken, async (req, res) => {
    // Aquí podrías validar que req.user.email sea admin
    const { id, title, icon, iframe_url, enabled, require_login, open_in_new_tab, sort_order, allowed_users, access_expirations, categories, category_legacy } = req.body;
    try {
        const connection = await getDbConnection();
        const sql = `
            INSERT INTO tableros (id, title, icon, iframe_url, enabled, require_login, open_in_new_tab, sort_order, allowed_users, access_expirations, categories, category_legacy)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE 
            title=VALUES(title), icon=VALUES(icon), iframe_url=VALUES(iframe_url), enabled=VALUES(enabled), 
            require_login=VALUES(require_login), open_in_new_tab=VALUES(open_in_new_tab), sort_order=VALUES(sort_order),
            allowed_users=VALUES(allowed_users), access_expirations=VALUES(access_expirations), categories=VALUES(categories), category_legacy=VALUES(category_legacy)
        `;
        await connection.execute(sql, [
            id, title, icon, iframe_url, enabled, require_login, open_in_new_tab, sort_order, 
            JSON.stringify(allowed_users), JSON.stringify(access_expirations), JSON.stringify(categories), category_legacy
        ]);
        await connection.end();
        res.json({ message: 'Tablero guardado.' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 9. Registrar consentimiento RCE
app.patch('/api/perfil/terms', verifyToken, async (req, res) => {
    const email = req.user.email;
    const { terms_version, terms_date } = req.body;
    try {
        const connection = await getDbConnection();
        await connection.execute(
            'UPDATE usuarios_perfiles SET terms_accepted_version = ?, terms_accepted_date = ? WHERE email = ?',
            [terms_version, terms_date ? new Date(terms_date) : new Date(), email]
        );
        await connection.end();
        res.json({ message: 'Términos actualizados.' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/rce', verifyToken, async (req, res) => {
    const user_uid = req.user.email;
    const { user_email, user_name, dni, terms_version } = req.body;
    const ip_address = req.ip || req.headers['x-forwarded-for'];

    try {
        const connection = await getDbConnection();
        await connection.execute(
            'INSERT INTO rce_consentimientos (user_uid, user_email, user_name, dni, ip_address, terms_version) VALUES (?, ?, ?, ?, ?, ?)',
            [user_uid, user_email, user_name, dni, ip_address, terms_version]
        );
        await connection.end();
        res.json({ message: 'Consentimiento registrado.' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 10. Obtener versión actual de T&C
app.get('/api/config/terms-version', async (req, res) => {
    try {
        const connection = await getDbConnection();
        const [rows] = await connection.query('SELECT config_value FROM config_sistema WHERE config_key = "terms_version"');
        await connection.end();
        res.json({ version: rows[0]?.config_value || '1.0.0' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --- ENDPOINTS ADMINISTRATIVOS (MYSQL) ---

// --- FEEDBACK ---
app.get('/api/feedback', async (req, res) => {
    try {
        const connection = await getDbConnection();
        const [rows] = await connection.execute('SELECT * FROM feedback_web ORDER BY created_at DESC');
        await connection.end();
        res.json(rows);
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// --- PRODUCTOS ESTADÍSTICOS / PEDIDOS ---
app.get('/api/productos-estadisticos', async (req, res) => {
    try {
        const connection = await getDbConnection();
        const [rows] = await connection.execute('SELECT * FROM productos_estadisticos ORDER BY created_at DESC');
        await connection.end();
        res.json(rows);
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/productos-estadisticos/:id/status', async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    try {
        const connection = await getDbConnection();
        await connection.execute('UPDATE productos_estadisticos SET status = ? WHERE id = ?', [status, id]);
        await connection.end();
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// --- LOGS DE ACTIVIDAD ---
app.get('/api/logs', verifyToken, async (req, res) => {
    try {
        const connection = await getDbConnection();
        const sql = `
            SELECT l.*, u.email as user_email, u.full_name as user_name
            FROM logs_actividad l
            LEFT JOIN usuarios_perfiles u ON l.user_uid = u.uid OR l.user_uid = u.email
            ORDER BY l.created_at DESC LIMIT 500
        `;
        const [rows] = await connection.execute(sql);
        await connection.end();
        res.json(rows);
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// --- RCE ALL ---
app.get('/api/rce-all', verifyToken, async (req, res) => {
    try {
        const connection = await getDbConnection();
        const [rows] = await connection.execute('SELECT * FROM rce_consentimientos ORDER BY timestamp DESC');
        await connection.end();
        res.json(rows);
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// --- CONFIGURACIÓN GENÉRICA ---
app.post('/api/config/:key', verifyToken, async (req, res) => {
    const { key } = req.params;
    const { value } = req.body;
    try {
        const connection = await getDbConnection();
        await connection.execute(
            'INSERT INTO config_sistema (config_key, config_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE config_value = ?',
            [key, value, value]
        );
        await connection.end();
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// --- CONTACTOS ---
app.get('/api/contactos', verifyToken, async (req, res) => {
    try {
        const connection = await getDbConnection();
        const [rows] = await connection.execute('SELECT * FROM mensajes_contacto ORDER BY created_at DESC');
        await connection.end();
        res.json(rows);
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// Ruta principal: Cargar el Observatorio por defecto
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'observatorio-gestion.html'));
});

// Listar todos los usuarios (admin)
app.get('/api/usuarios', verifyToken, async (_req, res) => {
    try {
        const connection = await getDbConnection();
        const [rows] = await connection.query(
            'SELECT * FROM usuarios_perfiles ORDER BY created_at DESC'
        );
        await connection.end();
        res.json(rows);
    } catch (error) {
        console.error('Error obteniendo usuarios:', error);
        res.status(500).json({ error: error.message });
    }
});

// Actualizar rol de usuario
app.patch('/api/usuarios/:email/role', verifyToken, async (req, res) => {
    try {
        const email = decodeURIComponent(req.params.email).toLowerCase();
        const { role } = req.body;
        const connection = await getDbConnection();
        await connection.execute(
            'UPDATE usuarios_perfiles SET role = ? WHERE email = ?',
            [role, email]
        );
        await connection.end();
        res.json({ success: true });
    } catch (error) {
        console.error('Error actualizando rol:', error);
        res.status(500).json({ error: error.message });
    }
});

// Eliminar usuario de MySQL (llamado desde admin.js al borrar un usuario)
app.delete('/api/usuarios/:email', verifyToken, async (req, res) => {
    try {
        const email = decodeURIComponent(req.params.email).toLowerCase();
        const connection = await getDbConnection();
        await connection.execute('DELETE FROM usuarios_perfiles WHERE email = ?', [email]);
        await connection.end();
        res.json({ success: true });
    } catch (error) {
        console.error('Error eliminando usuario de MySQL:', error);
        res.status(500).json({ error: error.message });
    }
});

// Ruta para el Admin
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'admin.html'));
});

// Manejar todas las rutas para SPA: Redirigir al Observatorio si no existe el archivo
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'observatorio-gestion.html'));
});

app.listen(PORT, () => {
    console.log(`Servidor corriendo en puerto ${PORT}`);
});
