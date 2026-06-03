import { auth, storage, provider, signInWithPopup, signInWithRedirect, signOut, onAuthStateChanged, ref, uploadBytes, getDownloadURL } from './firebase-config.js';

// DOM Elements
const loginBtn = document.getElementById('login-btn');
const userAvatar = document.getElementById('user-avatar');
const userName = document.getElementById('user-name');
const logoutBtn = document.getElementById('logout-btn');
const authSection = document.getElementById('auth-section');

// Filter UI Elements
const filterButtons = document.querySelectorAll('.filter-btn');
const filtersContainer = document.getElementById('dashboard-filters');
let currentFilterGroup = 'Gestores Internos';
let allAccessibleBoards = [];
let allCategories = [];
let allInformes = []; // Todos los informes habilitados
let currentUserRole = 'usuario';
let currentUserRequests = [];
let currentUserAcceptedTCVersion = null;
let currentUserAcceptedTCTimestamp = null;
let currentUserData = null;

// Registration Modal Elements
const registrationModal = document.getElementById('registration-modal');
const registrationForm = document.getElementById('registration-form');

const ADMIN_EMAILS = [
    'datos@riocuarto.gov.ar'
];

// Configuration for Dynamic Registration Form
const REG_FORM_CONFIG = {
    "Sector Público Estatal": {
        types: ["Municipalidad", "Municipalidad de Río Cuarto", "Gobierno Provincial", "Gobierno Nacional"],
        roles: ["Autoridad política", "Jefe de área / Coordinador", "Técnico / Profesional", "Analista de datos / Estadístico", "Personal administrativo", "Comunicador / Prensa institucional", "Desarrollador / Soporte TI", "Consultor externo", "Otro"],
        requiresCUIT: ["Autoridad política", "Jefe de área / Coordinador"]
    },
    "Educación": {
        types: ["Universidad", "Instituto Terciario", "Escuela (primaria/ secundaria)", "Centro de investigación"],
        roles: ["Docente / Educador", "Investigador", "Estudiante", "Jefe de departamento / Coordinador académico", "Personal administrativo", "Referente institucional", "Técnico de laboratorio / profesional especializado", "Comunicador académico", "Otro"],
        requiresCUIT: []
    },
    "Sociedad civil": {
        types: ["Organización de la sociedad civil / ONG", "Voluntariado estructurado / asociaciones civiles", "Cámara empresarial / Gremial", "Colegio profesional", "Sindicato / Asociación de trabajadores"],
        roles: ["Coordinador/a de programa", "Voluntario/a", "Líder de proyecto", "Representante legal / Apoderado", "Representante gremial / sindical", "Miembro de comisión directiva", "Comunicador / Prensa", "Administrador/a", "Facilitador / Promotor territorial", "Otro"],
        requiresCUIT: ["Representante legal / Apoderado", "Representante gremial / sindical"]
    },
    "Sector privado": {
        types: ["Empresa / Industria privada", "Emprendimiento / PyME"],
        roles: ["Empresario / Emprendedor", "Directivo / Gerente", "Profesional / Técnico", "Representante comercial", "Representante legal / Apoderado", "Consultor externo", "Personal administrativo", "Comunicador institucional", "Otro"],
        requiresCUIT: ["Representante legal / Apoderado"]
    }
};
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
        const errorData = await response.json();
        throw new Error(errorData.error || `Error en la API: ${response.status}`);
    }
    return await response.json();
}

console.log("Auth JS v1 - Backend Connected");

// Navigation State
let currentViewLevel = 'categories'; // 'categories' or 'boards'
let currentSelectedCategory = null; // ID of the category being viewed

// Modal Elements
const modal = document.getElementById('ogb-modal');
const modalHeading = document.getElementById('ogb-heading');
const modalIframeWrap = document.getElementById('ogb-iframe-wrap');
const modalIframe = document.getElementById('ogb-iframe');
const modalLoader = document.getElementById('iframe-loader');
const fullScreenBtn = document.getElementById('ogb-full');
const ogbDirectLink = null;
const iframeFallback = document.getElementById('iframe-fallback');
const ogbFallbackBtn = null;
const unauthOverlay = document.getElementById('unauth-overlay');

// Allowed Domain
const ALLOWED_DOMAIN = "@riocuarto.gov.ar";

// Current User State
let currentUser = null;

// Listen for auth state changes
onAuthStateChanged(auth, async (user) => {
    try {
        if (user) {
            console.log("Auth State: User logged in", user.email);
            // Always show base UI then load data
            showUserUI(user);
            try {
                await loadUserPermissions(user);
            } catch (loadErr) {
                console.error("loadUserPermissions failed:", loadErr);
                // Still try to show registration modal if profile is incomplete
                try {
                    const token = await user.getIdToken();
                    const r = await fetch('/api/perfil/me', { headers: { 'Authorization': `Bearer ${token}` } });
                    const { profile } = await r.json();
                    const isAdmin = ['datos@riocuarto.gov.ar'].includes(user.email.toLowerCase());
                    const profileCompleted = !!(profile?.sector_group && profile?.organization_name && profile?.role_position);
                    if (!profileCompleted && !isAdmin && registrationModal) {
                        registrationModal.classList.remove('hidden');
                        registrationModal.classList.add('flex');
                    }
                } catch (e2) {
                    console.error("Fallback profile check failed:", e2);
                }
                // Show error on screen for debugging
                const grid = document.getElementById('tableros-grid');
                if (grid) {
                    grid.innerHTML = `<div class="col-span-full p-8 bg-red-50 border border-red-200 rounded-xl text-center">
                        <p class="text-red-600 font-bold mb-2">Error al cargar datos</p>
                        <p class="text-red-500 text-sm">${loadErr.message || loadErr}</p>
                        <p class="text-gray-400 text-xs mt-2">Code: ${loadErr.code || 'N/A'}</p>
                    </div>`;
                }
            }
        } else {
            console.log("Auth State: User logged out");
            showLoginUI();
        }
    } catch (error) {
        console.error("Critical error in onAuthStateChanged:", error);
    }
});

// Login function
async function handleLogin() {
    try {
        const result = await signInWithPopup(auth, provider);
        const user = result.user;
        const userEmail = (user.email || '').toLowerCase();
        const isAdmin = userEmail ? ADMIN_EMAILS.includes(userEmail) : false;

        // Registrar/Actualizar usuario en MySQL backend (no Firestore)
        try {
            const token = await user.getIdToken();
            await fetch('/api/usuarios/sync', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    uid: user.uid,
                    email: userEmail,
                    full_name: user.displayName || userEmail.split('@')[0] || 'Usuario',
                    photo_url: user.photoURL || '',
                    is_admin: isAdmin
                })
            });
        } catch (e) {
            // No bloquear el login si el sync falla
            console.warn("Could not sync user to MySQL:", e);
        }
    } catch (error) {
        if (error.code === 'auth/popup-closed-by-user' || error.code === 'auth/cancelled-popup-request') {
            return; // Ignore if user closed the popup
        }
        if (error.code === 'auth/popup-blocked') {
            console.warn("Popup blocked, falling back to redirect...");
            // Use redirect instead of popup if the browser blocked it
            try {
                await signInWithRedirect(auth, provider);
                return; // Execution stops here, page will redirect
            } catch (redirectError) {
                console.error("Redirect login failed:", redirectError);
            }
        }
        console.error("Error during login:", error);
        alert("Ocurrió un error al intentar iniciar sesión: " + (error.message || error) + "\n\nIntenta de nuevo.");
    }
}

// Logout function
async function handleLogout() {
    try {
        await signOut(auth);
    } catch (error) {
        console.error("Error during logout:", error);
    }
}

// UI State Management
function showLoginUI() {
    if (loginBtn) loginBtn.classList.remove('hidden');
    if (userAvatar) userAvatar.classList.add('hidden');
    if (userName) userName.classList.add('hidden');
    if (logoutBtn) logoutBtn.classList.add('hidden');

    // Show overlay & hide filters
    if (unauthOverlay) unauthOverlay.style.display = 'flex';
    if (filtersContainer) filtersContainer.classList.add('hidden');

    // Clear grid
    const gridContainer = document.getElementById('tableros-grid');
    if (gridContainer) gridContainer.innerHTML = '';
}

function showUserUI(user) {
    if (loginBtn) loginBtn.classList.add('hidden');
    if (userAvatar) {
        userAvatar.classList.remove('hidden');
        userAvatar.src = user.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.displayName || user.email)}&background=009DE0&color=fff`;
    }
    if (userName) {
        userName.classList.remove('hidden');
        userName.textContent = user.displayName || user.email.split('@')[0];
    }
    if (logoutBtn) logoutBtn.classList.remove('hidden');

    // Hide overlay & show filters
    if (unauthOverlay) unauthOverlay.style.display = 'none';
    if (filtersContainer) filtersContainer.classList.remove('hidden');
}

async function loadUserPermissions(user) {
    const userEmail = user.email.toLowerCase();
    console.log("Loading permissions for user:", userEmail);

    try {
        // 1. Load profile from MySQL (source of truth) and categories/tableros in parallel
        let perfilData, categoriesData, boardsData;
        try {
            [perfilData, categoriesData, boardsData] = await Promise.all([
                callApi('/api/perfil/me', 'GET'),
                callApi('/api/categorias', 'GET'),
                callApi('/api/tableros', 'GET')
            ]);
        } catch (e) {
            console.error("Error loading base data:", e);
            throw e;
        }

        const profile = perfilData.profile;
        const globalTermsVersion = perfilData.termsVersion || '1';

        // Cache role and profile status from MySQL
        let hasProfileInfo = false;
        if (profile) {
            currentUserRole = profile.role || 'usuario';
            currentUserAcceptedTCVersion = profile.terms_accepted_version || null;
            currentUserAcceptedTCTimestamp = profile.terms_accepted_date || null;
            currentUserData = profile;

            const isAdmin = ['datos@riocuarto.gov.ar'].includes(userEmail);
            const profileCompleted = !!(profile.sector_group && profile.organization_name && profile.role_position);
            hasProfileInfo = profileCompleted || isAdmin;
        } else {
            currentUserRole = 'usuario';
        }

        // Show registration modal if missing info
        if (!hasProfileInfo && registrationModal) {
            console.log("Profile incomplete — showing registration modal");
            registrationModal.classList.remove('hidden');
            registrationModal.classList.add('flex');
        } else if (hasProfileInfo && profile) {
            // Check T&C Version for re-acceptance ONLY if profile is complete
            if (profile.terms_accepted_version && profile.terms_accepted_version !== globalTermsVersion) {
                console.log("Re-acceptance required: user has", profile.terms_accepted_version, "but current is", globalTermsVersion);
                showTCReacceptanceModal(globalTermsVersion);
            }
        }

        // Cargar informes en paralelo (no bloquea si falla)
        try {
            const informesData = await fetch('/api/informes').then(r => r.json());
            allInformes = informesData
                .filter(i => i.enabled)
                .map(i => {
                    const informeObj = {
                        id: i.id,
                        title: i.title,
                        description: i.description || '',
                        categories: (() => { try { const v = i.categories; return typeof v === 'string' ? JSON.parse(v) : (Array.isArray(v) ? v : []); } catch(e) { return []; } })(),
                        category: i.category_legacy,
                        url: i.file_path || i.url,
                        fileType: i.file_type || 'url',
                        period: i.period || '',
                        year: i.year,
                        sort_order: i.sort_order || 0,
                        requireLogin: i.require_login === 1 || i.require_login === true || i.require_login === 'true' || i.require_login === '1',
                        allowedUsers: (() => { try { const v = i.allowed_users; return typeof v === 'string' && v.trim() !== '' ? JSON.parse(v) : (Array.isArray(v) ? v : []); } catch(e) { return []; } })(),
                        accessExpirations: (() => { try { const v = i.access_expirations; return typeof v === 'string' && v.trim() !== '' ? JSON.parse(v) : (typeof v === 'object' && v !== null ? v : {}); } catch(e) { return {}; } })()
                    };
                    const hasAccess = checkUserAccess(user, informeObj);
                    return { ...informeObj, hasAccess };
                });
        } catch (e) {
            console.warn('Error cargando informes:', e.message);
            allInformes = [];
        }

        // 2. Load personal requests from MySQL
        let requestsData = [];
        try {
            const rows = await callApi('/api/solicitudes/me', 'GET');
            requestsData = rows.map(r => ({
                id: String(r.id),
                userEmail: r.user_uid,
                buttonId: r.dashboard_name,
                buttonName: r.dashboard_name,
                reason: r.reason,
                status: r.status,
                createdAt: r.created_at
            }));
        } catch (e) {
            console.warn("Error loading requests:", e.message);
        }

        // Cache user requests
        currentUserRequests = requestsData;

        // Cache categories and sort by order
        allCategories = categoriesData.map(c => ({
            id: c.id,
            name: c.name,
            description: c.description,
            icon: c.icon,
            type: c.type,
            color: c.color,
            visible: c.visible,
            order: c.sort_order
        }));
        allCategories.sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));

        // Cache all enabled boards and flag those with access
        allAccessibleBoards = [];
        boardsData.forEach((data) => {
            if (data.enabled) {
                const boardObj = {
                    id: data.id,
                    title: data.title,
                    icon: data.icon,
                    iframeUrl: data.iframe_url,
                    enabled: data.enabled,
                    requireLogin: data.require_login,
                    openInNewTab: data.open_in_new_tab,
                    sort_order: data.sort_order,
                    allowedUsers: (() => {
                        try {
                            const val = data.allowed_users;
                            if (typeof val === 'string' && val.trim() !== '') return JSON.parse(val);
                            return Array.isArray(val) ? val : [];
                        } catch (e) { return []; }
                    })(),
                    accessExpirations: (() => {
                        try {
                            const val = data.access_expirations;
                            if (typeof val === 'string' && val.trim() !== '') return JSON.parse(val);
                            return (typeof val === 'object' && val !== null) ? val : {};
                        } catch (e) { return {}; }
                    })(),
                    categories: (() => {
                        try {
                            const val = data.categories;
                            if (typeof val === 'string' && val.trim() !== '') return JSON.parse(val);
                            return Array.isArray(val) ? val : [];
                        } catch (e) { return []; }
                    })(),
                    category: data.category_legacy
                };
                const hasAccess = checkUserAccess(user, boardObj);
                allAccessibleBoards.push({ ...boardObj, hasAccess });
            }
        });

        console.log("Loaded (MySQL)", allCategories.length, "categories,", allAccessibleBoards.length, "boards,", allInformes.length, "informes");
        renderDashboard();


    } catch (error) {
        console.error("Error loading user permissions:", error);
        
        // Handle specific permission error for external users
        if (error.code === 'permission-denied' || error.message.includes('permissions')) {
            const gridContainer = document.getElementById('tableros-grid');
            if (gridContainer) {
                gridContainer.innerHTML = `
                    <div class="col-span-full py-16 text-center bg-white border border-red-100 rounded-2xl shadow-sm">
                        <div class="w-16 h-16 bg-red-50 text-red-500 rounded-full flex items-center justify-center mx-auto mb-4">
                            <svg class="h-8 w-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/>
                            </svg>
                        </div>
                        <h3 class="text-xl font-bold text-obelisco-dark mb-2">Acceso en Revisión</h3>
                        <p class="text-obelisco-gray max-w-md mx-auto px-6">
                            Tu cuenta se ha autenticado correctamente, pero aún no tiene permisos para ver estos indicadores. 
                            El equipo técnico del Observatorio procesará tu perfil pronto.
                        </p>
                    </div>
                `;
            }
        }
    }
}

function checkUserAccess(user, buttonData) {
    if (!buttonData.requireLogin) return true;
    if (!user) return false;

    const userEmail = user.email.toLowerCase();

    // Role status check (Full access for Lectors)
    if (currentUserRole === 'lector') return true;

    // Check if user is an admin by default
    if (ADMIN_EMAILS.includes(userEmail)) {
        console.log("Access granted: Admin user");
        return true;
    }

    const allowedUsers = buttonData.allowedUsers || [];
    const lowerEmail = userEmail.toLowerCase();
    
    const isAllowed = allowedUsers.map(email => email.toLowerCase()).includes(lowerEmail);

    if (isAllowed) {
        // Check for expiration if it exists
        const accessExpirations = buttonData.accessExpirations || {};
        if (accessExpirations[lowerEmail]) {
            const expiry = new Date(accessExpirations[lowerEmail]);
            const now = new Date();
            if (now > expiry) {
                console.warn(`Access expired for ${userEmail} on board ${buttonData.id || 'unknown'}`);
                return false;
            }
        }
        return true;
    }

    return false;
}

// Filter Listeners
filterButtons?.forEach(btn => {
    btn.addEventListener('click', (e) => {
        const targetBtn = e.currentTarget;

        // UI reset
        filterButtons.forEach(b => {
            b.classList.remove('bg-white', 'text-obelisco-blue', 'border-gray-200', 'shadow-sm', 'active-filter');
            b.classList.add('bg-transparent', 'text-gray-600', 'border-transparent');
            const icon = b.querySelector('span.text-2xl');
            if (icon) icon.classList.add('opacity-80');
        });

        // Set active
        targetBtn.classList.remove('bg-transparent', 'text-gray-600', 'border-transparent');
        targetBtn.classList.add('bg-white', 'text-obelisco-blue', 'border-gray-200', 'shadow-sm', 'active-filter');
        const icon = targetBtn.querySelector('span.text-2xl');
        if (icon) icon.classList.remove('opacity-80');

        currentFilterGroup = targetBtn.getAttribute('data-group');
        currentViewLevel = 'categories';
        currentSelectedCategory = null;
        renderDashboard();
    });
});

function renderDashboard() {
    const gridContainer = document.getElementById('tableros-grid');
    if (!gridContainer) return;
    gridContainer.innerHTML = '';

    // Add breadcrumb if in boards view
    let headerHtml = '';
    if (currentViewLevel === 'boards' && currentSelectedCategory) {
        const cat = allCategories.find(c => c.id === currentSelectedCategory);
        const catName = cat ? cat.name : 'Categoría';

        headerHtml = `
            <div class="col-span-full mb-4 flex items-center">
                <button id="btn-back-categories" class="text-obelisco-blue hover:text-blue-800 font-medium flex items-center transition">
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7" /></svg>
                    Volver a ${currentFilterGroup}
                </button>
                <span class="mx-3 text-gray-300">|</span>
                <h3 class="text-xl font-bold text-obelisco-dark">${catName}</h3>
            </div>
        `;
        gridContainer.innerHTML = headerHtml;

        document.getElementById('btn-back-categories')?.addEventListener('click', () => {
            currentViewLevel = 'categories';
            currentSelectedCategory = null;
            renderDashboard();
        });

        // Render boards for this category
        const boardsToRender = allAccessibleBoards.filter(b => b.categories && b.categories.includes(currentSelectedCategory));
        let renderedCount = 0;
        boardsToRender.forEach(board => {
            renderButton(gridContainer, board.id, board);
            renderedCount++;
        });

        // Render informes for this category
        const informesToRender = allInformes.filter(i => i.categories && i.categories.includes(currentSelectedCategory));
        if (informesToRender.length > 0) {
            if (renderedCount > 0) {
                // Divider between tableros and informes
                gridContainer.insertAdjacentHTML('beforeend', `
                    <div class="col-span-full mt-2 mb-1 flex items-center gap-3">
                        <div class="flex-grow h-px bg-gray-200"></div>
                        <span class="text-xs font-bold text-teal-600 uppercase tracking-widest px-2 py-1 bg-teal-50 rounded-full border border-teal-200">📄 Informes</span>
                        <div class="flex-grow h-px bg-gray-200"></div>
                    </div>`);
            }
            informesToRender.forEach(informe => renderInformeCard(gridContainer, informe));
            renderedCount += informesToRender.length;
        }

        if (renderedCount === 0) {
            gridContainer.insertAdjacentHTML('beforeend', getEmptyStateHtml(`No hay tableros ni informes en "${catName}".`));
        }

    } else {
        // Render Categories for this Group
        const catsToRender = allCategories.filter(c => (c.type || 'Categorías') === currentFilterGroup && c.visible !== false);
        // Also figure out if we have old boards that match this group but have no category, to show them directly? No, enforce category.

        let renderedCount = 0;
        catsToRender.forEach(cat => {
            // Count accessible boards + informes in this category
            const accessibleInCat = allAccessibleBoards.filter(b => b.categories && b.categories.includes(cat.id)).length;
            const informesInCat = allInformes.filter(i => i.categories && i.categories.includes(cat.id)).length;
            renderCategoryCard(gridContainer, cat, accessibleInCat, informesInCat);
            renderedCount++;
        });

        if (renderedCount === 0) {
            // Fallback for old boards/informes that don't have categories IDs but have string group name? 
            // Better to show them matching group directly if they have no category array
            const boardsWithoutCatInGroup = allAccessibleBoards.filter(b =>
                (!b.categories || b.categories.length === 0) && (b.category === currentFilterGroup)
            );
            const informesWithoutCatInGroup = allInformes.filter(i =>
                (!i.categories || i.categories.length === 0) && (i.category === currentFilterGroup)
            );

            if (boardsWithoutCatInGroup.length > 0 || informesWithoutCatInGroup.length > 0) {
                boardsWithoutCatInGroup.forEach(board => renderButton(gridContainer, board.id, board));
                
                if (informesWithoutCatInGroup.length > 0) {
                    if (boardsWithoutCatInGroup.length > 0) {
                        // Divider between tableros and informes
                        gridContainer.insertAdjacentHTML('beforeend', `
                            <div class="col-span-full mt-2 mb-1 flex items-center gap-3">
                                <div class="flex-grow h-px bg-gray-200"></div>
                                <span class="text-xs font-bold text-teal-600 uppercase tracking-widest px-2 py-1 bg-teal-50 rounded-full border border-teal-200">📄 Informes</span>
                                <div class="flex-grow h-px bg-gray-200"></div>
                            </div>`);
                    }
                    informesWithoutCatInGroup.forEach(informe => renderInformeCard(gridContainer, informe));
                }
                renderedCount = boardsWithoutCatInGroup.length + informesWithoutCatInGroup.length;
            } else {
                gridContainer.insertAdjacentHTML('beforeend', getEmptyStateHtml(`No hay categorías creadas bajo el grupo "${currentFilterGroup}".`));
            }
        }
    }
}

function getEmptyStateHtml(msg) {
    return `
        <div class="col-span-full py-12 text-center text-obelisco-gray bg-white border border-obelisco-border rounded-xl">
            <svg class="w-12 h-12 mx-auto text-gray-300 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/>
            </svg>
            <h3 class="text-lg font-medium text-obelisco-dark">Nada por aquí</h3>
            <p class="mt-2 text-sm">${msg}</p>
        </div>
    `;
}

function renderCategoryCard(container, category, boardCount, informeCount = 0) {
    let hexColor = category.color || '#009DE0';
    let iconStr = category.icon || '';
    let desc = category.description || ''; // Empty if not provided

    if (!iconStr) {
        iconStr = `<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" style="color: ${hexColor}" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                    </svg>`;
    } else {
        iconStr = `<span style="color: ${hexColor}; font-size: 1.5rem; display: flex; align-items: center; justify-content: center;" class="w-full h-full">${iconStr}</span>`;
    }

    const countBadges = [];
    if (boardCount > 0) countBadges.push(`<span class="text-xs font-medium px-2 py-1 bg-blue-50 rounded text-blue-600 border border-blue-100">${boardCount} Tablero${boardCount !== 1 ? 's' : ''}</span>`);
    if (informeCount > 0) countBadges.push(`<span class="text-xs font-medium px-2 py-1 bg-teal-50 rounded text-teal-700 border border-teal-100">${informeCount} Informe${informeCount !== 1 ? 's' : ''}</span>`);
    const totalCount = boardCount + informeCount;

    const html = `
        <div data-cat-id="${category.id}"
            class="obelisco-card category-card bg-white border border-obelisco-border rounded-xl p-6 flex flex-col h-full hover:bg-gray-50 transition drop-shadow-sm cursor-pointer border-t-4" style="border-top-color: ${hexColor}">
            <div class="flex items-center mb-4 w-full">
                <div class="h-12 w-12 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0">
                    ${iconStr}
                </div>
                <h3 class="text-base font-bold text-obelisco-dark ml-4 leading-snug break-words flex-grow">${category.name}</h3>
            </div>
            ${desc ? `<p class="text-obelisco-gray text-sm flex-grow mb-6 line-clamp-3" title="${desc}">${desc}</p>` : '<div class="flex-grow"></div>'}
            <div class="flex justify-between items-center w-full">
                <div class="flex gap-1 flex-wrap">${countBadges.join('') || `<span class="text-xs font-medium px-2 py-1 bg-gray-100 rounded text-gray-500">Sin contenido</span>`}</div>
                <span class="text-obelisco-blue font-bold text-sm flex items-center">
                    Ver contenido
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 ml-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
                    </svg>
                </span>
            </div>
        </div>
    `;

    container.insertAdjacentHTML('beforeend', html);

    // Add event listener to jump into category
    const insertedEl = container.lastElementChild;
    insertedEl.addEventListener('click', (e) => {
        e.preventDefault();
        currentViewLevel = 'boards';
        currentSelectedCategory = category.id;
        renderDashboard();
    });
}

async function handleAccessRequest(e) {
    e.preventDefault();
    const submitBtn = e.target.querySelector('button[type="submit"]');
    if (submitBtn.disabled) return;

    const buttonName = document.getElementById('ogb-form-button-name')?.value;

    // Capture from radio buttons
    const selectedRadio = document.querySelector('input[name="ogb-form-motivo"]:checked');
    const selectMotivo = selectedRadio ? selectedRadio.value : "";
    const detalleMotivo = document.getElementById('ogb-form-motivo-detalle')?.value;

    if (!selectMotivo) {
        alert("Por favor, selecciona un motivo de solicitud.");
        return;
    }

    if (selectMotivo === "Otra" && (!detalleMotivo || !detalleMotivo.trim())) {
        alert("Por favor, detalla el motivo de tu solicitud.");
        return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "Enviando...";

    try {
        await callApi('/api/solicitud-acceso', 'POST', {
            dashboard_name: buttonName,
            reason: selectMotivo,
            reason_detail: detalleMotivo,
            terms_version: currentUserAcceptedTCVersion || '1'
        });

        document.getElementById('ogb-form-ok').classList.remove('hidden');

        // Refresh local state to show "En revisión" immediately
        await loadUserPermissions(auth.currentUser);

        setTimeout(() => {
            document.getElementById('ogb-form-ok').classList.add('hidden');
            document.getElementById('ogb-form').reset();
            closeModal();
            submitBtn.disabled = false;
            submitBtn.textContent = "Solicitar Aprobación";
        }, 2500);
    } catch (error) {
        console.error("Error sending request:", error);
        alert("Error al enviar la solicitud: " + (error.code || error.message));
        submitBtn.disabled = false;
        submitBtn.textContent = "Solicitar Aprobación";
    }
}

function renderButton(container, id, data) {
    // If the board doesn't have an explicit icon string, guess color from categories
    let hexColor = '#009DE0';
    let iconStr = data.icon || '';
    let categoryNames = '';

    if (data.categories && data.categories.length > 0) {
        const primaryCat = allCategories.find(c => c.id === data.categories[0]);
        if (primaryCat) {
            hexColor = primaryCat.color || hexColor;
            if (!iconStr) iconStr = primaryCat.icon || '';

            // Generate list of names
            categoryNames = data.categories.map(cId => {
                const c = allCategories.find(cat => cat.id === cId);
                return c ? c.name : '';
            }).filter(Boolean).join(', ');
        }
    } else {
        // Fallback or old data
        categoryNames = data.category || 'Sin Categoría';
    }

    // If STILL no icon, use default SVG
    if (!iconStr) {
        iconStr = `<svg xmlns="http://www.w3.org/2000/svg" class="h-6 w-6" style="color: ${hexColor}" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                    </svg>`;
    } else {
        // Assume it could be an emoji or SVG text
        // Wrap it in a span with the category color to ensure text color inherits if it's text/SVG
        iconStr = `<span style="color: ${hexColor}; font-size: 1.5rem; display: flex; align-items: center; justify-content: center;" class="w-full h-full">${iconStr}</span>`;
    }

    const hasAccess = data.hasAccess !== false; // handle old data
    const restrictedClass = !hasAccess ? 'opacity-75 grayscale-[0.5] border-dashed border-red-200' : '';

    const pendingRequest = currentUserRequests.find(r => 
        (r.buttonId === id || r.buttonId === data.title || r.buttonName === data.title) && 
        (r.status === 'pendiente' || r.status === 'pending')
    );
    const isUnderReview = !!pendingRequest;

    const lockIcon = !hasAccess
        ? (isUnderReview
            ? '<div class="absolute top-2 right-2 text-obelisco-blue bg-blue-50 px-2 py-0.5 rounded-full text-[10px] font-bold border border-blue-200 shadow-sm">En revisión</div>'
            : '<div class="absolute top-2 right-2 text-red-500 bg-red-50 p-1.5 rounded-full border border-red-100"><svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clip-rule="evenodd"/></svg></div>')
        : '<div class="absolute top-2 right-2 text-green-600 bg-green-50 p-1.5 rounded-full border border-green-100 shadow-sm" title="Acceso concedido"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" /></svg></div>';

    const html = `
        <a href="#" data-button-id="${id}" data-iframe="${data.iframeUrl || ''}" data-heading="${data.title}" data-access="${hasAccess}" data-new-tab="${!!data.openInNewTab}"
            class="obelisco-card dashboard-btn bg-white border border-obelisco-border rounded-xl p-6 flex flex-col h-full hover:bg-gray-50 transition drop-shadow-sm relative ${restrictedClass}">
            ${lockIcon}
            <div class="flex items-center mb-4 w-full">
                <div class="h-12 w-12 rounded-lg bg-gray-100 flex items-center justify-center flex-shrink-0">
                    ${iconStr}
                </div>
                <h3 class="text-sm font-bold text-obelisco-dark ml-4 leading-snug break-words flex-grow">${data.title}</h3>
            </div>
            <p class="text-obelisco-gray text-xs flex-grow mb-6 italic" title="${categoryNames}">${categoryNames}</p>
            <span class="text-obelisco-blue font-bold text-sm flex items-center">
                ${hasAccess ? 'Ver tablero' : (isUnderReview ? 'Pendiente' : 'Solicitar acceso')}
                <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 ml-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
                </svg>
            </span>
        </a>
    `;

    container.insertAdjacentHTML('beforeend', html);
}

// Modal and Iframe Utility Functions
function openModal(title, url) {
    if (!url) {
        alert("El enlace para este tablero no está disponible.");
        return;
    }

    modalHeading.textContent = title;

    // Reset iframe state
    modalIframe.style.opacity = '0';
    modalLoader.style.display = 'flex';

    // Apply URL formatting fixes
    let finalSrc = ogbFixSheetUrl(url);
    finalSrc = ogbFixLookerUrl(finalSrc);
    finalSrc = ogbEnsurePBIToolbar(finalSrc);

    // Adjust security based on source
    modalIframe.setAttribute('referrerpolicy', 'no-referrer');
    modalIframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms');

    if (finalSrc.includes('lookerstudio.google.com')) {
        modalIframe.removeAttribute('referrerpolicy');
    }

    // Chrome's PDF viewer is disabled if the iframe has ANY sandbox attribute
    const isPdf = finalSrc.toLowerCase().includes('.pdf');
    if (isPdf) {
        modalIframe.removeAttribute('sandbox');
        // Hide PDF toolbar to prevent downloading/printing natively
        if (!finalSrc.includes('toolbar=0')) {
            finalSrc += (finalSrc.includes('#') ? '&' : '#') + 'toolbar=0';
        }
    }

    // Load iframe content
    modalIframe.src = finalSrc;

    // Reset fallback visibility
    if (iframeFallback) iframeFallback.classList.add('hidden');

    // Show fallback if it takes too long (might be blocked)
    const fallbackTimeout = setTimeout(() => {
        if (modalLoader.style.display !== 'none' || modalIframe.style.opacity === '0') {
            if (iframeFallback) iframeFallback.classList.remove('hidden');
        }
    }, 6000);

    // Listen for iframe load
    modalIframe.onload = () => {
        clearTimeout(fallbackTimeout);
        modalLoader.style.display = 'none';
        modalIframe.style.opacity = '1';
        // Even if it loads, we hide fallback just in case it was showing
        if (iframeFallback) iframeFallback.classList.add('hidden');
    };

    // If it's a PDF, Chrome might not fire the onload event for the plugin, so we force visibility.
    if (isPdf) {
        setTimeout(() => {
            clearTimeout(fallbackTimeout);
            modalLoader.style.display = 'none';
            modalIframe.style.opacity = '1';
        }, 1000);
    }

    // Show modal
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    modal.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden'; // Prevent background scrolling
}

function closeModal() {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
    modal.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';

    // Reset contents
    modalIframeWrap.classList.remove('hidden');
    if (iframeFallback) iframeFallback.classList.add('hidden');
    const formWrap = document.getElementById('ogb-form-wrap');
    if (formWrap) {
        formWrap.classList.add('hidden');
        formWrap.classList.remove('flex');
    }

    // Reset form
    const form = document.getElementById('ogb-form');
    if (form) form.reset();
    const submitBtn = document.getElementById('ogb-submit-btn');
    if (submitBtn) submitBtn.disabled = true;

    // Reset iframe
    modalIframe.src = 'about:blank';
    modalHeading.textContent = '...';

    const card = document.getElementById('ogb-modal-card');
    if (card) {
        card.classList.remove('w-full', 'h-full', 'rounded-none');
        card.classList.add('w-[min(96vw,1100px)]', 'h-[min(94vh,820px)]', 'rounded-xl');
    }
}

// URL Formatters (Migrated from original PHP snippet)
function ogbEnsurePBIToolbar(url) {
    try {
        var host = new URL(url, window.location.origin).hostname;
        if (!/(\.|^)powerbi\.com$/.test(host)) return url;

        var u = new URL(url, window.location.origin);
        u.searchParams.set('navContentPaneEnabled', 'true');
        u.searchParams.set('filterPaneEnabled', 'true');
        u.searchParams.delete('chromeless');
        u.searchParams.set('displayMode', 'fitToPage');
        return u.toString();
    } catch (e) {
        return url;
    }
}

// Fix Canva /view URLs to /view?embed so they load in iframe
function ogbFixCanvaUrl(url) {
    try {
        if (!url.includes('canva.com')) return url;
        const u = new URL(url);
        // Canva embed requires ?embed parameter
        if (!u.searchParams.has('embed')) u.searchParams.set('embed', '');
        return u.toString();
    } catch (e) {
        return url;
    }
}

// Render a single informe card and handle click → openModal
function renderInformeCard(container, informe) {
    const fileTypeLabels = { pdf: 'PDF', image: 'Imagen', html: 'HTML', url: 'Enlace' };
    const fileTypeBadge = `<span class="text-[10px] font-bold uppercase tracking-wider text-teal-700 bg-teal-50 border border-teal-200 px-2 py-0.5 rounded-full">${fileTypeLabels[informe.fileType] || 'Informe'}</span>`;
    const periodBadge = informe.period ? `<span class="text-[10px] font-medium text-gray-500 bg-gray-100 px-2 py-0.5 rounded-full">${informe.period}</span>` : '';

    const hasAccess = informe.hasAccess !== false; // handle old data
    const restrictedClass = !hasAccess ? 'opacity-75 grayscale-[0.5] border-dashed border-red-200' : 'border-teal-100';

    const pendingRequest = currentUserRequests.find(r => 
        (r.buttonId === informe.id || r.buttonId === informe.title || r.buttonName === informe.title) && 
        (r.status === 'pendiente' || r.status === 'pending')
    );
    const isUnderReview = !!pendingRequest;

    const lockIcon = !hasAccess
        ? (isUnderReview
            ? '<div class="absolute top-2 right-2 text-obelisco-blue bg-blue-50 px-2 py-0.5 rounded-full text-[10px] font-bold border border-blue-200 shadow-sm">En revisión</div>'
            : '<div class="absolute top-2 right-2 text-red-500 bg-red-50 p-1.5 rounded-full border border-red-100"><svg class="w-4 h-4" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clip-rule="evenodd"/></svg></div>')
        : '<div class="absolute top-2 right-2 text-green-600 bg-green-50 p-1.5 rounded-full border border-green-100 shadow-sm" title="Acceso concedido"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" /></svg></div>';

    const html = `
        <a href="#" data-informe-id="${informe.id}" data-informe-url="${informe.url || ''}" data-informe-type="${informe.fileType}" data-access="${hasAccess}"
            class="obelisco-card informe-btn bg-white border-2 rounded-xl p-5 flex flex-col h-full hover:bg-teal-50/40 hover:border-teal-300 transition drop-shadow-sm relative cursor-pointer ${restrictedClass}">
            ${lockIcon}
            <div class="flex items-center mb-3 w-full">
                <div class="h-12 w-12 rounded-lg bg-teal-50 border border-teal-100 flex items-center justify-center flex-shrink-0">
                    <svg class="h-6 w-6 text-teal-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
                    </svg>
                </div>
                <div class="ml-3 flex-grow min-w-0">
                    <div class="flex gap-1 flex-wrap mb-1">
                        <span class="text-[10px] font-black uppercase tracking-widest text-teal-600">INFORME</span>
                        ${fileTypeBadge}
                    </div>
                    <h3 class="text-sm font-bold text-obelisco-dark leading-snug break-words">${informe.title}</h3>
                </div>
            </div>
            ${informe.description ? `<p class="text-obelisco-gray text-xs flex-grow mb-4 line-clamp-2">${informe.description}</p>` : '<div class="flex-grow"></div>'}
            <div class="flex justify-between items-center w-full mt-auto">
                <div class="flex gap-1">${periodBadge}</div>
                <span class="text-teal-600 font-bold text-sm flex items-center">
                    ${hasAccess ? 'Ver informe' : (isUnderReview ? 'Pendiente' : 'Solicitar acceso')}
                    <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 ml-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
                    </svg>
                </span>
            </div>
        </a>
    `;

    container.insertAdjacentHTML('beforeend', html);

    const card = container.lastElementChild;
    card.addEventListener('click', (e) => {
        e.preventDefault();
        if (hasAccess) {
            recordUserActivity(informe.title, true);
            openInformeModal(informe);
        } else {
            recordUserActivity(informe.title, false);
            openAccessRequestForm(informe.title, informe.id);
        }
    });
}

function openInformeModal(informe) {
    if (!informe.url) {
        alert('Este informe no tiene una URL disponible.');
        return;
    }

    let url = informe.url;

    // Apply URL fixes depending on type
    url = ogbFixCanvaUrl(url);
    url = ogbFixSheetUrl(url);
    url = ogbFixLookerUrl(url);

    openModal(informe.title, url);
}

function openAccessRequestForm(title, buttonId) {
    const mainModalEl = document.getElementById('ogb-modal');
    const iframeWrap = document.getElementById('ogb-iframe-wrap');
    const formWrap = document.getElementById('ogb-form-wrap');
    
    if (!mainModalEl || !formWrap) return;

    // Set heading
    const modalHeading = document.getElementById('ogb-heading');
    if (modalHeading) modalHeading.textContent = "Solicitar Acceso";

    // Show Form, Hide Iframe
    iframeWrap?.classList.add('hidden');
    formWrap.classList.remove('hidden');
    formWrap.classList.add('flex');

    // Show Main Modal
    mainModalEl.classList.remove('hidden');
    mainModalEl.classList.add('flex');
    document.body.style.overflow = 'hidden';

    // Fill fields
    const userField = document.getElementById('ogb-form-user');
    const buttonNameField = document.getElementById('ogb-form-button-name');

    // Store buttonId in hidden field
    let existingHidden = document.getElementById('ogb-form-button-id');
    if (!existingHidden) {
        existingHidden = document.createElement('input');
        existingHidden.type = 'hidden';
        existingHidden.id = 'ogb-form-button-id';
        document.getElementById('ogb-form')?.appendChild(existingHidden);
    }
    existingHidden.value = buttonId;

    if (userField) userField.value = auth.currentUser ? auth.currentUser.email : 'No identificado';
    if (buttonNameField) buttonNameField.value = title;

    // Reset form state
    const form = document.getElementById('ogb-form');
    if (form) {
        const motivoSelect = document.getElementById('ogb-form-motivo-select');
        const motivoDetalle = document.getElementById('ogb-form-motivo-detalle');
        const motivoDetalleWrap = document.getElementById('ogb-form-motivo-detalle-wrap');
        const termsCheck = document.getElementById('ogb-form-terms');

        if (motivoSelect) motivoSelect.value = '';
        if (motivoDetalle) motivoDetalle.value = '';
        if (motivoDetalleWrap) motivoDetalleWrap.classList.add('hidden');
        if (termsCheck) termsCheck.checked = false;
    }

    // Disable submit until a motivo is selected
    const submitBtn = document.getElementById('ogb-submit-btn');
    if (submitBtn) submitBtn.disabled = true;

    // Wire radio buttons directly — more reliable than bubbling from a scrollable container
    document.querySelectorAll('input[name="ogb-form-motivo"]').forEach(radio => {
        radio.onchange = () => {
            const btn = document.getElementById('ogb-submit-btn');
            if (btn) btn.disabled = false;
        };
    });

    // Populate T&C acceptance notice spans
    const tcVersionSpan = document.getElementById('ogb-tc-version');
    const tcDateSpan = document.getElementById('ogb-tc-date');
    if (tcVersionSpan) tcVersionSpan.textContent = currentUserAcceptedTCVersion || '—';
    if (tcDateSpan) {
        let dateStr = '—';
        if (currentUserAcceptedTCTimestamp) {
            try { dateStr = new Date(currentUserAcceptedTCTimestamp).toLocaleDateString('es-AR'); } catch (_) {}
        }
        tcDateSpan.textContent = dateStr;
    }

    // Ensure Terms Modal is HIDDEN at the start
    const tModal = document.getElementById('terms-modal');
    if (tModal) {
        tModal.classList.add('hidden');
        tModal.classList.remove('flex');
    }
}

// Terms iframe scroll detection is handled in openTermsModalForAcceptance() / attachTermsScrollDetection() below.
const closeTermsBtn = document.getElementById('close-terms-btn');



// 1. Intercept checkbox click → open Terms modal instead of checking directly
document.getElementById('ogb-form-terms')?.addEventListener('click', (e) => {
    const checkbox = e.target;
    // Only open if the user is attempting to CHECK the box
    if (checkbox.checked) {
        // We set it to false temporarily until terms are accepted via modal
        checkbox.checked = false; 
        openTermsModalForAcceptance();
    } else {
        // If unchecking, disable the submit button
        const submitBtn = document.getElementById('ogb-submit-btn');
        if (submitBtn) submitBtn.disabled = true;
    }
});

function openTermsModalForAcceptance(readOnly = false) {
    const tModal = document.getElementById('terms-modal');
    const confirmBtn = document.getElementById('confirm-terms-btn');
    if (!tModal) return;

    // Reset confirm button to disabled state or hide it if readOnly
    if (confirmBtn) {
        if (readOnly) {
            confirmBtn.classList.add('hidden');
        } else {
            confirmBtn.classList.remove('hidden');
            confirmBtn.disabled = true;
            confirmBtn.textContent = 'Confirmar Aceptación (Desplácese hasta el final)';
            confirmBtn.className = 'flex-1 sm:order-2 bg-gray-300 text-gray-500 font-bold py-3 px-6 rounded-xl transition cursor-not-allowed';
        }
    }

    tModal.classList.remove('hidden');
    tModal.classList.add('flex');

    // Attach scroll listener to iframe after it loads
    const iframe = document.getElementById('terms-iframe');
    if (iframe) {
        // Re-attach onload every time modal opens to reset scroll state
        iframe.onload = () => attachTermsScrollDetection(confirmBtn);
        // If already loaded (src hasn't changed), trigger manually
        try {
            const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
            if (iframeDoc && iframeDoc.readyState === 'complete') {
                attachTermsScrollDetection(confirmBtn);
            }
        } catch(e) {
            // cross-origin fallback
            if (confirmBtn) {
                confirmBtn.disabled = false;
                confirmBtn.textContent = 'Confirmar Aceptación ✓';
                confirmBtn.className = 'flex-1 sm:order-2 bg-obelisco-blue hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-xl transition cursor-pointer';
            }
        }
    }
}

function attachTermsScrollDetection(confirmBtn) {
    const iframe = document.getElementById('terms-iframe');
    if (!iframe) return;

    let iframeWin, iframeDoc;
    try {
        iframeWin = iframe.contentWindow;
        iframeDoc = iframe.contentDocument || iframeWin.document;
    } catch(e) {
        // If cross-origin, enable immediately
        if (confirmBtn) enableConfirmBtn(confirmBtn);
        return;
    }

    // Inject CSS to hide Word draft comments
    try {
        const style = iframeDoc.createElement('style');
        style.textContent = `
            div[style*="mso-element:comment"],
            .msocomtxt, .msocomanchor { display: none !important; }
        `;
        iframeDoc.head?.appendChild(style);

        // Hide paragraphs with draft notes
        const draftPatterns = ['Pablo', 'jajajaja', 'Art. 8', 'estas son las opciones', 'Detallar en caso', 'No me gusta'];
        iframeDoc.querySelectorAll('p').forEach(p => {
            if (draftPatterns.some(pattern => p.textContent.includes(pattern)) && p.textContent.length < 300) {
                p.style.display = 'none';
            }
        });
    } catch(e) { /* silently fail on cross-origin */ }

    const checkAtBottom = () => {
        try {
            const docEl = iframeDoc.documentElement;
            const body = iframeDoc.body;
            const scrollTop = iframeWin.pageYOffset || docEl.scrollTop || body.scrollTop || 0;
            const windowH = iframeWin.innerHeight || docEl.clientHeight || body.clientHeight || 0;
            const totalH = Math.max(body.scrollHeight, docEl.scrollHeight, body.offsetHeight, docEl.offsetHeight);
            const atBottom = (scrollTop + windowH) >= (totalH - 200);
            if (atBottom && confirmBtn?.disabled) {
                enableConfirmBtn(confirmBtn);
                clearInterval(pollInterval);
                iframeWin.removeEventListener('scroll', checkAtBottom);
            }
        } catch(e) {
            enableConfirmBtn(confirmBtn);
            clearInterval(pollInterval);
        }
    };

    iframeWin?.addEventListener('scroll', checkAtBottom);
    const pollInterval = setInterval(checkAtBottom, 500);
    // Initial check (document might already be short)
    setTimeout(checkAtBottom, 800);
}

function enableConfirmBtn(btn) {
    if (!btn) return;
    btn.disabled = false;
    btn.textContent = 'Confirmar Aceptación ✓';
    btn.className = 'flex-1 sm:order-2 bg-obelisco-blue hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-xl transition cursor-pointer shadow-md';
}

// 2. "Confirmar Aceptación" → close modal, check checkbox, enable submit
closeTermsBtn?.addEventListener('click', () => {
    if (closeTermsBtn.disabled) return;
    const tModal = document.getElementById('terms-modal');
    tModal?.classList.add('hidden');
    tModal?.classList.remove('flex');

    const formTermsCheck = document.getElementById('ogb-form-terms');
    if (formTermsCheck) {
        formTermsCheck.checked = true;
    }
    const submitBtn = document.getElementById('ogb-submit-btn');
    if (submitBtn) submitBtn.disabled = false;
});

// 3. Cancel / close X / overlay / Cerrar btn → just close modal, don't check checkbox
['close-terms-x', 'cancel-terms-btn', 'close-terms-overlay', 'close-terms-btn'].forEach(id => {
    document.getElementById(id)?.addEventListener('click', async () => {
        const tModal = document.getElementById('terms-modal');
        if (tModal?.dataset.reacceptance === 'true') {
            delete tModal.dataset.reacceptance;
            tModal.classList.add('hidden');
            tModal.classList.remove('flex');
            await signOut(auth);
            return;
        }
        tModal?.classList.add('hidden');
        tModal?.classList.remove('flex');
    });
});

function ogbFixLookerUrl(url) {
    try {
        var u = new URL(url, window.location.origin);
        if (u.hostname.includes('lookerstudio.google.com')) {
            if (!/\/embed\//.test(u.pathname)) {
                u.pathname = u.pathname.replace('/reporting/', '/embed/reporting/');
            }
        }
        return u.toString();
    } catch (e) {
        return url.replace('/reporting/', '/embed/reporting/');
    }
}

function ogbFixSheetUrl(url) {
    try {
        var u = new URL(url, window.location.origin);
        var h = u.hostname;

        // Google Sheets
        if (h.includes('docs.google.com') && u.pathname.includes('/spreadsheets/')) {
            if (!u.pathname.includes('/pubhtml')) {
                var m = u.pathname.match(/\/spreadsheets\/d\/([^/]+)/);
                var id = m ? m[1] : null;
                var gid = u.searchParams.get('gid') || (u.hash.match(/gid=(\d+)/) || [])[1] || '0';
                if (id) {
                    u.pathname = '/spreadsheets/d/' + id + '/pubhtml';
                    u.search = '';
                    u.hash = '';
                    u.searchParams.set('gid', gid);
                    u.searchParams.set('single', 'true');
                    u.searchParams.set('widget', 'true');
                    u.searchParams.set('headers', 'false');
                }
            }
            return u.toString();
        }
        return url;
    } catch (e) {
        return url;
    }
}

// Event Listeners
loginBtn?.addEventListener('click', handleLogin);
logoutBtn?.addEventListener('click', handleLogout);

// Modal Event Listeners
document.addEventListener('click', (e) => {
    // Click on dashboard button
    const btn = e.target.closest('.dashboard-btn');
    if (btn) {
        e.preventDefault();
        const hasAccess = btn.getAttribute('data-access') !== 'false';
        const title = btn.getAttribute('data-heading');
        const id = btn.getAttribute('data-button-id');

        if (hasAccess) {
            const url = btn.getAttribute('data-iframe');
            
            // Record activity and wait for it
            recordUserActivity(title, true);

            const newTab = btn.getAttribute('data-new-tab') === 'true';
            if (newTab && url) {
                window.open(url, '_blank');
            } else {
                openModal(title, url);
            }
        } else {
            recordUserActivity(title, false);
            openAccessRequestForm(title, id);
        }
        return;
    }

    // Click to close modal
    if (e.target.closest('[data-ogb-close]')) {
        closeModal();
    }
});

// Fullscreen toggle via button
fullScreenBtn?.addEventListener('click', () => {
    const card = document.getElementById('ogb-modal-card');
    if (card) {
        const isFull = card.classList.contains('w-full');
        if (isFull) {
            // Revert back
            card.classList.remove('w-full', 'h-full', 'rounded-none');
            card.classList.add('w-[min(96vw,1100px)]', 'h-[min(94vh,820px)]', 'rounded-xl');
            fullScreenBtn.classList.remove('bg-gray-200');
        } else {
            // Expand to full screen
            card.classList.add('w-full', 'h-full', 'rounded-none');
            card.classList.remove('w-[min(96vw,1100px)]', 'h-[min(94vh,820px)]', 'rounded-xl');
            fullScreenBtn.classList.add('bg-gray-200');
        }
    }
});

// Esc to close modal
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.classList.contains('hidden')) {
        closeModal();
    }
});

// Form Listener
document.getElementById('ogb-form')?.addEventListener('submit', handleAccessRequest);

// NOTE: ogb-form-terms click is handled by the interceptor in the TERMS MODAL FLOW section above.
// NOTE: open-terms-modal is no longer used (terms open via checkbox click-intercept).


// 4. Lógica de Modales Legales (Términos y Privacidad)
const termsModal = document.getElementById('terms-modal');
const privacyModal = document.getElementById('privacy-modal');

// Selectores para botones de apertura del modal de términos (desde el footer y otros lugares)
const termsTriggers = ['view-terms-btn']; // 'open-terms-modal' has its own listener above
const privacyTriggers = ['view-privacy-btn', 'open-privacy-modal'];

termsTriggers.forEach(id => {
    document.getElementById(id)?.addEventListener('click', (e) => {
        e.preventDefault();
        termsModal?.classList.remove('hidden');
        termsModal?.classList.add('flex');
    });
});

// --- Contact Form System ---
// const SPARKPOST_KEY = 'e4cda244e44a44b47b92cce48e7befc7f1a88444';
const ADMIN_EMAIL = 'datos@riocuarto.gov.ar';

const contactModal = document.getElementById('contact-modal');
const openContactBtn = document.getElementById('open-contact-btn');
const closeContactBtn = document.getElementById('close-contact-modal');
const closeContactOverlay = document.getElementById('close-contact-overlay');
const contactForm = document.getElementById('contact-form');

function openContactModal(e) {
    e?.preventDefault();
    contactModal?.classList.remove('hidden');
    contactModal?.classList.add('flex');
    document.body.style.overflow = 'hidden';

    // Autofill user info if logged in
    if (auth.currentUser) {
        const nameField = document.getElementById('contact-name');
        const emailField = document.getElementById('contact-email');
        if (nameField) nameField.value = auth.currentUser.displayName || (auth.currentUser.email ? auth.currentUser.email.split('@')[0] : '');
        if (emailField) emailField.value = auth.currentUser.email || '';
    }
}

openContactBtn?.addEventListener('click', openContactModal);

// Botón Contacto del encabezado (header)
const openContactBtnHeader = document.getElementById('open-contact-btn-header');
openContactBtnHeader?.addEventListener('click', openContactModal);

// Dynamic Contact Form Logic
const contactTypeSelect = document.getElementById('contact-type');
const contactReasonWrap = document.getElementById('contact-reason-wrap');
const contactReasonSelect = document.getElementById('contact-reason');

const REASONS = {
    incident: [
        { val: "Uso indebido de la plataforma", label: "🚨 Uso indebido de la plataforma" },
        { val: "Acceso no autorizado detectado", label: "🔒 Acceso no autorizado detectado" },
        { val: "Incidente de seguridad", label: "⚠️ Incidente de seguridad" },
        { val: "Otros (Incidente)", label: "Otros" }
    ],
    general: [
        { val: "Sugerencia / Mejora", label: "💡 Sugerencia / Mejora" },
        { val: "Error en visualización de datos", label: "📊 Error en visualización de datos" },
        { val: "Consulta técnica", label: "🔧 Consulta técnica" },
        { val: "Otros (Consulta)", label: "Otros" }
    ]
};

contactTypeSelect?.addEventListener('change', (e) => {
    const type = e.target.value;
    if (!type) {
        contactReasonWrap?.classList.add('hidden');
        return;
    }

    // Populate reasons
    contactReasonSelect.innerHTML = '<option value="" disabled selected>Seleccioná un motivo específico</option>';
    REASONS[type].forEach(r => {
        const opt = document.createElement('option');
        opt.value = r.val;
        opt.textContent = r.label;
        contactReasonSelect.appendChild(opt);
    });

    contactReasonWrap?.classList.remove('hidden');
});

const closeContact = () => {
    contactModal?.classList.add('hidden');
    contactModal?.classList.remove('flex');
    document.body.style.overflow = '';
};

closeContactBtn?.addEventListener('click', closeContact);
closeContactOverlay?.addEventListener('click', closeContact);

if (contactForm) {
    contactForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const submitBtn = document.getElementById('submit-contact-btn');
        const originalText = submitBtn.innerHTML;
        
        const name = document.getElementById('contact-name').value;
        const email = document.getElementById('contact-email').value;
        const type = document.getElementById('contact-type').value;
        const reason = document.getElementById('contact-reason').value;
        const message = document.getElementById('contact-message').value;

        submitBtn.disabled = true;
        submitBtn.innerHTML = '<span>Enviando...</span>';

        try {
            await callApi('/api/contactos', 'POST', {
                name: name.trim(),
                email: email.trim().toLowerCase(),
                type: type,
                reason: reason,
                message: message.trim()
            });

            alert("¡Mensaje enviado con éxito! Nos pondremos en contacto pronto.");
            contactForm.reset();
            contactReasonWrap?.classList.add('hidden');
            closeContact();
        } catch (error) {
            console.error("Error sending contact:", error);
            alert("Hubo un error al enviar el mensaje. Detalle: " + error.message);
        } finally {
            submitBtn.disabled = false;
            submitBtn.innerHTML = originalText;
        }
    });
}

/*
async function sendSecurityEmail(name, email, reason, message) {
    const isUrgent = reason.toLowerCase().includes('seguridad') || reason.toLowerCase().includes('autorizado');
    const subject = `${isUrgent ? '🚨 URGENTE: ' : ''}Nuevo reporte de ${reason}`;
    
    const body = {
        options: { sandbox: false },
        content: {
            from: 'notificaciones@riocuarto.gov.ar',
            subject: subject,
            html: `
                <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #eee; border-radius: 12px; overflow: hidden;">
                    <div style="background: #0072BB; padding: 20px; color: white;">
                        <h2 style="margin: 0;">Observatorio de Gestión</h2>
                        <p style="margin: 5px 0 0 0; opacity: 0.8;">Sistema de Notificaciones de Seguridad</p>
                    </div>
                    <div style="padding: 30px;">
                        <p>Se ha recibido una nueva notificación desde el portal:</p>
                        <table style="width: 100%; border-collapse: collapse;">
                            <tr><td style="padding: 10px 0; font-weight: bold; width: 120px;">Remitente:</td><td>${name}</td></tr>
                            <tr><td style="padding: 10px 0; font-weight: bold;">Email:</td><td>${email}</td></tr>
                            <tr><td style="padding: 10px 0; font-weight: bold;">Categoría:</td><td><span style="color: ${isUrgent ? '#e53e3e' : '#2b6cb0'};">${reason}</span></td></tr>
                        </table>
                        <div style="margin-top: 20px; padding: 15px; background: #f8f9fa; border-radius: 8px;">
                            <strong>Detalle del mensaje:</strong>
                            <p style="white-space: pre-wrap;">${message}</p>
                        </div>
                        <p style="font-size: 12px; color: #718096; margin-top: 30px; text-align: center;">
                            Este es un correo automático generado por el sistema de contacto del OGM.
                        </p>
                    </div>
                </div>
            `
        },
        recipients: [{ address: ADMIN_EMAIL }]
    };

    try {
        // Sparkpost US/EU check - Trying both if one fails or using US as default
        const endpoint = 'https://api.sparkpost.com/api/v1/transmissions';
        
        console.log("Intentando enviar mail vía Sparkpost...");
        const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Authorization': SPARKPOST_KEY,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(body)
        });
        
        const result = await response.json();
        if (!response.ok) {
            console.error("Sparkpost API Error:", result);
            throw new Error(result.errors ? result.errors[0].message : "Error desconocido de Sparkpost");
        }
        console.log("Sparkpost Success:", result);
    } catch (e) {
        console.error("Error en sendSecurityEmail:", e);
        // If it's a CORS error, we can't do much from frontend directly without a proxy
        if (e.message.includes('fetch')) {
            console.warn("Posible error de CORS. Sparkpost no admite llamadas directas desde el navegador sin configuración previa.");
        }
        throw e;
    }
}
*/

// Update trigger logic for Terms & Conditions (Footer and other buttons)
document.getElementById('view-terms-footer')?.addEventListener('click', (e) => {
    e.preventDefault();
    openTermsOnly();
});



// Final cleanup of Terms flow conflicts
function openTermsOnly() {
    const footerModal = document.getElementById('terms-footer-modal');
    if (footerModal) {
        footerModal.classList.remove('hidden');
        footerModal.classList.add('flex');
    }
}

// Motivo "Otra" dynamic visibility for Radio Buttons + enable submit on selection
document.addEventListener('change', (e) => {
    if (e.target.name === 'ogb-form-motivo') {
        const wrap = document.getElementById('ogb-form-motivo-detalle-wrap');
        const textarea = document.getElementById('ogb-form-motivo-detalle');
        if (e.target.value === 'Otra') {
            wrap?.classList.remove('hidden');
            textarea?.setAttribute('required', 'required');
            textarea?.focus();
        } else {
            wrap?.classList.add('hidden');
            textarea?.removeAttribute('required');
        }
        const submitBtn = document.getElementById('ogb-submit-btn');
        if (submitBtn) submitBtn.disabled = false;
    }
});

privacyTriggers.forEach(id => {
    document.getElementById(id)?.addEventListener('click', (e) => {
        e.preventDefault();
        privacyModal?.classList.remove('hidden');
        privacyModal?.classList.add('flex');
    });
});
// --- Dynamic File Upload for Representante Legal ---
const regOrgRoleSelect = document.getElementById('registration-org-role');
if (regOrgRoleSelect) {
    regOrgRoleSelect.addEventListener('change', () => {
        if (regOrgRoleSelect.value === 'Representante legal / Apoderado/a') {
            document.getElementById('registration-extra-docs')?.classList.remove('hidden');
        } else {
            document.getElementById('registration-extra-docs')?.classList.add('hidden');
        }
    });
}

// --- Registration Form Submission (Refactored) ---
if (registrationForm) {
    const regGroupSelect = document.getElementById('reg-group');
    const regTypeSelect = document.getElementById('reg-org-type');
    const regRoleSelect = document.getElementById('reg-org-role');
    const regExtraFields = document.getElementById('reg-extra-fields');
    const regRoleDetailWrap = document.getElementById('reg-role-detail-wrap');
    const regNoExpiryCheck = document.getElementById('reg-no-expiry');
    const regExpiryDateInput = document.getElementById('reg-expiry-date');

    function updateCuitFieldState() {
        const group = regGroupSelect.value;
        const orgType = regTypeSelect.value;
        const role = regRoleSelect.value;
        const config = REG_FORM_CONFIG[group];
        const regCuitInput = document.getElementById('reg-cuit');

        if (!regCuitInput) return;

        if (config && config.requiresCUIT.includes(role)) {
            if (group === "Sector Público Estatal" && orgType === "Municipalidad de Río Cuarto") {
                regCuitInput.value = "30999050685";
                regCuitInput.disabled = true;
                regCuitInput.classList.add('bg-gray-100', 'cursor-not-allowed');
            } else {
                if (regCuitInput.disabled) {
                    regCuitInput.disabled = false;
                    regCuitInput.value = "";
                    regCuitInput.classList.remove('bg-gray-100', 'cursor-not-allowed');
                }
            }
        } else {
            regCuitInput.disabled = false;
            regCuitInput.classList.remove('bg-gray-100', 'cursor-not-allowed');
        }
    }

    // 1. Group Change -> Populate Types
    regGroupSelect?.addEventListener('change', () => {
        const group = regGroupSelect.value;
        const config = REG_FORM_CONFIG[group];
        
        regTypeSelect.innerHTML = '<option value="" disabled selected>Seleccioná una opción</option>';
        config.types.forEach(t => {
            const opt = document.createElement('option');
            opt.value = t;
            opt.textContent = t;
            regTypeSelect.appendChild(opt);
        });
        
        regTypeSelect.disabled = false;
        regRoleSelect.disabled = true;
        regRoleSelect.innerHTML = '<option value="" disabled selected>Primero seleccioná el tipo de organización</option>';
        regExtraFields.classList.add('hidden');
        regRoleDetailWrap.classList.add('hidden');
        updateCuitFieldState();
    });

    // 2. Type Change -> Populate Roles
    regTypeSelect?.addEventListener('change', () => {
        const group = regGroupSelect.value;
        const config = REG_FORM_CONFIG[group];
        
        regRoleSelect.innerHTML = '<option value="" disabled selected>Seleccioná tu rol</option>';
        config.roles.forEach(r => {
            const opt = document.createElement('option');
            opt.value = r;
            opt.textContent = r;
            regRoleSelect.appendChild(opt);
        });
        
        regRoleSelect.disabled = false;
        regExtraFields.classList.add('hidden');
        regRoleDetailWrap.classList.add('hidden');
        updateCuitFieldState();
    });

    // 3. Role Change -> Conditional Fields
    regRoleSelect?.addEventListener('change', () => {
        const group = regGroupSelect.value;
        const role = regRoleSelect.value;
        const config = REG_FORM_CONFIG[group];

        // CUIT & Expiry
        if (config.requiresCUIT.includes(role)) {
            regExtraFields.classList.remove('hidden');
        } else {
            regExtraFields.classList.add('hidden');
        }

        // Role Detail
        if (role === 'Otro') {
            regRoleDetailWrap.classList.remove('hidden');
            document.getElementById('reg-role-detail').required = true;
        } else {
            regRoleDetailWrap.classList.add('hidden');
            document.getElementById('reg-role-detail').required = false;
        }
        updateCuitFieldState();
    });

    // 4. No Expiry Check logic
    regNoExpiryCheck?.addEventListener('change', () => {
        if (regNoExpiryCheck.checked) {
            regExpiryDateInput.disabled = true;
            regExpiryDateInput.value = '';
            regExpiryDateInput.required = false;
        } else {
            regExpiryDateInput.disabled = false;
            regExpiryDateInput.required = true;
        }
    });

    // logic for DNI (only numbers)
    const regDniInput = document.getElementById('reg-dni');
    regDniInput?.addEventListener('input', (e) => {
        e.target.value = e.target.value.replace(/[^0-9]/g, '');
    });

    // --- T&C Mandatory Scroll Logic ---
    const termsModal = document.getElementById('terms-modal');
    const termsContent = document.getElementById('terms-content-container');
    const termsBody = document.getElementById('terms-content-body');
    const confirmTermsBtn = document.getElementById('confirm-terms-btn');
    const regTermsCheck = document.getElementById('reg-terms');
    const regSubmitBtn = document.getElementById('reg-submit-btn');

    let termsLoaded = false;

    // Helper to open modal (shared by link and checkbox)
    async function openTermsFlow() {
        console.log("Opening terms modal...");
        termsModal?.classList.remove('hidden');
        termsModal?.classList.add('flex');
        
        if (confirmTermsBtn) {
            confirmTermsBtn.classList.add('hidden');
            confirmTermsBtn.disabled = true;
            delete confirmTermsBtn.dataset.confirmed; // Clear previous confirmation
        }
        if (termsContent) termsContent.scrollTop = 0;

        if (!termsLoaded && termsBody) {
            try {
                termsBody.innerHTML = '<p class="text-center py-10 text-gray-400">Cargando...</p>';
                const response = await fetch('normativas/Terminos/Terminos_y_Condiciones_OGM_RioCuarto_v1.htm');
                if (!response.ok) throw new Error("No se pudo cargar el documento.");
                let html = await response.text();
                const parser = new DOMParser();
                const doc = parser.parseFromString(html, 'text/html');
                const bodyContent = doc.body ? doc.body.innerHTML : html;
                termsBody.innerHTML = bodyContent;
                termsLoaded = true;
            } catch (err) {
                console.error("Error loading terms:", err);
                termsBody.innerHTML = `<p class="text-center py-10 text-red-500">Error al cargar los términos. Por favor intente más tarde.</p>`;
            }
        }
    }

    // Use event delegation for opening the terms (Link or Checkbox)
    document.addEventListener('click', async (e) => {
        const target = e.target;
        
        // Match link OR the checkbox itself
        if (target.id === 'open-terms-link' || target.closest('#open-terms-link') || target.id === 'reg-terms') {
            
            // If they clicked the checkbox, don't let it check yet
            if (target.id === 'reg-terms' && !confirmTermsBtn?.dataset.confirmed) {
                e.preventDefault();
                target.checked = false;
            }
            
            if (!confirmTermsBtn?.dataset.confirmed) {
                await openTermsFlow();
            }
        }
    });

    // Detect scroll in terms container
    termsContent?.addEventListener('scroll', () => {
        const { scrollTop, scrollHeight, clientHeight } = termsContent;
        if (scrollHeight > clientHeight && (scrollTop + clientHeight >= scrollHeight - 60)) {
            if (confirmTermsBtn && confirmTermsBtn.classList.contains('hidden')) {
                confirmTermsBtn.classList.remove('hidden');
                confirmTermsBtn.disabled = false;
            }
        }
    }, { passive: true });

    confirmTermsBtn?.addEventListener('click', () => {
        if (confirmTermsBtn) confirmTermsBtn.dataset.confirmed = "true";
        
        if (regTermsCheck) {
            regTermsCheck.checked = true;
        }
        if (regSubmitBtn) {
            regSubmitBtn.disabled = false;
            regSubmitBtn.classList.remove('bg-gray-400', 'disabled:bg-gray-400');
            regSubmitBtn.classList.add('bg-obelisco-blue');
        }
        termsModal?.classList.add('hidden');
        termsModal?.classList.remove('flex');
    });

    closeTermsBtn?.addEventListener('click', () => {
        termsModal?.classList.add('hidden');
        termsModal?.classList.remove('flex');
    });

    // Prevent manual checking of the box to force the modal flow
    regTermsCheck?.addEventListener('click', (e) => {
        if (!regTermsCheck.checked || !confirmTermsBtn?.dataset.confirmed) {
             // If we want to strictly forbid manual check:
             // e.preventDefault();
             // openTermsLink.click();
        }
    });

    if (regTermsCheck) {
        regTermsCheck.addEventListener('change', () => {
            regSubmitBtn.disabled = !regTermsCheck.checked;
        });
    }

    async function getUserIP() {
        try {
            const response = await fetch('https://api.ipify.org?format=json');
            const data = await response.json();
            return data.ip;
        } catch (e) {
            console.error("Error fetching IP:", e);
            return "unknown";
        }
    }

    registrationForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const user = auth.currentUser;
        if (!user) return;

        const group = regGroupSelect.value;
        const orgType = regTypeSelect.value;
        const orgName = document.getElementById('reg-org-name').value;
        const orgRole = regRoleSelect.value;
        const dni = regDniInput.value;

        const roleDetail = document.getElementById('reg-role-detail').value;
        const cuit = document.getElementById('reg-cuit').value;
        const expiryDate = regExpiryDateInput.value;
        const noExpiry = regNoExpiryCheck.checked;

        // Validation for DNI
        if (!dni) {
            alert('Por favor completá tu DNI / CUIL.');
            return;
        }

        // Validation for conditional fields
        const config = REG_FORM_CONFIG[group];
        if (config.requiresCUIT.includes(orgRole)) {
            if (!cuit) {
                alert('Por favor completá el CUIT de la organización.');
                return;
            }
            if (!noExpiry && !expiryDate) {
                alert('Por favor seleccioná una fecha de vencimiento o marcá "No aplica".');
                return;
            }
        }

        try {
            regSubmitBtn.disabled = true;
            regSubmitBtn.textContent = 'Guardando...';

            const userEmail = user.email.toLowerCase();

            // Fetch T&C Version from MySQL
            const tcRes = await fetch('/api/config/terms-version');
            const tcData = await tcRes.json();
            const currentTCVersion = tcData.version || "1";
            const userIP = await getUserIP();

            let legalDocURL = null;
            const legalFileInput = document.getElementById('reg-legal-file');
            if (!document.getElementById('reg-legal-file-wrap').classList.contains('hidden') && legalFileInput?.files[0]) {
                const file = legalFileInput.files[0];
                const storageRef = ref(storage, `legal_docs/${userEmail}_${Date.now()}_${file.name}`);
                const snapshot = await uploadBytes(storageRef, file);
                legalDocURL = await getDownloadURL(snapshot.ref);
            }

            const registrationData = {
                email: user.email.toLowerCase(),
                name: user.displayName || user.email.split('@')[0],
                dni: dni,
                photoURL: user.photoURL || '',
                orgGroup: group,
                orgType,
                orgName,
                orgRole,
                orgRoleDetail: orgRole === 'Otro' ? roleDetail : '',
                cuit: config.requiresCUIT.includes(orgRole) ? cuit : '',
                expiryDate: (config.requiresCUIT.includes(orgRole) && !noExpiry) ? expiryDate : (noExpiry ? 'No aplica' : ''),
                profileCompleted: true,
                acceptedTCVersion: currentTCVersion,
                acceptedTCTimestamp: new Date().toISOString(),
                acceptedTCIP: userIP,
                updatedAt: new Date().toISOString(),
                ...(legalDocURL ? { legalDocURL } : {})
            };

            await callApi('/api/perfil', 'POST', {
                full_name: registrationData.name,
                dni: registrationData.dni,
                sector_group: registrationData.orgGroup,
                organization_type: registrationData.orgType,
                organization_name: registrationData.orgName,
                role_position: registrationData.orgRole,
                role_detail: registrationData.orgRoleDetail,
                cuit: registrationData.cuit,
                expiry_date: registrationData.expiryDate === 'No aplica' ? null : registrationData.expiryDate,
                legal_file_url: registrationData.legalDocURL || null,
                terms_accepted_version: registrationData.acceptedTCVersion,
                terms_accepted_date: registrationData.acceptedTCTimestamp
            });

            // Audit Log in consent_logs (MySQL)
            try {
                await callApi('/api/rce', 'POST', {
                    user_email: userEmail,
                    user_name: registrationData.name,
                    dni: dni,
                    terms_version: currentTCVersion
                });
            } catch (auditErr) {
                console.warn("Audit log failed", auditErr);
            }

            // Enviar email de bienvenida con T&C adjuntos
            try {
                await callApi('/api/enviar-bienvenida', 'POST', {
                    full_name: registrationData.name,
                    email: userEmail
                });
                console.log('[Email] Correo de bienvenida enviado exitosamente.');
            } catch (emailErr) {
                console.warn('[Email] No se pudo enviar el correo de bienvenida:', emailErr);
                // No bloquear el registro si falla el envío del email
            }

            registrationModal.classList.add('hidden');
            registrationModal.classList.remove('flex');
            alert('¡Perfil completado con éxito!');
            
            await loadUserPermissions(user);

        } catch (error) {
            console.error('Error updating profile:', error);
            alert('Hubo un error al guardar tu información: ' + (error.code || error.message));
            regSubmitBtn.disabled = false;
            regSubmitBtn.textContent = 'Guardar y Continuar';
        }
    });
}

// --- T&C Re-acceptance Modal Flow ---
async function showTCReacceptanceModal(newVersion) {
    const termsModal = document.getElementById('terms-modal');
    const termsLabel = document.querySelector('.tc-version-label');
    if (termsLabel) termsLabel.textContent = newVersion;

    if (!termsModal) return;

    // Update modal title
    const modalTitle = termsModal.querySelector('h3');
    if (modalTitle) modalTitle.textContent = 'Actualización de Términos y Condiciones';

    // Load the terms document
    const termsBody = document.getElementById('terms-content-body');
    const termsContent = document.getElementById('terms-content-container');
    if (termsBody) {
        termsBody.innerHTML = '<p class="text-center py-10 text-gray-400">Cargando términos...</p>';
        if (termsContent) termsContent.scrollTop = 0;
        try {
            const response = await fetch('normativas/Terminos/Terminos_y_Condiciones_OGM_RioCuarto_v1.htm');
            if (!response.ok) throw new Error('No se pudo cargar el documento.');
            const html = await response.text();
            const parser = new DOMParser();
            const parsed = parser.parseFromString(html, 'text/html');
            termsBody.innerHTML = parsed.body ? parsed.body.innerHTML : html;
        } catch (err) {
            termsBody.innerHTML = '<p class="text-center py-10 text-red-500">Error al cargar los términos. Por favor intente más tarde.</p>';
        }
    }

    termsModal.classList.remove('hidden');
    termsModal.classList.add('flex');
    termsModal.dataset.reacceptance = 'true';

    // Reset confirm button: hidden until user scrolls to bottom
    const confirmBtn = document.getElementById('confirm-terms-btn');
    if (confirmBtn) {
        confirmBtn.classList.add('hidden');
        confirmBtn.disabled = true;
        confirmBtn.textContent = 'Confirmar Lectura ✅';
        delete confirmBtn.dataset.confirmed;
    }

    // Scroll detection: reveal confirm button when reaching the bottom
    const termsContentEl = document.getElementById('terms-content-container');
    function onReacceptanceScroll() {
        if (!termsContentEl || !confirmBtn) return;
        const { scrollTop, scrollHeight, clientHeight } = termsContentEl;
        if (scrollHeight > clientHeight && (scrollTop + clientHeight >= scrollHeight - 60)) {
            confirmBtn.classList.remove('hidden');
            confirmBtn.disabled = false;
        }
    }
    termsContentEl?.addEventListener('scroll', onReacceptanceScroll, { passive: true });

    // Override confirm button to save re-acceptance
    confirmBtn.onclick = async () => {
        try {
            confirmBtn.disabled = true;
            confirmBtn.textContent = 'Guardando...';

            const user = auth.currentUser;
            const timestamp = new Date().toISOString();

            await callApi('/api/perfil/terms', 'PATCH', {
                terms_version: newVersion,
                terms_date: timestamp
            });

            await callApi('/api/rce', 'POST', {
                user_email: user.email.toLowerCase(),
                user_name: currentUserData?.full_name || currentUserData?.name || user.displayName || user.email,
                dni: currentUserData?.dni || null,
                terms_version: newVersion
            });

            termsContentEl?.removeEventListener('scroll', onReacceptanceScroll);
            confirmBtn.onclick = null;
            delete termsModal.dataset.reacceptance;
            termsModal.classList.add('hidden');
            termsModal.classList.remove('flex');
            alert('Términos actualizados con éxito.');
            location.reload();
        } catch (e) {
            console.error(e);
            alert('Error al actualizar términos.');
            confirmBtn.disabled = false;
            confirmBtn.textContent = 'Confirmar Lectura ✅';
        }
    };
}
async function recordUserActivity(buttonName, hasAccess) {
    const user = auth.currentUser;
    if (!user) {
        console.warn("Tracking skipped: No user logged in.");
        return;
    }
    
    console.log(`[Tracking] Recording activity for: ${buttonName} (Access: ${hasAccess})`);
    
    try {
        const logData = {
            userEmail: user.email.toLowerCase(),
            userName: user.displayName || user.email.split('@')[0],
            buttonName: buttonName || "Desconocido",
            hasAccess: hasAccess,
            timestamp: new Date().toISOString()
        };
        
        await callApi('/api/log-actividad', 'POST', {
            action: hasAccess ? 'view_dashboard' : 'access_denied',
            details: logData
        });

        console.log("[Tracking] Activity recorded successfully in Firestore and MySQL.");
    } catch (e) {
        console.error("[Tracking] Error recording activity:", e);
    }
}

// --- NUEVOS MÓDULOS Y FUNCIONALIDADES ---

// 1. Lógica del Móvil de Teléfonos Útiles
const phonesModal = document.getElementById('phones-modal');
const viewPhonesBtn = document.getElementById('view-phones-btn');
const viewPhonesBtnFooter = document.getElementById('view-phones-btn-footer');
const closePhonesBtn = document.getElementById('close-phones-btn');
const closePhonesOverlay = document.getElementById('close-phones-overlay');

function togglePhonesModal(show) {
    if (!phonesModal) return;
    if (show) {
        phonesModal.classList.remove('hidden');
        phonesModal.classList.add('flex');
        document.body.style.overflow = 'hidden';
    } else {
        phonesModal.classList.add('hidden');
        phonesModal.classList.remove('flex');
        document.body.style.overflow = '';
    }
}

viewPhonesBtn?.addEventListener('click', () => togglePhonesModal(true));
viewPhonesBtnFooter?.addEventListener('click', () => togglePhonesModal(true));
closePhonesBtn?.addEventListener('click', () => togglePhonesModal(false));
closePhonesOverlay?.addEventListener('click', () => togglePhonesModal(false));

// Modales legales: los listeners ya están registrados en el bloque de arriba (termsTriggers / privacyTriggers).


// 2. Lógica de Feedback ("No me sirvió")
const feedbackModal = document.getElementById('feedback-modal');
const feedbackNoBtn = document.getElementById('feedback-no-btn');
const feedbackForm = document.getElementById('feedback-form');
const feedbackSuccess = document.getElementById('feedback-success');
const closeFeedbackOverlay = document.getElementById('close-feedback-overlay');

feedbackNoBtn?.addEventListener('click', () => {
    if (!feedbackModal) return;
    feedbackModal.classList.remove('hidden');
    feedbackModal.classList.add('flex');
    document.body.style.overflow = 'hidden';
});

closeFeedbackOverlay?.addEventListener('click', () => {
    feedbackModal?.classList.add('hidden');
    feedbackModal?.classList.remove('flex');
    document.body.style.overflow = '';
});

feedbackForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const comment = document.getElementById('feedback-comment').value;
    const name = document.getElementById('feedback-name').value;
    const email = document.getElementById('feedback-email').value;
    const submitBtn = document.getElementById('feedback-submit-btn');

    if (!comment) return;

    submitBtn.disabled = true;
    submitBtn.textContent = "Enviando...";

    try {
        await callApi('/api/feedback', 'POST', {
            user_uid: auth.currentUser ? auth.currentUser.uid : null,
            is_useful: false,
            comment: comment,
            name_provided: name,
            email_provided: email
        });

        feedbackForm.classList.add('hidden');
        feedbackSuccess.classList.remove('hidden');

        // Hide the original feedback card
        const section = document.getElementById('feedback-no-btn')?.closest('section');
        if (section) section.classList.add('hidden');

        setTimeout(() => {
            feedbackModal.classList.add('hidden');
            feedbackModal.classList.remove('flex');
            document.body.style.overflow = '';
            // Reset for next time
            setTimeout(() => {
                feedbackForm.reset();
                feedbackForm.classList.remove('hidden');
                feedbackSuccess.classList.add('hidden');
                submitBtn.disabled = false;
                submitBtn.textContent = "Enviar Feedback";
            }, 500);
        }, 2000);

    } catch (error) {
        console.error("Error sending feedback:", error);
        alert("Ocurrió un error al enviar el feedback. Por favor, intenta de nuevo.");
        submitBtn.disabled = false;
        submitBtn.textContent = "Enviar Feedback";
    }
});

// 3. Lógica de Buscador de Cabecera (Client-side)
const searchInput = document.getElementById('header-search-input');

searchInput?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        const query = searchInput.value.trim();
        if (query.length < 3) return;
        performEnhancedSearch(query);
    }
});

// Helper: Normalize string (remove accents and lower case)
function normalizeStr(str) {
    return str.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function performEnhancedSearch(query) {
    const resultsContainer = document.getElementById('search-results-container');
    const searchModal = document.getElementById('search-modal');
    const queryDisplay = document.getElementById('search-query-display');
    
    if (!resultsContainer || !searchModal) return;

    resultsContainer.innerHTML = '';
    queryDisplay.textContent = `Buscando: "${query}"`;
    
    const normalizedQuery = normalizeStr(query);
    const results = [];
    
    // Search in meaningful sections, including buttons and links (important for dashboard boards)
    const elements = document.querySelectorAll('h1, h2, h3, h4, h5, p, .searchable, button, a, [title]');
    
    elements.forEach(el => {
        let text = el.textContent || el.getAttribute('title') || '';
        const normalizedText = normalizeStr(text);
        
        // Skip elements inside modals to avoid recursive search results
        if (el.closest('#search-modal') || el.closest('#login-modal') || el.closest('footer')) return;

        if (normalizedText.includes(normalizedQuery) && text.trim().length > 2) {
            // Find parent section or category
            const section = el.closest('section')?.querySelector('h1, h2, h3')?.textContent || 
                           el.closest('.obelisco-card')?.querySelector('h3, h4')?.textContent || 
                           'Sección General';
            
            results.push({
                text: text.trim(),
                section: section.trim(),
                element: el
            });
        }
    });

    if (results.length === 0) {
        resultsContainer.innerHTML = `
            <div class="text-center py-12">
                <div class="text-gray-300 mb-4 opacity-30">
                    <svg class="w-16 h-16 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                </div>
                <p class="text-obelisco-dark font-bold text-lg">No encontramos coincidencias</p>
                <p class="text-gray-500 text-sm mt-1">Probá con términos más generales como "seguridad", "ambiente" o "dalcar".</p>
            </div>
        `;
    } else {
        const uniqueResults = [];
        const seenTexts = new Set();
        
        results.forEach(r => {
            const cleanText = normalizeStr(r.text);
            if (!seenTexts.has(cleanText)) {
                uniqueResults.push(r);
                seenTexts.add(cleanText);
            }
        });

        // Limit to 15 results for performance
        const limitedResults = uniqueResults.slice(0, 15);

        limitedResults.forEach(item => {
            const itemDiv = document.createElement('div');
            itemDiv.className = 'p-4 bg-white border border-gray-100 rounded-xl hover:border-obelisco-blue hover:shadow-lg transition cursor-pointer group mb-3';
            
            // Highlight match
            const escapedQuery = normalizedQuery.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const displayHTML = item.text.replace(new RegExp(escapedQuery, 'gi'), match => `<span class="bg-yellow-200 font-bold p-0.5 rounded">${match}</span>`);

            itemDiv.innerHTML = `
                <div class="flex justify-between items-start mb-1">
                    <span class="text-[9px] font-bold uppercase tracking-widest text-obelisco-blue opacity-70">${item.section}</span>
                </div>
                <p class="text-sm text-obelisco-dark font-medium leading-relaxed">${displayHTML}</p>
                <div class="mt-2 flex items-center text-[10px] text-obelisco-blue font-bold opacity-0 group-hover:opacity-100 transition">
                    <span>Ir a la sección</span>
                    <svg class="w-3 h-3 ml-1" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 8l4 4m0 0l-4 4m4-4H3" /></svg>
                </div>
            `;

            itemDiv.onclick = () => {
                searchModal.classList.add('hidden');
                item.element.scrollIntoView({ behavior: 'smooth', block: 'center' });
                // Flash animation for the target element
                item.element.classList.add('ring-4', 'ring-obelisco-yellow', 'ring-opacity-50', 'rounded-lg', 'transition-all');
                setTimeout(() => item.element.classList.remove('ring-4', 'ring-obelisco-yellow', 'ring-opacity-50'), 2000);
            };

            resultsContainer.appendChild(itemDiv);
        });
    }

    searchModal.classList.remove('hidden');
}

// Modal Generic Close Logic
document.querySelectorAll('[data-close-modal]').forEach(btn => {
    btn.addEventListener('click', (e) => {
        const modalId = `${e.currentTarget.getAttribute('data-close-modal')}-modal`;
        const m = document.getElementById(modalId);
        if (m) {
            m.classList.add('hidden');
            m.classList.remove('flex');
            document.body.style.overflow = '';
        }
    });
});

// "Sí, me fue útil" Logic
const feedbackYesBtn = document.getElementById('feedback-yes-btn');
if (feedbackYesBtn) {
    feedbackYesBtn.onclick = async () => {
        feedbackYesBtn.disabled = true;
        feedbackYesBtn.innerHTML = '<span class="animate-pulse">Registrando...</span>';
        
        try {
            await callApi('/api/feedback', 'POST', {
                user_uid: auth.currentUser ? auth.currentUser.uid : null,
                is_useful: true,
                comment: 'Voto: Sí me fue útil',
                name_provided: auth.currentUser ? auth.currentUser.displayName : 'Anónimo',
                email_provided: auth.currentUser ? auth.currentUser.email : null
            });
            
            // Show thanks toast
            const thanksToast = document.createElement('div');
            thanksToast.className = 'fixed bottom-24 left-1/2 -translate-x-1/2 bg-gray-900 border border-gray-700 text-white px-8 py-4 rounded-2xl shadow-[0_20px_50px_rgba(0,0,0,0.5)] z-[100005] font-bold flex items-center space-x-4 transition-all transform scale-100 animate-in fade-in zoom-in duration-300';
            thanksToast.innerHTML = `
                <div class="w-8 h-8 bg-green-500 rounded-full flex items-center justify-center shrink-0">
                    <svg class="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7" /></svg>
                </div>
                <div>
                    <p class="text-sm">¡Gracias por tu devolución!</p>
                    <p class="text-[10px] text-gray-400 font-normal">Tu opinión nos ayuda a mejorar el portal.</p>
                </div>
            `;
            document.body.appendChild(thanksToast);

            // Hide feedback section completely
            const feedbackSection = feedbackYesBtn.closest('section');
            if (feedbackSection) {
                feedbackSection.classList.add('hidden');
            }

            setTimeout(() => {
                thanksToast.classList.add('opacity-0', 'translate-y-4');
                setTimeout(() => thanksToast.remove(), 500);
            }, 4000);
            
        } catch (err) {
            console.error("Error saving useful vote:", err);
            feedbackYesBtn.disabled = false;
            feedbackYesBtn.innerText = 'Intentar de nuevo';
        }
    };
}

// Phone Modal Footer Link listeners already handled above via unified togglePhonesModal logic.


