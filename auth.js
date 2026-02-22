import { db, state } from "./config.js";
import { initAdminPanel } from "./admin-crud.js"; 
import { 
    collection, query, where, getDocs, doc, getDoc 
} from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";

const SESSION_KEY = "agenda_nunes_user_session";

// Lista de e-mails que viram ADMIN automaticamente
const SUPER_ADMINS = [
    "gl.infostech@gmail.com"
];

// E-mails que NÃO devem aparecer na lista de Consultoras/Compartilhar
const HIDDEN_USERS = [
    "gl.infostech@gmail.com",
    "admin@admin.com"
];


function normalizeEmail(email) {
    return String(email || "").trim().toLowerCase();
}

function normalizeRole(role) {
    return String(role || "").trim().toLowerCase();
}

function isAdminRole(role) {
    return normalizeRole(role) === "admin";
}

export function initAuth(initAppCallback) {
    setupLoginForm(initAppCallback);
    
    const savedSession = localStorage.getItem(SESSION_KEY);

    if (savedSession) {
        try {
            const userProfile = JSON.parse(savedSession);
            handleLoginSuccess(userProfile, initAppCallback);
        } catch (e) {
            console.error("Sessão inválida.");
            handleLogout();
        }
    } else {
        handleLogout();
    }

    window.logout = () => {
        handleLogout();
    };
}

function setupLoginForm(initAppCallback) {
    const form = document.getElementById("login-form");
    if(!form) return;

    const newForm = form.cloneNode(true);
    form.parentNode.replaceChild(newForm, form);

    newForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        
        const errorElement = document.getElementById("login-error");
        const emailInput = document.getElementById("login-email");
        const passInput = document.getElementById("login-password");
        const btnSubmit = newForm.querySelector("button[type='submit']");

        const email = normalizeEmail(emailInput.value);
        const password = passInput.value.trim();

        if (!email || !password) {
            errorElement.innerText = "Preencha e-mail e senha.";
            return;
        }

        errorElement.innerText = "Verificando credenciais...";
        if(btnSubmit) btnSubmit.disabled = true;
        
        try {
            let userDoc = null;
            let userData = null;

            const q = query(
                collection(db, "users"), 
                where("email", "==", email),
                where("password", "==", password) 
            );

            const querySnapshot = await getDocs(q);

            if (!querySnapshot.empty) {
                userDoc = querySnapshot.docs[0];
                userData = userDoc.data();
            } else {
                const userByIdRef = doc(db, "users", email);
                const userByIdSnap = await getDoc(userByIdRef);

                if (!userByIdSnap.exists()) {
                    throw new Error("E-mail ou senha incorretos.");
                }

                const byIdData = userByIdSnap.data() || {};
                const savedPassword = String(byIdData.password || "").trim();

                if (!savedPassword || savedPassword !== password) {
                    throw new Error("E-mail ou senha incorretos.");
                }

                userDoc = userByIdSnap;
                userData = byIdData;
            }
            
            const profile = {
                ...userData,
                id: userDoc.id, 
                email: normalizeEmail(userData.email || userDoc.id)
            };

            if (SUPER_ADMINS.includes(normalizeEmail(profile.email))) {
                profile.role = "admin";
            }

            handleLoginSuccess(profile, initAppCallback);

        } catch (err) {
            console.error("Falha login.");
            errorElement.innerText = err.message || "Erro ao tentar entrar.";
            passInput.value = "";
            passInput.focus();
        } finally {
            if(btnSubmit) btnSubmit.disabled = false;
        }
    });
}


function showMainAppView() {
    const navBar = document.getElementById("main-navbar");
    const appContainer = document.getElementById("app-container");
    const adminPanel = document.getElementById("admin-crud-screen");

    if (adminPanel) adminPanel.classList.add("hidden");
    if (navBar) navBar.classList.remove("hidden");
    if (appContainer) appContainer.classList.remove("hidden");
}

function showAdminPanelView() {
    const navBar = document.getElementById("main-navbar");
    const appContainer = document.getElementById("app-container");
    const adminPanel = document.getElementById("admin-crud-screen");

    if (adminPanel) adminPanel.classList.remove("hidden");
    if (navBar) navBar.classList.add("hidden");
    if (appContainer) appContainer.classList.add("hidden");
}

function handleLoginSuccess(profile, initAppCallback) {
    state.userProfile = profile;
    localStorage.setItem(SESSION_KEY, JSON.stringify(profile));

    const loginScreen = document.getElementById("login-screen");
    if(loginScreen) loginScreen.classList.add("hidden");

    showMainAppView();

    if (isAdminRole(profile.role)) {
        initAdminPanel();
    }

    updateUserUI(profile);

    // Carrega consultoras (se tiver permissão)
    if (["admin", "consultant"].includes(normalizeRole(profile.role))) {
        loadConsultantsList();
    }

    if (!state.appInitialized && initAppCallback) {
        initAppCallback();
    }
}

function handleLogout() {
    localStorage.removeItem(SESSION_KEY);
    state.userProfile = null;
    state.appInitialized = false;
    
    const loginScreen = document.getElementById("login-screen");
    const navBar = document.getElementById("main-navbar");
    const appContainer = document.getElementById("app-container");
    const adminPanel = document.getElementById("admin-crud-screen");

    if(loginScreen) loginScreen.classList.remove("hidden");
    if(navBar) navBar.classList.add("hidden");
    if(appContainer) appContainer.classList.add("hidden");
    if(adminPanel) adminPanel.classList.add("hidden");
    
    const loginForm = document.getElementById("login-form");
    if (loginForm) loginForm.reset();
    
    const errEl = document.getElementById("login-error");
    if(errEl) errEl.innerText = "";
}

function updateUserUI(profile) {
    const firstName = profile.name ? profile.name.split(" ")[0] : "Usuário";
    const userDisplay = document.getElementById("user-display");
    if (userDisplay) userDisplay.innerText = firstName;
    
    const adminPanelBtn = document.getElementById("btn-admin-panel"); 
    if (adminPanelBtn) {
        if (isAdminRole(profile.role)) {
            adminPanelBtn.classList.remove('hidden');
            adminPanelBtn.onclick = () => showAdminPanelView();
            window.openAdminPanel = showAdminPanelView;
            window.closeAdminPanel = showMainAppView;
        } else {
            adminPanelBtn.classList.add('hidden');
            adminPanelBtn.onclick = null;
        }
    }
}

// --- CORREÇÃO AQUI: FILTRAR USUÁRIOS OCULTOS ---
async function loadConsultantsList() {
    try {
        const q = query(collection(db, "users"), where("role", "in", ["consultant", "admin"]));
        const snapshot = await getDocs(q);
        
        state.availableConsultants = snapshot.docs
          .map((doc) => ({ email: normalizeEmail(doc.data().email || doc.id), name: doc.data().name || "" }))
          // FILTRO: Remove quem estiver na lista HIDDEN_USERS
          .filter(u => !HIDDEN_USERS.includes(normalizeEmail(u.email)))
          .sort((a, b) => a.name.localeCompare(b.name));
          
    } catch (e) {
        // Silencioso
    }
}