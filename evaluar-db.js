const mysql = require('mysql2/promise');
require('dotenv').config();

const dbConfig = {
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER,
    password: process.env.DB_PASS,
    database: process.env.DB_NAME,
    port: 3306
};

async function evaluarBaseDeDatos() {
    console.log('=== EVALUANDO ESTADO DE LA BASE DE DATOS ===');
    console.log('Host configurado:', dbConfig.host);
    console.log('Base de datos:', dbConfig.database);
    console.log('--------------------------------------------\n');

    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        console.log('✅ Conexión establecida con éxito.\n');

        // 1. Resumen de Tablas
        console.log('--- 1. Resumen de registros en las tablas ---');
        const tablas = ['solicitudes_acceso', 'mensajes_contacto', 'feedback_web', 'tableros', 'rce_consentimientos'];
        for (const tabla of tablas) {
            try {
                const [[{ total }]] = await connection.execute(`SELECT COUNT(*) as total FROM ${tabla}`);
                console.log(`🔹 Tabla '${tabla}': ${total} registros.`);
            } catch (err) {
                console.log(`❌ Error al consultar la tabla '${tabla}': ${err.message}`);
            }
        }
        console.log('\n');

        // 2. Últimas solicitudes de acceso
        console.log('--- 2. Últimas 5 Solicitudes de Acceso ---');
        try {
            const [solicitudes] = await connection.execute(
                'SELECT id, user_uid, dashboard_name, status, created_at FROM solicitudes_acceso ORDER BY created_at DESC LIMIT 5'
            );
            if (solicitudes.length === 0) {
                console.log('⚠️ No hay solicitudes registradas aún.');
            } else {
                console.table(solicitudes.map(s => ({
                    ID: s.id,
                    Usuario: s.user_uid,
                    Tablero: s.dashboard_name,
                    Estado: s.status,
                    Fecha: new Date(s.created_at).toLocaleString()
                })));
            }
        } catch (err) {
            console.log('❌ Error al consultar solicitudes:', err.message);
        }
        console.log('\n');

        // 3. Últimos mensajes de contacto
        console.log('--- 3. Últimos 3 Mensajes de Contacto ---');
        try {
            const [contactos] = await connection.execute(
                'SELECT id, name, email, reason, created_at FROM mensajes_contacto ORDER BY created_at DESC LIMIT 3'
            );
            if (contactos.length === 0) {
                console.log('⚠️ No hay mensajes de contacto registrados aún.');
            } else {
                console.table(contactos.map(c => ({
                    ID: c.id,
                    Nombre: c.name,
                    Email: c.email,
                    Motivo: c.reason,
                    Fecha: new Date(c.created_at).toLocaleString()
                })));
            }
        } catch (err) {
            console.log('❌ Error al consultar mensajes de contacto:', err.message);
        }
        console.log('\n');

        // 4. Últimos feedbacks
        console.log('--- 4. Últimos 3 Feedbacks Recibidos ---');
        try {
            const [feedbacks] = await connection.execute(
                'SELECT id, rating, comment, created_at FROM feedback_web ORDER BY created_at DESC LIMIT 3'
            );
            if (feedbacks.length === 0) {
                console.log('⚠️ No hay feedback registrado aún.');
            } else {
                console.table(feedbacks.map(f => ({
                    ID: f.id,
                    Calificación: f.rating,
                    Comentario: f.comment || 'Sin comentario',
                    Fecha: new Date(f.created_at).toLocaleString()
                })));
            }
        } catch (err) {
            console.log('❌ Error al consultar feedbacks:', err.message);
        }
        console.log('\n');

    } catch (error) {
        console.error('❌ Error de conexión general a MySQL:', error.message);
        console.log('\n💡 Consejo: Asegúrate de que Docker Desktop esté encendido o que tu VPN esté activa.');
    } finally {
        if (connection) {
            await connection.end();
        }
        console.log('\n============================================');
    }
}

evaluarBaseDeDatos();
