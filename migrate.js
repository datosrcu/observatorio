const admin = require('firebase-admin');
const mysql = require('mysql2/promise');
require('dotenv').config();

// 1. Configuración de Firebase Admin
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});
const dbFirestore = admin.firestore();

// 2. Configuración de MySQL
const getDbConnection = async () => {
    return await mysql.createConnection({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER,
        password: process.env.DB_PASS,
        database: process.env.DB_NAME,
        port: 3306
    });
};

async function migrate() {
    let connection;
    try {
        connection = await getDbConnection();
        console.log('--- Iniciando Migración Total ---');

        // 1. CATEGORÍAS
        console.log('Migrando Categorías...');
        const catSnap = await dbFirestore.collection('categories').get();
        for (const doc of catSnap.docs) {
            const data = doc.data();
            await connection.execute(
                'INSERT IGNORE INTO categorias (id, name, description, icon, type, color, visible, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                [doc.id, data.name, data.description || '', data.icon || '', data.type || 'Categorías', data.color || '#000000', data.visible !== false, data.order || 0]
            );
        }

        // 2. TABLEROS
        console.log('Migrando Tableros...');
        const boardSnap = await dbFirestore.collection('buttons').get();
        for (const doc of boardSnap.docs) {
            const data = doc.data();
            await connection.execute(
                'INSERT IGNORE INTO tableros (id, title, icon, iframe_url, enabled, require_login, open_in_new_tab, sort_order, allowed_users, access_expirations, categories, category_legacy) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [
                    doc.id, data.title, data.icon || '', data.iframeUrl || '', data.enabled !== false, 
                    data.requireLogin !== false, data.openInNewTab === true, data.order || 0,
                    JSON.stringify(data.allowedUsers || []), JSON.stringify(data.accessExpirations || {}),
                    JSON.stringify(data.categories || []), data.category || ''
                ]
            );
        }

        // 3. USUARIOS
        console.log('Migrando Usuarios...');
        const userSnap = await dbFirestore.collection('users').get();
        for (const doc of userSnap.docs) {
            const data = doc.data();
            await connection.execute(
                'INSERT IGNORE INTO usuarios_perfiles (uid, email, full_name, dni, sector_group, organization_type, organization_name) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [doc.id, data.email || '', data.displayName || data.full_name || '', data.dni || '', data.sector || '', data.orgType || '', data.orgName || '']
            );
        }

        // 4. SOLICITUDES DE ACCESO
        console.log('Migrando Solicitudes de Acceso...');
        const reqSnap = await dbFirestore.collection('access_requests').get();
        for (const doc of reqSnap.docs) {
            const data = doc.data();
            await connection.execute(
                'INSERT IGNORE INTO solicitudes_acceso (user_uid, dashboard_name, reason, status, created_at) VALUES (?, ?, ?, ?, ?)',
                [data.user_uid || doc.id, data.dashboard_name || '', data.reason || '', data.status || 'pendiente', data.timestamp?.toDate ? data.timestamp.toDate() : new Date()]
            );
        }

        // 5. FEEDBACK
        console.log('Migrando Feedback...');
        const feedSnap = await dbFirestore.collection('feedback').get();
        for (const doc of feedSnap.docs) {
            const data = doc.data();
            await connection.execute(
                'INSERT IGNORE INTO feedback_web (user_uid, is_useful, comment, email_provided, created_at) VALUES (?, ?, ?, ?, ?)',
                [data.user_uid || '', data.rating > 3, data.comment || '', data.user_email || '', data.timestamp?.toDate ? data.timestamp.toDate() : new Date()]
            );
        }

        // 6. MENSAJES DE CONTACTO
        console.log('Migrando Contactos...');
        const contactSnap = await dbFirestore.collection('contacts').get();
        for (const doc of contactSnap.docs) {
            const data = doc.data();
            await connection.execute(
                'INSERT IGNORE INTO mensajes_contacto (name, email, reason, message, type, created_at) VALUES (?, ?, ?, ?, ?, ?)',
                [data.name || 'Anónimo', data.email || '', data.reason || 'Consulta', data.message || '', data.type || 'general', data.createdAt?.toDate ? data.createdAt.toDate() : new Date()]
            );
        }

        // 7. PRODUCTOS ESTADÍSTICOS
        console.log('Migrando Productos Estadísticos...');
        const prodSnap = await dbFirestore.collection('stats_products').get();
        for (const doc of prodSnap.docs) {
            const data = doc.data();
            await connection.execute(
                'INSERT IGNORE INTO productos_estadisticos (id, title, description, category, created_at) VALUES (?, ?, ?, ?, ?)',
                [doc.id, data.title || '', data.description || '', data.category || '', data.createdAt?.toDate ? data.createdAt.toDate() : new Date()]
            );
        }

        // 8. RCE
        console.log('Migrando RCE...');
        const rceSnap = await dbFirestore.collection('consent_logs').get();
        for (const doc of rceSnap.docs) {
            const data = doc.data();
            const date = data.timestamp ? new Date(data.timestamp) : new Date();
            await connection.execute(
                'INSERT IGNORE INTO rce_consentimientos (user_uid, user_email, user_name, dni, ip_address, terms_version, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [data.user_uid || '', data.user_email || '', data.user_name || '', data.dni || '', data.ip || '', data.version || '', date]
            );
        }

        // 9. CONFIGURACIÓN
        console.log('Migrando Configuración...');
        const configSnap = await dbFirestore.collection('config').get();
        for (const doc of configSnap.docs) {
            const data = doc.data();
            await connection.execute(
                'INSERT IGNORE INTO config_sistema (id, config_key, config_value) VALUES (?, ?, ?)',
                [doc.id, doc.id, JSON.stringify(data)]
            );
        }

        console.log('--- Migración Completada con Éxito ---');
    } catch (error) {
        console.error('Error durante la migración:', error);
    } finally {
        if (connection) await connection.end();
        process.exit();
    }
}

migrate();
