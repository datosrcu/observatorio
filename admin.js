import { auth, provider, signInWithPopup, signOut, onAuthStateChanged } from './firebase-config.js';

// --- DOM Elements ---
const loader = document.getElementById('auth-loader');
const userInfo = document.getElementById('user-info');
const adminAvatar = document.getElementById('admin-avatar');
const adminName = document.getElementById('admin-name');
const logoutBtn = document.getElementById('logout-btn');

const adminContent = document.getElementById('admin-content');
const adminDashboard = document.getElementById('admin-dashboard');
const sectionAdminOG = document.getElementById('section-admin-og');
const sectionAdminPedidos = document.getElementById('section-admin-pedidos');

const btnGotoOG = document.getElementById('btn-goto-og');
const btnGotoPedidos = document.getElementById('btn-goto-pedidos');
const btnsBackDashboard = document.querySelectorAll('.btn-back-dashboard');
const errorScreen = document.getElementById('error-screen');
const errorMsg = document.getElementById('error-message');
const errorLoginBtn = document.getElementById('error-login-btn');

// Tabs
const navTabs = document.querySelectorAll('.nav-tab');
const tabPanes = document.querySelectorAll('.tab-pane');

// Tableros
const boardsTbody = document.getElementById('boards-tbody');
const addBoardBtn = document.getElementById('add-board-btn');

// Categorías
const catTbody = document.getElementById('categories-tbody');
const addCatBtn = document.getElementById('add-cat-btn');

// Usuarios
const usersTbody = document.getElementById('users-tbody');
const filterUserSearch = document.getElementById('filter-user-search');

// Solicitudes
const requestsTbody = document.getElementById('requests-tbody');
const requestsBadge = document.getElementById('requests-badge');
const filterBoardSearch = document.getElementById('filter-board-search');
const filterBoardCategory = document.getElementById('filter-board-category');
const filterBoardStatus = document.getElementById('filter-board-status');
const trackingTbody = document.getElementById('tracking-tbody');
const feedbackTbody = document.getElementById('feedback-tbody');
const feedbackBadge = document.getElementById('feedback-badge');
const contactoTbody = document.getElementById('contacto-tbody');
const contactoBadge = document.getElementById('contacto-badge');

const countTotal = document.getElementById('count-total');
const countActive = document.getElementById('count-active');
const countInactive = document.getElementById('count-inactive');

const filterTrackingSearch = document.getElementById('filter-tracking-search');
const filterTrackingStatus = document.getElementById('filter-tracking-status');

// Solicitudes Estadísticas
let statisticalRequests = [];
let reqStatusFilter = 'todos';
let reqSearchFilter = '';

const pedidosTableBody = document.getElementById('pedidos-table-body');
const filterReqSearch = document.getElementById('filter-req-search');
const filterReqStatus = document.getElementById('filter-req-status');
const countReqTotal = document.getElementById('count-req-total');
const countReqPending = document.getElementById('count-req-pending');
const countReqCompleted = document.getElementById('count-req-completed');

// Modal Elements
const boardModal = document.getElementById('board-modal');
const catModal = document.getElementById('cat-modal');

// --- Forms & Inputs ---
// Board Form
const boardForm = document.getElementById('board-form');
const boardModalTitle = document.getElementById('board-modal-title');
const fieldBoardId = document.getElementById('board-id');
const fieldBoardEnabled = document.getElementById('field-board-enabled');
const fieldBoardTitle = document.getElementById('field-board-title');
const categoriesChecklist = document.getElementById('categories-checklist');
const categorySearchInput = document.getElementById('category-search');
let currentlySelectedCategories = [];

const fieldBoardReqLogin = document.getElementById('field-board-req-login');
const fieldBoardUrl = document.getElementById('field-board-url');
const fieldBoardIcon = document.getElementById('field-board-icon');
const fieldBoardNewTab = document.getElementById('field-board-new-tab');

// User Multi-select inside Board Form
const userSearchInput = document.getElementById('user-search');
const usersChecklist = document.getElementById('users-checklist');
let allUsersFetched = [];
let currentlySelectedUsers = [];

// Cat Form
const catForm = document.getElementById('cat-form');
const catModalTitle = document.getElementById('cat-modal-title');
const fieldCatId = document.getElementById('cat-id');
const fieldCatVisible = document.getElementById('field-cat-visible');
const fieldCatName = document.getElementById('field-cat-name');
const fieldCatDesc = document.getElementById('field-cat-desc');
const fieldCatIcon = document.getElementById('field-cat-icon');
const fieldCatType = document.getElementById('field-cat-type');
const fieldCatColorPicker = document.getElementById('field-cat-color-picker');
const fieldCatColorText = document.getElementById('field-cat-color');

// Duration Modal for Solicitudes
const durationModal = document.getElementById('duration-modal');
const optOneYear = document.getElementById('opt-1-year');
const optRoleExpiry = document.getElementById('opt-role-expiry');
const userRoleDateLabel = document.getElementById('user-role-date');
const roleExpiryWarning = document.getElementById('role-expiry-warning');

const cancelDurationBtn = document.getElementById('cancel-duration-btn');
const closeDurationOverlay = document.getElementById('close-duration-overlay');
let pendingApproval = null; // { requestId, email, buttonId, userExpiryDate }

// Search & Filter Listeners for Requests

// --- State ---
let isSubmitting = false;
let globalCategories = []; // to populate dropdowns
let allRequestsFetched = []; // Cache for filtering
let currentCatFilter = "Categorías";
let allBoardsFetched = [];
let boardSearchQuery = "";
let boardCategoryFilter = "all";
let boardStatusFilter = "all";
let allTrackingFetched = [];
let trackingSearchQuery = "";
let trackingStatusFilter = "all";
let allContactsFetched = [];
let allRCEFetched = [];
let globalTermsVersion = "1.2.0";

const ADMIN_EMAILS = [
    'datos@riocuarto.gov.ar'
];

// --- Helper para llamar a la API del Backend ---
async function callApi(endpoint, method = 'POST', body = null) {
    const user = auth.currentUser;
    if (!user) throw new Error("Usuario no autenticado");

    const token = await user.getIdToken();
    const response = await fetch(endpoint, {
        method: method,
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: body ? JSON.stringify(body) : null
    });

    if (!response.ok) {
        let errorMessage = `Error en la API: ${response.status}`;
        try {
            const errorData = await response.json();
            errorMessage = errorData.error || errorMessage;
        } catch (e) {}
        throw new Error(errorMessage);
    }

    const text = await response.text();
    return text ? JSON.parse(text) : {};
}

// --- Initialization & Auth ---
onAuthStateChanged(auth, async (user) => {
    if (loader) loader.classList.add('hidden');
    if (user) {
        const userEmail = user.email.toLowerCase();
        const isAdminExact = ADMIN_EMAILS.map(e => e.toLowerCase()).includes(userEmail);
        const isDomain = userEmail.endsWith('@riocuarto.gov.ar');

        if (isAdminExact) { 
            showAdminUI(user);

            // Auto-register/update admin user in MySQL
            try {
                const token = await user.getIdToken();
                await fetch('/api/usuarios/sync', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                    body: JSON.stringify({ email: userEmail, full_name: user.displayName || userEmail.split('@')[0], is_admin: true })
                });
            } catch (e) {
                console.warn("Could not auto-register admin user", e);
            }

            await loadData();
            await loadRequests();
            await loadUserTracking();
            await loadFeedback();
            await loadTCConfig();
            checkBackgroundNotifications();
            // Consultar nuevas notificaciones periódicamente en tiempo real (cada 45 segundos)
            setInterval(checkBackgroundNotifications, 45000);
        } else {
            showError("No tienes privilegios de administrador para ver o editar.");
            await signOut(auth);
        }
    } else {
        showError("Inicia sesión para acceder al panel de administración.");
    }
});

errorLoginBtn?.addEventListener('click', () => signInWithPopup(auth, provider));
logoutBtn?.addEventListener('click', () => signOut(auth));

function showAdminUI(user) {
    adminContent.classList.remove('hidden');
    errorScreen.classList.add('hidden');
    userInfo.classList.remove('hidden');
    userInfo.classList.add('flex');
    adminAvatar.src = user.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.displayName || user.email)}&background=212529&color=fff`;
    adminName.textContent = user.displayName || user.email;

    // Al entrar, siempre mostrar el Dashboard
    showDashboard();
}

function showDashboard() {
    adminDashboard.classList.remove('hidden');
    sectionAdminOG.classList.add('hidden');
    sectionAdminPedidos.classList.add('hidden');
}

function showOGSection() {
    adminDashboard.classList.add('hidden');
    sectionAdminOG.classList.remove('hidden');
    sectionAdminPedidos.classList.add('hidden');
    // Forzar carga de la primera pestaña si es necesario
    loadBoards();
}

function showPedidosSection() {
    adminDashboard.classList.add('hidden');
    sectionAdminOG.classList.add('hidden');
    sectionAdminPedidos.classList.remove('hidden');
    loadStatisticalRequests();
}

// Navigation dashboard listeners
btnGotoOG?.addEventListener('click', showOGSection);
btnGotoPedidos?.addEventListener('click', showPedidosSection);
btnsBackDashboard?.forEach(btn => btn?.addEventListener('click', showDashboard));

function showError(msg) {
    adminContent.classList.add('hidden');
    userInfo.classList.add('hidden');
    userInfo.classList.remove('flex');
    errorScreen.classList.remove('hidden');
    errorMsg.textContent = msg;
}

// --- Tabs Logic ---
navTabs?.forEach(tab => {
    tab?.addEventListener('click', (e) => {
        const target = tab.getAttribute('data-target');
        navTabs.forEach(t => {
            t.classList.remove('border-obelisco-blue', 'text-obelisco-blue');
            t.classList.add('border-transparent', 'text-gray-500');
        });
        tabPanes.forEach(pane => {
            pane.classList.add('hidden');
            pane.classList.remove('block');
        });

        tab.classList.remove('border-transparent', 'text-gray-500');
        tab.classList.add('border-obelisco-blue', 'text-obelisco-blue');

        const targetPane = document.getElementById(target);
        if (targetPane) {
            targetPane.classList.remove('hidden');
            targetPane.classList.add('block');
        }

        // Reload data for specific tabs and clear badges
        if (target === 'tab-tableros') loadBoards();
        if (target === 'tab-categorias') loadCategories();
        if (target === 'tab-usuarios') {
            loadUsers();
            localStorage.setItem('ogb_last_seen_users', new Date().toISOString());
            const usersBadge = document.getElementById('users-badge');
            if (usersBadge) usersBadge.classList.add('hidden');
        }
        if (target === 'tab-solicitudes') loadRequests();
        if (target === 'tab-tracking') loadUserTracking();
        if (target === 'tab-feedback') {
            loadFeedback();
            localStorage.setItem('ogb_last_seen_feedback', new Date().toISOString());
            if (feedbackBadge) feedbackBadge.classList.add('hidden');
        }
        if (target === 'tab-contacto') {
            loadContacts();
            localStorage.setItem('ogb_last_seen_contacto', new Date().toISOString());
            if (contactoBadge) contactoBadge.classList.add('hidden');
        }
    });
});

// --- Sub-Tabs Logic (Usuarios) ---
const subNavTabs = document.querySelectorAll('.sub-nav-tab');
const subPanes = document.querySelectorAll('.sub-pane');

subNavTabs?.forEach(tab => {
    subNavTabs.forEach(t => {
        t.addEventListener('click', () => {
            const target = t.getAttribute('data-sub');
            
            subNavTabs.forEach(btn => {
                btn.classList.remove('active-sub-tab', 'border-obelisco-blue', 'bg-blue-50', 'text-obelisco-blue');
                btn.classList.add('border-transparent', 'text-gray-600');
            });
            
            subPanes.forEach(p => p.classList.add('hidden'));
            
            t.classList.add('active-sub-tab', 'border-obelisco-blue', 'bg-blue-50', 'text-obelisco-blue');
            t.classList.remove('border-transparent', 'text-gray-600');
            
            const targetPane = document.getElementById(target);
            if (targetPane) targetPane.classList.remove('hidden');

            // Trigger specific loads
            if (target === 'sub-rce') loadRCE();
            if (target === 'sub-solicitudes') loadRequests();
            if (target === 'sub-tracking') loadUserTracking();
            if (target === 'sub-directorio') loadUsers();
        });
    });
});

const filterTrackingSearchInner = document.getElementById('filter-tracking-search-inner');
const filterTrackingStatusInner = document.getElementById('filter-tracking-status-inner');

if (filterTrackingSearchInner) {
    filterTrackingSearchInner.addEventListener('input', (e) => {
        trackingSearchQuery = e.target.value.toLowerCase();
        renderUserTracking();
    });
}
if (filterTrackingStatusInner) {
    filterTrackingStatusInner.addEventListener('change', (e) => {
        trackingStatusFilter = e.target.value;
        renderUserTracking();
    });
}

const filterContactType = document.getElementById('filter-contact-type');
if (filterContactType) {
    filterContactType.addEventListener('change', () => {
        renderContactsTable();
    });
}

// Listeners for restored Requests sub-tab filters
document.getElementById('filter-request-user')?.addEventListener('input', filterAndRenderRequests);
document.getElementById('filter-request-status')?.addEventListener('change', filterAndRenderRequests);
document.getElementById('sort-request-expiry')?.addEventListener('change', filterAndRenderRequests);

// --- LOAD MASTER DATA ---
async function loadData() {
    await Promise.all([
        loadUsers(),
        loadCategories(),
        loadBoards(),
        loadRequests(),
        loadStatisticalRequests(),
        loadUserTracking(),
        loadFeedback(),
        loadContacts()
    ]);
}
// --- USERS LISTING & SELECTOR ---
filterUserSearch?.addEventListener('input', () => {
    filterAndRenderUsers();
});

function filterAndRenderUsers() {
    const filterText = filterUserSearch.value.toLowerCase().trim();
    const filtered = allUsersFetched.filter(u => {
        const name = (u.name || '').toLowerCase();
        const email = (u.email || '').toLowerCase();
        const orgName = (u.orgName || '').toLowerCase();
        const orgType = (u.orgType || '').toLowerCase();
        return name.includes(filterText) ||
            email.includes(filterText) ||
            orgName.includes(filterText) ||
            orgType.includes(filterText);
    });
    renderUsersTable(filtered);
}

async function loadUsers() {
    try {
        const data = await callApi('/api/usuarios', 'GET');
        allUsersFetched = data.map(u => ({
            id: u.email,
            email: u.email,
            name: u.full_name,
            dni: u.dni,
            orgGroup: u.sector_group,
            orgType: u.organization_type,
            orgName: u.organization_name,
            orgRole: u.role_position,
            orgRoleDetail: u.role_detail,
            cuit: u.cuit,
            expiryDate: u.expiry_date,
            legalDocURL: u.legal_file_url,
            acceptedTCVersion: u.terms_accepted_version,
            role: u.role || 'usuario',
            lastLogin: u.last_login,
            createdAt: u.created_at,
            photoURL: null
        }));
        filterAndRenderUsers();
        renderUserChecklist();
    } catch (error) {
        console.error(error);
        usersTbody.innerHTML = `<tr><td colspan="5" class="text-center py-6 text-red-500">Error cargando usuarios.</td></tr>`;
    }
}

function renderUsersTable(users) {
    if (!usersTbody) return;
    usersTbody.innerHTML = '';

    if (users.length === 0) {
        usersTbody.innerHTML = `<tr><td colspan="5" class="py-12 text-center text-obelisco-gray">No se encontraron usuarios.</td></tr>`;
        return;
    }

    users.forEach(u => {
        const tr = document.createElement('tr');
        tr.className = "hover:bg-gray-50 transition";
        const lastLogin = u.lastLogin ? new Date(u.lastLogin).toLocaleString() : 'N/A';
        const registered = u.createdAt ? new Date(u.createdAt).toLocaleDateString() : 'N/A';
        const role = u.role || 'usuario';

        tr.innerHTML = `
            <td class="px-4 py-3">
                <div class="flex items-center space-x-3">
                    <img src="${u.photoURL || 'https://ui-avatars.com/api/?name='+u.name}" class="w-8 h-8 rounded-full border">
                    <div>
                        <div class="font-bold text-obelisco-dark">${u.name}</div>
                        <div class="text-[10px] text-gray-500">${u.email}</div>
                        <div class="text-[9px] font-mono bg-gray-100 w-fit px-1 rounded mt-1">DNI: ${u.dni || 'No reg.'}</div>
                    </div>
                </div>
            </td>
            <td class="py-3 px-4">
                <div class="flex flex-col">
                    <span class="text-xs font-bold text-obelisco-blue uppercase">${u.orgType || 'N/A'}</span>
                    <span class="text-sm font-medium">${u.orgName || '-'}</span>
                    <span class="text-[10px] text-obelisco-gray uppercase flex flex-col gap-1 items-start">
                        ${u.orgRole || '-'}
                         ${u.legalDocURL ? `<a href="${u.legalDocURL}" target="_blank" class="text-blue-500 hover:text-blue-700 underline normal-case flex items-center mt-1"><svg class="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"></path></svg> Ver Respaldo</a>` : ''}
                    </span>
                </div>
            </td>
            <td class="py-3 px-4">
                <div class="flex flex-col text-[10px] text-obelisco-gray uppercase">
                    <span>Reg: ${registered}</span>
                    <span>Acc: ${lastLogin}</span>
                </div>
            </td>
            <td class="py-3 px-4">
                <div class="flex items-center space-x-2">
                    <select class="role-select text-xs border border-gray-300 rounded px-2 py-1 bg-white outline-none focus:border-obelisco-blue" data-id="${u.id}" data-original="${role}">
                        <option value="usuario" ${role === 'usuario' ? 'selected' : ''}>Usuario del Observatorio</option>
                        <option value="lector" ${role === 'lector' ? 'selected' : ''}>Lector</option>
                    </select>
                    <button class="btn-save-role hidden bg-green-500 hover:bg-green-600 text-white p-1 rounded transition-opacity" title="Guardar Cambio de Rol">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>
                    </button>
                </div>
            </td>
            <td class="py-3 px-4 text-right">
                <button class="text-red-500 hover:text-red-700 font-medium btn-del-user" data-id="${u.id}">Eliminar</button>
            </td>
        `;
        usersTbody.appendChild(tr);

        // Role change logic with save button
        const roleSelect = tr.querySelector('.role-select');
        const saveBtn = tr.querySelector('.btn-save-role');

        roleSelect.addEventListener('change', (e) => {
            const currentRole = e.target.value;
            const originalRole = e.target.getAttribute('data-original');
            if (currentRole !== originalRole) {
                saveBtn.classList.remove('hidden');
            } else {
                saveBtn.classList.add('hidden');
            }
        });

        saveBtn.addEventListener('click', async () => {
            const newRole = roleSelect.value;
            try {
                saveBtn.disabled = true;
                saveBtn.innerHTML = `<svg class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>`;
                await callApi(`/api/usuarios/${encodeURIComponent(u.id)}/role`, 'PATCH', { role: newRole });
                alert("Rol actualizado correctamente.");
                await loadUsers(); // Refresh the table
            } catch (err) {
                console.error("Error updating role:", err);
                alert("No se pudo actualizar el rol.");
                saveBtn.disabled = false;
                saveBtn.innerHTML = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>`;
            }
        });

        // Delete user listener
        tr.querySelector('.btn-del-user').addEventListener('click', () => deleteUser(u.id));
    });
}

async function deleteUser(id) {
    if (confirm("¿Estás seguro que querés eliminar este usuario?")) {
        try {
            await callApi(`/api/usuarios/${encodeURIComponent(id)}`, 'DELETE');
            loadUsers();
        } catch (error) {
            console.error("Error deleting user:", error);
            alert("No se pudo eliminar el usuario.");
        }
    }
}

// --- REQUESTS LOGIC ---
async function loadRequests() {
    try {
        const rows = await callApi('/api/solicitudes', 'GET');
        const now = new Date();

        allRequestsFetched = rows.map(r => ({
            id: String(r.id),
            userEmail: r.user_email || r.user_uid, // Priorizar email del join
            userName: r.user_name || '',
            buttonId: r.dashboard_name,
            buttonName: r.dashboard_name,
            reason: r.reason,
            status: (r.status || 'pendiente').toLowerCase(), // Normalizar a minúsculas
            expiryDate: r.admin_comment?.startsWith('Vence:') ? r.admin_comment.replace('Vence: ', '') : null,
            createdAt: r.created_at
        }));

        // Passive auto-expire: mark expired in MySQL if past expiry
        const expirePromises = allRequestsFetched
            .filter(r => r.status === 'aprobado' && r.expiryDate && now > new Date(r.expiryDate))
            .map(async r => {
                r.status = 'expirado';
                await callApi(`/api/solicitudes/${r.id}/status`, 'PATCH', { status: 'expirado' }).catch(() => {});
            });
        if (expirePromises.length > 0) await Promise.all(expirePromises);

        const pendingCount = allRequestsFetched.filter(r => r.status === 'pendiente').length;
        const badge = document.getElementById('requests-badge');
        const innerBadge = document.getElementById('requests-badge-inner');

        if (badge) {
            badge.textContent = pendingCount;
            badge.classList.toggle('hidden', pendingCount === 0);
        }
        if (innerBadge) {
            innerBadge.textContent = pendingCount;
            innerBadge.classList.toggle('bg-red-100', pendingCount > 0);
            innerBadge.classList.toggle('text-red-600', pendingCount > 0);
            innerBadge.classList.toggle('bg-gray-100', pendingCount === 0);
            innerBadge.classList.toggle('text-gray-400', pendingCount === 0);
        }

        filterAndRenderRequests();
    } catch (error) {
        console.error("Error loading requests:", error);
    }
}

function filterAndRenderRequests() {
    const userSearch = document.getElementById('filter-request-user')?.value.toLowerCase() || "";
    const statusFilter = document.getElementById('filter-request-status')?.value || "all";
    const sortFilter = document.getElementById('sort-request-expiry')?.value || 'created-desc';

    let filtered = allRequestsFetched.filter(req => {
        const matchesUser = req.userEmail.toLowerCase().includes(userSearch) || req.userName.toLowerCase().includes(userSearch);
        
        // Map HTML values to DB values
        let mappedStatus = statusFilter;
        if (statusFilter === 'pending') mappedStatus = 'pendiente';
        if (statusFilter === 'approved') mappedStatus = 'aprobado';
        if (statusFilter === 'rejected') mappedStatus = 'rechazado';
        if (statusFilter === 'expired') mappedStatus = 'expirado';

        const matchesStatus = statusFilter === 'all' || req.status === mappedStatus;
        return matchesUser && matchesStatus;
    });

    // Handle Sorting
    if (sortFilter === 'expiry-soon') {
        filtered.sort((a, b) => {
            if (!a.expiryDate) return 1;
            if (!b.expiryDate) return -1;
            return new Date(a.expiryDate) - new Date(b.expiryDate);
        });
    } else if (sortFilter === 'expiry-far') {
        filtered.sort((a, b) => {
            if (!a.expiryDate) return 1;
            if (!b.expiryDate) return -1;
            return new Date(b.expiryDate) - new Date(a.expiryDate);
        });
    } else {
        // Default: created-desc
        filtered.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    }

    renderRequests(filtered);
}

// Filter listeners
document.getElementById('filter-request-user')?.addEventListener('input', filterAndRenderRequests);
document.getElementById('filter-request-status')?.addEventListener('change', filterAndRenderRequests);
document.getElementById('sort-request-expiry')?.addEventListener('change', filterAndRenderRequests);


function renderRequests(requests) {
    const container = document.getElementById('requests-container');
    if (!container) return;

    if (requests.length === 0) {
        container.innerHTML = `
            <div class="bg-white border rounded-xl p-12 text-center text-gray-400 border-dashed">
                <svg class="w-12 h-12 mx-auto mb-3 opacity-20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
                No se encontraron solicitudes con esos filtros.
            </div>
        `;
        return;
    }

    container.innerHTML = '';
    requests.forEach(req => {
        const date = req.createdAt ? new Date(req.createdAt).toLocaleDateString() : '-';
        const expiryDate = req.expiryDate ? new Date(req.expiryDate).toLocaleDateString() : 'N/A';
        const status = req.status || 'pending';

        let statusBadge = '';
        switch (status) {
            case 'aprobado':
            case 'approved': statusBadge = '<span class="px-2 py-0.5 bg-green-100 text-green-700 rounded-full font-bold text-[9px] uppercase">Aprobada</span>'; break;
            case 'rechazado':
            case 'rejected': statusBadge = '<span class="px-2 py-0.5 bg-red-100 text-red-700 rounded-full font-bold text-[9px] uppercase">Rechazada</span>'; break;
            case 'restricted': statusBadge = '<span class="px-2 py-0.5 bg-gray-100 text-gray-700 rounded-full font-bold text-[9px] uppercase">Restringida</span>'; break;
            case 'expirado':
            case 'expired': statusBadge = '<span class="px-2 py-0.5 bg-orange-100 text-orange-700 rounded-full font-bold text-[9px] uppercase">Vencido</span>'; break;
            default: statusBadge = '<span class="px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full font-bold text-[9px] uppercase">Pendiente</span>';
        }

        const card = document.createElement('div');
        card.className = "bg-white border border-gray-200 rounded-xl p-4 shadow-sm hover:shadow-md transition flex flex-col md:flex-row items-center gap-4";
        card.innerHTML = `
            <div class="flex-shrink-0 w-12 h-12 bg-gray-50 rounded-full flex items-center justify-center text-gray-400">
                <svg class="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path></svg>
            </div>
            
            <div class="flex-grow text-center md:text-left">
                <div class="flex items-center justify-center md:justify-start gap-2 mb-1">
                    <span class="font-bold text-obelisco-dark">${req.userEmail}</span>
                    ${statusBadge}
                </div>
                <div class="text-xs text-gray-500">
                    Solicita: <span class="font-bold text-obelisco-blue">${req.buttonName || 'Tablero restringido'}</span>
                </div>
                <div class="text-[10px] text-gray-400 mt-1">
                    Fecha: ${date} • Vencimiento: <span class="font-mono">${expiryDate}</span>
                </div>
                <div class="mt-3 text-[11px] text-gray-600 italic bg-gray-50 p-2 rounded-lg border-l-2 border-gray-200 line-clamp-1 truncate hover:line-clamp-none cursor-help" title="${req.reason}">
                    "${req.reason || 'Sin motivo declarado'}"
                </div>
            </div>

            <div class="flex flex-row md:flex-col gap-2 shrink-0">
                ${(status !== 'aprobado' && status !== 'approved') ? `
                <button class="btn-approve bg-green-500 hover:bg-green-600 text-white p-2 rounded-lg transition shadow-sm" data-id="${req.id}" data-email="${req.userEmail}" data-button="${req.buttonId}" title="Aprobar Acceso">
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>
                </button>
                ` : ''}
                
                ${(status === 'pendiente' || status === 'pending') ? `
                <button class="btn-reject bg-white border border-orange-200 text-orange-500 hover:bg-orange-50 p-2 rounded-lg transition" data-id="${req.id}" title="Rechazar">
                    <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
                </button>
                ` : ''}
            </div>
        `;

        const approveBtn = card.querySelector('.btn-approve');
        if (approveBtn) {
            approveBtn.addEventListener('click', () => approveRequest(req.id, req.userEmail, req.buttonId));
        }

        const rejectBtn = card.querySelector('.btn-reject');
        if (rejectBtn) {
            rejectBtn.addEventListener('click', async () => {
                if(!confirm("¿Estás seguro que querés rechazar esta solicitud?")) return;
                await updateRequestStatus(req.id, 'rechazado');
            });
        }

        container.appendChild(card);
    });
}

async function updateRequestStatus(requestId, newStatus) {
    try {
        await callApi(`/api/solicitudes/${requestId}/status`, 'PATCH', { status: newStatus });
        await loadRequests();
    } catch (e) { console.error(e); }
}

async function approveRequest(requestId, email, buttonId) {
    pendingApproval = { requestId, email, buttonId };

    // Reset UI
    userRoleDateLabel.classList.add('hidden');
    roleExpiryWarning.classList.add('hidden');
    optRoleExpiry.classList.remove('hidden');

    // Look up user from already-loaded allUsersFetched
    const userData = allUsersFetched.find(u => u.email.toLowerCase() === email.toLowerCase());
    if (userData) {
        const expiry = userData.expiryDate;
        if (expiry && expiry !== 'No aplica' && expiry !== '') {
            const expiryDate = new Date(expiry);
            const now = new Date();
            if (now > expiryDate) {
                optRoleExpiry.classList.add('hidden');
            } else {
                const daysRemaining = Math.max(0, Math.ceil((expiryDate - now) / (1000 * 60 * 60 * 24)));
                userRoleDateLabel.textContent = `${expiryDate.toLocaleDateString()} (vence en ${daysRemaining} días)`;
                userRoleDateLabel.classList.remove('hidden');
                pendingApproval.userExpiryDate = expiry;
            }
        } else {
            optRoleExpiry.classList.add('hidden');
        }
    } else {
        optRoleExpiry.classList.add('hidden');
    }
    const targetSpan = document.getElementById('approve-user-target');
    if (targetSpan) targetSpan.textContent = email;

    durationModal?.classList.remove('hidden');
    durationModal?.classList.add('flex');
}

// Handle Expiration Selections
async function processApproval(type) {
    if (!pendingApproval) return;
    const { requestId, email, buttonId, userExpiryDate } = pendingApproval;
    const now = new Date();
    let expiryISO = "";

    optOneYear.disabled = true;
    optRoleExpiry.disabled = true;

    if (type === '1year') {
        expiryISO = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString();
    } else if (type === 'role') {
        if (!userExpiryDate) return;
        expiryISO = userExpiryDate;
    }

    try {
        await callApi(`/api/solicitudes/${requestId}/aprobar`, 'POST', {
            email,
            tablero_id: buttonId,
            expiry_iso: expiryISO
        });

        closeDurationModal();
        await loadRequests();
    } catch (error) {
        console.error("Error approving request:", error);
        alert("Error al procesar la aprobación: " + (error.message || "Error desconocido"));
    } finally {
        optOneYear.disabled = false;
        optRoleExpiry.disabled = false;
    }
}

optOneYear?.addEventListener('click', () => processApproval('1year'));
optRoleExpiry?.addEventListener('click', () => processApproval('role'));

function closeDurationModal() {
    durationModal?.classList.add('hidden');
    durationModal?.classList.remove('flex');
    pendingApproval = null;
}

cancelDurationBtn?.addEventListener('click', () => {
    closeDurationModal();
    loadRequests(); 
});
closeDurationOverlay?.addEventListener('click', closeDurationModal);

function renderUserChecklist(filterText = '') {
    usersChecklist.innerHTML = '';
    const filtered = allUsersFetched.filter(u => u.email.toLowerCase().includes(filterText.toLowerCase()) || u.name.toLowerCase().includes(filterText.toLowerCase()));
    if (filtered.length === 0) {
        usersChecklist.innerHTML = `<p class="text-xs text-center text-gray-500 py-4">No se encontraron usuarios.</p>`;
        return;
    }
    filtered.forEach(u => {
        const userEmail = u.email.toLowerCase();
        const isAdmin = ADMIN_EMAILS.map(e => e.toLowerCase()).includes(userEmail);
        const isLector = u.role === 'lector';

        const isChecked = isAdmin || isLector || currentlySelectedUsers.includes(userEmail) ? 'checked' : '';
        const disabledAttr = (isAdmin || isLector) ? 'disabled' : '';

        let badgeHtml = '';
        if (isAdmin) badgeHtml = '<span class="ml-auto text-[9px] bg-amber-100 text-amber-700 px-1 rounded font-bold uppercase">Admin (Acceso Total)</span>';
        else if (isLector) badgeHtml = '<span class="ml-auto text-[9px] bg-green-100 text-green-700 px-1 rounded font-bold uppercase">Lector (Acceso Total)</span>';

        const div = document.createElement('div');
        div.className = `flex items-center space-x-2 p-2 hover:bg-gray-50 rounded border border-transparent hover:border-gray-200 cursor-pointer transition ${(isAdmin || isLector) ? 'opacity-70' : ''}`;
        div.innerHTML = `
            <input type="checkbox" id="user-${u.email}" value="${u.email}" class="user-checkbox w-4 h-4 text-obelisco-blue rounded border-gray-300 pointer-events-none" ${isChecked} ${disabledAttr}>
            <label for="user-${u.email}" class="text-sm font-medium cursor-pointer flex-grow pointer-events-none flex items-center">
                <span class="block truncate max-w-[150px]">${u.name}</span> 
                <span class="text-[10px] text-gray-400 font-normal block truncate ml-2">(${u.email})</span>
                ${badgeHtml}
            </label>
        `;
        div.addEventListener('click', () => {
            if (isAdmin || isLector) return;
            const cb = div.querySelector('input');
            cb.checked = !cb.checked;
            const email = u.email.toLowerCase();
            if (cb.checked) {
                if (!currentlySelectedUsers.includes(email)) currentlySelectedUsers.push(email);
            } else {
                currentlySelectedUsers = currentlySelectedUsers.filter(e => e.toLowerCase() !== email);
            }
        });
        usersChecklist.appendChild(div);
    });

    // Option to add manually if filterText looks like an email and not in the list
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const lowerFilter = filterText.toLowerCase().trim();
    const alreadyInList = allUsersFetched.some(u => u.email.toLowerCase() === lowerFilter) ||
        currentlySelectedUsers.some(e => e.toLowerCase() === lowerFilter);

    if (emailRegex.test(lowerFilter) && !alreadyInList) {
        const divManual = document.createElement('div');
        divManual.className = "mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg flex items-center justify-between cursor-pointer hover:bg-blue-100 transition";
        divManual.innerHTML = `
            <div class="flex flex-col">
                <span class="text-xs font-bold text-obelisco-blue uppercase">Email no registrado</span>
                <span class="text-sm font-medium truncate max-w-[200px]">${lowerFilter}</span>
            </div>
            <button type="button" class="bg-obelisco-blue text-white text-xs px-3 py-1.5 rounded font-bold hover:bg-blue-700">
                Autorizar
            </button>
        `;
        divManual.addEventListener('click', (e) => {
            e.stopPropagation();
            if (!currentlySelectedUsers.map(u => u.toLowerCase()).includes(lowerFilter)) {
                currentlySelectedUsers.push(lowerFilter);
                userSearchInput.value = '';
                renderUserChecklist();
            }
        });
        usersChecklist.appendChild(divManual);
    }
}
userSearchInput?.addEventListener('input', (e) => renderUserChecklist(e.target.value));

// --- CATEGORIES LISTING & SELECTOR ---
categorySearchInput?.addEventListener('input', (e) => renderCategoryChecklist(e.target.value));

function renderCategoryChecklist(filterText = '') {
    categoriesChecklist.innerHTML = '';
    const lowerFilter = filterText.toLowerCase().trim();

    // Virtual option: assign board directly to Gestores Externos (no real category needed)
    const vIsChecked = currentlySelectedCategories.includes('_ge_direct');
    const vLabel = "Gestores Externos".toLowerCase();

    if (!lowerFilter || vLabel.includes(lowerFilter)) {
        const vDiv = document.createElement('div');
        vDiv.className = `flex items-center space-x-2 p-2 rounded border cursor-pointer transition mb-1 ${vIsChecked ? 'border-blue-300 bg-blue-50' : 'border-dashed border-blue-200 hover:bg-blue-50'}`;
        vDiv.innerHTML = `
            <input type="checkbox" class="w-4 h-4 text-obelisco-blue rounded border-gray-300 pointer-events-none" ${vIsChecked ? 'checked' : ''}>
            <span class="pointer-events-none">🌐</span>
            <span class="text-sm font-semibold pointer-events-none text-obelisco-blue">Gestores Externos <span class="text-xs text-gray-400 font-normal">· sin categoría específica</span></span>
        `;
        vDiv.addEventListener('click', () => {
            const cb = vDiv.querySelector('input');
            cb.checked = !cb.checked;
            vDiv.className = `flex items-center space-x-2 p-2 rounded border cursor-pointer transition mb-1 ${cb.checked ? 'border-blue-300 bg-blue-50' : 'border-dashed border-blue-200 hover:bg-blue-50'}`;
            if (cb.checked) { if (!currentlySelectedCategories.includes('_ge_direct')) currentlySelectedCategories.push('_ge_direct'); }
            else { currentlySelectedCategories = currentlySelectedCategories.filter(id => id !== '_ge_direct'); }
        });
        categoriesChecklist.appendChild(vDiv);
    }

    const filteredCategories = globalCategories.filter(c => {
        const name = (c.name || '').toLowerCase();
        const type = (c.type || '').toLowerCase();
        return name.includes(lowerFilter) || type.includes(lowerFilter);
    });

    if (filteredCategories.length === 0 && (!vLabel.includes(lowerFilter) || !lowerFilter)) {
        const p = document.createElement('p');
        p.className = 'text-xs text-center text-gray-500 py-4';
        p.textContent = lowerFilter ? 'No se encontraron categorías.' : 'No hay categorías creadas aún.';
        categoriesChecklist.appendChild(p);
        return;
    }

    filteredCategories.forEach(c => {
        const isChecked = currentlySelectedCategories.includes(c.id) ? 'checked' : '';
        const div = document.createElement('div');
        div.className = "flex items-center space-x-2 p-2 hover:bg-gray-50 rounded border border-transparent hover:border-gray-200 cursor-pointer transition";
        div.innerHTML = `
            <input type="checkbox" id="cat-${c.id}" value="${c.id}" class="cat-checkbox w-4 h-4 text-obelisco-blue rounded border-gray-300 pointer-events-none" ${isChecked}>
            <span class="w-3 h-3 rounded-full border border-gray-300 inline-block pointer-events-none" style="background-color: ${c.color}"></span>
            <span class="text-sm font-medium pointer-events-none" style="margin-left: 0.25rem;">${c.icon ? c.icon + ' ' : ''}${c.name}</span>
            <span class="text-xs text-obelisco-gray ml-auto pointer-events-none">(${c.type || 'Categorías'})</span>
        `;
        div.addEventListener('click', () => {
            const cb = div.querySelector('input');
            cb.checked = !cb.checked;
            if (cb.checked) {
                if (!currentlySelectedCategories.includes(c.id)) currentlySelectedCategories.push(c.id);
            } else currentlySelectedCategories = currentlySelectedCategories.filter(id => id !== c.id);
        });
        categoriesChecklist.appendChild(div);
    });
}

// --- CATEGORIES CRUD ---
fieldCatColorPicker.addEventListener('input', e => fieldCatColorText.value = e.target.value.toUpperCase());
fieldCatColorText.addEventListener('input', e => { if (/^#[0-9A-F]{6}$/i.test(e.target.value)) fieldCatColorPicker.value = e.target.value; });

async function loadCategories() {
    try {
        const data = await callApi('/api/categorias', 'GET');
        globalCategories = data.map(c => ({
            id: c.id,
            name: c.name,
            description: c.description,
            icon: c.icon,
            type: c.type,
            color: c.color,
            visible: c.visible !== 0,
            order: c.sort_order
        }));

        renderCategories();
        renderCategoryChecklist();
        updateBoardCategoryFilterOptions();
    } catch (error) { console.error("Error loading categories from MySQL:", error); }
}

function updateBoardCategoryFilterOptions() {
    if (!filterBoardCategory) return;
    const currentVal = filterBoardCategory.value;
    filterBoardCategory.innerHTML = '<option value="all">Todas las categorías</option>';
    filterBoardCategory.innerHTML += '<option value="_ge_direct">🌐 Gestores Externos (Directos)</option>';

    globalCategories.forEach(cat => {
        const option = document.createElement('option');
        option.value = cat.id;
        option.textContent = `${cat.icon || '📁'} ${cat.name}`;
        filterBoardCategory.appendChild(option);
    });

    if ([...filterBoardCategory.options].some(o => o.value === currentVal)) {
        filterBoardCategory.value = currentVal;
    }
}

function renderCategories() {
    catTbody.innerHTML = '';

    // Sort all by order FIRST to maintain global ordering
    globalCategories.sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));

    const filtered = globalCategories.filter(cat => (cat.type || 'Categorías') === currentCatFilter);

    if (filtered.length === 0) {
        catTbody.innerHTML = `<tr><td colspan="6" class="py-12 text-center text-obelisco-gray">No hay elementos en esta sección.</td></tr>`;
        return;
    }

    filtered.forEach(cat => {
        const data = cat;
        const id = cat.id;
        const tr = document.createElement('tr');
        tr.className = "hover:bg-gray-50 transition";
        tr.innerHTML = `
                <td class="py-3 px-4 font-medium text-xl text-center">${data.icon || '📌'}</td>
                <td class="py-3 px-4 font-medium">${data.name}</td>
                <td class="py-3 px-4 text-obelisco-gray text-xs truncate" title="${data.type || 'Categorías'}">
                    <span class="bg-gray-100 border border-gray-200 px-2 py-1 rounded inline-block">${data.type || 'Categorías'}</span>
                </td>
                <td class="py-3 px-4">
                    <div class="flex items-center space-x-2">
                        <span class="w-4 h-4 rounded-full border border-gray-300" style="background-color: ${data.color}"></span>
                        <span class="font-mono text-xs">${data.color}</span>
                    </div>
                </td>
                <td class="py-3 px-4 text-center">
                    <button class="toggle-cat-visibility flex items-center justify-center w-full" data-id="${id}" title="Alternar visibilidad">
                        ${data.visible !== false
                ? '<span class="w-3 h-3 bg-green-500 rounded-full inline-block shadow-sm"></span>'
                : '<span class="w-3 h-3 bg-red-500 rounded-full inline-block shadow-sm"></span>'}
                    </button>
                </td>
                <td class="py-3 px-4">
                    <input type="number" class="w-16 border border-gray-300 rounded px-2 py-1 text-xs outline-none focus:border-obelisco-blue cat-order-input" value="${data.order || 0}" data-id="${id}">
                </td>
                <td class="py-3 px-4 text-right space-x-2">
                    <button class="text-obelisco-blue hover:text-blue-800 font-medium btn-edit-cat" data-id="${id}">Editar</button>
                    <button class="text-red-500 hover:text-red-700 font-medium btn-del-cat" data-id="${id}">Eliminar</button>
                </td>
            `;
        catTbody.appendChild(tr);
        tr.querySelector('.btn-edit-cat').addEventListener('click', () => {
            fieldCatId.value = id;
            fieldCatVisible.checked = data.visible !== false;
            fieldCatName.value = data.name;
            fieldCatDesc.value = data.description || '';
            fieldCatIcon.value = data.icon || '';
            fieldCatType.value = data.type || 'Categorías';
            fieldCatColorText.value = data.color;
            fieldCatColorPicker.value = data.color;
            catModalTitle.textContent = "Editar Categoría";
            catModal.classList.remove('hidden');
            catModal.classList.add('flex');
        });
        tr.querySelector('.btn-del-cat').addEventListener('click', () => deleteDocReq("categories", id));

        tr.querySelector('.toggle-cat-visibility').addEventListener('click', async () => {
            try {
                await callApi(`/api/categorias/${id}`, 'PATCH', { visible: data.visible !== false ? 0 : 1 });
                await loadCategories();
            } catch (e) { console.error(e); }
        });

        // Auto-save order on change
        tr.querySelector('.cat-order-input').addEventListener('change', async (e) => {
            const newOrder = parseInt(e.target.value) || 0;
            try {
                await callApi(`/api/categorias/${id}`, 'PATCH', { sort_order: newOrder });
                await loadCategories();
            } catch (err) {
                console.error("Error updating order:", err);
                alert("No se pudo actualizar el orden.");
            }
        });
    });

    renderCategoryChecklist();
}

// Cat filter listeners
document.querySelectorAll('.cat-filter-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        currentCatFilter = e.target.dataset.type;

        // Update UI styles
        document.querySelectorAll('.cat-filter-btn').forEach(b => {
            b.classList.remove('active-cat-filter', 'bg-white', 'text-obelisco-blue', 'shadow-sm');
            b.classList.add('text-gray-600', 'hover:bg-gray-200');
        });
        btn.classList.add('active-cat-filter', 'bg-white', 'text-obelisco-blue', 'shadow-sm');
        btn.classList.remove('text-gray-600', 'hover:bg-gray-200');

        renderCategories();
    });
});

addCatBtn?.addEventListener('click', () => {
    catForm.reset();
    fieldCatId.value = '';
    fieldCatVisible.checked = true;
    fieldCatDesc.value = '';
    fieldCatColorPicker.value = '#009DE0';
    fieldCatColorText.value = '#009DE0';
    catModalTitle.textContent = "Nueva Categoría";
    catModal.classList.remove('hidden');
    catModal.classList.add('flex');
});

catForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (isSubmitting) return;
    isSubmitting = true;
    try {
        const docId = fieldCatId.value || `cat_${Date.now()}`;
        const data = {
            id: docId,
            visible: fieldCatVisible.checked ? 1 : 0,
            name: fieldCatName.value.trim(),
            description: fieldCatDesc.value.trim(),
            icon: fieldCatIcon.value.trim(),
            type: fieldCatType.value,
            color: fieldCatColorText.value.trim().toUpperCase(),
            sort_order: fieldCatId.value ? (globalCategories.find(c => c.id === docId)?.order || 0) : (globalCategories.length > 0 ? Math.max(...globalCategories.map(c => c.order || 0)) + 1 : 1)
        };
        
        // We need an endpoint for saving categories, let's assume we'll add it or use a generic one
        // For now, let's use a hypothetical /api/categorias POST
        await callApi('/api/categorias', 'POST', data);

        closeAllModals();
        await loadCategories();
    } catch (e) {
        console.error("Error saving category to MySQL:", e);
        alert("Error al guardar categoría en MySQL.");
    } finally { isSubmitting = false; }
});

// --- BOARDS CRUD ---
function boardMatchesFilter(data, search, catId, status) {
    const matchesSearch = !search || data.title.toLowerCase().includes(search.toLowerCase());

    let matchesCat = true;
    if (catId !== 'all') {
        if (catId === '_ge_direct') {
            matchesCat = (data.category === 'Gestores Externos' && (!data.categories || data.categories.length === 0));
        } else {
            matchesCat = (data.categories || []).includes(catId);
        }
    }

    let matchesStatus = true;
    if (status !== 'all') {
        const isActive = data.enabled !== false;
        matchesStatus = (status === 'active' && isActive) || (status === 'inactive' && !isActive);
    }

    return matchesSearch && matchesCat && matchesStatus;
}

async function loadBoards() {
    try {
        const data = await callApi('/api/tableros', 'GET');
        allBoardsFetched = data.map(b => ({
            id: b.id,
            title: b.title,
            icon: b.icon,
            iframeUrl: b.iframe_url,
            filePath: b.file_path,
            enabled: b.enabled !== 0,
            requireLogin: b.require_login !== 0,
            openInNewTab: b.open_in_new_tab !== 0,
            order: b.sort_order,
            allowedUsers: (() => {
                try {
                    const val = b.allowed_users;
                    if (typeof val === 'string' && val.trim() !== '') return JSON.parse(val);
                    return Array.isArray(val) ? val : [];
                } catch (e) { return []; }
            })(),
            accessExpirations: (() => {
                try {
                    const val = b.access_expirations;
                    if (typeof val === 'string' && val.trim() !== '') return JSON.parse(val);
                    return (typeof val === 'object' && val !== null) ? val : {};
                } catch (e) { return {}; }
            })(),
            categories: (() => {
                try {
                    const val = b.categories;
                    if (typeof val === 'string' && val.trim() !== '') return JSON.parse(val);
                    return Array.isArray(val) ? val : [];
                } catch (e) { return []; }
            })(),
            category: b.category_legacy
        }));
        filterAndRenderBoards();
    } catch (error) { console.error("Error loading boards from MySQL:", error); }
}

function filterAndRenderBoards() {
    boardsTbody.innerHTML = '';
    const filtered = allBoardsFetched.filter(b => boardMatchesFilter(b, boardSearchQuery, boardCategoryFilter, boardStatusFilter));

    // Update summary cards based on current filters
    const total = filtered.length;
    const active = filtered.filter(b => b.enabled !== false).length;
    const inactive = total - active;

    if (countTotal) countTotal.textContent = total;
    if (countActive) countActive.textContent = active;
    if (countInactive) countInactive.textContent = inactive;

    if (filtered.length === 0) {
        boardsTbody.innerHTML = `<tr><td colspan="6" class="py-12 text-center text-obelisco-gray bg-gray-50">No hay tableros en esta sección.</td></tr>`;
        return;
    }
    // Sort by order field
    filtered.sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
    filtered.forEach((data) => {
        const id = data.id;
        const allowedCount = (data.allowedUsers || []).length;
        const accessBadge = allowedCount === 0 && data.requireLogin
            ? `<span class="bg-red-50 text-red-600 border border-red-200 px-2 py-0.5 rounded text-xs">Público bloq.</span>`
            : (data.requireLogin
                ? `<span class="bg-blue-50 text-obelisco-blue border border-blue-200 px-2 py-0.5 rounded text-xs">${allowedCount} autorizados</span>`
                : `<span class="bg-green-50 text-green-700 border border-green-200 px-2 py-0.5 rounded text-xs">Público abierto</span>`);
        const catNames = (data.categories || []).map(catId => {
            const c = globalCategories.find(gc => gc.id === catId);
            return c ? c.name : 'Desc.';
        }).join(', ') || data.category || 'Sin Categoría';
        const tr = document.createElement('tr');
        tr.className = "hover:bg-gray-50 transition";
        tr.innerHTML = `
            <td class="py-3 px-4 cursor-pointer text-center" title="Click para alternar estado" data-toggle="${id}">
                ${data.enabled ? '<span class="w-3 h-3 bg-green-500 rounded-full inline-block shadow-sm"></span>' : '<span class="w-3 h-3 bg-red-500 rounded-full inline-block shadow-sm"></span>'}
            </td>
            <td class="py-3 px-4 font-medium"><span class="mr-2">${data.icon || '📌'}</span>${data.title}</td>
            <td class="py-3 px-4 text-obelisco-gray text-xs truncate max-w-[200px]" title="${catNames}">${catNames}</td>
            <td class="py-3 px-4">${accessBadge}</td>
            <td class="py-3 px-4">
                <input type="number" class="w-16 border border-gray-300 rounded px-2 py-1 text-xs outline-none focus:border-obelisco-blue board-order-input" value="${data.order || 0}" data-id="${id}">
            </td>
            <td class="py-3 px-4 text-right space-x-2">
                <button class="text-obelisco-blue hover:text-blue-800 font-medium btn-edit-board" data-id="${id}">Editar</button>
                <button class="text-red-500 hover:text-red-700 font-medium btn-del-board" data-id="${id}">Eliminar</button>
            </td>
        `;
        boardsTbody.appendChild(tr);
        tr.querySelector(`[data-toggle="${id}"]`).addEventListener('click', async () => {
            try { await callApi(`/api/tableros/${id}`, 'PATCH', { enabled: !data.enabled }); loadBoards(); }
            catch (e) { console.error(e); }
        });
        // Auto-save order on change
        tr.querySelector('.board-order-input').addEventListener('change', async (e) => {
            const newOrder = parseInt(e.target.value) || 0;
            try {
                await callApi(`/api/tableros/${id}`, 'PATCH', { sort_order: newOrder });
                await loadBoards();
            } catch (err) { console.error("Error updating board order:", err); }
        });
        tr.querySelector('.btn-edit-board').addEventListener('click', () => {
            boardModalTitle.textContent = 'Editar Tablero';
            fieldBoardId.value = id;
            fieldBoardEnabled.checked = data.enabled !== false;
            fieldBoardTitle.value = data.title || '';
            fieldBoardIcon.value = data.icon || '';
            fieldBoardReqLogin.value = data.requireLogin !== false ? 'true' : 'false';
            fieldBoardNewTab.checked = data.openInNewTab === true;
            currentlySelectedUsers = (data.allowedUsers || []).map(u => u.toLowerCase()).filter(email =>
                allUsersFetched.some(u => u.email.toLowerCase() === email) ||
                ADMIN_EMAILS.map(e => e.toLowerCase()).includes(email)
            );
            userSearchInput.value = '';
            categorySearchInput.value = '';
            renderUserChecklist();
            // Handle categories including virtual GE direct
            currentlySelectedCategories = data.categories || [];
            if (currentlySelectedCategories.length === 0 && data.category) {
                if (data.category === 'Gestores Externos') {
                    currentlySelectedCategories = ['_ge_direct'];
                } else {
                    const matchedCat = globalCategories.find(c => c.name === data.category);
                    if (matchedCat) currentlySelectedCategories.push(matchedCat.id);
                }
            }
            renderCategoryChecklist();

            // Set file upload reset
            const fileInputEl = document.getElementById('field-board-file');
            if (fileInputEl) fileInputEl.value = '';
            const fileLabelEl = document.getElementById('board-file-label');
            if (fileLabelEl) fileLabelEl.textContent = 'Arrastrá o hacé clic (HTML, ZIP, PDF, imagen — máx 50MB)';
            
            const currentFileEl = document.getElementById('board-current-file');
            const typeUrlEl = document.getElementById('board-type-url');
            const typeFileEl = document.getElementById('board-type-file');
            const urlWrapEl = document.getElementById('board-url-wrap');
            const fileWrapEl = document.getElementById('board-file-wrap');

            if (data.filePath) {
                if (typeFileEl) typeFileEl.checked = true;
                if (urlWrapEl) urlWrapEl.classList.add('hidden');
                if (fileWrapEl) fileWrapEl.classList.remove('hidden');
                if (currentFileEl) {
                    currentFileEl.textContent = `Archivo actual: ${data.filePath}`;
                    currentFileEl.classList.remove('hidden');
                }
                fieldBoardUrl.value = '';
            } else {
                if (typeUrlEl) typeUrlEl.checked = true;
                if (urlWrapEl) urlWrapEl.classList.remove('hidden');
                if (fileWrapEl) fileWrapEl.classList.add('hidden');
                if (currentFileEl) {
                    currentFileEl.textContent = '';
                    currentFileEl.classList.add('hidden');
                }
                fieldBoardUrl.value = data.iframeUrl || '';
            }

            boardModal.classList.remove('hidden');
            boardModal.classList.add('flex');
        });
        tr.querySelector('.btn-del-board').addEventListener('click', () => deleteDocReq("buttons", id));
    });
}

// Board filters
filterBoardSearch?.addEventListener('input', (e) => {
    boardSearchQuery = e.target.value;
    filterAndRenderBoards();
});

filterBoardCategory?.addEventListener('change', (e) => {
    boardCategoryFilter = e.target.value;
    filterAndRenderBoards();
});

filterBoardStatus?.addEventListener('change', (e) => {
    boardStatusFilter = e.target.value;
    filterAndRenderBoards();
});

addBoardBtn?.addEventListener('click', () => {
    boardForm.reset();
    fieldBoardId.value = '';
    fieldBoardReqLogin.value = 'true';
    fieldBoardNewTab.checked = false;
    currentlySelectedUsers = [];
    userSearchInput.value = '';
    categorySearchInput.value = '';
    renderUserChecklist();

    currentlySelectedCategories = [];
    renderCategoryChecklist();

    // Reset source type to URL
    const typeUrlEl = document.getElementById('board-type-url');
    if (typeUrlEl) typeUrlEl.checked = true;
    const urlWrapEl = document.getElementById('board-url-wrap');
    if (urlWrapEl) urlWrapEl.classList.remove('hidden');
    const fileWrapEl = document.getElementById('board-file-wrap');
    if (fileWrapEl) fileWrapEl.classList.add('hidden');
    const fileInputEl = document.getElementById('field-board-file');
    if (fileInputEl) fileInputEl.value = '';
    const fileLabelEl = document.getElementById('board-file-label');
    if (fileLabelEl) fileLabelEl.textContent = 'Arrastrá o hacé clic (HTML, ZIP, PDF, imagen — máx 50MB)';
    const currentFileEl = document.getElementById('board-current-file');
    if (currentFileEl) { currentFileEl.textContent = ''; currentFileEl.classList.add('hidden'); }

    boardModalTitle.textContent = 'Nuevo Tablero';
    boardModal.classList.remove('hidden');
    boardModal.classList.add('flex');
});

boardForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (isSubmitting) return;
    isSubmitting = true;
    try {
        const docId = fieldBoardId.value || `board_${Date.now()}`;
        const hasGEDirect = currentlySelectedCategories.includes('_ge_direct');
        const finalCategories = currentlySelectedCategories.filter(id => id !== '_ge_direct');
        
        const allowedUsersList = currentlySelectedUsers.filter(email =>
            allUsersFetched.some(u => u.email.toLowerCase() === email.toLowerCase()) ||
            ADMIN_EMAILS.map(e => e.toLowerCase()).includes(email.toLowerCase())
        );

        // Preservar expiraciones de accesos previas que sigan autorizadas
        const accessExpirations = {};
        if (fieldBoardId.value) {
            const existingBoard = allBoardsFetched.find(b => b.id === docId);
            const existingExpirations = existingBoard?.accessExpirations || {};
            const allowedUsersLower = allowedUsersList.map(u => u.toLowerCase());
            for (const [email, expDate] of Object.entries(existingExpirations)) {
                if (allowedUsersLower.includes(email.toLowerCase())) {
                    accessExpirations[email.toLowerCase()] = expDate;
                }
            }
        }

        const sourceType = document.querySelector('input[name="board-source-type"]:checked')?.value || 'url';
        const urlVal = fieldBoardUrl.value.trim();
        const fileInput = document.getElementById('field-board-file');

        if (sourceType === 'url' && !urlVal && !fieldBoardId.value) {
            alert('Por favor ingresá una URL para el tablero.');
            isSubmitting = false;
            return;
        }

        const token = await getCurrentUserToken();
        const formData = new FormData();
        formData.append('id', docId);
        formData.append('title', fieldBoardTitle.value.trim());
        formData.append('icon', fieldBoardIcon.value.trim());
        formData.append('categories', JSON.stringify(finalCategories));
        formData.append('category_legacy', hasGEDirect ? 'Gestores Externos' : '');
        formData.append('enabled', fieldBoardEnabled.checked ? 'true' : 'false');
        formData.append('require_login', fieldBoardReqLogin.value === 'true' ? 'true' : 'false');
        formData.append('open_in_new_tab', fieldBoardNewTab.checked ? 'true' : 'false');
        formData.append('allowed_users', JSON.stringify(allowedUsersList));
        formData.append('access_expirations', JSON.stringify(accessExpirations));
        formData.append('sort_order', fieldBoardId.value ? (allBoardsFetched.find(b => b.id === docId)?.order || 0) : 0);
        formData.append('source_type', sourceType);

        if (sourceType === 'url') {
            formData.append('iframe_url', urlVal);
        } else if (fileInput && fileInput.files[0]) {
            formData.append('archivo', fileInput.files[0]);
        }

        const response = await fetch('/api/tableros', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            body: formData
        });

        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error || 'Error al guardar tablero');
        }

        closeAllModals();
        await loadBoards();
        await loadRequests(); 
    } catch (error) {
        console.error("Error saving board to MySQL:", error);
        alert("Error al guardar tablero en MySQL: " + error.message);
    } finally { isSubmitting = false; }
});

// --- UTILITIES ---
function closeAllModals() {
    boardModal.classList.add('hidden');
    boardModal.classList.remove('flex');
    catModal.classList.add('hidden');
    catModal.classList.remove('flex');
}
document.querySelectorAll('[data-close]')?.forEach(btn => btn?.addEventListener('click', closeAllModals));

async function deleteDocReq(collectionName, id) {
    if (confirm("¿Estás seguro que querés eliminar esto permanentemente?")) {
        try {
            if (collectionName === 'buttons') {
                await callApi(`/api/tableros/${id}`, 'DELETE');
                await loadBoards();
            } else if (collectionName === 'categories') {
                await callApi(`/api/categorias/${id}`, 'DELETE');
                await loadCategories();
            }
        } catch (error) { console.error(error); alert("No se pudo eliminar."); }
    }
}

// --- USER TRACKING LOGIC ---
async function loadUserTracking() {
    console.log("Loading user tracking logs from MySQL...");
    try {
        const data = await callApi('/api/logs', 'GET');
        allTrackingFetched = data.map(log => {
            let details = {};
            try {
                details = typeof log.details === 'string' ? JSON.parse(log.details) : (log.details || {});
            } catch (e) {
                console.warn("Error parsing log details", e);
            }

            return {
                id: log.id,
                userEmail: log.user_email || log.user_uid,
                userName: log.user_name || details?.userName || '',
                buttonName: details?.buttonName || (log.action === 'view_dashboard' ? 'Dashboard' : log.action),
                hasAccess: log.action === 'view_dashboard' || log.action.includes('Acceso'),
                timestamp: log.created_at
            };
        });

        // Ordenar por timestamp descending
        allTrackingFetched.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        renderTrackingTable();
    } catch (error) {
        console.error("Error loading user tracking from MySQL:", error);
    }
}

function renderTrackingTable() {
    if (!trackingTbody) return;
    trackingTbody.innerHTML = '';

    // Aplicar filtros
    const filtered = allTrackingFetched.filter(log => {
        const matchesSearch = 
            (log.userEmail || "").toLowerCase().includes(trackingSearchQuery) ||
            (log.userName || "").toLowerCase().includes(trackingSearchQuery) ||
            (log.buttonName || "").toLowerCase().includes(trackingSearchQuery);
        
        let matchesStatus = true;
        if (trackingStatusFilter === 'access') {
            matchesStatus = log.hasAccess === true;
        } else if (trackingStatusFilter === 'denied') {
            matchesStatus = log.hasAccess === false;
        }

        return matchesSearch && matchesStatus;
    });

    if (filtered.length === 0) {
        trackingTbody.innerHTML = '<tr><td colspan="5" class="text-center py-8 text-obelisco-gray">No hay registros de actividad que coincidan con los filtros.</td></tr>';
        return;
    }

    filtered.forEach(log => {
        const date = log.timestamp ? new Date(log.timestamp).toLocaleString() : 'N/A';
        const tr = document.createElement('tr');
        tr.className = "hover:bg-gray-50 transition-colors";
        
        const statusBadge = log.hasAccess 
            ? '<span class="px-2 py-0.5 bg-green-100 text-green-700 rounded-full font-bold text-[10px] uppercase">Acceso Concedido</span>'
            : '<span class="px-2 py-0.5 bg-red-100 text-red-700 rounded-full font-bold text-[10px] uppercase">Denegado / Solicitud</span>';

        tr.innerHTML = `
            <td class="py-3 px-4 text-xs font-mono text-gray-500">${date}</td>
            <td class="py-3 px-4 text-xs">
                <div class="font-medium">${log.userName || log.userEmail.split('@')[0]}</div>
                <div class="text-[9px] text-gray-400">${log.userEmail}</div>
            </td>
            <td class="py-3 px-4 font-medium text-xs">${log.buttonName || 'N/A'}</td>
            <td class="py-3 px-4 text-right">${statusBadge}</td>
        `;
        trackingTbody.appendChild(tr);
    });
}
// --- SOLICITUDES ESTADÍSTICAS (PEDIDOS) ---
async function loadStatisticalRequests() {
    console.log("Loading statistical requests from MySQL...");
    try {
        const data = await callApi('/api/productos-estadisticos', 'GET');
        statisticalRequests = data.map(r => ({
            id: r.id,
            clientName: r.client_name,
            clientArea: r.area,
            clientPosition: r.client_position,
            clientEmail: r.client_email,
            clientPhone: r.client_phone,
            requestTitle: r.title,
            description: r.description,
            status: r.status.charAt(0).toUpperCase() + r.status.slice(1).replace('_', ' '),
            createdAt: { toDate: () => new Date(r.created_at) },
            jurisdictions: typeof r.jurisdictions === 'string' ? JSON.parse(r.jurisdictions) : r.jurisdictions,
            productTypes: typeof r.product_types === 'string' ? JSON.parse(r.product_types) : r.product_types,
            formats: typeof r.formats === 'string' ? JSON.parse(r.formats) : r.formats,
            periodicity: r.periodicity,
            dueDate: r.due_date,
            hasTechContact: r.has_tech_contact ? 'si' : 'no',
            techContactName: r.tech_contact_name,
            techContactEmail: r.tech_contact_email,
            techContactPhone: r.tech_contact_phone,
            additionalInfo: r.additional_info,
            attachments: typeof r.attachment_urls === 'string' ? JSON.parse(r.attachment_urls) : r.attachment_urls
        }));

        updateStatisticalSummary();
        renderStatisticalRequests();
    } catch (error) {
        console.error("Error loading statistical requests from MySQL:", error);
    }
}

function updateStatisticalSummary() {
    if (!countReqTotal) return;

    const total = statisticalRequests.length;
    const pending = statisticalRequests.filter(r => r.status === 'Pendiente').length;
    const completed = statisticalRequests.filter(r => r.status === 'Completado').length;

    countReqTotal.textContent = total;
    countReqPending.textContent = pending;
    countReqCompleted.textContent = completed;
}

function renderStatisticalRequests() {
    if (!pedidosTableBody) return;

    const searchText = reqSearchFilter.toLowerCase().trim();
    const filtered = statisticalRequests.filter(req => {
        const matchesSearch =
            (req.clientName || '').toLowerCase().includes(searchText) ||
            (req.requestTitle || '').toLowerCase().includes(searchText) ||
            (req.clientArea || '').toLowerCase().includes(searchText);

        const matchesStatus = reqStatusFilter === 'todos' || req.status === reqStatusFilter;

        return matchesSearch && matchesStatus;
    });

    if (filtered.length === 0) {
        pedidosTableBody.innerHTML = `<tr><td colspan="5" class="px-6 py-12 text-center text-gray-400">No se encontraron pedidos con esos filtros.</td></tr>`;
        return;
    }

    pedidosTableBody.innerHTML = filtered.map(req => {
        const date = req.createdAt?.toDate ? req.createdAt.toDate().toLocaleDateString() : 'N/A';
        const statusClass = getStatusBadgeClass(req.status);

        return `
            <tr class="hover:bg-gray-50/50 transition duration-150">
                <td class="px-6 py-4 font-mono text-xs text-gray-400">${date}</td>
                <td class="px-6 py-4">
                    <div class="font-bold text-gray-800">${req.clientName || 'N/A'}</div>
                    <div class="text-xs text-obelisco-gray">${req.clientArea || 'N/A'}</div>
                </td>
                <td class="px-6 py-4">
                    <div class="font-medium text-gray-700">${req.requestTitle || 'Sin título'}</div>
                    <div class="text-[10px] text-gray-400 truncate max-w-[200px]">${req.description || ''}</div>
                </td>
                <td class="px-6 py-4">
                    <span class="px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${statusClass}">
                        ${req.status || 'Pendiente'}
                    </span>
                </td>
                <td class="px-6 py-4 text-right">
                    <div class="flex items-center justify-end space-x-2">
                        <select onchange="window.updateRequestStatus('${req.id}', this.value)" class="text-xs border border-gray-200 rounded px-2 py-1 outline-none bg-white font-medium">
                            <option value="Pendiente" ${req.status === 'Pendiente' ? 'selected' : ''}>Pendiente</option>
                            <option value="En Proceso" ${req.status === 'En Proceso' ? 'selected' : ''}>En Proceso</option>
                            <option value="Completado" ${req.status === 'Completado' ? 'selected' : ''}>Completado</option>
                            <option value="Rechazado" ${req.status === 'Rechazado' ? 'selected' : ''}>Rechazado</option>
                        </select>
                        <button onclick="window.viewRequestDetails('${req.id}')" class="p-1.5 text-obelisco-blue hover:bg-blue-50 rounded transition shadow-sm border border-blue-100" title="Ver detalles completo">
                            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>
                        </button>
                    </div>
                </td>
            </tr>
        `;
    }).join('');
}

function getStatusBadgeClass(status) {
    switch (status) {
        case 'Pendiente': return 'bg-yellow-100 text-yellow-700 border border-yellow-200';
        case 'En Proceso': return 'bg-blue-100 text-blue-700 border border-blue-200';
        case 'Completado': return 'bg-green-100 text-green-700 border border-green-200';
        case 'Rechazado': return 'bg-red-100 text-red-700 border border-red-200';
        default: return 'bg-gray-100 text-gray-700 border border-gray-200';
    }
}

// Global functions for events
window.updateRequestStatus = async (id, newStatus) => {
    try {
        const mysqlStatus = newStatus.toLowerCase().replace(' ', '_');
        await callApi(`/api/productos-estadisticos/${id}/status`, 'POST', { status: mysqlStatus });
        
        // Local update
        const req = statisticalRequests.find(r => r.id === id);
        if (req) req.status = newStatus;
        updateStatisticalSummary();
        renderStatisticalRequests();
    } catch (error) {
        console.error("Error updating status in MySQL:", error);
        alert("Error al actualizar el estado.");
    }
};

window.viewRequestDetails = (id) => {
    const req = statisticalRequests.find(r => r.id === id);
    if (!req) return;

    let details = `DETALLES DEL PEDIDO\n\n`;
    details += `• CLIENTE: ${req.clientName}\n`;
    details += `• CARGO: ${req.clientPosition} - ${req.clientArea}\n`;
    details += `• JURISDICCIÓN: ${Array.isArray(req.jurisdictions) ? req.jurisdictions.join(', ') : (req.jurisdiction || 'N/A')}\n`;
    details += `• EMAIL: ${req.clientEmail}\n`;
    details += `• TELÉFONO: ${req.clientPhone}\n\n`;

    details += `• PRODUCTO(S): ${Array.isArray(req.productTypes) ? req.productTypes.join(', ') : (req.productType || 'N/A')}\n`;
    details += `• TÍTULO: ${req.requestTitle}\n`;
    details += `• DESCRIPCIÓN: ${req.description}\n`;
    details += `• PERIODICIDAD: ${req.periodicity}\n`;
    details += `• FECHA LÍMITE: ${req.dueDate}\n\n`;

    details += `• FORMATO(S): ${Array.isArray(req.formats) ? req.formats.join(', ') : (req.format || 'N/A')}\n`;
    details += `• PRIORIDAD: ${req.priority === '3' ? 'Alta' : req.priority === '2' ? 'Media' : 'Baja'}\n`;
    details += `• CONTACTO TÉCNICO: ${req.hasTechContact === 'si' ? 'Sí' : 'No'}\n`;
    if (req.hasTechContact === 'si') {
        details += `  - Nombre: ${req.techContactName || 'N/A'}\n`;
        details += `  - Email: ${req.techContactEmail || 'N/A'}\n`;
        details += `  - Tel: ${req.techContactPhone || 'N/A'}\n`;
    }
    details += `\n• INFO ADICIONAL: ${req.additionalInfo || 'N/A'}\n`;
    if (req.attachments && req.attachments.length > 0) {
        details += `\n• ARCHIVOS ADJUNTOS:\n`;
        req.attachments.forEach(file => {
            if (typeof file === 'object' && file.url) {
                details += `  - ${file.name}\n    Enlace: ${file.url}\n`;
            } else {
                // Backward compatibility if it was just a string
                details += `  - ${file}\n`;
            }
        });
    }

    alert(details);
};

// Listeners
filterReqSearch?.addEventListener('input', (e) => {
    reqSearchFilter = e.target.value;
    renderStatisticalRequests();
});

filterReqStatus?.addEventListener('change', (e) => {
    reqStatusFilter = e.target.value;
    renderStatisticalRequests();
});
// --- FEEDBACK LOGIC ---
async function loadFeedback() {
    try {
        const data = await callApi('/api/feedback', 'GET');
        const allFeedback = data.map(fb => ({
            id: fb.id,
            name: fb.name_provided || 'Anónimo',
            email: fb.email_provided,
            comment: fb.comment,
            timestamp: fb.created_at
        }));

        // Sort by date desc
        allFeedback.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

        renderFeedbackTable(allFeedback);
    } catch (error) {
        console.error("Error loading feedback from MySQL:", error);
    }
}

function renderFeedbackTable(feedbackList) {
    if (!feedbackTbody) return;
    feedbackTbody.innerHTML = '';

    if (feedbackList.length === 0) {
        feedbackTbody.innerHTML = '<tr><td colspan="5" class="text-center py-8 text-obelisco-gray">No hay feedback recibido aún.</td></tr>';
        return;
    }

    feedbackList.forEach(fb => {
        const date = fb.timestamp ? new Date(fb.timestamp).toLocaleString() : '-';
        const tr = document.createElement('tr');
        tr.className = "hover:bg-gray-50 transition-colors";
        
        tr.innerHTML = `
            <td class="py-4 px-4 whitespace-nowrap text-xs text-gray-500">${date}</td>
            <td class="py-4 px-4 font-medium">
                <div class="flex flex-col">
                    <span>${fb.name || 'Anónimo'}</span>
                    <span class="text-[10px] text-gray-400 font-normal">${fb.email || 'Email no provisto'}</span>
                </div>
            </td>
            <td class="py-4 px-4 text-sm text-gray-700">
                <div class="max-w-md break-words">${fb.comment}</div>
            </td>
            <td class="py-4 px-4 text-xs font-semibold text-obelisco-blue truncate max-w-[150px]" title="${fb.pageUrl}">
                ${fb.pageUrl || '/'}
            </td>
            <td class="py-4 px-4 text-right">
                <button class="text-red-500 hover:text-red-700 btn-del-feedback" data-id="${fb.id}">
                    <svg class="w-5 h-5 ml-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                </button>
            </td>
        `;

        tr.querySelector('.btn-del-feedback').addEventListener('click', async () => {
            if (confirm("¿Eliminar este feedback?")) {
                try {
                    await callApi(`/api/feedback/${fb.id}`, 'DELETE');
                    loadFeedback();
                } catch (err) {
                    console.error("Error deleting feedback:", err);
                }
            }
        });

        feedbackTbody.appendChild(tr);
    });
}
// Background notifications (uses MySQL)
async function checkBackgroundNotifications() {
    try {
        const lastSeenUsers = localStorage.getItem('ogb_last_seen_users');
        const lastSeenFeedback = localStorage.getItem('ogb_last_seen_feedback');
        const lastSeenContacto = localStorage.getItem('ogb_last_seen_contacto');

        const activeTab = document.querySelector('.nav-tab.text-obelisco-blue');
        const currentTarget = activeTab ? activeTab.getAttribute('data-target') : '';

        const isNewer = (dateVal, lastSeen) => {
            if (!dateVal) return false;
            const d = new Date(dateVal);
            return !lastSeen || d.getTime() > new Date(lastSeen).getTime();
        };

        const [users, feedback, contacts] = await Promise.all([
            callApi('/api/usuarios', 'GET').catch(() => []),
            callApi('/api/feedback', 'GET').catch(() => []),
            callApi('/api/contactos', 'GET').catch(() => [])
        ]);

        const usersBadge = document.getElementById('users-badge');
        if (usersBadge && currentTarget !== 'tab-usuarios') {
            const hasNew = users.some(u => isNewer(u.created_at, lastSeenUsers));
            if (hasNew) usersBadge.classList.remove('hidden');
        }

        const feedbackBadge = document.getElementById('feedback-badge');
        if (feedbackBadge && currentTarget !== 'tab-feedback') {
            const newCount = feedback.filter(f => isNewer(f.created_at, lastSeenFeedback)).length;
            if (newCount > 0) {
                feedbackBadge.textContent = newCount;
                feedbackBadge.classList.remove('hidden');
            }
        }

        const contactBadge = document.getElementById('contacto-badge');
        if (contactBadge && currentTarget !== 'tab-contacto') {
            const newCount = contacts.filter(c => isNewer(c.created_at, lastSeenContacto)).length;
            if (newCount > 0) {
                contactBadge.textContent = newCount;
                contactBadge.classList.remove('hidden');
            }
        }
    } catch (e) {
        console.error("Error checking background notifications:", e);
    }
}

// --- CONTACTS LOGIC ---
async function loadContacts() {
    console.log("Loading contacts from MySQL...");
    try {
        const data = await callApi('/api/contactos', 'GET');
        allContactsFetched = data.map(c => ({
            id: c.id,
            name: c.name,
            email: c.email,
            reason: c.reason,
            message: c.message,
            type: c.type,
            createdAt: c.created_at
        }));
        
        renderContactsTable();
    } catch (error) {
        console.error("Error loading contacts from MySQL:", error);
    }
}

function renderContactsTable() {
    if (!contactoTbody) return;
    contactoTbody.innerHTML = '';

    // Filter the contacts
    const filterType = document.getElementById('filter-contact-type')?.value || 'all';
    const filtered = allContactsFetched.filter(c => {
        // New explicit type field OR fallback keyword detection
        const isIncident = c.type === 'incident' || (c.reason && (
            c.reason.toLowerCase().includes('seguridad') || 
            c.reason.toLowerCase().includes('autorizado') ||
            c.reason.toLowerCase().includes('incidente') ||
            c.reason.toLowerCase().includes('indebido')
        ));

        if (filterType === 'incident') return isIncident;
        if (filterType === 'general') return !isIncident;
        return true;
    });

    if (filtered.length === 0) {
        contactoTbody.innerHTML = `<tr><td colspan="5" class="py-12 text-center text-obelisco-gray">No hay mensajes que coincidan con el filtro.</td></tr>`;
        return;
    }

    filtered.forEach(c => {
        const tr = document.createElement('tr');
        tr.className = "hover:bg-gray-50 transition border-b border-gray-100";
        
        // Format date safely
        let dateStr = 'N/A';
        if (c.createdAt) {
            try {
                const dt = c.createdAt.seconds ? c.createdAt.toDate() : new Date(c.createdAt);
                dateStr = dt.toLocaleString();
            } catch (e) {
                console.warn("Date formatting error for contact:", c.id, e);
            }
        }

        const isUrgent = c.type === 'incident' || (c.reason && (
            c.reason.toLowerCase().includes('seguridad') || 
            c.reason.toLowerCase().includes('autorizado') || 
            c.reason.toLowerCase().includes('incidente') ||
            c.reason.toLowerCase().includes('indebido')
        ));

        tr.innerHTML = `
            <td class="py-4 px-4 text-xs font-mono text-gray-500">${dateStr}</td>
            <td class="py-4 px-4 font-medium">
                <div class="flex flex-col">
                    <span class="text-obelisco-dark">${c.name || 'Anónimo'}</span>
                    <span class="text-[11px] text-obelisco-gray">${c.email || 'Sin email'}</span>
                </div>
            </td>
            <td class="py-4 px-4">
                <span class="px-2 py-1 rounded-md text-[10px] font-bold uppercase tracking-wider ${isUrgent ? 'bg-red-50 text-red-600 border border-red-100' : 'bg-blue-50 text-blue-600 border border-blue-100'}">
                    ${isUrgent ? '🚨 ' : '💬 '}${c.reason || 'Consulta'}
                </span>
            </td>
            <td class="py-4 px-4 italic text-obelisco-gray text-xs leading-relaxed max-w-xs truncate" title="${c.message}">"${c.message}"</td>
            <td class="py-4 px-4 text-right">
                <button class="text-gray-400 hover:text-red-500 transition-colors btn-del-contact" data-id="${c.id}" title="Eliminar reporte">
                    <svg class="w-5 h-5 ml-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
                </button>
            </td>
        `;

        tr.querySelector('.btn-del-contact').addEventListener('click', async () => {
            if (confirm("¿Eliminar este reporte permanentemente?")) {
                try {
                    await callApi(`/api/contactos/${c.id}`, 'DELETE');
                    loadContacts();
                } catch (err) {
                    console.error("Error deleting contact:", err);
                }
            }
        });

        contactoTbody.appendChild(tr);
    });
}
// --- T&C Version Management ---
async function loadTCConfig() {
    try {
        const data = await callApi('/api/config/terms-version', 'GET');
        globalTermsVersion = data.version;
        const input = document.getElementById('config-tc-version');
        if (input) input.value = globalTermsVersion;
    } catch (e) {
        console.error("Error loading TC config from MySQL:", e);
    }
}

document.getElementById('save-tc-version')?.addEventListener('click', async () => {
    const newVersion = document.getElementById('config-tc-version').value;
    if (!newVersion) return;
    
    if (!confirm(`¿Estás seguro de actualizar a la versión ${newVersion}? \nEsto obligará a TODOS los usuarios a aceptar los términos de nuevo.`)) return;

    try {
        const btn = document.getElementById('save-tc-version');
        btn.disabled = true;
        btn.textContent = "...";
        
        await callApi(`/api/config/terms_version`, 'POST', { value: newVersion });
        globalTermsVersion = newVersion;
        alert("Versión de T&C actualizada correctamente en MySQL.");
        
        btn.disabled = false;
        btn.textContent = "Activar";
    } catch (e) {
        console.error("Error saving TC Version to MySQL:", e);
        alert(`Error al guardar versión.`);
    }
});

// --- RCE Loading ---
async function loadRCE() {
    const rceTbody = document.getElementById('rce-tbody');
    if (!rceTbody) return;

    rceTbody.innerHTML = '<tr><td colspan="5" class="py-12 text-center text-gray-400">Cargando registros...</td></tr>';

    try {
        const data = await callApi('/api/rce-all', 'GET');
        allRCEFetched = data.map(log => ({
            id: log.id,
            userName: log.user_name,
            userEmail: log.user_email,
            dni: log.dni,
            timestamp: log.timestamp,
            ip: log.ip_address,
            version: log.terms_version
        }));
        
        // Sort by timestamp desc
        allRCEFetched.sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp));
        
        renderRCE();
    } catch (e) {
        console.error("Error loading RCE from MySQL:", e);
        rceTbody.innerHTML = '<tr><td colspan="5" class="py-12 text-center text-red-400">Error al cargar RCE desde MySQL</td></tr>';
    }
}

function renderRCE() {
    const rceTbody = document.getElementById('rce-tbody');
    if (!rceTbody) return;

    if (allRCEFetched.length === 0) {
        rceTbody.innerHTML = '<tr><td colspan="5" class="py-12 text-center text-gray-400">No hay registros de consentimiento aún.</td></tr>';
        return;
    }

    rceTbody.innerHTML = allRCEFetched.map(log => `
        <tr class="hover:bg-gray-50 transition">
            <td class="px-4 py-3">
                <div class="font-bold text-obelisco-dark">${log.userName || 'Usuario'}</div>
                <div class="text-[9px] text-gray-400">DNI: ${log.dni || 'S/D'}</div>
            </td>
            <td class="px-4 py-3 text-gray-500">${log.userEmail}</td>
            <td class="px-4 py-3">
                <div class="font-medium">${new Date(log.timestamp).toLocaleDateString()}</div>
                <div class="text-[9px] text-gray-400">${new Date(log.timestamp).toLocaleTimeString()}</div>
            </td>
            <td class="px-4 py-3">
                <span class="bg-gray-100 text-gray-600 px-2 py-0.5 rounded font-mono">${log.ip || '0.0.0.0'}</span>
            </td>
            <td class="px-4 py-3">
                <span class="bg-blue-100 text-blue-700 px-2 py-0.5 rounded font-bold">${log.version}</span>
            </td>
        </tr>
    `).join('');
}

// ─────────────────────────────────────────────────────────────────────────────
// MÓDULO INFORMES
// ─────────────────────────────────────────────────────────────────────────────

let allInformesAdmin = [];
let editingInformeId = null;
let informeSelectedUsers = [];

async function loadInformes() {
    const tbody = document.getElementById('informes-tbody');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="6" class="text-center py-8 text-obelisco-gray">Cargando informes...</td></tr>';

    try {
        const data = await callApi('/api/informes', 'GET');
        allInformesAdmin = data;
        renderInformesTable(data);
    } catch (e) {
        console.error('Error cargando informes admin:', e);
        tbody.innerHTML = `<tr><td colspan="6" class="text-center py-8 text-red-500">Error: ${e.message}</td></tr>`;
    }
}

function renderInformesTable(informes) {
    const tbody = document.getElementById('informes-tbody');
    if (!tbody) return;

    if (!informes || informes.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" class="text-center py-12 text-obelisco-gray italic">No hay informes creados aún. Hacé clic en "Nuevo Informe" para comenzar.</td></tr>';
        return;
    }

    const typeLabels = { url: '🔗 URL', pdf: '📕 PDF', image: '🖼️ Imagen', html: '🌐 HTML' };

    tbody.innerHTML = informes.map(inf => {
        const cats = (() => { try { return typeof inf.categories === 'string' ? JSON.parse(inf.categories) : (Array.isArray(inf.categories) ? inf.categories : []); } catch(e) { return []; } })();
        const catNames = cats.map(id => globalCategories?.find(c => c.id === id)?.name || id).join(', ') || '—';
        const enabled = inf.enabled;

        return `<tr class="hover:bg-gray-50 transition">
            <td class="py-3 px-4">
                <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold ${enabled ? 'bg-teal-50 text-teal-700' : 'bg-gray-100 text-gray-400'}">${enabled ? '● Activo' : '○ Inactivo'}</span>
            </td>
            <td class="py-3 px-4">
                <div class="font-bold text-obelisco-dark text-sm">${inf.title}</div>
                ${inf.description ? `<div class="text-xs text-gray-400 mt-0.5 truncate max-w-[280px]">${inf.description}</div>` : ''}
            </td>
            <td class="py-3 px-4 text-xs text-gray-500">${catNames}</td>
            <td class="py-3 px-4 text-xs">${inf.period || '—'} ${inf.year ? `<span class="text-gray-400">(${inf.year})</span>` : ''}</td>
            <td class="py-3 px-4 text-xs">${typeLabels[inf.file_type] || '—'}</td>
            <td class="py-3 px-4 text-right">
                <button onclick="openInformeModal('${inf.id}')" class="text-teal-600 hover:text-teal-800 font-medium text-xs mr-3 transition">Editar</button>
                <button onclick="deleteInforme('${inf.id}')" class="text-red-500 hover:text-red-700 font-medium text-xs transition">Eliminar</button>
            </td>
        </tr>`;
    }).join('');
}

function openInformeModal(id = null) {
    try {
        editingInformeId = id;
        const modal = document.getElementById('informe-modal');
        const title = document.getElementById('informe-modal-title');
        const deleteBtn = document.getElementById('delete-informe-btn');

        // Reset form
        document.getElementById('informe-id').value = '';
        document.getElementById('field-informe-enabled').checked = true;
        document.getElementById('field-informe-title').value = '';
        document.getElementById('field-informe-desc').value = '';
        document.getElementById('field-informe-period').value = '';
        document.getElementById('field-informe-year').value = '';
        document.getElementById('field-informe-url').value = '';
        document.getElementById('field-informe-order').value = '0';
        document.getElementById('field-informe-file').value = '';
        document.getElementById('field-informe-req-login').value = 'false';
        document.getElementById('informe-user-search').value = '';
        document.getElementById('informe-file-label').textContent = 'Arrastrá o hacé clic (PDF, imagen o HTML — máx 50MB)';
        const currentFileEl = document.getElementById('informe-current-file');
        if (currentFileEl) { currentFileEl.textContent = ''; currentFileEl.classList.add('hidden'); }

        // Reset source type to URL
        document.getElementById('informe-type-url').checked = true;
        document.getElementById('informe-url-wrap').classList.remove('hidden');
        document.getElementById('informe-file-wrap').classList.add('hidden');

        informeSelectedUsers = [];
        renderInformeUserChecklist();

        // Populate categories checklist
        populateInformeCategories([]);

        if (id) {
            const informe = allInformesAdmin.find(i => i.id === id);
            if (!informe) return;

            title.textContent = 'Editar Informe';
            deleteBtn.classList.remove('hidden');
            document.getElementById('informe-id').value = informe.id;
            document.getElementById('field-informe-enabled').checked = !!informe.enabled;
            document.getElementById('field-informe-title').value = informe.title || '';
            document.getElementById('field-informe-desc').value = informe.description || '';
            document.getElementById('field-informe-period').value = informe.period || '';
            document.getElementById('field-informe-year').value = informe.year || '';
            document.getElementById('field-informe-order').value = informe.sort_order ?? 0;
            document.getElementById('field-informe-req-login').value = informe.require_login ? 'true' : 'false';

            // Load users
            const allowedUsersRaw = informe.allowed_users;
            const parsedAllowedUsers = (() => {
                try {
                    if (typeof allowedUsersRaw === 'string' && allowedUsersRaw.trim() !== '') return JSON.parse(allowedUsersRaw);
                    return Array.isArray(allowedUsersRaw) ? allowedUsersRaw : [];
                } catch (e) { return []; }
            })();
            informeSelectedUsers = parsedAllowedUsers.map(u => u.toLowerCase()).filter(email =>
                allUsersFetched.some(u => u.email.toLowerCase() === email) ||
                ADMIN_EMAILS.map(e => e.toLowerCase()).includes(email)
            );
            renderInformeUserChecklist();

            // Set source type
            if (informe.file_path) {
                document.getElementById('informe-type-file').checked = true;
                document.getElementById('informe-url-wrap').classList.add('hidden');
                document.getElementById('informe-file-wrap').classList.remove('hidden');
                if (currentFileEl) {
                    currentFileEl.textContent = `Archivo actual: ${informe.file_path}`;
                    currentFileEl.classList.remove('hidden');
                }
            } else {
                document.getElementById('field-informe-url').value = informe.url || '';
            }

            // Load selected categories
            const cats = (() => { try { return typeof informe.categories === 'string' ? JSON.parse(informe.categories) : (Array.isArray(informe.categories) ? informe.categories : []); } catch(e) { return []; } })();
            populateInformeCategories(cats);
        } else {
            title.textContent = 'Nuevo Informe';
            deleteBtn.classList.add('hidden');
        }

        modal.classList.remove('hidden');
        modal.classList.add('flex');
    } catch (err) {
        alert("Error interno abriendo informe: " + err.message);
        console.error(err);
    }
}

function populateInformeCategories(selectedIds = []) {
    const container = document.getElementById('informe-categories-checklist');
    if (!container) return;

    const cats = globalCategories || [];
    if (cats.length === 0) {
        container.innerHTML = '<p class="text-xs text-center text-gray-400 py-4">No hay categorías disponibles.</p>';
        return;
    }

    container.innerHTML = cats.map(cat => `
        <label class="flex items-center gap-2 p-1.5 hover:bg-gray-50 rounded cursor-pointer">
            <input type="checkbox" name="informe-cat" value="${cat.id}" ${selectedIds.includes(cat.id) ? 'checked' : ''}
                class="w-3.5 h-3.5 text-teal-600 rounded focus:ring-teal-500">
            <span class="text-xs">${cat.icon || ''} ${cat.name}</span>
        </label>
    `).join('');
}

function renderInformeUserChecklist(filterText = '') {
    const list = document.getElementById('informe-users-checklist');
    if (!list) return;
    list.innerHTML = '';
    const filtered = allUsersFetched.filter(u => u.email.toLowerCase().includes(filterText.toLowerCase()) || u.name.toLowerCase().includes(filterText.toLowerCase()));
    if (filtered.length === 0) {
        list.innerHTML = `<p class="text-xs text-center text-gray-500 py-4">No se encontraron usuarios.</p>`;
        return;
    }
    filtered.forEach(u => {
        const userEmail = u.email.toLowerCase();
        const isAdmin = ADMIN_EMAILS.map(e => e.toLowerCase()).includes(userEmail);
        const isLector = u.role === 'lector';

        const isChecked = isAdmin || isLector || informeSelectedUsers.includes(userEmail) ? 'checked' : '';
        const disabledAttr = (isAdmin || isLector) ? 'disabled' : '';

        let badgeHtml = '';
        if (isAdmin) badgeHtml = '<span class="ml-auto text-[9px] bg-amber-100 text-amber-700 px-1 rounded font-bold uppercase">Admin (Acceso Total)</span>';
        else if (isLector) badgeHtml = '<span class="ml-auto text-[9px] bg-green-100 text-green-700 px-1 rounded font-bold uppercase">Lector (Acceso Total)</span>';

        const div = document.createElement('div');
        div.className = `flex items-center space-x-2 p-2 hover:bg-gray-50 rounded border border-transparent hover:border-gray-200 cursor-pointer transition ${(isAdmin || isLector) ? 'opacity-70' : ''}`;
        
        div.innerHTML = `
            <input type="checkbox" class="w-3.5 h-3.5 text-teal-600 rounded focus:ring-teal-500" value="${userEmail}" ${isChecked} ${disabledAttr}>
            <div class="flex flex-col">
                <span class="text-xs font-bold text-gray-800">${u.name}</span>
                <span class="text-[10px] text-gray-500">${userEmail}</span>
            </div>
            ${badgeHtml}
        `;

        if (!isAdmin && !isLector) {
            const checkbox = div.querySelector('input');
            div.addEventListener('click', (e) => {
                if (e.target.tagName !== 'INPUT') checkbox.checked = !checkbox.checked;
                if (checkbox.checked) {
                    if (!informeSelectedUsers.includes(userEmail)) informeSelectedUsers.push(userEmail);
                } else {
                    informeSelectedUsers = informeSelectedUsers.filter(e => e.toLowerCase() !== userEmail);
                }
            });
        }
        list.appendChild(div);
    });
}

async function saveInforme() {
    const saveBtn = document.getElementById('save-informe-btn');
    const title = document.getElementById('field-informe-title').value.trim();
    if (!title) { alert('El título del informe es obligatorio.'); return; }

    const sourceType = document.querySelector('input[name="informe-source-type"]:checked')?.value || 'url';
    const urlVal = document.getElementById('field-informe-url').value.trim();
    const fileInput = document.getElementById('field-informe-file');

    if (sourceType === 'url' && !urlVal && !editingInformeId) {
        alert('Por favor ingresá una URL para el informe.'); return;
    }

    const selectedCats = Array.from(document.querySelectorAll('input[name="informe-cat"]:checked')).map(c => c.value);
    const informeId = document.getElementById('informe-id').value || null;
    const enabled = document.getElementById('field-informe-enabled').checked;
    const requireLogin = document.getElementById('field-informe-req-login').value === 'true';

    saveBtn.disabled = true;
    saveBtn.textContent = 'Guardando...';

    try {
        const token = await getCurrentUserToken();
        const formData = new FormData();
        if (informeId) formData.append('id', informeId);
        formData.append('title', title);
        formData.append('description', document.getElementById('field-informe-desc').value.trim());
        formData.append('period', document.getElementById('field-informe-period').value.trim());
        formData.append('year', document.getElementById('field-informe-year').value || '');
        formData.append('categories', JSON.stringify(selectedCats));
        formData.append('enabled', enabled ? 'true' : 'false');
        formData.append('sort_order', document.getElementById('field-informe-order').value || '0');
        formData.append('require_login', requireLogin ? 'true' : 'false');
        formData.append('allowed_users', JSON.stringify(informeSelectedUsers.filter(email =>
            allUsersFetched.some(u => u.email.toLowerCase() === email.toLowerCase()) ||
            ADMIN_EMAILS.map(e => e.toLowerCase()).includes(email.toLowerCase())
        )));

        if (sourceType === 'url') {
            formData.append('url', urlVal);
        } else if (fileInput.files[0]) {
            formData.append('archivo', fileInput.files[0]);
        }

        const method = informeId ? 'PATCH' : 'POST';
        const endpoint = informeId ? `/api/informes/${informeId}` : '/api/informes';

        const response = await fetch(endpoint, {
            method,
            headers: { 'Authorization': `Bearer ${token}` },
            body: formData
        });

        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error || 'Error al guardar');
        }

        closeInformeModal();
        await loadInformes();
    } catch (e) {
        console.error('Error guardando informe:', e);
        alert('Error: ' + e.message);
    } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = 'Guardar Informe';
    }
}

async function deleteInforme(id) {
    if (!confirm('¿Eliminar este informe permanentemente?')) return;
    try {
        await callApi(`/api/informes/${id}`, 'DELETE');
        closeInformeModal();
        await loadInformes();
    } catch (e) {
        alert('Error al eliminar: ' + e.message);
    }
}

function closeInformeModal() {
    const modal = document.getElementById('informe-modal');
    if (modal) { modal.classList.add('hidden'); modal.classList.remove('flex'); }
    editingInformeId = null;
}

// Helper para obtener el token del usuario actual
async function getCurrentUserToken() {
    const { auth } = await import('./firebase-config.js');
    return auth.currentUser?.getIdToken();
}

// Event listeners para el módulo de informes (sin DOMContentLoaded porque type="module" es diferido)
document.getElementById('add-informe-btn')?.addEventListener('click', () => openInformeModal(null));

// Guardar informe
document.getElementById('save-informe-btn')?.addEventListener('click', saveInforme);

// Eliminar informe
document.getElementById('delete-informe-btn')?.addEventListener('click', () => {
    if (editingInformeId) deleteInforme(editingInformeId);
});

// Cerrar modal de informe (overlay y botones data-close="informe")
document.querySelectorAll('[data-close="informe"]')?.forEach(btn => {
    btn.addEventListener('click', closeInformeModal);
});
// Mostrar/ocultar URL vs File según radio
document.querySelectorAll('input[name="informe-source-type"]')?.forEach(radio => {
    radio.addEventListener('change', () => {
        const isUrl = document.getElementById('informe-type-url').checked;
        document.getElementById('informe-url-wrap').classList.toggle('hidden', !isUrl);
        document.getElementById('informe-file-wrap').classList.toggle('hidden', isUrl);
    });
});

// Actualizar label del input file
document.getElementById('field-informe-file')?.addEventListener('change', (e) => {
    const file = e.target.files[0];
    const label = document.getElementById('informe-file-label');
    if (file && label) label.textContent = `✓ ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`;
});

// Búsqueda de categorías en el modal de informe
document.getElementById('informe-cat-search')?.addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    document.querySelectorAll('#informe-categories-checklist label').forEach(label => {
        label.style.display = label.textContent.toLowerCase().includes(q) ? '' : 'none';
    });
});

// Búsqueda de usuarios en el modal de informe
document.getElementById('informe-user-search')?.addEventListener('input', (e) => {
    renderInformeUserChecklist(e.target.value);
});

// Hook: cargar informes cuando se active la pestaña
const _origNavTabClick = window._navTabClickBound;
document.querySelectorAll('.nav-tab[data-target="tab-informes"]')?.forEach(btn => {
    btn.addEventListener('click', () => {
        setTimeout(loadInformes, 50);
    });
});

// Mostrar/ocultar URL vs File en Tableros según radio
document.querySelectorAll('input[name="board-source-type"]')?.forEach(radio => {
    radio.addEventListener('change', () => {
        const isUrl = document.getElementById('board-type-url').checked;
        document.getElementById('board-url-wrap').classList.toggle('hidden', !isUrl);
        document.getElementById('board-file-wrap').classList.toggle('hidden', isUrl);
    });
});

// Actualizar label del input file de Tableros
document.getElementById('field-board-file')?.addEventListener('change', (e) => {
    const file = e.target.files[0];
    const label = document.getElementById('board-file-label');
    if (file && label) label.textContent = `✓ ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`;
});

window.openInformeModal = openInformeModal;
window.deleteInforme = deleteInforme;
