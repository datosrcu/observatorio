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
        console.log('--- Iniciando Migración Completa ---');

        // 1. MIGRAR CATEGORÍAS
        console.log('Migrando Categorías...');
        const catSnap = await dbFirestore.collection('categories').get();
        for (const doc of catSnap.docs) {
            const data = doc.data();
            await connection.execute(
                'INSERT IGNORE INTO categorias (id, name, description, icon, type, color, visible, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                [doc.id, data.name, data.description || '', data.icon || '', data.type || 'Categorías', data.color || '#000000', data.visible !== false, data.order || 0]
            );
        }

        // 2. MIGRAR TABLEROS
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

        // 3. MIGRAR PERFILES DE USUARIO
        console.log('Migrando Usuarios...');
        const userSnap = await dbFirestore.collection('users').get();
        for (const doc of userSnap.docs) {
            const data = doc.data();
            await connection.execute(
                'INSERT IGNORE INTO usuarios_perfiles (uid, email, display_name, photo_url, role, last_login) VALUES (?, ?, ?, ?, ?, ?)',
                [doc.id, data.email || '', data.displayName || '', data.photoURL || '', data.role || 'viewer', data.lastLogin?.toDate ? data.lastLogin.toDate() : null]
            );
        }

        // 4. MIGRAR SOLICITUDES DE ACCESO
        console.log('Migrando Solicitudes de Acceso...');
        const reqSnap = await dbFirestore.collection('access_requests').get();
        for (const doc of reqSnap.docs) {
            const data = doc.data();
            await connection.execute(
                'INSERT IGNORE INTO solicitudes_acceso (id, user_email, requested_at, status) VALUES (?, ?, ?, ?)',
                [doc.id, data.email || '', data.timestamp?.toDate ? data.timestamp.toDate() : new Date(), data.status || 'pending']
            );
        }

        // 5. MIGRAR FEEDBACK
        console.log('Migrando Feedback...');
        const feedSnap = await dbFirestore.collection('feedback').get();
        for (const doc of feedSnap.docs) {
            const data = doc.data();
            await connection.execute(
                'INSERT IGNORE INTO feedback_web (id, user_email, rating, comment, created_at) VALUES (?, ?, ?, ?, ?)',
                [doc.id, data.userEmail || '', data.rating || 0, data.comment || '', data.timestamp?.toDate ? data.timestamp.toDate() : new Date()]
            );
        }

        // 6. MIGRAR PRODUCTOS ESTADÍSTICOS
        console.log('Migrando Productos Estadísticos...');
        const prodSnap = await dbFirestore.collection('stats_products').get();
        for (const doc of prodSnap.docs) {
            const data = doc.data();
            await connection.execute(
                'INSERT IGNORE INTO productos_estadisticos (id, title, description, url, category, created_at) VALUES (?, ?, ?, ?, ?, ?)',
                [doc.id, data.title || '', data.description || '', data.url || '', data.category || '', data.createdAt?.toDate ? data.createdAt.toDate() : new Date()]
            );
        }

        // 7. MIGRAR RCE
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

        console.log('--- Migración Completada con Éxito ---');
    } catch (error) {
        console.error('Error durante la migración:', error);
    } finally {
        if (connection) await connection.end();
        process.exit();
    }
}

migrate();
