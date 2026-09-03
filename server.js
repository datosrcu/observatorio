const express = require('express');
const mysql = require('mysql2/promise');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');
const admin = require('firebase-admin');
const { Resend } = require('resend');
const multer = require('multer');
const AdmZip = require('adm-zip');
const crypto = require('crypto');
require('dotenv').config();

// --- Firma de acceso a tableros/informes protegidos (require_login = 1) ---
// Clave secreta para firmar los enlaces de acceso de corta duración a /uploads.
// Debe configurarse como variable de entorno en el servidor (Dokploy). Si falta,
// el sistema queda en modo "cerrado por defecto": los tableros/informes con
// require_login = 1 no van a poder abrirse hasta que se configure, en vez de
// quedar accesibles sin control (falla segura, no falla silenciosa).
const TABLERO_ACCESS_SECRET = process.env.TABLERO_ACCESS_SECRET || null;
if (!TABLERO_ACCESS_SECRET) {
    console.warn('⚠️  TABLERO_ACCESS_SECRET no configurada. Los tableros/informes con require_login=1 no podrán abrirse hasta configurarla.');
}
const TABLERO_ACCESS_TTL_MS = 15 * 60 * 1000; // 15 minutos

function signTableroAccess(resourceId, expiresAt) {
    if (!TABLERO_ACCESS_SECRET) return null;
    return crypto.createHmac('sha256', TABLERO_ACCESS_SECRET).update(`${resourceId}.${expiresAt}`).digest('hex');
}

function verifyTableroAccess(resourceId, expiresAt, signature) {
    if (!TABLERO_ACCESS_SECRET || !signature || !expiresAt) return false;
    const expiresAtNum = Number(expiresAt);
    if (!Number.isFinite(expiresAtNum) || Date.now() > expiresAtNum) return false;
    const expected = signTableroAccess(resourceId, expiresAtNum);
    if (!expected) return false;
    try {
        const a = Buffer.from(expected);
        const b = Buffer.from(String(signature));
        return a.length === b.length && crypto.timingSafeEqual(a, b);
    } catch (e) {
        return false;
    }
}

// Agrega un token de acceso de corta duración a una URL de contenido propio
// (/uploads/... o /api/github/proxy/...) existente. Otras URLs (externas, tipo
// Looker Studio o Power BI) quedan sin tocar.
const PROTECTABLE_URL_PREFIXES = ['/uploads/', '/api/github/proxy/'];
function withAccessToken(url, resourceId) {
    if (!url || !PROTECTABLE_URL_PREFIXES.some(p => String(url).startsWith(p))) return url;
    const expiresAt = Date.now() + TABLERO_ACCESS_TTL_MS;
    const sig = signTableroAccess(resourceId, expiresAt);
    if (!sig) return url; // sin secreto configurado: no se puede firmar, se deja como está
    const sep = url.includes('?') ? '&' : '?';
    return `${url}${sep}t=${sig}&exp=${expiresAt}`;
}

// Cuenta administradora maestra (ver docs/SECURITY_POLICY.md, sección 2) — igual
// que ADMIN_EMAILS en admin.js/auth.js, mantener sincronizada si cambia.
const ADMIN_EMAILS = ['datos@riocuarto.gov.ar'];

// La cuenta maestra y los usuarios con rol 'lector' tienen acceso de lectura a
// todos los tableros/informes, sin pasar por allowed_users — decisión de
// producto explícita (2026-08-24, ver docs/SECURITY_LOG.md): el resto de los
// admins sigue necesitando estar en la lista de usuarios permitidos, igual que
// cualquier otro usuario. La UI de admin.js ya mostraba a admin/lector como
// "Acceso Total" en el checklist, pero eso nunca se traducía en un permiso real
// del lado del servidor — este es el fix de esa promesa incumplida.
async function hasBlanketAccess(connection, email) {
    if (!email) return false;
    const normalizedEmail = String(email).toLowerCase();
    if (ADMIN_EMAILS.map(e => e.toLowerCase()).includes(normalizedEmail)) return true;
    try {
        const [[user]] = await connection.execute(
            'SELECT role FROM usuarios_perfiles WHERE LOWER(email) = ?',
            [normalizedEmail]
        );
        return user?.role === 'lector';
    } catch (e) {
        console.error('Error verificando rol para acceso total (lector):', e);
        return false;
    }
}

// Determina si un usuario (por email) está habilitado hoy para un tablero/informe,
// usando exactamente los mismos campos (allowed_users, access_expirations) que ya
// gobiernan el circuito de solicitud/aprobación de acceso.
function isEntitled(row, email) {
    if (!email) return false;
    let allowed = [];
    try {
        const raw = row.allowed_users;
        allowed = typeof raw === 'string' ? JSON.parse(raw || '[]') : (Array.isArray(raw) ? raw : []);
    } catch (e) { allowed = []; }
    const normalizedEmail = String(email).toLowerCase();
    if (!allowed.some(a => String(a).toLowerCase() === normalizedEmail)) return false;

    let expirations = {};
    try {
        const raw = row.access_expirations;
        expirations = typeof raw === 'string' ? JSON.parse(raw || '{}') : (raw || {});
    } catch (e) { expirations = {}; }
    const expKey = Object.keys(expirations).find(k => k.toLowerCase() === normalizedEmail);
    if (expKey && expirations[expKey]) {
        const expDate = new Date(expirations[expKey]);
        if (!isNaN(expDate.getTime()) && expDate.getTime() < Date.now()) return false;
    }
    return true;
}

// Verifica el header Authorization si viene, pero sin exigirlo — para endpoints
// públicos que igual necesitan saber (opcionalmente) quién pregunta.
async function getOptionalUserEmail(req) {
    const idToken = req.headers.authorization?.split('Bearer ')[1];
    if (!idToken) return null;
    try {
        const decoded = await admin.auth().verifyIdToken(idToken);
        return decoded.email || null;
    } catch (e) {
        return null;
    }
}

// Cache breve en memoria para no consultar MySQL en cada archivo estático servido
// desde /uploads (una página con varios recursos hace varias peticiones seguidas).
const PERMISSION_CACHE = new Map();
const PERMISSION_CACHE_TTL_MS = 30 * 1000;
async function getCached(key, fetcher) {
    const hit = PERMISSION_CACHE.get(key);
    if (hit && hit.expiresAt > Date.now()) return hit.data;
    const data = await fetcher();
    PERMISSION_CACHE.set(key, { data, expiresAt: Date.now() + PERMISSION_CACHE_TTL_MS });
    return data;
}

// --- MULTER: Configuración de uploads para informes ---
const UPLOADS_PATH = process.env.UPLOADS_PATH ? path.resolve(process.env.UPLOADS_PATH) : path.join(__dirname, 'uploads');
const UPLOADS_DIR = path.join(UPLOADS_PATH, 'informes');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const informesStorage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
    filename: (_req, file, cb) => {
        const unique = Date.now() + '-' + Math.round(Math.random() * 1e6);
        const ext = path.extname(file.originalname);
        cb(null, unique + ext);
    }
});
const uploadInformes = multer({
    storage: informesStorage,
    limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
    fileFilter: (_req, file, cb) => {
        const allowed = ['.pdf', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.html', '.htm'];
        const ext = path.extname(file.originalname).toLowerCase();
        if (allowed.includes(ext)) cb(null, true);
        else cb(new Error('Tipo de archivo no permitido. Se aceptan: PDF, imágenes y HTML.'));
    }
});

// --- MULTER: Configuración de uploads para tableros ---
const TABLEROS_DIR = path.join(UPLOADS_PATH, 'tableros');
if (!fs.existsSync(TABLEROS_DIR)) fs.mkdirSync(TABLEROS_DIR, { recursive: true });

const tablerosStorage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, TABLEROS_DIR),
    filename: (_req, file, cb) => {
        const unique = Date.now() + '-' + Math.round(Math.random() * 1e6);
        const ext = path.extname(file.originalname);
        cb(null, unique + ext);
    }
});
const uploadTableros = multer({
    storage: tablerosStorage,
    limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
    fileFilter: (_req, file, cb) => {
        const allowed = ['.pdf', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.html', '.htm', '.zip'];
        const ext = path.extname(file.originalname).toLowerCase();
        if (allowed.includes(ext)) cb(null, true);
        else cb(new Error('Tipo de archivo no permitido. Se aceptan: PDF, imágenes, HTML y ZIP.'));
    }
});

// ── DESPLIEGUE DE TABLEROS DESDE GITHUB (modelo tipo Vercel) ────────────────
// El servidor descarga el repositorio (zipball de la API de GitHub) y lo extrae
// en uploads/tableros/project_<id>/ — exactamente la misma ubicación y mecánica
// que los ZIP subidos a mano desde admin.html — de modo que el tablero clonado
// se sirve desde /uploads con la misma guardia de require_login / allowed_users /
// access_expirations. No se sirve nada directo desde GitHub para los tableros
// nuevos: nada de Pages ni del proxy (que quedan solo para tableros legados aún
// no migrados).
// GITHUB_DEPLOY_TOKEN: Personal Access Token (solo lectura de repos) usado por
// el SERVIDOR para descargar los zipballs, incluidos repos privados. Sin ella,
// solo se pueden desplegar repositorios públicos.
const GITHUB_DEPLOY_TOKEN = process.env.GITHUB_DEPLOY_TOKEN || null;
if (!GITHUB_DEPLOY_TOKEN) {
    console.warn('⚠️  GITHUB_DEPLOY_TOKEN no configurada. Los despliegues desde repositorios privados de GitHub van a fallar hasta configurarla.');
}
const GITHUB_POLL_MINUTES = Math.max(1, parseInt(process.env.GITHUB_POLL_MINUTES, 10) || 10);
const GITHUB_UA = 'Observatorio-RioCuarto-App';

function ghApiHeaders() {
    const headers = {
        'User-Agent': GITHUB_UA,
        'Accept': 'application/vnd.github+json'
    };
    if (GITHUB_DEPLOY_TOKEN) headers['Authorization'] = `Bearer ${GITHUB_DEPLOY_TOKEN}`;
    return headers;
}

async function getLatestCommitSha(owner, repo, branch) {
    const res = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits/${encodeURIComponent(branch)}`, { headers: ghApiHeaders() });
    if (!res.ok) throw new Error(`GitHub API ${res.status}: no se pudo leer el último commit de ${owner}/${repo}@${branch}`);
    const data = await res.json();
    if (!data || !data.sha) throw new Error('GitHub no devolvió un SHA de commit válido.');
    return data.sha;
}

// Descarga el zipball, lo extrae en un directorio temporal, achata la carpeta
// raíz que GitHub agrega (<repo>-<sha>/), localiza el HTML de entrada y reemplaza
// uploads/tableros/project_<boardId>/ con el contenido nuevo.
async function deployGithubBoard({ boardId, owner, repo, branch, entryPath }) {
    const sha = await getLatestCommitSha(owner, repo, branch);

    const zipRes = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/zipball/${encodeURIComponent(branch)}`, { headers: ghApiHeaders() });
    if (!zipRes.ok) {
        const hint = !GITHUB_DEPLOY_TOKEN ? ' (¿repositorio privado sin GITHUB_DEPLOY_TOKEN configurada?)' : '';
        throw new Error(`GitHub API ${zipRes.status}: no se pudo descargar ${owner}/${repo}@${branch}${hint}`);
    }
    const zipBuffer = Buffer.from(await zipRes.arrayBuffer());

    const safeBoardSegment = String(boardId).replace(/[^a-zA-Z0-9_-]/g, '_');
    const tmpDir = path.join(TABLEROS_DIR, `.tmp_deploy_${safeBoardSegment}_${Date.now()}_${Math.round(Math.random() * 1e6)}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    try {
        // adm-zip 0.5.x sanea las entradas del ZIP (verificado contra Zip Slip en SECURITY_LOG.md)
        const zip = new AdmZip(zipBuffer);
        zip.extractAllTo(tmpDir, true);

        let rootDir = tmpDir;
        try {
            const entries = fs.readdirSync(tmpDir);
            const dirs = entries.filter(e => fs.statSync(path.join(tmpDir, e)).isDirectory());
            const files = entries.filter(e => fs.statSync(path.join(tmpDir, e)).isFile());
            if (dirs.length === 1 && files.length === 0) rootDir = path.join(tmpDir, dirs[0]);
        } catch (e) { rootDir = tmpDir; }

        // Archivo de entrada: el configurado (si existe dentro del repo y no escapa
        // del directorio), si no index.html, si no cualquier .html (raíz, luego 1 nivel).
        let entrypointFile = null;
        if (entryPath && String(entryPath).trim() !== '') {
            const candidate = path.resolve(rootDir, String(entryPath).trim());
            if (candidate.startsWith(path.resolve(rootDir)) && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
                entrypointFile = path.relative(rootDir, candidate).replace(/\\/g, '/');
            }
        }
        if (!entrypointFile) {
            entrypointFile = 'index.html';
            const rootFiles = fs.readdirSync(rootDir);
            if (!rootFiles.includes('index.html')) {
                const htmlFile = rootFiles.find(f => f.endsWith('.html') || f.endsWith('.htm'));
                if (htmlFile) {
                    entrypointFile = htmlFile;
                } else {
                    let found = null;
                    for (const f of rootFiles) {
                        const fullPath = path.join(rootDir, f);
                        if (fs.statSync(fullPath).isDirectory()) {
                            const subFiles = fs.readdirSync(fullPath);
                            const subHtml = subFiles.find(sf => sf.endsWith('.html') || sf.endsWith('.htm'));
                            if (subHtml) { found = path.join(f, subHtml); break; }
                        }
                    }
                    if (found) entrypointFile = found;
                }
            }
        }

        const projectDir = path.join(TABLEROS_DIR, `project_${boardId}`);
        if (fs.existsSync(projectDir)) {
            try { fs.rmSync(projectDir, { recursive: true, force: true }); } catch (e) { console.error('Error borrando versión anterior del proyecto:', e); }
        }
        try {
            fs.renameSync(rootDir, projectDir);
        } catch (e) {
            // rename puede fallar entre unidades distintas; copiar como fallback
            fs.cpSync(rootDir, projectDir, { recursive: true });
        }

        const filePath = `/uploads/tableros/project_${boardId}/${entrypointFile}`;
        return { sha, filePath };
    } finally {
        try { if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
    }
}

// Guarda el resultado de un despliegue GitHub en la fila del tablero.
// autoDeploy (opcional): si viene definido, también actualiza github_auto_deploy.
async function persistGithubDeploy(boardId, { owner, repo, branch }, { sha, filePath }, autoDeploy) {
    const connection = await getDbConnection();
    try {
        if (autoDeploy === undefined) {
            await connection.execute(
                'UPDATE tableros SET iframe_url = ?, file_path = ?, github_repo = ?, github_branch = ?, deployed_sha = ?, deployed_at = NOW() WHERE id = ?',
                [filePath, filePath, `${owner}/${repo}`, branch, sha, boardId]
            );
        } else {
            await connection.execute(
                'UPDATE tableros SET iframe_url = ?, file_path = ?, github_repo = ?, github_branch = ?, deployed_sha = ?, deployed_at = NOW(), github_auto_deploy = ? WHERE id = ?',
                [filePath, filePath, `${owner}/${repo}`, branch, sha, autoDeploy ? 1 : 0, boardId]
            );
        }
    } finally {
        await connection.end();
    }
}

// Agrega las columnas de despliegue GitHub a la tabla tableros si no existen
// (idempotente: seguro llamarlo en cada arranque).
async function ensureGithubColumns() {
    const connection = await getDbConnection();
    try {
        const [cols] = await connection.query(
            "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tableros'"
        );
        const existing = new Set(cols.map(c => c.COLUMN_NAME));
        const wanted = [
            ['github_repo', 'VARCHAR(255) NULL'],
            ['github_branch', "VARCHAR(100) NULL DEFAULT 'main'"],
            ['github_path', "VARCHAR(500) NULL DEFAULT 'index.html'"],
            ['github_auto_deploy', 'TINYINT(1) NOT NULL DEFAULT 0'],
            ['deployed_sha', 'CHAR(40) NULL'],
            ['deployed_at', 'DATETIME NULL']
        ];
        for (const [name, def] of wanted) {
            if (!existing.has(name)) {
                await connection.execute(`ALTER TABLE tableros ADD COLUMN ${name} ${def}`);
                console.log(`Columna agregada a tableros: ${name}`);
            }
        }
    } finally {
        await connection.end();
    }
}

// Interpreta URLs de tableros GitHub legados (proxy interno o GitHub Pages).
function parseLegacyGithubUrl(url) {
    if (!url) return null;
    const cleanUrl = String(url).split('?')[0];
    const proxyMatch = cleanUrl.match(/\/api\/github\/proxy\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/);
    if (proxyMatch) {
        return {
            owner: decodeURIComponent(proxyMatch[1]),
            repo: decodeURIComponent(proxyMatch[2]),
            branch: decodeURIComponent(proxyMatch[3]),
            path: decodeURIComponent(proxyMatch[4])
        };
    }
    const pagesMatch = cleanUrl.match(/^https?:\/\/([^./]+)\.github\.io\/([^/]+)\/(.+)$/);
    if (pagesMatch) {
        return { owner: pagesMatch[1], repo: pagesMatch[2], branch: 'main', path: pagesMatch[3] };
    }
    return null;
}

// Migra tableros creados con el mecanismo viejo (Pages o proxy) al modelo clonado.
// Devuelve un reporte; ante falla individual el tablero queda como está (el proxy
// sigue existiendo), nunca rompe el tablero vigente.
async function migrateLegacyGithubBoards() {
    const report = [];
    let rows = [];
    try {
        await ensureGithubColumns();
        const connection = await getDbConnection();
        [rows] = await connection.query(
            "SELECT id, iframe_url FROM tableros WHERE (iframe_url LIKE '%/api/github/proxy/%' OR iframe_url LIKE '%github.io/%') AND (github_repo IS NULL OR github_repo = '')"
        );
        await connection.end();
    } catch (e) {
        console.error('Error listando tableros GitHub a migrar:', e.message);
        return [{ id: null, ok: false, detail: e.message }];
    }

    for (const row of rows) {
        const meta = parseLegacyGithubUrl(row.iframe_url);
        if (!meta) {
            report.push({ id: row.id, ok: false, detail: `URL no interpretable: ${row.iframe_url}` });
            continue;
        }
        try {
            const deploy = await deployGithubBoard({ boardId: row.id, ...meta });
            await persistGithubDeploy(row.id, meta, deploy, true);
            report.push({ id: row.id, ok: true, detail: `${meta.owner}/${meta.repo}@${meta.branch} → ${deploy.sha.slice(0, 7)}` });
            console.log(`Tablero ${row.id} migrado a modelo clonado (${deploy.sha.slice(0, 7)}).`);
        } catch (e) {
            report.push({ id: row.id, ok: false, detail: e.message });
            console.error(`Falló migración de ${row.id} (sigue sirviéndose por el mecanismo anterior):`, e.message);
        }
    }
    return report;
}

// Auto-deploy por polling: compara el SHA de la rama con el último desplegado.
let githubPollInProgress = false;
async function pollGithubBoards() {
    if (githubPollInProgress) return;
    githubPollInProgress = true;
    try {
        const connection = await getDbConnection();
        const [rows] = await connection.query(
            'SELECT id, github_repo, github_branch, github_path, deployed_sha FROM tableros WHERE github_repo IS NOT NULL AND github_repo <> \'\' AND github_auto_deploy = 1 AND enabled = 1'
        );
        await connection.end();

        for (const row of rows) {
            try {
                const slashIdx = row.github_repo.indexOf('/');
                if (slashIdx <= 0) continue;
                const owner = row.github_repo.slice(0, slashIdx);
                const repo = row.github_repo.slice(slashIdx + 1);
                const branch = row.github_branch || 'main';
                const sha = await getLatestCommitSha(owner, repo, branch);
                if (sha !== row.deployed_sha) {
                    console.log(`Auto-deploy: cambio detectado en ${row.github_repo}@${branch}, redesplegando ${row.id}...`);
                    const deploy = await deployGithubBoard({ boardId: row.id, owner, repo, branch, entryPath: row.github_path || 'index.html' });
                    await persistGithubDeploy(row.id, { owner, repo, branch }, deploy);
                    console.log(`Auto-deploy completado para ${row.id} (${deploy.sha.slice(0, 7)}).`);
                }
            } catch (e) {
                console.error(`Auto-deploy falló para ${row.id}:`, e.message);
            }
        }
    } catch (e) {
        console.error('Error en polling de tableros GitHub:', e.message);
    } finally {
        githubPollInProgress = false;
    }
}
// ────────────────────────────────────────────────────────────────────────────

// Inicializar Resend para envío de emails (Condicional para evitar crasheos si falta la API Key)
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
if (!resend) {
    console.warn("⚠️ RESEND_API_KEY no configurada. El envío de emails estará deshabilitado.");
}

let firebaseInitError = null;
// Inicializar Firebase Admin
try {
    if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
        throw new Error("La variable de entorno FIREBASE_SERVICE_ACCOUNT no está definida.");
    }
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
    console.log('Firebase Admin inicializado correctamente.');
} catch (error) {
    firebaseInitError = error;
    console.error('Error al inicializar Firebase Admin:', error.message);
}

const app = express();
app.set('trust proxy', true); // Permitir capturar la IP real del cliente detrás del proxy inverso Nginx/Docker
const PORT = process.env.PORT || 8080;

// Proxy for Firebase Auth redirects and iframes (to prevent third-party cookie blocking)
app.get('/__/auth/*', async (req, res) => {
    try {
        const targetUrl = `https://web-subse.firebaseapp.com${req.originalUrl}`;
        const response = await fetch(targetUrl);
        const contentType = response.headers.get('content-type');
        if (contentType) {
            res.setHeader('Content-Type', contentType);
        }
        const buffer = await response.arrayBuffer();
        res.send(Buffer.from(buffer));
    } catch (err) {
        console.error("Firebase Auth Proxy Error:", err);
        res.status(500).send("Auth Proxy Error");
    }
});

// Lista blanca de archivos públicos permitidos desde la raíz
const PUBLIC_STATIC_ALLOWLIST = new Set([
    '/',
    '/index.html',
    '/admin.html',
    '/observatorio-gestion.html',
    '/monitor-satisfaccion.html',
    '/solicitudes-area.html',
    '/plantilla_bienvenida_ogm.html',
    '/admin.js',
    '/auth.js',
    '/firebase-config.js',
    '/requests.js',
    '/robots.txt',
    '/flujo_de_trabajo_observatorio.svg',
    '/flujo_de_trabajo_observatorio.html',
    '/brief_agente_auditoria_ogm.md',
    '/seguridad.html'
]);

const PUBLIC_STATIC_PREFIXES = [
    '/recursos/',
    '/normativas/'
];

// Filtro de seguridad para restringir entrega de estáticos de la raíz
app.use((req, res, next) => {
    // Permitir pasaje de rutas de API, proxy de auth y /uploads
    if (req.path.startsWith('/api/') || req.path.startsWith('/uploads/') || req.path.startsWith('/__/auth/')) {
        return next();
    }

    const reqPathLower = req.path.toLowerCase();

    // 1. Bloqueo explícito de scripts de servidor y configuraciones
    const BLOCKED_FILES = [
        '/server.js', '/migrate.js', '/evaluar-db.js', '/test-admin.js',
        '/test-mock.js', '/generate_security_doc.py', '/.env', '/package.json',
        '/package-lock.json', '/.gitignore', '/dockerfile', '/docker-compose.yml',
        '/php-buttons.code-snippets (1).php'
    ];

    if (BLOCKED_FILES.includes(reqPathLower)) {
        return res.status(404).send('Not Found');
    }

    // 2. Bloquear cualquier script/config que NO esté en la lista blanca.
    // Lista ampliada respecto de la original (.js, .py, .sh, .sql) para cubrir otros
    // lenguajes de servidor, backups y archivos de credenciales que no deberían
    // quedar accesibles por el simple hecho de existir en la raíz del proyecto.
    const BLOCKED_EXTENSIONS = [
        '.js', '.py', '.sh', '.sql', '.php', '.rb', '.pl', '.cgi',
        '.bak', '.backup', '.old', '.log', '.yml', '.yaml', '.ini',
        '.conf', '.config', '.pem', '.key', '.crt', '.swp', '.md'
    ];
    if (BLOCKED_EXTENSIONS.some(ext => reqPathLower.endsWith(ext)) && !PUBLIC_STATIC_ALLOWLIST.has(reqPathLower)) {
        return res.status(404).send('Not Found');
    }

    // 3. Permitir si está en la lista blanca o pertenece a un prefijo público
    if (PUBLIC_STATIC_ALLOWLIST.has(reqPathLower) || PUBLIC_STATIC_PREFIXES.some(prefix => reqPathLower.startsWith(prefix))) {
        return next();
    }

    // 4. Cualquier .html/.htm que no haya pasado la regla 3 no es un documento
    // reconocido del sitio: se bloquea en vez de permitirse por defecto.
    // (Verificado: todos los .html legítimos del proyecto están cubiertos por la
    // lista blanca o por PUBLIC_STATIC_PREFIXES; esta regla no rompe ninguno de ellos.)
    if (reqPathLower.endsWith('.html') || reqPathLower.endsWith('.htm')) {
        return res.status(404).send('Not Found');
    }

    next();
});

// Servir archivos estáticos filtrados desde la raíz
app.use(express.static(path.join(__dirname)));

// Registro de accesos DENEGADOS (Anexo I Art. 16.3, Resolucion 73: la traza debe
// cubrir los accesos permitidos y los denegados, con retencion minima de 2 anios).
// Hasta ahora las guardias solo escribian en la rama de exito: quedaba constancia
// de quien entro, no de a quien se le nego el paso.
//
// En una denegacion no hay usuario conocido — lo que fallo es justamente el token
// firmado — asi que se usa un marcador de origen, igual que en la rama de exito, y
// se vuelca en details lo que si se sabe. Escribe en segundo plano y nunca cambia
// la respuesta al cliente: un fallo del log no debe convertir un 403 en un 500.
function registrarAccesoDenegado(marcador, action, detalles, req) {
    getDbConnection().then(async (connection) => {
        try {
            await connection.execute(
                'INSERT INTO logs_actividad (user_uid, action, details, ip_address) VALUES (?, ?, ?, ?)',
                [marcador, action, JSON.stringify(detalles), req.ip || req.headers['x-forwarded-for'] || null]
            );
        } catch (e) {
            console.error('Error registrando acceso denegado:', e);
        } finally {
            await connection.end();
        }
    }).catch(() => {});
}

// Servir archivos de informes/tableros subidos, respetando require_login por recurso.
// Los tableros/informes con require_login = 0 se sirven exactamente igual que antes
// (sin consultar nada extra más allá de identificar a qué fila pertenecen). Los que
// tienen require_login = 1 exigen un token de acceso válido (?t=...&exp=...), emitido
// únicamente por GET /api/tableros o GET /api/informes para usuarios habilitados.
app.use('/uploads', async (req, res, next) => {
    const reqPath = req.path; // relativo al punto de montaje, ej: /tableros/project_x/index.html
    const fullStoredPath = '/uploads' + reqPath;

    try {
        let row = null;

        const projectMatch = reqPath.match(/^\/tableros\/project_([^/]+)\//);
        if (projectMatch) {
            const tableroId = decodeURIComponent(projectMatch[1]);
            row = await getCached(`tablero:id:${tableroId}`, async () => {
                const connection = await getDbConnection();
                const [[r]] = await connection.execute(
                    'SELECT id, require_login, allowed_users, access_expirations FROM tableros WHERE id = ?',
                    [tableroId]
                );
                await connection.end();
                return r || null;
            });
        } else if (reqPath.startsWith('/tableros/')) {
            row = await getCached(`tablero:path:${fullStoredPath}`, async () => {
                const connection = await getDbConnection();
                const [[r]] = await connection.execute(
                    'SELECT id, require_login, allowed_users, access_expirations FROM tableros WHERE file_path = ?',
                    [fullStoredPath]
                );
                await connection.end();
                return r || null;
            });
        } else if (reqPath.startsWith('/informes/')) {
            row = await getCached(`informe:path:${fullStoredPath}`, async () => {
                const connection = await getDbConnection();
                const [[r]] = await connection.execute(
                    'SELECT id, require_login, allowed_users, access_expirations FROM informes WHERE file_path = ?',
                    [fullStoredPath]
                );
                await connection.end();
                return r || null;
            });
        }

        // Sin fila asociada (archivo huérfano, no vinculado hoy a ningún tablero/informe
        // vigente): se deja pasar sin cambios, igual que se serviría hoy. No es una
        // regresión — hoy tampoco tiene ningún control.
        if (!row || !row.require_login) return next();

        const { t, exp } = req.query;
        if (!verifyTableroAccess(row.id, exp, t)) {
            registrarAccesoDenegado('(token-uploads)', 'acceso_denegado_archivo', {
                resourceId: row.id,
                path: fullStoredPath,
                motivo: !t ? 'sin_token' : 'token_invalido_o_vencido',
                exp: exp || null
            }, req);
            return res.status(403).send('Acceso no autorizado.');
        }

        // Registro autoritativo de acceso concedido (a diferencia de logs_actividad,
        // este lo escribe el servidor, no depende de que el cliente avise).
        getDbConnection().then(async (connection) => {
            try {
                await connection.execute(
                    'INSERT INTO logs_actividad (user_uid, action, details, ip_address) VALUES (?, ?, ?, ?)',
                    ['(token-uploads)', 'acceso_archivo_protegido', JSON.stringify({ resourceId: row.id, path: fullStoredPath }), req.ip || req.headers['x-forwarded-for'] || null]
                );
            } catch (e) {
                console.error('Error registrando acceso autoritativo:', e);
            } finally {
                await connection.end();
            }
        }).catch(() => {});

        res.set('Cache-Control', 'no-store');
        return next();
    } catch (e) {
        console.error('Error validando acceso a /uploads:', e);
        return res.status(500).send('Error interno.');
    }
}, express.static(UPLOADS_PATH));
app.use(express.json()); // Asegurar que pueda leer JSON en el body
app.use(cors());

// Datos de respaldo por si la base de datos MySQL no responde localmente
const MOCK_CATEGORIES = [
    { id: 'cat-gi-1', name: 'Gestión Municipal', description: 'Tableros de control interno municipal', icon: 'bar-chart-2', type: 'Gestores Internos', color: '#6366F1', visible: 1, sort_order: 1 },
    { id: 'cat-gi-2', name: 'Hacienda y Finanzas', description: 'Presupuesto y recaudación', icon: 'dollar-sign', type: 'Gestores Internos', color: '#10B981', visible: 1, sort_order: 2 },
    { id: 'cat-ge-1', name: 'Indicadores Públicos', description: 'Estadísticas públicas y movilidad', icon: 'pie-chart', type: 'Gestores Externos', color: '#F59E0B', visible: 1, sort_order: 3 },
    { id: '_monitor_cl', name: 'Clima Laboral', description: 'Encuestas de Clima Laboral', icon: 'users', type: 'Satisfacción', color: '#8B5CF6', visible: 1, sort_order: 4 },
    { id: '_monitor_cc', name: 'Satisfacción Ciudadana', description: 'Encuestas de Satisfacción Ciudadana', icon: 'smile', type: 'Satisfacción', color: '#EC4899', visible: 1, sort_order: 5 }
];

const MOCK_TABLEROS = [
    {
        id: 'tb-1',
        title: 'Tablero de Control General',
        icon: 'bar-chart-2',
        iframe_url: 'https://lookerstudio.google.com/embed/reporting/demo',
        enabled: 1,
        require_login: 0,
        open_in_new_tab: 0,
        sort_order: 1,
        allowed_users: [],
        categories: JSON.stringify(['cat-gi-1']),
        category_legacy: 'Gestores Internos'
    },
    {
        id: 'tb-2',
        title: 'Monitor de Satisfacción Ciudadana',
        icon: 'smile',
        iframe_url: 'https://lookerstudio.google.com/embed/reporting/demo2',
        enabled: 1,
        require_login: 0,
        open_in_new_tab: 0,
        sort_order: 2,
        allowed_users: [],
        categories: JSON.stringify(['_monitor_cc']),
        category_legacy: 'Satisfacción'
    },
    {
        id: 'tb-3',
        title: 'Encuesta Clima Laboral',
        icon: 'users',
        iframe_url: 'https://lookerstudio.google.com/embed/reporting/demo3',
        enabled: 1,
        require_login: 0,
        open_in_new_tab: 0,
        sort_order: 3,
        allowed_users: [],
        categories: JSON.stringify(['_monitor_cl']),
        category_legacy: 'Satisfacción'
    }
];

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
        return res.status(403).json({ error: `Token inválido o expirado: ${error.message}` });
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
    max: 2000, // Limita cada IP a 2000 peticiones por ventana (cada 15 min) para evitar bloquear el panel de administración
    message: {
        error: 'Demasiadas peticiones desde esta IP. Por favor, intente de nuevo más tarde.',
        code: 'TOO_MANY_REQUESTS'
    },
    standardHeaders: true, // Retorna info de límite en las cabeceras `RateLimit-*`
    legacyHeaders: false, // Desactiva las cabeceras `X-RateLimit-*`
    validate: { trustProxy: false } // Desactivar advertencia permisiva sobre trust proxy en VPS
});

// Limitador propio del acuse de recibo del RCE (Anexo I Art. 14, Resolucion 73).
// El limitador general (2000 peticiones / 15 min) esta calibrado para no trabar
// el panel de administracion; no sirve para una ruta que envia correo, donde el
// abuso no es scraping sino usar el Observatorio para bombardear una casilla.
//
// Se limita por USUARIO, no por IP: una jornada de altas desde una oficina
// municipal sale toda detras de la misma IP publica, y un limite por IP le
// habria negado el acuse a partir del sexto registrante — rompiendo justamente
// lo que esta correccion viene a arreglar. Va montado despues de verifyToken,
// asi que req.user.email ya esta disponible cuando corre keyGenerator; la IP
// queda solo como respaldo. El flujo legitimo usa 1 de las 10 por hora.
const bienvenidaLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hora
    max: 10,
    keyGenerator: (req) => (req.user && req.user.email)
        ? String(req.user.email).toLowerCase()
        : (req.ip || 'anonimo'),
    message: {
        error: 'Demasiados intentos de envio del acuse de recibo. Intente nuevamente mas tarde.',
        code: 'TOO_MANY_REQUESTS'
    },
    standardHeaders: true,
    legacyHeaders: false,
    // Las validaciones internas de la libreria asumen una clave derivada de la
    // IP y advierten sobre IPv6; aca la clave es el email verificado del token.
    validate: false
});

// Servir handler de autenticacion de Firebase para cerrar popups al instante
app.get('/__/auth/handler', (req, res) => {
    res.send(`<!DOCTYPE html>
<html>
<head><title>Autenticando...</title></head>
<body style="background:#f8f9fa;display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;">
  <p style="color:#495057;font-weight:600;">Autenticación completada. Cerrando ventana...</p>
  <script>
    setTimeout(function() {
      try { window.close(); } catch(e) {}
    }, 100);
  </script>
</body>
</html>`);
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
        port: parseInt(process.env.DB_PORT) || 3306,
        connectTimeout: 3000
    });
};

// Middleware para verificar el rol del usuario en la Base de Datos MySQL (RBAC)
// Consulta el rol efectivo de un usuario contra usuarios_perfiles, la misma
// fuente de verdad que usa requireRole. Se usa en rutas que no son puramente
// administrativas pero que igual necesitan distinguir a un admin (por ejemplo,
// permitirle actuar sobre otro usuario). No reemplaza a requireRole: para una
// ruta que es solo de admin, sigue usandose requireRole.
const getUserRole = async (email) => {
    if (!email) return null;
    let connection;
    try {
        connection = await getDbConnection();
        const [rows] = await connection.query(
            'SELECT role FROM usuarios_perfiles WHERE LOWER(email) = LOWER(?)',
            [email]
        );
        await connection.end();
        if (!rows || rows.length === 0) return null;
        return (rows[0].role || 'usuario').toLowerCase();
    } catch (error) {
        if (connection) { try { await connection.end(); } catch (e) {} }
        console.error('Error al consultar rol de usuario:', error);
        return null;
    }
};

const requireRole = (...allowedRoles) => {
    return async (req, res, next) => {
        if (!req.user || !req.user.email) {
            return res.status(401).json({ error: 'Usuario no autenticado o email no presente en el token.' });
        }

        let connection;
        try {
            connection = await getDbConnection();
            const [rows] = await connection.query(
                'SELECT role FROM usuarios_perfiles WHERE LOWER(email) = LOWER(?)',
                [req.user.email]
            );
            await connection.end();

            if (!rows || rows.length === 0) {
                return res.status(403).json({ error: 'Acceso denegado: Usuario no registrado en la base de datos.' });
            }

            const userRole = (rows[0].role || 'usuario').toLowerCase();
            const normalizedAllowed = allowedRoles.map(r => r.toLowerCase());

            if (!normalizedAllowed.includes(userRole)) {
                return res.status(403).json({ 
                    error: `Acceso denegado: Se requieren privilegios de ${allowedRoles.join(' o ')}.` 
                });
            }

            req.userRole = userRole;
            next();
        } catch (error) {
            if (connection) {
                try { await connection.end(); } catch (e) {}
            }
            console.error('Error al verificar rol de usuario en DB:', error);
            return res.status(500).json({ error: 'Error interno al verificar permisos de acceso.' });
        }
    };
};

// Variante de requireRole para rutas donde el header Authorization ya está
// ocupado por un token de un tercero (ej. GitHub) y no puede llevar, además,
// el token de sesión del Observatorio. Ese token viaja en un header propio
// (X-Observatorio-Token) y se verifica acá de forma independiente — no depende
// de que verifyToken haya corrido antes.
const requireRoleViaHeader = (headerName, ...allowedRoles) => {
    return async (req, res, next) => {
        const idToken = req.headers[headerName.toLowerCase()];
        if (!idToken) {
            return res.status(401).json({ error: `Falta el header ${headerName} con la sesión del Observatorio.` });
        }

        let connection;
        try {
            const decoded = await admin.auth().verifyIdToken(idToken);
            const email = decoded.email;
            if (!email) {
                return res.status(401).json({ error: 'Token de sesión sin email asociado.' });
            }

            connection = await getDbConnection();
            const [rows] = await connection.query(
                'SELECT role FROM usuarios_perfiles WHERE LOWER(email) = LOWER(?)',
                [email]
            );
            await connection.end();

            if (!rows || rows.length === 0) {
                return res.status(403).json({ error: 'Acceso denegado: Usuario no registrado en la base de datos.' });
            }

            const userRole = (rows[0].role || 'usuario').toLowerCase();
            const normalizedAllowed = allowedRoles.map(r => r.toLowerCase());
            if (!normalizedAllowed.includes(userRole)) {
                return res.status(403).json({ error: `Acceso denegado: Se requieren privilegios de ${allowedRoles.join(' o ')}.` });
            }

            req.observatorioUser = { email, role: userRole };
            next();
        } catch (error) {
            if (connection) {
                try { await connection.end(); } catch (e) {}
            }
            console.error(`Error al verificar sesión vía ${headerName}:`, error.message);
            return res.status(403).json({ error: 'Sesión del Observatorio inválida o expirada.' });
        }
    };
};

// Servir archivos de informes subidos
// (se registra después de crear app, antes de rutas)

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
        await connection.query(`ALTER TABLE usuarios_perfiles ADD COLUMN last_login DATETIME`).catch(() => {});
        await connection.query(`ALTER TABLE usuarios_perfiles ADD COLUMN role VARCHAR(50) DEFAULT 'usuario'`).catch(() => {});
        await connection.query(`UPDATE usuarios_perfiles SET role = 'admin' WHERE email = 'datos@riocuarto.gov.ar'`).catch(() => {});

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
        await connection.query("DELETE FROM productos_estadisticos WHERE client_name LIKE '%pablo%' OR area LIKE '%15. Innovación%'").catch(() => {});

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
                file_path VARCHAR(500),
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
            INSERT INTO config_sistema (config_key, config_value) 
            VALUES ('terms_version', '1')
            ON DUPLICATE KEY UPDATE config_value = '1'
        `);

        // 11. Tabla de Informes
        await connection.query(`
            CREATE TABLE IF NOT EXISTS informes (
                id VARCHAR(128) PRIMARY KEY,
                title VARCHAR(255) NOT NULL,
                description TEXT,
                categories JSON,
                url TEXT,
                file_path VARCHAR(500),
                file_type ENUM('url','pdf','image','html') DEFAULT 'url',
                period VARCHAR(100),
                year INT,
                enabled BOOLEAN DEFAULT TRUE,
                sort_order INT DEFAULT 0,
                require_login BOOLEAN DEFAULT FALSE,
                allowed_users JSON,
                access_expirations JSON,
                category_legacy VARCHAR(255),
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )
        `);

        // 12. Tabla de Favoritos por usuario
        await connection.query(`
            CREATE TABLE IF NOT EXISTS favoritos_usuario (
                id INT AUTO_INCREMENT PRIMARY KEY,
                uid VARCHAR(128) NOT NULL,
                item_type ENUM('tablero','informe') NOT NULL,
                item_id VARCHAR(128) NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY uq_favorito_usuario_item (uid, item_type, item_id),
                INDEX idx_favoritos_uid (uid)
            )
        `);

        // 13. Tabla de Evaluaciones (reseñas) de Tableros e Informes
        await connection.query(`
            CREATE TABLE IF NOT EXISTS feedback_tableros (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_uid VARCHAR(128) NOT NULL,
                email VARCHAR(255),
                item_type ENUM('tablero','informe') NOT NULL,
                item_id VARCHAR(128) NOT NULL,
                item_title VARCHAR(255),
                rating_parecido TINYINT NOT NULL,
                rating_utilidad TINYINT NOT NULL,
                comentario TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_feedback_tableros_item (item_type, item_id),
                INDEX idx_feedback_tableros_uid (user_uid)
            )
        `);

        // Asegurar que las columnas nuevas existan si la tabla ya había sido creada sin ellas
        try {
            await connection.query('ALTER TABLE informes ADD COLUMN require_login BOOLEAN DEFAULT FALSE');
        } catch (e) { /* ignore if exists */ }
        try {
            await connection.query('ALTER TABLE informes ADD COLUMN allowed_users JSON');
        } catch (e) { /* ignore if exists */ }
        try {
            await connection.query('ALTER TABLE informes ADD COLUMN access_expirations JSON');
        } catch (e) { /* ignore if exists */ }
        try {
            await connection.query('ALTER TABLE informes ADD COLUMN category_legacy VARCHAR(255)');
        } catch (e) { /* ignore if exists */ }
        try {
            await connection.query('ALTER TABLE tableros ADD COLUMN file_path VARCHAR(500)');
        } catch (e) { /* ignore if exists */ }

        // Seed Atlas Estadístico y Monitor Comparativo si no existen en la tabla tableros
        try {
            await connection.query(`
                INSERT INTO tableros (id, title, icon, iframe_url, enabled, require_login, open_in_new_tab, sort_order, allowed_users, access_expirations, categories)
                VALUES 
                ('atlas-estadistico', 'Atlas Estadístico RCU', '🗺️', 'Atlas y Monitor/Atlas Estadístico de Río Cuarto.html', TRUE, TRUE, FALSE, 998, '[]', '{}', '[]'),
                ('monitor-analisis-comparativo', 'Monitor de Análisis Comparativo RCU', '📊', 'Atlas y Monitor/atlas-analisis-comparativo.html', TRUE, TRUE, FALSE, 999, '[]', '{}', '[]')
                ON DUPLICATE KEY UPDATE id=id
            `);
        } catch (e) { console.warn('Error al seeding atlas y monitor:', e.message); }

        console.log('Estructura de base de datos lista.');
        await connection.end();
    } catch (error) {
        console.error('Error al inicializar las tablas:', error);
    }
};

const initializeTablesWithRetry = async (retries = 6, delay = 4000) => {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            const connection = await getDbConnection();
            await connection.ping();
            await connection.end();
            
            // Si conecta bien, procedemos a inicializar tablas
            await initializeTables();
            return;
        } catch (error) {
            console.error(`[DB init] Intento ${attempt}/${retries} fallido: la base de datos no responde (${error.message})`);
            if (attempt === retries) {
                console.error('[DB init] No se pudo establecer conexión con la base de datos tras varios intentos.');
            } else {
                console.log(`[DB init] Reintentando en ${delay / 1000} segundos...`);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        }
    }
};

// Ejecutar inicialización al arrancar con reintentos
initializeTablesWithRetry();

// Endpoint de prueba de conexión
app.get('/api/status', async (req, res) => {
    let dbStatus = 'disconnected';
    let dbError = null;
    let userInDb = null;

    try {
        const connection = await getDbConnection();
        await connection.ping();
        
        // Consultar si el usuario específico existe en la base de datos
        const [rows] = await connection.execute(
            'SELECT uid, email, full_name, created_at FROM usuarios_perfiles WHERE email = ?',
            ['gderivas@riocuarto.gov.ar']
        );
        if (rows.length > 0) {
            userInDb = rows[0];
        }
        
        await connection.end();
        dbStatus = 'connected';
    } catch (error) {
        dbError = error.message;
    }

    res.json({
        status: dbStatus === 'connected' && admin.apps.length > 0 ? 'online' : 'degraded',
        database: dbStatus,
        databaseError: dbError,
        userCheck: {
            email: 'gderivas@riocuarto.gov.ar',
            existsInDb: !!userInDb,
            userData: userInDb
        },
        firebaseInitialized: admin.apps.length > 0,
        firebaseEnvPresent: !!process.env.FIREBASE_SERVICE_ACCOUNT,
        firebaseEnvLength: process.env.FIREBASE_SERVICE_ACCOUNT ? process.env.FIREBASE_SERVICE_ACCOUNT.length : 0,
        firebaseInitError: firebaseInitError ? {
            message: firebaseInitError.message,
            stack: firebaseInitError.stack
        } : null,
        nodeVersion: process.version,
        time: new Date().toISOString()
    });
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
    const { uid, email, full_name } = req.body;
    if (!uid || !email) {
        return res.status(400).json({ error: 'Faltan campos obligatorios: uid, email' });
    }
    const cleanEmail = email.toLowerCase().trim();
    const defaultRole = cleanEmail === 'datos@riocuarto.gov.ar' ? 'admin' : 'usuario';
    try {
        const connection = await getDbConnection();
        await connection.execute(
            `INSERT INTO usuarios_perfiles (uid, email, full_name, role, last_login)
             VALUES (?, ?, ?, ?, NOW())
             ON DUPLICATE KEY UPDATE
               uid = VALUES(uid),
               full_name = COALESCE(NULLIF(?, ''), full_name),
               role = IF(email = 'datos@riocuarto.gov.ar', 'admin', role),
               last_login = NOW()`,
            [uid, cleanEmail, full_name, defaultRole, full_name]
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
        const userEmail = (req.user.email || '').toLowerCase().trim();
        const connection = await getDbConnection();
        if (userEmail === 'datos@riocuarto.gov.ar') {
            await connection.execute("UPDATE usuarios_perfiles SET role = 'admin' WHERE email = ?", [userEmail]).catch(() => {});
        }
        const [[profile], [configRow]] = await Promise.all([
            connection.execute('SELECT * FROM usuarios_perfiles WHERE email = ?', [userEmail])
                .then(([rows]) => rows),
            connection.query("SELECT config_value FROM config_sistema WHERE config_key = 'terms_version'")
                .then(([rows]) => rows)
        ]);
        await connection.end();

        if (profile && userEmail === 'datos@riocuarto.gov.ar') {
            profile.role = 'admin';
        }

        const isAdminEmail = userEmail === 'datos@riocuarto.gov.ar';
        const fallbackAdminProfile = {
            role: 'admin',
            sector_group: 'Municipalidad de Río Cuarto',
            organization_name: 'Observatorio de Gestión Municipal',
            role_position: 'Administrador',
            terms_accepted_version: '1'
        };

        res.json({
            profile: profile || (isAdminEmail ? fallbackAdminProfile : null),
            termsVersion: configRow?.config_value || '1'
        });
    } catch (error) {
        console.warn('DB offline, returning fallback profile:', error.message);
        const userEmail = (req.user?.email || '').toLowerCase().trim();
        const isAdminEmail = userEmail === 'datos@riocuarto.gov.ar';
        res.json({
            profile: isAdminEmail ? {
                role: 'admin',
                sector_group: 'Municipalidad de Río Cuarto',
                organization_name: 'Observatorio de Gestión Municipal',
                role_position: 'Administrador',
                terms_accepted_version: '1'
            } : null,
            termsVersion: '1'
        });
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

// ── ENVÍO DE EMAIL DE BIENVENIDA (Resend) ──────────────────────────────────
// Acuse de recibo del RCE (Anexo I Art. 14, Resolucion 73): completado el
// registro, el sistema debe enviar automaticamente la constancia con version del
// documento, fecha y hora de aceptacion y numero de registro.
//
// Esta ruta exigia requireRole('admin'), lo que la dejaba inalcanzable: su unico
// llamador es el flujo de registro en auth.js, donde el usuario recien creado
// tiene rol 'usuario'. La peticion devolvia 403 y el acuse obligatorio no se
// enviaba nunca. Ahora cada usuario dispara el suyo y un admin puede disparar el
// de cualquiera (reenvio manual). Un usuario comun no elige destinatario: se
// ignora el email del body y se usa el del token verificado. Ver
// docs/SECURITY_LOG.md.
app.post('/api/enviar-bienvenida', verifyToken, bienvenidaLimiter, async (req, res) => {
    const { full_name, registro_id, fecha_aceptacion, terms_version } = req.body;

    const solicitante = req.user && req.user.email ? req.user.email : null;
    const esAdmin = (await getUserRole(solicitante)) === 'admin';
    const email = esAdmin ? (req.body.email || solicitante) : solicitante;

    if (!email) {
        return res.status(400).json({ error: 'El campo email es obligatorio.' });
    }

    const userName = full_name || email.split('@')[0];

    // Datos de la constancia exigidos por el Anexo I Art. 14. Si el cliente no
    // los manda, se envia igual pero dejando explicito que el dato no vino, en
    // vez de inventarlo: una constancia con una fecha fabricada es peor que una
    // que declara el faltante.
    const fechaAceptacion = fecha_aceptacion ? new Date(fecha_aceptacion) : new Date();
    const fechaLegible = isNaN(fechaAceptacion.getTime())
        ? 'No disponible'
        : fechaAceptacion.toLocaleString('es-AR', {
            timeZone: 'America/Argentina/Cordoba',
            dateStyle: 'long',
            timeStyle: 'short'
        });
    const registroLegible = (registro_id !== undefined && registro_id !== null && registro_id !== '')
        ? `N° ${registro_id}`
        : 'No disponible';
    const versionLegible = terms_version ? `v${String(terms_version).replace(/^v/i, '')}` : 'v1';

    try {
        // 1. Leer el documento de T&C para adjuntarlo
        const termsPath = path.join(__dirname, 'normativas', 'Terminos', 'Terminos_y_Condiciones_OGM_RioCuarto_v1.htm');
        const termsContent = fs.readFileSync(termsPath);

        // 2. Enviar email con Resend (si está configurado)
        if (!resend) {
            console.log(`[Simulación] Email de bienvenida a ${email} no enviado (Resend no configurado).`);
            return res.json({ success: true, message: 'Simulación: Email de bienvenida omitido por falta de API Key.', emailId: 'simulated' });
        }

        let fromEmail = process.env.RESEND_FROM_EMAIL || 'onboarding@resend.dev';
        if (fromEmail && !fromEmail.includes('<')) {
            fromEmail = `Observatorio de Gestión Municipal <${fromEmail}>`;
        }

        const emailOptions = {
            from: fromEmail,
            to: [email],
            subject: 'Bienvenido/a al Observatorio de Gestión Municipal – RCU',
            attachments: [
                {
                    filename: 'Terminos_y_Condiciones_OGM_RioCuarto_v1.html',
                    content: termsContent.toString('base64'),
                    content_type: 'text/html'
                }
            ]
        };

        const templateId = process.env.RESEND_TEMPLATE_ID;

        if (templateId) {
            // Usar la plantilla creada en Resend
            emailOptions.template = {
                id: templateId,
                variables: {
                    userName: userName,
                    full_name: userName,
                    name: userName,
                    // Datos de constancia (Anexo I Art. 14). Si la plantilla
                    // remota todavia no los usa, el correo sale igual pero sin
                    // ellos: revisar la plantilla en Resend al desplegar.
                    termsVersion: versionLegible,
                    fechaAceptacion: fechaLegible,
                    registroId: registroLegible
                }
            };
        } else {
            // Fallback: Leer la plantilla HTML local y enviarla
            const templatePath = path.join(__dirname, 'plantilla_bienvenida_ogm.html');
            let htmlTemplate = fs.readFileSync(templatePath, 'utf-8');

            // Reemplazar placeholders con el nombre del usuario
            htmlTemplate = htmlTemplate.replace(/\[Nombre del destinatario\]/g, userName);
            htmlTemplate = htmlTemplate.replace(/\{\{\{userName\}\}\}/g, userName);
            htmlTemplate = htmlTemplate.replace(/\{\{\{termsVersion\}\}\}/g, versionLegible);
            htmlTemplate = htmlTemplate.replace(/\{\{\{fechaAceptacion\}\}\}/g, fechaLegible);
            htmlTemplate = htmlTemplate.replace(/\{\{\{registroId\}\}\}/g, registroLegible);

            // Convertir los enlaces a absolutos basados en el host de la petición
            const protocol = req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
            let host = req.get('host');
            if (host.includes('localhost') || host.includes('127.0.0.1')) {
                host = 'observatorio.72.60.8.241.sslip.io'; // Fallback público para pruebas locales (VPS)
            }
            const baseUrl = `${protocol}://${host}`;
            htmlTemplate = htmlTemplate.replace(/href="http:\/\/observatorio\.72\.60\.8\.241\.sslip\.io\/"/g, `href="${baseUrl}/"`);
            htmlTemplate = htmlTemplate.replace(/observatorio\.72\.60\.8\.241\.sslip\.io<\/div>/g, `${host}</div>`);

            emailOptions.html = htmlTemplate;
        }

        const { data, error } = await resend.emails.send(emailOptions);

        if (error) {
            console.error('Error de Resend al enviar email:', error);
            return res.status(500).json({ error: 'Error al enviar email de bienvenida.', details: error.message });
        }

        console.log(`Email de bienvenida enviado a ${email} (ID: ${data?.id})`);
        res.json({ success: true, message: 'Email de bienvenida enviado.', emailId: data?.id });
    } catch (error) {
        console.error('Error al enviar email de bienvenida:', error);
        res.status(500).json({ error: 'Error interno al enviar email.', details: error.message });
    }
});

// ── SOLICITUDES DE ACCESO ──────────────────────────────────────────────────

// Listar todas las solicitudes (admin / fiscal)
app.get('/api/solicitudes', verifyToken, requireRole('admin', 'fiscal'), async (_req, res) => {
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
app.patch('/api/solicitudes/:id/status', verifyToken, requireRole('admin', 'fiscal'), async (req, res) => {
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
app.post('/api/solicitudes/:id/aprobar', verifyToken, requireRole('admin', 'fiscal'), async (req, res) => {
    try {
        const { email, tablero_id, expiry_iso } = req.body;
        const connection = await getDbConnection();

        // 1. Obtener tablero (por ID o por título, para compatibilidad con datos históricos)
        const [[tablero]] = await connection.execute(
            'SELECT id, allowed_users, access_expirations FROM tableros WHERE id = ? OR title = ? LIMIT 1',
            [tablero_id, tablero_id]
        );
        if (tablero) {
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

            if (!Array.isArray(allowed)) allowed = [];
            if (typeof expirations !== 'object' || expirations === null || Array.isArray(expirations)) expirations = {};

            const lowerEmail = email.toLowerCase();
            if (!allowed.map(u => String(u).toLowerCase()).includes(lowerEmail)) {
                allowed.push(email);
            }
            if (expiry_iso) {
                expirations[lowerEmail] = expiry_iso;
            }
            await connection.execute(
                'UPDATE tableros SET allowed_users = ?, access_expirations = ? WHERE id = ?',
                [JSON.stringify(allowed), JSON.stringify(expirations), tablero.id]
            );
        } else {
            // Si no es un tablero, buscar en informes
            const [[informe]] = await connection.execute(
                'SELECT id, allowed_users, access_expirations FROM informes WHERE id = ? OR title = ? LIMIT 1',
                [tablero_id, tablero_id]
            );
            if (informe) {
                let allowed = [];
                try {
                    const rawAllowed = informe.allowed_users;
                    if (Array.isArray(rawAllowed)) {
                        allowed = rawAllowed;
                    } else if (typeof rawAllowed === 'string' && rawAllowed.trim() !== '') {
                        allowed = JSON.parse(rawAllowed);
                    }
                } catch (jsonErr) {
                    console.error("Error parsing allowed_users for informe:", jsonErr);
                    allowed = [];
                }

                let expirations = {};
                try {
                    const rawExp = informe.access_expirations;
                    if (typeof rawExp === 'object' && rawExp !== null && !Array.isArray(rawExp)) {
                        expirations = rawExp;
                    } else if (typeof rawExp === 'string' && rawExp.trim() !== '') {
                        expirations = JSON.parse(rawExp);
                    }
                } catch (jsonErr) {
                    console.error("Error parsing access_expirations for informe:", jsonErr);
                    expirations = {};
                }

                if (!Array.isArray(allowed)) allowed = [];
                if (typeof expirations !== 'object' || expirations === null || Array.isArray(expirations)) expirations = {};

                const lowerEmail = email.toLowerCase();
                if (!allowed.map(u => String(u).toLowerCase()).includes(lowerEmail)) {
                    allowed.push(email);
                }
                if (expiry_iso) {
                    expirations[lowerEmail] = expiry_iso;
                }
                await connection.execute(
                    'UPDATE informes SET allowed_users = ?, access_expirations = ? WHERE id = ?',
                    [JSON.stringify(allowed), JSON.stringify(expirations), informe.id]
                );
            }
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
app.delete('/api/contactos/:id', verifyToken, requireRole('admin'), async (req, res) => {
    try {
        const connection = await getDbConnection();
        await connection.execute('DELETE FROM mensajes_contacto WHERE id = ?', [req.params.id]);
        await connection.end();
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── FEEDBACK ───────────────────────────────────────────────────────────────

// Eliminar feedback
app.delete('/api/feedback/:id', verifyToken, requireRole('admin'), async (req, res) => {
    try {
        const connection = await getDbConnection();
        await connection.execute('DELETE FROM feedback_web WHERE id = ?', [req.params.id]);
        await connection.end();
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── CATEGORÍAS (PATCH + DELETE) ────────────────────────────────────────────

app.patch('/api/categorias/:id', verifyToken, requireRole('admin'), async (req, res) => {
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

app.delete('/api/categorias/:id', verifyToken, requireRole('admin'), async (req, res) => {
    try {
        const connection = await getDbConnection();
        await connection.execute('DELETE FROM categorias WHERE id = ?', [req.params.id]);
        await connection.end();
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── TABLEROS (PATCH + DELETE) ──────────────────────────────────────────────

app.patch('/api/tableros/:id', verifyToken, requireRole('admin'), async (req, res) => {
    try {
        const { id } = req.params;
        const fields = { ...req.body };

        Object.keys(fields).forEach(k => { if (fields[k] === undefined || fields[k] === '') delete fields[k]; });

        if (Object.keys(fields).length === 0) return res.json({ success: true });

        if ('enabled' in fields) fields.enabled = (fields.enabled === 'true' || fields.enabled === true || fields.enabled === 1) ? 1 : 0;
        if ('require_login' in fields) fields.require_login = (fields.require_login === 'true' || fields.require_login === true || fields.require_login === 1) ? 1 : 0;
        if ('open_in_new_tab' in fields) fields.open_in_new_tab = (fields.open_in_new_tab === 'true' || fields.open_in_new_tab === true || fields.open_in_new_tab === 1) ? 1 : 0;
        if ('allowed_users' in fields && typeof fields.allowed_users !== 'string') fields.allowed_users = JSON.stringify(fields.allowed_users);
        if ('access_expirations' in fields && typeof fields.access_expirations !== 'string') fields.access_expirations = JSON.stringify(fields.access_expirations);

        const sets = Object.keys(fields).map(k => `${k} = ?`).join(', ');
        const vals = [...Object.values(fields), id];

        const connection = await getDbConnection();
        await connection.execute(`UPDATE tableros SET ${sets} WHERE id = ?`, vals);
        await connection.end();
        res.json({ success: true });
    } catch (e) {
        console.error('Error updating board:', e);
        res.status(500).json({ error: e.message });
    }
});

app.delete('/api/tableros/:id', verifyToken, requireRole('admin'), async (req, res) => {
    try {
        const connection = await getDbConnection();
        const [[row]] = await connection.execute('SELECT file_path FROM tableros WHERE id = ?', [req.params.id]);
        if (row && row.file_path) {
            const absPath = path.join(__dirname, row.file_path);
            
            // Si la ruta del archivo pertenece a un proyecto descomprimido en carpeta dedicada,
            // eliminamos toda la carpeta.
            if (row.file_path.includes('/project_')) {
                const projectDir = path.dirname(absPath);
                if (fs.existsSync(projectDir)) {
                    try { fs.rmSync(projectDir, { recursive: true, force: true }); } catch (e) { console.error('Error deleting project dir on board delete:', e); }
                }
            } else {
                if (fs.existsSync(absPath)) {
                    try { fs.unlinkSync(absPath); } catch (e) { console.error('Error deleting file on board delete:', e); }
                }
            }
        }
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
        console.warn("DB offline, returning fallback categories:", error.message);
        res.json(MOCK_CATEGORIES);
    }
});

// 6b. Guardar/Actualizar categoría (Admin)
app.post('/api/categorias', verifyToken, requireRole('admin'), async (req, res) => {
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
        const requesterEmail = await getOptionalUserEmail(req);
        const connection = await getDbConnection();
        const [rows] = await connection.query('SELECT * FROM tableros ORDER BY sort_order ASC');
        const blanketAccess = await hasBlanketAccess(connection, requesterEmail);
        await connection.end();
        const withTokens = rows.map(row => {
            if (!row.require_login || !(blanketAccess || isEntitled(row, requesterEmail))) return row;
            return { ...row, iframe_url: withAccessToken(row.iframe_url, row.id) };
        });
        res.json(withTokens);
    } catch (error) {
        console.warn("DB offline, returning fallback tableros:", error.message);
        res.json(MOCK_TABLEROS);
    }
});

// 8. Guardar/Actualizar tablero (Admin)
app.post('/api/tableros', verifyToken, requireRole('admin'), uploadTableros.single('archivo'), async (req, res) => {
    // Aquí podrías validar que req.user.email sea admin
    const { id, title, icon, iframe_url, enabled, require_login, open_in_new_tab, sort_order, allowed_users, access_expirations, categories, category_legacy, source_type, github_repo, github_branch, github_path, github_auto_deploy } = req.body;
    try {
        const safeId = id || `board_${Date.now()}`;
        const connection = await getDbConnection();
        
        // Obtener tablero existente para ver si ya tiene un archivo
        const [[existing]] = await connection.execute('SELECT file_path, iframe_url FROM tableros WHERE id = ?', [safeId]);

        let finalIframeUrl = iframe_url || '';
        let filePath = null;
        let ghMeta = null; // metadatos de despliegue GitHub (solo source_type = 'github')

        if (existing) {
            filePath = existing.file_path;
            finalIframeUrl = existing.iframe_url;
        }

        if (req.file) {
            // Eliminar archivo o carpeta viejo si existe
            if (existing && existing.file_path) {
                const oldPath = path.join(__dirname, existing.file_path);
                
                // Si la ruta previa pertenecía a un proyecto descomprimido (e.g. estaba dentro de una carpeta del proyecto)
                // de tipo uploads/tableros/project_<id>/, borramos toda la carpeta del proyecto.
                if (existing.file_path.includes('/project_')) {
                    const projectDir = path.dirname(oldPath);
                    if (fs.existsSync(projectDir)) {
                        try { fs.rmSync(projectDir, { recursive: true, force: true }); } catch (e) { console.error('Error deleting old project dir:', e); }
                    }
                } else {
                    if (fs.existsSync(oldPath)) {
                        try { fs.unlinkSync(oldPath); } catch (e) { console.error('Error deleting old file:', e); }
                    }
                }
            }

            const ext = path.extname(req.file.originalname).toLowerCase();
            if (ext === '.zip') {
                // Es un archivo ZIP, lo descomprimimos
                const projectFolderName = `project_${safeId}`;
                const projectExtractDir = path.join(TABLEROS_DIR, projectFolderName);
                
                // Asegurar que el directorio de extracción esté limpio y exista
                if (fs.existsSync(projectExtractDir)) {
                    fs.rmSync(projectExtractDir, { recursive: true, force: true });
                }
                fs.mkdirSync(projectExtractDir, { recursive: true });

                try {
                    const zip = new AdmZip(req.file.path);
                    zip.extractAllTo(projectExtractDir, true);

                    // Buscar el archivo HTML principal
                    // Priorizamos index.html en la raíz de extracción
                    let entrypointFile = 'index.html';
                    const filesInRoot = fs.readdirSync(projectExtractDir);
                    
                    if (!filesInRoot.includes('index.html')) {
                        // Si no hay index.html, buscar cualquier archivo HTML
                        const htmlFile = filesInRoot.find(f => f.endsWith('.html') || f.endsWith('.htm'));
                        if (htmlFile) {
                            entrypointFile = htmlFile;
                        } else {
                            // Buscar recursivamente en subcarpetas (máximo 1 nivel de profundidad para evitar loops)
                            let found = null;
                            for (const f of filesInRoot) {
                                const fullPath = path.join(projectExtractDir, f);
                                if (fs.statSync(fullPath).isDirectory()) {
                                    const subFiles = fs.readdirSync(fullPath);
                                    const subHtml = subFiles.find(sf => sf.endsWith('.html') || sf.endsWith('.htm'));
                                    if (subHtml) {
                                        found = path.join(f, subHtml);
                                        break;
                                    }
                                }
                            }
                            if (found) {
                                entrypointFile = found;
                            }
                        }
                    }

                    filePath = `/uploads/tableros/${projectFolderName}/${entrypointFile.replace(/\\/g, '/')}`;
                    finalIframeUrl = filePath;
                } catch (zipErr) {
                    console.error('Error extracting ZIP file:', zipErr);
                    throw new Error('No se pudo procesar el archivo ZIP de manera correcta.');
                } finally {
                    // Eliminar el archivo .zip temporal cargado por multer para no desperdiciar espacio
                    if (fs.existsSync(req.file.path)) {
                        try { fs.unlinkSync(req.file.path); } catch (e) {}
                    }
                }
            } else {
                // Archivo convencional
                filePath = `/uploads/tableros/${req.file.filename}`;
                finalIframeUrl = filePath;
            }
        } else if (source_type === 'url') {
            // Eliminar archivo viejo si cambia a URL
            if (existing && existing.file_path) {
                const oldPath = path.join(__dirname, existing.file_path);
                if (existing.file_path.includes('/project_')) {
                    const projectDir = path.dirname(oldPath);
                    if (fs.existsSync(projectDir)) {
                        try { fs.rmSync(projectDir, { recursive: true, force: true }); } catch (e) { console.error('Error deleting old project dir on source switch:', e); }
                    }
                } else {
                    if (fs.existsSync(oldPath)) {
                        try { fs.unlinkSync(oldPath); } catch (e) { console.error('Error deleting old file on source switch:', e); }
                    }
                }
            }
            filePath = null;
            finalIframeUrl = iframe_url || '';
        } else if (source_type === 'github' && github_repo) {
            // Modelo tipo Vercel: el servidor descarga el repo y lo sirve localmente
            // desde /uploads/tableros/project_<id>/ (misma guardia que los ZIP subidos).
            const slashIdx = String(github_repo).indexOf('/');
            if (slashIdx <= 0 || slashIdx === String(github_repo).length - 1) {
                await connection.end();
                return res.status(400).json({ error: 'Formato de repositorio inválido (esperado dueño/repo).' });
            }
            const ghOwner = String(github_repo).slice(0, slashIdx);
            const ghRepo = String(github_repo).slice(slashIdx + 1);
            const ghBranch = github_branch || 'main';

            // Si antes era un archivo suelto (no proyecto), borrarlo al cambiar a GitHub.
            if (existing && existing.file_path && !existing.file_path.includes('/project_')) {
                const oldPath = path.join(__dirname, existing.file_path);
                if (fs.existsSync(oldPath)) {
                    try { fs.unlinkSync(oldPath); } catch (e) { console.error('Error deleting old file on source switch:', e); }
                }
            }

            try {
                ghMeta = {
                    owner: ghOwner,
                    repo: ghRepo,
                    branch: ghBranch,
                    ...(await deployGithubBoard({ boardId: safeId, owner: ghOwner, repo: ghRepo, branch: ghBranch, entryPath: github_path || 'index.html' }))
                };
            } catch (deployErr) {
                await connection.end();
                console.error('Error desplegando tablero desde GitHub:', deployErr);
                return res.status(502).json({ error: 'No se pudo desplegar el repositorio: ' + deployErr.message });
            }
            filePath = ghMeta.filePath;
            finalIframeUrl = ghMeta.filePath;
        }

        const sql = `
            INSERT INTO tableros (id, title, icon, iframe_url, file_path, enabled, require_login, open_in_new_tab, sort_order, allowed_users, access_expirations, categories, category_legacy, github_repo, github_branch, github_path, github_auto_deploy, deployed_sha, deployed_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE 
            title=VALUES(title), icon=VALUES(icon), iframe_url=VALUES(iframe_url), file_path=VALUES(file_path), enabled=VALUES(enabled), 
            require_login=VALUES(require_login), open_in_new_tab=VALUES(open_in_new_tab), sort_order=VALUES(sort_order),
            allowed_users=VALUES(allowed_users), access_expirations=VALUES(access_expirations), categories=VALUES(categories), category_legacy=VALUES(category_legacy),
            github_repo=VALUES(github_repo), github_branch=VALUES(github_branch), github_path=VALUES(github_path),
            github_auto_deploy=VALUES(github_auto_deploy), deployed_sha=VALUES(deployed_sha), deployed_at=VALUES(deployed_at)
        `;
        
        const safeTitle = title || '';
        const safeIcon = icon || '';
        const safeEnabled = (enabled === true || enabled === 1 || enabled === 'true') ? 1 : 0;
        const safeRequireLogin = (require_login === true || require_login === 1 || require_login === 'true') ? 1 : 0;
        const safeOpenInNewTab = (open_in_new_tab === true || open_in_new_tab === 1 || open_in_new_tab === 'true') ? 1 : 0;
        const safeSortOrder = parseInt(sort_order) || 0;
        
        let parsedAllowedUsers = [];
        try {
            parsedAllowedUsers = typeof allowed_users === 'string' ? JSON.parse(allowed_users) : (allowed_users || []);
        } catch (e) { parsedAllowedUsers = []; }
        const safeAllowedUsers = JSON.stringify(parsedAllowedUsers);

        let parsedAccessExpirations = {};
        try {
            parsedAccessExpirations = typeof access_expirations === 'string' ? JSON.parse(access_expirations) : (access_expirations || {});
        } catch (e) { parsedAccessExpirations = {}; }
        const safeAccessExpirations = JSON.stringify(parsedAccessExpirations);

        let parsedCategories = [];
        try {
            parsedCategories = typeof categories === 'string' ? JSON.parse(categories) : (categories || []);
        } catch (e) { parsedCategories = []; }
        const safeCategories = JSON.stringify(parsedCategories);

        const safeCategoryLegacy = category_legacy || '';

        // Metadatos de despliegue GitHub: solo se completan si el origen es un repo;
        // en cualquier otro tipo de fuente se limpian para que el poller y la UI
        // no sigan tratando al tablero como de GitHub.
        const safeGithubRepo = ghMeta ? `${ghMeta.owner}/${ghMeta.repo}` : null;
        const safeGithubBranch = ghMeta ? ghMeta.branch : null;
        const safeGithubPath = ghMeta ? (github_path || 'index.html') : null;
        const safeAutoDeploy = ghMeta ? ((github_auto_deploy === true || github_auto_deploy === 1 || github_auto_deploy === 'true') ? 1 : 0) : 0;
        const safeDeployedSha = ghMeta ? ghMeta.sha : null;
        const safeDeployedAt = ghMeta ? new Date() : null;

        await connection.execute(sql, [
            safeId, safeTitle, safeIcon, finalIframeUrl, filePath, safeEnabled, safeRequireLogin, safeOpenInNewTab, safeSortOrder, 
            safeAllowedUsers, safeAccessExpirations, safeCategories, safeCategoryLegacy,
            safeGithubRepo, safeGithubBranch, safeGithubPath, safeAutoDeploy, safeDeployedSha, safeDeployedAt
        ]);
        await connection.end();
        res.json({ message: 'Tablero guardado.', id: safeId, iframe_url: finalIframeUrl });
    } catch (error) {
        console.error('Error saving board:', error);
        res.status(500).json({ error: error.message });
    }
});

// Redesplegar manualmente un tablero de origen GitHub (Admin) — botón "Redesplegar".
app.post('/api/tableros/:id/redeploy', verifyToken, requireRole('admin'), async (req, res) => {
    try {
        const { id } = req.params;
        const connection = await getDbConnection();
        const [[row]] = await connection.execute('SELECT github_repo, github_branch, github_path FROM tableros WHERE id = ?', [id]);
        await connection.end();
        if (!row) return res.status(404).json({ error: 'Tablero no encontrado.' });
        if (!row.github_repo) return res.status(400).json({ error: 'Este tablero no tiene origen GitHub configurado.' });

        const slashIdx = row.github_repo.indexOf('/');
        const owner = row.github_repo.slice(0, slashIdx);
        const repo = row.github_repo.slice(slashIdx + 1);
        const branch = row.github_branch || 'main';

        const deploy = await deployGithubBoard({ boardId: id, owner, repo, branch, entryPath: row.github_path || 'index.html' });
        await persistGithubDeploy(id, { owner, repo, branch }, deploy);
        res.json({ message: 'Despliegue actualizado.', sha: deploy.sha, iframe_url: deploy.filePath });
    } catch (e) {
        console.error('Error en redeploy de tablero:', e);
        res.status(502).json({ error: e.message });
    }
});

// Migrar manualmente todos los tableros GitHub legados (Pages/proxy) al modelo
// clonado (Admin). Útil si la migración automática del arranque falló para alguno.
app.post('/api/tableros/migrate-github', verifyToken, requireRole('admin'), async (req, res) => {
    try {
        const report = await migrateLegacyGithubBoards();
        res.json({ message: `Migración finalizada: ${report.filter(r => r.ok).length} ok, ${report.filter(r => !r.ok).length} con error.`, report });
    } catch (e) {
        console.error('Error en migración manual de tableros GitHub:', e);
        res.status(500).json({ error: e.message });
    }
});



// ── INFORMES ───────────────────────────────────────────────────────────────

// Obtener todos los informes habilitados (público)
app.get('/api/informes', async (req, res) => {
    try {
        const requesterEmail = await getOptionalUserEmail(req);
        const connection = await getDbConnection();
        const [rows] = await connection.query('SELECT * FROM informes ORDER BY year DESC, sort_order ASC');
        const blanketAccess = await hasBlanketAccess(connection, requesterEmail);
        await connection.end();
        const withTokens = rows.map(row => {
            if (!row.require_login || !(blanketAccess || isEntitled(row, requesterEmail))) return row;
            return { ...row, file_path: withAccessToken(row.file_path, row.id) };
        });
        res.json(withTokens);
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// ── FAVORITOS POR USUARIO ──────────────────────────────────────────────────

// Obtener favoritos del usuario autenticado
app.get('/api/favoritos', verifyToken, async (req, res) => {
    const uid = req.user.uid;
    try {
        const connection = await getDbConnection();
        const [rows] = await connection.query(
            'SELECT item_type, item_id FROM favoritos_usuario WHERE uid = ?',
            [uid]
        );
        await connection.end();
        res.json(rows);
    } catch (error) {
        console.error('Error al obtener favoritos:', error);
        res.status(500).json({ error: 'Error al obtener favoritos.' });
    }
});

// Agregar o quitar un favorito del usuario autenticado
app.post('/api/favoritos/toggle', verifyToken, async (req, res) => {
    const uid = req.user.uid;
    const { item_type, item_id } = req.body;

    if (!item_id || !['tablero', 'informe'].includes(item_type)) {
        return res.status(400).json({ error: 'item_id es requerido y item_type debe ser "tablero" o "informe".' });
    }

    try {
        const connection = await getDbConnection();
        const [result] = await connection.execute(
            'DELETE FROM favoritos_usuario WHERE uid = ? AND item_type = ? AND item_id = ?',
            [uid, item_type, item_id]
        );
        if (result.affectedRows === 0) {
            await connection.execute(
                'INSERT INTO favoritos_usuario (uid, item_type, item_id) VALUES (?, ?, ?)',
                [uid, item_type, item_id]
            );
        }
        await connection.end();
        res.json({ status: 'ok', favorito: result.affectedRows === 0 });
    } catch (error) {
        console.error('Error al alternar favorito:', error);
        res.status(500).json({ error: 'Error al alternar favorito.' });
    }
});

// ── EVALUACIONES DE TABLEROS E INFORMES ────────────────────────────────────

// Crear evaluación (usuario autenticado)
app.post('/api/feedback-tableros', verifyToken, async (req, res) => {
    const uid = req.user.uid;
    const email = (req.user.email || '').toLowerCase().trim();
    const { item_type, item_id, item_title, rating_parecido, rating_utilidad, comentario } = req.body;

    const r1 = parseInt(rating_parecido, 10);
    const r2 = parseInt(rating_utilidad, 10);
    if (!item_id || !['tablero', 'informe'].includes(item_type) || !(r1 >= 1 && r1 <= 5) || !(r2 >= 1 && r2 <= 5)) {
        return res.status(400).json({ error: 'Faltan datos o las puntuaciones deben estar entre 1 y 5.' });
    }

    try {
        const connection = await getDbConnection();
        await connection.execute(
            `INSERT INTO feedback_tableros (user_uid, email, item_type, item_id, item_title, rating_parecido, rating_utilidad, comentario)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [uid, email || null, item_type, item_id, item_title || null, r1, r2, comentario || null]
        );
        await connection.end();
        res.json({ status: 'ok' });
    } catch (error) {
        console.error('Error al guardar evaluación:', error);
        res.status(500).json({ error: 'Error al guardar la evaluación.' });
    }
});

// Listar evaluaciones (admin)
app.get('/api/feedback-tableros', verifyToken, requireRole('admin'), async (_req, res) => {
    try {
        const connection = await getDbConnection();
        const [rows] = await connection.query('SELECT * FROM feedback_tableros ORDER BY created_at DESC');
        await connection.end();
        res.json(rows);
    } catch (error) {
        console.error('Error al listar evaluaciones:', error);
        res.status(500).json({ error: 'Error al listar las evaluaciones.' });
    }
});

// Eliminar evaluación (admin)
app.delete('/api/feedback-tableros/:id', verifyToken, requireRole('admin'), async (req, res) => {
    try {
        const connection = await getDbConnection();
        await connection.execute('DELETE FROM feedback_tableros WHERE id = ?', [req.params.id]);
        await connection.end();
        res.json({ success: true });
    } catch (error) {
        console.error('Error al eliminar evaluación:', error);
        res.status(500).json({ error: 'Error al eliminar la evaluación.' });
    }
});

// Crear informe (admin) — acepta multipart/form-data para subida de archivos
app.post('/api/informes', verifyToken, requireRole('admin'), uploadInformes.single('archivo'), async (req, res) => {
    try {
        const {
            id, title, description, categories, url,
            period, year, enabled, sort_order,
            require_login, allowed_users, access_expirations, category_legacy
        } = req.body;

        let finalUrl = url || null;
        let filePath = null;
        let fileType = 'url';

        if (req.file) {
            filePath = `/uploads/informes/${req.file.filename}`;
            finalUrl = filePath;
            const ext = path.extname(req.file.originalname).toLowerCase();
            if (ext === '.pdf') fileType = 'pdf';
            else if (['.html', '.htm'].includes(ext)) fileType = 'html';
            else fileType = 'image';
        } else if (finalUrl) {
            fileType = 'url';
        }

        const informeId = id || ('inf-' + Date.now());
        const connection = await getDbConnection();
        const sql = `
            INSERT INTO informes (
                id, title, description, categories, url, file_path, file_type, 
                period, year, enabled, sort_order, require_login, allowed_users, access_expirations, category_legacy
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
            title=VALUES(title), description=VALUES(description), categories=VALUES(categories),
            url=VALUES(url), file_path=VALUES(file_path), file_type=VALUES(file_type),
            period=VALUES(period), year=VALUES(year), enabled=VALUES(enabled), sort_order=VALUES(sort_order),
            require_login=VALUES(require_login), allowed_users=VALUES(allowed_users), access_expirations=VALUES(access_expirations), category_legacy=VALUES(category_legacy)
        `;
        await connection.execute(sql, [
            informeId, title, description || null,
            categories || null,
            finalUrl, filePath, fileType,
            period || null, year ? parseInt(year) : null,
            enabled !== undefined ? (enabled === 'true' || enabled === true ? 1 : 0) : 1,
            sort_order ? parseInt(sort_order) : 0,
            require_login === 'true' || require_login === true ? 1 : 0,
            allowed_users || null,
            access_expirations || null,
            category_legacy || null
        ]);
        await connection.end();
        res.json({ success: true, id: informeId, url: finalUrl });
    } catch (e) {
        console.error('Error creating informe:', e);
        res.status(500).json({ error: e.message });
    }
});

// Editar informe (admin) — también acepta archivo nuevo
app.patch('/api/informes/:id', verifyToken, requireRole('admin'), uploadInformes.single('archivo'), async (req, res) => {
    try {
        const { id } = req.params;
        const fields = { ...req.body };

        if (req.file) {
            fields.file_path = `/uploads/informes/${req.file.filename}`;
            fields.url = fields.file_path;
            const ext = path.extname(req.file.originalname).toLowerCase();
            if (ext === '.pdf') fields.file_type = 'pdf';
            else if (['.html', '.htm'].includes(ext)) fields.file_type = 'html';
            else fields.file_type = 'image';
        }

        // Remove undefined / empty keys
        Object.keys(fields).forEach(k => { if (fields[k] === undefined || fields[k] === '') delete fields[k]; });

        if (Object.keys(fields).length === 0) return res.json({ success: true });

        // Coerce booleans
        if ('enabled' in fields) fields.enabled = (fields.enabled === 'true' || fields.enabled === true) ? 1 : 0;
        if ('require_login' in fields) fields.require_login = (fields.require_login === 'true' || fields.require_login === true) ? 1 : 0;
        if ('year' in fields) fields.year = parseInt(fields.year) || null;
        if ('sort_order' in fields) fields.sort_order = parseInt(fields.sort_order) || 0;

        const sets = Object.keys(fields).map(k => `${k} = ?`).join(', ');
        const vals = [...Object.values(fields), id];

        const connection = await getDbConnection();
        await connection.execute(`UPDATE informes SET ${sets} WHERE id = ?`, vals);
        await connection.end();
        res.json({ success: true });
    } catch (e) {
        console.error('Error updating informe:', e);
        res.status(500).json({ error: e.message });
    }
});

// Eliminar informe (admin)
app.delete('/api/informes/:id', verifyToken, requireRole('admin'), async (req, res) => {
    try {
        const connection = await getDbConnection();
        // Obtener file_path para eliminar el archivo si existe
        const [[row]] = await connection.execute('SELECT file_path FROM informes WHERE id = ?', [req.params.id]);
        if (row && row.file_path) {
            const absPath = path.join(__dirname, row.file_path);
            if (fs.existsSync(absPath)) fs.unlinkSync(absPath);
        }
        await connection.execute('DELETE FROM informes WHERE id = ?', [req.params.id]);
        await connection.end();
        res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
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
        // Se recupera el id autoincremental y la marca temporal de la fila recien
        // insertada: son el "numero de registro" y la "fecha y hora de aceptacion"
        // que el acuse de recibo debe informar (Anexo I Art. 14). No hace falta
        // columna nueva, ya existian en la tabla.
        const [insercion] = await connection.execute(
            'INSERT INTO rce_consentimientos (user_uid, user_email, user_name, dni, ip_address, terms_version) VALUES (?, ?, ?, ?, ?, ?)',
            [user_uid, user_email, user_name, dni, ip_address, terms_version]
        );
        const registroId = insercion && insercion.insertId ? insercion.insertId : null;
        let registroTimestamp = null;
        if (registroId) {
            const [[fila]] = await connection.execute(
                'SELECT timestamp FROM rce_consentimientos WHERE id = ?',
                [registroId]
            );
            registroTimestamp = fila && fila.timestamp ? fila.timestamp : null;
        }
        await connection.end();
        res.json({
            message: 'Consentimiento registrado.',
            registro_id: registroId,
            fecha_aceptacion: registroTimestamp
        });
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
        res.json({ version: rows[0]?.config_value || '1' });
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
app.get('/api/productos-estadisticos', verifyToken, requireRole('admin', 'fiscal'), async (req, res) => {
    try {
        const connection = await getDbConnection();
        const [rows] = await connection.execute('SELECT * FROM productos_estadisticos ORDER BY created_at DESC');
        await connection.end();
        res.json(rows);
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/productos-estadisticos/:id/status', verifyToken, requireRole('admin', 'fiscal'), async (req, res) => {
    const { id } = req.params;
    const { status } = req.body;
    try {
        const connection = await getDbConnection();
        await connection.execute('UPDATE productos_estadisticos SET status = ? WHERE id = ?', [status, id]);
        await connection.end();
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.delete('/api/productos-estadisticos/:id', verifyToken, requireRole('admin'), async (req, res) => {
    const { id } = req.params;
    try {
        const connection = await getDbConnection();
        await connection.execute('DELETE FROM productos_estadisticos WHERE id = ?', [id]);
        await connection.end();
        res.json({ success: true, message: 'Pedido eliminado correctamente.' });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.patch('/api/productos-estadisticos/:id', verifyToken, requireRole('admin', 'fiscal'), async (req, res) => {
    const { id } = req.params;
    const { title, client_name, area, due_date, status, additional_info } = req.body;
    try {
        const connection = await getDbConnection();
        const updates = [];
        const values = [];

        if (title !== undefined) { updates.push('title = ?'); values.push(title); }
        if (client_name !== undefined) { updates.push('client_name = ?'); values.push(client_name); }
        if (area !== undefined) { updates.push('area = ?'); values.push(area); }
        if (due_date !== undefined) { updates.push('due_date = ?'); values.push(due_date); }
        if (status !== undefined) { updates.push('status = ?'); values.push(status); }
        if (additional_info !== undefined) { updates.push('additional_info = ?'); values.push(additional_info); }

        if (updates.length === 0) {
            await connection.end();
            return res.json({ success: true, message: 'Nada que actualizar.' });
        }

        values.push(id);
        const sql = `UPDATE productos_estadisticos SET ${updates.join(', ')} WHERE id = ?`;
        await connection.execute(sql, values);
        await connection.end();
        res.json({ success: true, message: 'Pedido actualizado correctamente.' });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// --- LOGS DE ACTIVIDAD ---
app.get('/api/logs', verifyToken, requireRole('admin'), async (req, res) => {
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
app.get('/api/rce-all', verifyToken, requireRole('admin'), async (req, res) => {
    try {
        const connection = await getDbConnection();
        const [rows] = await connection.execute('SELECT * FROM rce_consentimientos ORDER BY timestamp DESC');
        await connection.end();
        res.json(rows);
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// --- CONFIGURACIÓN GENÉRICA ---
app.post('/api/config/:key', verifyToken, requireRole('admin'), async (req, res) => {
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
app.get('/api/contactos', verifyToken, requireRole('admin'), async (req, res) => {
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
app.get('/api/usuarios', verifyToken, requireRole('admin'), async (_req, res) => {
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
app.patch('/api/usuarios/:email/role', verifyToken, requireRole('admin'), async (req, res) => {
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

app.delete('/api/usuarios/:email', verifyToken, requireRole('admin'), async (req, res) => {
    try {
        const email = decodeURIComponent(req.params.email).toLowerCase();
        const connection = await getDbConnection();
        
        // 1. Eliminar usuario de la tabla de perfiles
        await connection.execute('DELETE FROM usuarios_perfiles WHERE email = ?', [email]);
        
        // 2. Quitar accesos de los tableros
        const [tableros] = await connection.query('SELECT id, allowed_users, access_expirations FROM tableros');
        for (const t of tableros) {
            let allowed = [];
            let expirations = {};
            
            try {
                allowed = typeof t.allowed_users === 'string' ? JSON.parse(t.allowed_users || '[]') : (t.allowed_users || []);
            } catch (e) { allowed = []; }
            
            try {
                expirations = typeof t.access_expirations === 'string' ? JSON.parse(t.access_expirations || '{}') : (t.access_expirations || {});
            } catch (e) { expirations = {}; }
            
            if (!Array.isArray(allowed)) allowed = [];
            if (typeof expirations !== 'object' || expirations === null) expirations = {};
            
            const lowerAllowed = allowed.map(u => u.toLowerCase());
            if (lowerAllowed.includes(email)) {
                const newAllowed = allowed.filter(u => u.toLowerCase() !== email);
                const newExpirations = { ...expirations };
                delete newExpirations[email];
                for (const key of Object.keys(newExpirations)) {
                    if (key.toLowerCase() === email) {
                        delete newExpirations[key];
                    }
                }
                await connection.execute(
                    'UPDATE tableros SET allowed_users = ?, access_expirations = ? WHERE id = ?',
                    [JSON.stringify(newAllowed), JSON.stringify(newExpirations), t.id]
                );
            }
        }

        // 3. Quitar accesos de los informes
        const [informes] = await connection.query('SELECT id, allowed_users, access_expirations FROM informes');
        for (const inf of informes) {
            let allowed = [];
            let expirations = {};
            
            try {
                allowed = typeof inf.allowed_users === 'string' ? JSON.parse(inf.allowed_users || '[]') : (inf.allowed_users || []);
            } catch (e) { allowed = []; }
            
            try {
                expirations = typeof inf.access_expirations === 'string' ? JSON.parse(inf.access_expirations || '{}') : (inf.access_expirations || {});
            } catch (e) { expirations = {}; }
            
            if (!Array.isArray(allowed)) allowed = [];
            if (typeof expirations !== 'object' || expirations === null) expirations = {};
            
            const lowerAllowed = allowed.map(u => u.toLowerCase());
            if (lowerAllowed.includes(email)) {
                const newAllowed = allowed.filter(u => u.toLowerCase() !== email);
                const newExpirations = { ...expirations };
                delete newExpirations[email];
                for (const key of Object.keys(newExpirations)) {
                    if (key.toLowerCase() === email) {
                        delete newExpirations[key];
                    }
                }
                await connection.execute(
                    'UPDATE informes SET allowed_users = ?, access_expirations = ? WHERE id = ?',
                    [JSON.stringify(newAllowed), JSON.stringify(newExpirations), inf.id]
                );
            }
        }
        
        await connection.end();
        res.json({ success: true });
    } catch (error) {
        console.error('Error eliminando usuario de MySQL:', error);
        res.status(500).json({ error: error.message });
    }
});

// ==========================================================
// 🐙 ENDPOINTS INTEGRACIÓN GITHUB OAUTH & APIS
// ==========================================================

// 1. Redirigir a GitHub OAuth Login
app.get('/api/auth/github/login', (req, res) => {
    const clientId = process.env.GITHUB_CLIENT_ID;
    if (!clientId) {
        return res.status(500).send("GITHUB_CLIENT_ID no configurado en servidor.");
    }
    const redirectUri = encodeURIComponent(`${req.protocol}://${req.get('host')}/api/auth/github/callback`);
    const githubAuthUrl = `https://github.com/login/oauth/authorize?client_id=${clientId}&redirect_uri=${redirectUri}&scope=repo%20read:user`;
    res.redirect(githubAuthUrl);
});

// 2. Callback de GitHub OAuth (postMessage al popup de admin.js)
app.get('/api/auth/github/callback', async (req, res) => {
    const { code } = req.query;
    const clientId = process.env.GITHUB_CLIENT_ID;
    const clientSecret = process.env.GITHUB_CLIENT_SECRET;

    if (!code) {
        return res.status(400).send("Falta código de autorización de GitHub.");
    }

    try {
        const tokenResponse = await fetch('https://github.com/login/oauth/access_token', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify({
                client_id: clientId,
                client_secret: clientSecret,
                code: code
            })
        });

        const tokenData = await tokenResponse.json();
        if (tokenData.error) {
            return res.status(400).send(`Error de GitHub: ${tokenData.error_description || tokenData.error}`);
        }

        const accessToken = tokenData.access_token;

        // Obtener datos del usuario de GitHub
        const userResponse = await fetch('https://api.github.com/user', {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'User-Agent': 'Observatorio-RioCuarto-App'
            }
        });
        const userData = await userResponse.json();

        res.send(`
            <!DOCTYPE html>
            <html>
            <head><title>GitHub Auth Success</title></head>
            <body style="font-family: sans-serif; text-align: center; padding: 40px; background: #f9fafb;">
                <h2 style="color: #0284c7;">¡Conexión con GitHub Exitosa!</h2>
                <p>Bienvenido/a <strong>${userData.login || 'Usuario'}</strong>. Cerrando esta ventana...</p>
                <script>
                    const authPayload = {
                        token: ${JSON.stringify(accessToken)},
                        user: ${JSON.stringify(userData.login || 'GitHub User')},
                        avatar: ${JSON.stringify(userData.avatar_url || '')},
                        ts: Date.now()
                    };

                    try {
                        localStorage.setItem('github_auth_event', JSON.stringify(authPayload));
                    } catch(e) {
                        console.error("LocalStorage save error", e);
                    }

                    if (window.opener && !window.opener.closed) {
                        try {
                            window.opener.postMessage({
                                type: 'GITHUB_AUTH_SUCCESS',
                                ...authPayload
                            }, '*');
                        } catch(e) {}
                    }
                    setTimeout(() => window.close(), 1000);
                </script>
            </body>
            </html>
        `);
    } catch (err) {
        console.error("Error en callback de GitHub:", err);
        res.status(500).send("Error al autenticar con GitHub: " + err.message);
    }
});

// 3. Obtener repositorios del usuario autenticado en GitHub
app.get('/api/github/repos', requireRoleViaHeader('X-Observatorio-Token', 'admin'), async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Token de GitHub no provisto.' });
    }
    const token = authHeader.split(' ')[1];

    try {
        const response = await fetch('https://api.github.com/user/repos?per_page=100&sort=updated', {
            headers: {
                'Authorization': `Bearer ${token}`,
                'User-Agent': 'Observatorio-RioCuarto-App',
                'Accept': 'application/vnd.github.v3+json'
            }
        });

        if (!response.ok) {
            const errData = await response.json();
            return res.status(response.status).json({ error: errData.message || 'Error consultando GitHub API' });
        }

        const repos = await response.json();
        const formatted = repos.map(r => ({
            id: r.id,
            name: r.name,
            full_name: r.full_name,
            owner: r.owner?.login,
            private: r.private,
            default_branch: r.default_branch || 'main',
            html_url: r.html_url,
            has_pages: r.has_pages
        }));

        res.json(formatted);
    } catch (err) {
        console.error("Error fetching GitHub repos:", err);
        res.status(500).json({ error: err.message });
    }
});

// 4. Obtener ramas de un repositorio de GitHub
app.get('/api/github/branches', requireRoleViaHeader('X-Observatorio-Token', 'admin'), async (req, res) => {
    const authHeader = req.headers.authorization;
    const { owner, repo } = req.query;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Token de GitHub no provisto.' });
    }
    if (!owner || !repo) {
        return res.status(400).json({ error: 'Faltan parámetros de consulta: owner, repo.' });
    }
    const token = authHeader.split(' ')[1];

    try {
        const response = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches?per_page=100`, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'User-Agent': 'Observatorio-RioCuarto-App',
                'Accept': 'application/vnd.github.v3+json'
            }
        });

        if (!response.ok) {
            const errData = await response.json();
            return res.status(response.status).json({ error: errData.message || 'Error consultando ramas de GitHub' });
        }

        const branches = await response.json();
        const formatted = branches.map(b => ({
            name: b.name
        }));

        res.json(formatted);
    } catch (err) {
        console.error("Error fetching GitHub branches:", err);
        res.status(500).json({ error: err.message });
    }
});

// 5. Proxy para servir archivos de repositorios públicos o privados de GitHub dentro del iframe
// Guardia del proxy de GitHub: exige el mismo token de acceso firmado que
// protege /uploads para cualquier tablero con require_login = 1. Se aplica
// por prefijo (owner/repo/branch), no por archivo exacto, para no romper los
// recursos internos (css/js/imágenes) que la página cargue por rutas relativas.
// Nota importante: esto NO resuelve que el token de GitHub siga viajando en la
// URL — eso queda pendiente como rediseño aparte (ver docs/SECURITY_LOG.md).
// Si ningún tablero conocido coincide con owner/repo/branch, se bloquea por
// defecto: a diferencia de /uploads, acá "no reconocido" no es un archivo
// huérfano inofensivo, es una ruta capaz de relayar contenido arbitrario de
// GitHub — no conviene dejarla pasar sin más.
async function githubProxyGuard(req, res, next) {
    const { owner, repo, branch } = req.params;
    const prefix = `/api/github/proxy/${owner}/${repo}/${branch}/`;
    // Escapar comodines de LIKE (% _ \) para que un nombre de repo/rama con
    // guion bajo no matchee de más contra otro tablero.
    const escapedPrefix = prefix.replace(/[\\%_]/g, '\\$&');
    try {
        const row = await getCached(`ghtablero:${prefix}`, async () => {
            const connection = await getDbConnection();
            const [[r]] = await connection.execute(
                "SELECT id, require_login FROM tableros WHERE iframe_url LIKE CONCAT(?, '%') LIMIT 1",
                [escapedPrefix]
            );
            await connection.end();
            return r || null;
        });

        // Este 404 NO se registra en logs_actividad, y es deliberado. La traza que
        // exige el Anexo I Art. 16.3 cubre accesos permitidos y denegados a un
        // recurso: un prefijo que no matchea ningun tablero no es la denegacion de
        // un acceso a una persona, es una ruta inexistente, y se dispara tambien
        // con los recursos relativos (css, js, imagenes) que pide la pagina
        // embebida. Registrarlo llenaria la tabla de ruido, y hoy no hay politica
        // de purga que lo contenga. Si en algun momento hace falta, conviene
        // deduplicar por prefijo owner/repo/branch antes de escribir.
        if (!row) {
            return res.status(404).send('Recurso no vinculado a ningún tablero activo.');
        }

        if (!row.require_login) {
            return next(); // tablero público: mismo comportamiento que hoy
        }

        const { t, exp } = req.query;
        if (!verifyTableroAccess(row.id, exp, t)) {
            registrarAccesoDenegado('(token-github-proxy)', 'acceso_denegado_github', {
                resourceId: row.id,
                owner,
                repo,
                branch,
                motivo: !t ? 'sin_token' : 'token_invalido_o_vencido',
                exp: exp || null
            }, req);
            return res.status(403).send('Acceso no autorizado.');
        }

        getDbConnection().then(async (connection) => {
            try {
                await connection.execute(
                    'INSERT INTO logs_actividad (user_uid, action, details, ip_address) VALUES (?, ?, ?, ?)',
                    ['(token-github-proxy)', 'acceso_tablero_github', JSON.stringify({ resourceId: row.id, owner, repo, branch }), req.ip || req.headers['x-forwarded-for'] || null]
                );
            } catch (e) {
                console.error('Error registrando acceso autoritativo (github proxy):', e);
            } finally {
                await connection.end();
            }
        }).catch(() => {});

        next();
    } catch (e) {
        console.error('Error validando acceso a /api/github/proxy:', e);
        return res.status(500).send('Error interno.');
    }
}

app.get('/api/github/proxy/:owner/:repo/:branch/*', githubProxyGuard, async (req, res) => {
    const { owner, repo, branch } = req.params;
    let filePath = req.params[0] || 'index.html';

    if (filePath.startsWith('/')) filePath = filePath.substring(1);
    if (!filePath) filePath = 'index.html';

    let token = req.query.token || (req.headers.authorization ? req.headers.authorization.replace('Bearer ', '') : null);

    const headers = {
        'User-Agent': 'Observatorio-RioCuarto-App',
        'Accept': 'application/vnd.github.v3.raw'
    };
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    try {
        const ghUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${filePath}?ref=${encodeURIComponent(branch)}`;
        const ghRes = await fetch(ghUrl, { headers });

        if (!ghRes.ok) {
            return res.status(ghRes.status).send(`
                <div style="font-family: system-ui, sans-serif; padding: 40px; text-align: center; color: #e11d48; background: #fff1f2; border-radius: 12px; margin: 20px;">
                    <h3 style="margin-top:0;">Error al cargar archivo desde GitHub (${ghRes.status})</h3>
                    <p>No se pudo acceder a <code>${filePath}</code> en el repositorio <strong>${owner}/${repo}</strong> (rama: <em>${branch}</em>).</p>
                    <p style="font-size: 13px; color: #475569;">Verifica que la app esté conectada con GitHub y que el archivo exista en la rama seleccionada.</p>
                </div>
            `);
        }

        const ext = filePath.split('.').pop().toLowerCase();
        const mimeTypes = {
            'html': 'text/html; charset=utf-8',
            'htm': 'text/html; charset=utf-8',
            'css': 'text/css; charset=utf-8',
            'js': 'application/javascript; charset=utf-8',
            'mjs': 'application/javascript; charset=utf-8',
            'json': 'application/json; charset=utf-8',
            'png': 'image/png',
            'jpg': 'image/jpeg',
            'jpeg': 'image/jpeg',
            'gif': 'image/gif',
            'svg': 'image/svg+xml',
            'webp': 'image/webp',
            'ico': 'image/x-icon',
            'woff': 'font/woff',
            'woff2': 'font/woff2',
            'ttf': 'font/ttf'
        };

        const contentType = mimeTypes[ext] || ghRes.headers.get('content-type') || 'text/plain';
        res.setHeader('Content-Type', contentType);

        if (ext === 'html' || ext === 'htm') {
            let htmlText = await ghRes.text();
            const tokenQuery = token ? `?token=${encodeURIComponent(token)}` : '';
            const pathDir = filePath.includes('/') ? filePath.substring(0, filePath.lastIndexOf('/') + 1) : '';
            const baseTag = `<base href="/api/github/proxy/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(branch)}/${pathDir}${tokenQuery}">`;
            
            if (htmlText.includes('<head>')) {
                htmlText = htmlText.replace('<head>', `<head>\n  ${baseTag}`);
            } else if (htmlText.includes('<HEAD>')) {
                htmlText = htmlText.replace('<HEAD>', `<HEAD>\n  ${baseTag}`);
            } else {
                htmlText = baseTag + htmlText;
            }
            return res.send(htmlText);
        }

        const buffer = await ghRes.arrayBuffer();
        return res.send(Buffer.from(buffer));
    } catch (err) {
        console.error("Error en GitHub proxy:", err);
        res.status(500).send("Error interno en proxy de GitHub: " + err.message);
    }
});

// Informe de seguridad — solo para rol admin, vía panel (docs/*.md ya no se
// sirve público desde la raíz, ver Sección 5 de SECURITY_POLICY.md).
app.get('/api/seguridad/informe', verifyToken, requireRole('admin'), (req, res) => {
    try {
        const content = fs.readFileSync(path.join(__dirname, 'docs', 'INFORME_SEGURIDAD.md'), 'utf-8');
        res.json({ content });
    } catch (e) {
        console.error('Error leyendo informe de seguridad:', e);
        res.status(500).json({ error: 'No se pudo leer el informe de seguridad.' });
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

// ── Arranque: columnas GitHub, migración de tableros legados y auto-deploy ──
// Las columnas se aseguran apenas arranca. La migración de los tableros GitHub
// viejos (Pages/proxy) y el polling de auto-deploy arrancan con una demora para
// no competir con la inicialización de la base al levantar el contenedor.
ensureGithubColumns().catch(e => console.error('Error asegurando columnas de GitHub en tableros:', e.message));
setTimeout(() => {
    migrateLegacyGithubBoards().then(report => {
        if (report.length > 0) {
            const ok = report.filter(r => r.ok).length;
            console.log(`Migración de tableros GitHub legados: ${ok} ok, ${report.length - ok} con error (reintentable vía POST /api/tableros/migrate-github).`);
        }
    });
    setInterval(pollGithubBoards, GITHUB_POLL_MINUTES * 60 * 1000);
}, 15000);

app.listen(PORT, () => {
    console.log(`Servidor corriendo en puerto ${PORT}`);
});
