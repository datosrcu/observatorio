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
        console.log('✅ Conexión a MySQL establecida');
        console.log('');
        console.log('🗑️  Limpiando tablas...');

        // Desactivar FK checks para poder truncar sin orden
        await connection.query('SET FOREIGN_KEY_CHECKS = 0');

        const tables = [
            'usuarios_perfiles',
            'solicitudes_acceso',
            'productos_estadisticos',
            'logs_actividad',
            'feedback_web',
            'categorias',
            'tableros',
            'mensajes_contacto',
            'rce_consentimientos',
            'config_sistema'
        ];

        for (const table of tables) {
            await connection.query(`TRUNCATE TABLE ${table}`);
            console.log(`  → ${table} limpiada`);
        }

        await connection.query('SET FOREIGN_KEY_CHECKS = 1');
        console.log('');
        console.log('🚀 Iniciando migración...');
        console.log('');

        // ─────────────────────────────────────────────────
        // 1. USUARIOS  (Firestore: users → MySQL: usuarios_perfiles)
        // ─────────────────────────────────────────────────
        console.log('1/10 Migrando Usuarios (users)...');
        const usersSnap = await dbFirestore.collection('users').get();
        for (const docItem of usersSnap.docs) {
            const d = docItem.data();
            const expiryRaw = d.expiryDate || d.expiry_date || null;
            let expiryDate = null;
            if (expiryRaw && expiryRaw !== 'No aplica') {
                const parsed = new Date(expiryRaw);
                expiryDate = isNaN(parsed.getTime()) ? null : parsed;
            }
            const termsDate = d.acceptedTCTimestamp || d.terms_accepted_date || null;
            await connection.execute(
                `INSERT INTO usuarios_perfiles
                    (uid, email, full_name, dni, sector_group, organization_type, organization_name,
                     role_position, role_detail, cuit, expiry_date, legal_file_url,
                     terms_accepted_version, terms_accepted_date, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    d.uid || d.userId || docItem.id,
                    docItem.id,
                    d.name || d.full_name || d.displayName || '',
                    d.dni || '',
                    d.orgGroup || d.sector_group || '',
                    d.orgType || d.organization_type || '',
                    d.orgName || d.organization_name || '',
                    d.orgRole || d.role_position || d.role || '',
                    d.orgRoleDetail || d.role_detail || '',
                    d.cuit || '',
                    expiryDate,
                    d.legalDocURL || d.legal_file_url || null,
                    d.acceptedTCVersion || d.terms_accepted_version || null,
                    termsDate ? new Date(termsDate) : null,
                    d.createdAt ? new Date(d.createdAt) : new Date()
                ]
            );
        }
        console.log(`   → ${usersSnap.size} usuarios migrados`);

        // ─────────────────────────────────────────────────
        // 2. CONSENTIMIENTOS  (Firestore: consent_logs → MySQL: rce_consentimientos)
        // ─────────────────────────────────────────────────
        console.log('2/10 Migrando Consentimientos (consent_logs)...');
        const rceSnap = await dbFirestore.collection('consent_logs').get();
        for (const docItem of rceSnap.docs) {
            const d = docItem.data();
            await connection.execute(
                `INSERT INTO rce_consentimientos
                    (user_uid, user_email, user_name, dni, ip_address, terms_version, timestamp)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [
                    d.user_uid || d.userId || '',
                    d.userEmail || d.email || '',
                    d.userName || d.name || '',
                    d.dni || '',
                    d.ip || d.ip_address || '',
                    d.version || d.terms_version || '',
                    d.timestamp ? new Date(d.timestamp) : new Date()
                ]
            );
        }
        console.log(`   → ${rceSnap.size} consentimientos migrados`);

        // ─────────────────────────────────────────────────
        // 3. LOGS DE ACTIVIDAD  (Firestore: user_tracking → MySQL: logs_actividad)
        // ─────────────────────────────────────────────────
        console.log('3/10 Migrando Logs de Actividad (user_tracking)...');
        const logsSnap = await dbFirestore.collection('user_tracking').get();
        for (const docItem of logsSnap.docs) {
            const d = docItem.data();
            await connection.execute(
                `INSERT INTO logs_actividad
                    (user_uid, action, details, ip_address, created_at)
                 VALUES (?, ?, ?, ?, ?)`,
                [
                    d.userEmail || d.userId || '',
                    d.buttonName || d.action || 'Acceso',
                    JSON.stringify(d),
                    d.ip || '',
                    d.timestamp ? new Date(d.timestamp) : new Date()
                ]
            );
        }
        console.log(`   → ${logsSnap.size} logs migrados`);

        // ─────────────────────────────────────────────────
        // 4. SOLICITUDES DE ACCESO  (Firestore: requests → MySQL: solicitudes_acceso)
        // ─────────────────────────────────────────────────
        console.log('4/10 Migrando Solicitudes de Acceso (requests)...');
        const reqSnap = await dbFirestore.collection('requests').get();
        for (const docItem of reqSnap.docs) {
            const d = docItem.data();
            const statusRaw = (d.status || 'pendiente').toLowerCase().trim();
            const validStatus = ['pendiente', 'aprobado', 'rechazado'].includes(statusRaw) ? statusRaw : 'pendiente';
            await connection.execute(
                `INSERT INTO solicitudes_acceso
                    (user_uid, dashboard_name, reason, reason_detail, terms_version, status, admin_comment, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    d.userEmail || d.user_uid || '',
                    d.dashboardName || d.buttonName || '',
                    d.reason || '',
                    d.reasonDetail || d.reason_detail || '',
                    d.termsVersion || d.terms_version || '',
                    validStatus,
                    d.adminComment || d.admin_comment || null,
                    d.timestamp?.toDate ? d.timestamp.toDate() : new Date()
                ]
            );
        }
        console.log(`   → ${reqSnap.size} solicitudes migradas`);

        // ─────────────────────────────────────────────────
        // 5. PEDIDOS ESTADÍSTICOS  (Firestore: statistical_requests → MySQL: productos_estadisticos)
        // ─────────────────────────────────────────────────
        console.log('5/10 Migrando Pedidos Estadísticos (statistical_requests)...');
        const prodSnap = await dbFirestore.collection('statistical_requests').get();
        for (const docItem of prodSnap.docs) {
            const d = docItem.data();
            const statusRaw = (d.status || 'pendiente').toLowerCase().replace(/ /g, '_');
            const validStatus = ['pendiente', 'en_proceso', 'completado', 'rechazado'].includes(statusRaw) ? statusRaw : 'pendiente';
            const dueDateRaw = d.dueDate || d.due_date || null;
            const dueDate = dueDateRaw ? new Date(dueDateRaw) : null;
            await connection.execute(
                `INSERT INTO productos_estadisticos
                    (client_name, client_email, client_phone, client_position, jurisdictions, area,
                     product_types, title, periodicity, due_date, description, formats,
                     has_tech_contact, tech_contact_name, tech_contact_email, tech_contact_phone,
                     additional_info, attachment_urls, status, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    d.clientName || '',
                    d.clientEmail || '',
                    d.clientPhone || '',
                    d.clientPosition || '',
                    JSON.stringify(d.jurisdictions || []),
                    d.clientArea || d.area || '',
                    JSON.stringify(d.productTypes || d.product_types || []),
                    d.requestTitle || d.title || '',
                    d.periodicity || '',
                    dueDate && !isNaN(dueDate.getTime()) ? dueDate : null,
                    d.description || '',
                    JSON.stringify(d.formats || []),
                    d.hasTechContact === 'si' || d.has_tech_contact === true ? 1 : 0,
                    d.techContactName || d.tech_contact_name || null,
                    d.techContactEmail || d.tech_contact_email || null,
                    d.techContactPhone || d.tech_contact_phone || null,
                    d.additionalInfo || d.additional_info || null,
                    JSON.stringify(d.attachmentUrls || d.attachment_urls || []),
                    validStatus,
                    d.createdAt?.toDate ? d.createdAt.toDate() : new Date()
                ]
            );
        }
        console.log(`   → ${prodSnap.size} pedidos migrados`);

        // ─────────────────────────────────────────────────
        // 6. FEEDBACK  (Firestore: feedback → MySQL: feedback_web)
        // ─────────────────────────────────────────────────
        console.log('6/10 Migrando Feedback (feedback)...');
        const feedSnap = await dbFirestore.collection('feedback').get();
        for (const docItem of feedSnap.docs) {
            const d = docItem.data();
            await connection.execute(
                `INSERT INTO feedback_web
                    (user_uid, is_useful, comment, name_provided, email_provided, created_at)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [
                    d.userId || d.userEmail || d.user_uid || null,
                    d.isUseful === true || d.is_useful === true ? 1 : 0,
                    d.comment || null,
                    d.name || d.name_provided || null,
                    d.email || d.email_provided || null,
                    d.timestamp?.toDate ? d.timestamp.toDate() : new Date()
                ]
            );
        }
        console.log(`   → ${feedSnap.size} feedbacks migrados`);

        // ─────────────────────────────────────────────────
        // 7. CATEGORÍAS  (Firestore: categories → MySQL: categorias)
        // ─────────────────────────────────────────────────
        console.log('7/10 Migrando Categorías (categories)...');
        const catSnap = await dbFirestore.collection('categories').get();
        for (const docItem of catSnap.docs) {
            const d = docItem.data();
            await connection.execute(
                `INSERT INTO categorias
                    (id, name, description, icon, type, color, visible, sort_order)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    docItem.id,
                    d.name || '',
                    d.description || '',
                    d.icon || '',
                    d.type || 'Categorías',
                    d.color || '#009DE0',
                    d.visible !== false ? 1 : 0,
                    d.order || d.sort_order || 0
                ]
            );
        }
        console.log(`   → ${catSnap.size} categorías migradas`);

        // ─────────────────────────────────────────────────
        // 8. TABLEROS  (Firestore: buttons → MySQL: tableros)
        // ─────────────────────────────────────────────────
        console.log('8/10 Migrando Tableros (buttons)...');
        const btnSnap = await dbFirestore.collection('buttons').get();
        for (const docItem of btnSnap.docs) {
            const d = docItem.data();
            await connection.execute(
                `INSERT INTO tableros
                    (id, title, icon, iframe_url, enabled, require_login, open_in_new_tab,
                     sort_order, allowed_users, access_expirations, categories, category_legacy)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    docItem.id,
                    d.title || '',
                    d.icon || '',
                    d.iframeUrl || d.iframe_url || '',
                    d.enabled !== false ? 1 : 0,
                    d.requireLogin !== false ? 1 : 0,
                    d.openInNewTab === true ? 1 : 0,
                    d.order || d.sort_order || 0,
                    JSON.stringify(d.allowedUsers || d.allowed_users || []),
                    JSON.stringify(d.accessExpirations || d.access_expirations || {}),
                    JSON.stringify(d.categories || []),
                    d.category || d.category_legacy || ''
                ]
            );
        }
        console.log(`   → ${btnSnap.size} tableros migrados`);

        // ─────────────────────────────────────────────────
        // 9. MENSAJES DE CONTACTO  (Firestore: contacts → MySQL: mensajes_contacto)
        // ─────────────────────────────────────────────────
        console.log('9/10 Migrando Mensajes de Contacto (contacts)...');
        const contSnap = await dbFirestore.collection('contacts').get();
        for (const docItem of contSnap.docs) {
            const d = docItem.data();
            const typeRaw = d.type || 'general';
            const validType = ['general', 'incident'].includes(typeRaw) ? typeRaw : 'general';
            await connection.execute(
                `INSERT INTO mensajes_contacto
                    (name, email, reason, message, type, created_at)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [
                    d.name || '',
                    d.email || '',
                    d.reason || '',
                    d.message || '',
                    validType,
                    d.createdAt?.toDate ? d.createdAt.toDate() : new Date()
                ]
            );
        }
        console.log(`   → ${contSnap.size} mensajes migrados`);

        // ─────────────────────────────────────────────────
        // 10. CONFIGURACIÓN  (Firestore: config/terms → MySQL: config_sistema)
        // ─────────────────────────────────────────────────
        console.log('10/10 Migrando Configuración (config)...');
        const configDoc = await dbFirestore.collection('config').doc('terms').get();
        if (configDoc.exists) {
            const d = configDoc.data();
            if (d.currentVersion) {
                await connection.execute(
                    `INSERT INTO config_sistema (config_key, config_value)
                     VALUES ('terms_version', ?)
                     ON DUPLICATE KEY UPDATE config_value = VALUES(config_value)`,
                    [d.currentVersion]
                );
                console.log(`   → versión T&C migrada: ${d.currentVersion}`);
            }
        } else {
            console.log('   → sin datos en config/terms (se mantiene el valor por defecto)');
        }

        console.log('');
        console.log('✅ Migración completa de las 10 tablas finalizada');

    } catch (error) {
        console.error('❌ Error durante la migración:', error);
    } finally {
        if (connection) await connection.end();
        process.exit();
    }
}

migrate();
