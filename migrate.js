const admin = require('firebase-admin');
const mysql = require('mysql2/promise');
require('dotenv').config();

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const dbFirestore = admin.firestore();

const getDbConnection = async () => {
    return await mysql.createConnection({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER,
        password: process.env.DB_PASS || process.env.DB_PASSWORD,
        database: process.env.DB_NAME || process.env.DB_DATABASE,
        port: parseInt(process.env.DB_PORT) || 3306
    });
};

async function migrate() {
    let connection;
    try {
        connection = await getDbConnection();
        console.log('--- Iniciando Migración de Precisión ---');

        // 1. RCE (Basado en tu captura de Workbench)
        console.log('Migrando RCE (consent_logs)...');
        const rceSnap = await dbFirestore.collection('consent_logs').get();
        for (const doc of rceSnap.docs) {
            const data = doc.data();
            // Mapeo corregido: userName -> user_name, userEmail -> user_email
            await connection.execute(
                'INSERT IGNORE INTO rce_consentimientos (user_uid, user_email, user_name, dni, ip_address, terms_version, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)',
                [
                    data.user_uid || data.userId || '', 
                    data.userEmail || data.email || '', 
                    data.userName || data.name || '', 
                    data.dni || '', 
                    data.ip || data.ip_address || '', 
                    data.version || data.terms_version || '', 
                    data.timestamp ? new Date(data.timestamp) : new Date()
                ]
            );
        }

        // 2. LOGS DE ACTIVIDAD (Colección real: user_tracking)
        console.log('Migrando Logs de Actividad (user_tracking)...');
        const logsSnap = await dbFirestore.collection('user_tracking').get();
        for (const doc of logsSnap.docs) {
            const data = doc.data();
            await connection.execute(
                'INSERT IGNORE INTO logs_actividad (user_uid, action, details, ip_address, created_at) VALUES (?, ?, ?, ?, ?)',
                [
                    data.userEmail || data.userId || '', 
                    data.buttonName || data.action || 'Acceso', 
                    JSON.stringify(data), 
                    data.ip || '', 
                    data.timestamp ? new Date(data.timestamp) : new Date()
                ]
            );
        }

        // 3. SOLICITUDES DE ACCESO (Colección: requests)
        console.log('Migrando Solicitudes de Acceso (requests)...');
        const reqSnap = await dbFirestore.collection('requests').get();
        for (const doc of reqSnap.docs) {
            const data = doc.data();
            await connection.execute(
                'INSERT IGNORE INTO solicitudes_acceso (user_uid, dashboard_name, reason, status, created_at) VALUES (?, ?, ?, ?, ?)',
                [
                    data.userEmail || data.user_uid || '', 
                    data.dashboardName || data.buttonName || '', 
                    data.reason || '', 
                    data.status || 'pendiente', 
                    data.timestamp?.toDate ? data.timestamp.toDate() : new Date()
                ]
            );
        }

        // 4. PEDIDOS / PRODUCTOS (statistical_requests)
        console.log('Migrando Pedidos (statistical_requests)...');
        const prodSnap = await dbFirestore.collection('statistical_requests').get();
        for (const doc of prodSnap.docs) {
            const data = doc.data();
            await connection.execute(
                'INSERT IGNORE INTO productos_estadisticos (client_name, client_email, client_phone, client_position, area, title, description, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [
                    data.clientName || '', data.clientEmail || '', data.clientPhone || '', data.clientPosition || '', 
                    data.clientArea || '', data.requestTitle || '', data.description || '', 
                    (data.status || 'pendiente').toLowerCase().replace(' ', '_'),
                    data.createdAt?.toDate ? data.createdAt.toDate() : new Date()
                ]
            );
        }

        console.log('--- Migración de Precisión Finalizada ---');
    } catch (error) {
        console.error('Error:', error);
    } finally {
        if (connection) await connection.end();
        process.exit();
    }
}

migrate();
