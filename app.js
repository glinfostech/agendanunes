// app.js

// 1. IMPORTAÇÕES
import { db, state, setBrokers } from "./config.js"; // <-- setBrokers adicionado
import { updateHeaderDate, renderMain, scrollToBusinessHours } from "./render.js";
import { 
    collection, query, onSnapshot, limit, getDocs, deleteDoc, doc 
} from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";

import { initAuth } from "./auth.js";
import { setupUIInteractions } from "./interactions.js";
import { setupAppointmentLogic } from "./appointments.js";
import { initReports } from "./reports.js"; 

// 2. INICIALIZAÇÃO E AUTENTICAÇÃO
initAuth(initApp);

function isBrokerRole(role) {
    return role === "broker" || role === "Corretor";
}

function normalizeRole(role) {
    if (!role) return "";
    return String(role).trim().toLowerCase();
}

function isBrokerUserRole(role) {
    const normalizedRole = normalizeRole(role);
    return normalizedRole === "broker" || normalizedRole === "corretor";
}

// 3. FUNÇÃO PRINCIPAL
function initApp() {
    listenToBrokers(); 

    // --- NOVA REGRA: TRAVAR TELA PARA CORRETOR ---
    if (state.userProfile && isBrokerRole(state.userProfile.role)) {
        document.body.classList.add("broker-view-only");
    }

    if (!state.appInitialized) {
        setupUIInteractions();
        setupAppointmentLogic();
        state.appInitialized = true;
        
        renderUserInfo();

        setTimeout(() => {
            if (state.userProfile && state.userProfile.role === 'admin') {
                initReports(); 
            }
            renderUserInfo(); 
        }, 1000);
    }
    cleanupExpiredDeletedAppointments().catch((e) => console.error("Erro na limpeza de excluídos:", e));

    const baseDate = state.currentDate || new Date();
    setupRealtime(baseDate);
    
    updateHeaderDate();
    renderMain();
    scrollToBusinessHours();
}

// --- FUNÇÃO PARA BUSCAR CORRETORES NO BANCO DE DADOS EM TEMPO REAL ---
function listenToBrokers() {
    // Busca todos os usuários e filtra no cliente para tolerar inconsistências de capitalização/valor do campo role
    const q = query(collection(db, "users"));
    
    onSnapshot(q, (snapshot) => {
        let loadedBrokers = [];
        snapshot.forEach((doc) => {
            const data = doc.data();
            if (!isBrokerUserRole(data.role)) return;

            loadedBrokers.push({
                id: data.email || doc.id,
                docId: doc.id,
                name: data.name,
                phone: data.phone || "" 
            });
        });

        // --- NOVA REGRA: SE FOR CORRETOR, VÊ SÓ ELE MESMO ---
        if (state.userProfile && isBrokerRole(state.userProfile.role)) {
            loadedBrokers = loadedBrokers.filter((b) => (
                b.id === state.userProfile.email || b.docId === state.userProfile.id
            ));
            
            // Oculta a caixa de seleção de corretores no topo
            const selectEl = document.getElementById("view-broker-select");
            if(selectEl) selectEl.style.display = "none";
        }

        loadedBrokers.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
        setBrokers(loadedBrokers); 

        if (loadedBrokers.length > 0) {
            const hasSelectedBroker = loadedBrokers.some((b) => b.id === state.selectedBrokerId);
            if (!hasSelectedBroker) {
                state.selectedBrokerId = loadedBrokers[0].id;
            }

            const selectEl = document.getElementById("view-broker-select");
            if (selectEl) selectEl.value = state.selectedBrokerId;
        } else {
            state.selectedBrokerId = "all";
        }

        renderMain(); 
        
        if (typeof window.populateBrokerSelect === "function") window.populateBrokerSelect();
        if (typeof window.populateAllBrokerSelects === "function") window.populateAllBrokerSelects();
    });
}
function renderUserInfo() {
    if (!state.userProfile) return;
    
    // Mapeamento de cargos
    const rolesMap = {
        'admin': 'Administrador',
        'consultant': 'Consultora',
        'broker': 'Corretor'
    };

    const userInfoDiv = document.querySelector('.user-info');
    if (userInfoDiv) {
        // Busca no mapa ou usa 'Corretor' como padrão caso não encontre
        const roleDisplay = rolesMap[state.userProfile.role] || 'Corretor';

        userInfoDiv.innerHTML = `
            <div style="font-weight:700; font-size:0.9rem;">${state.userProfile.name}</div>
            <div style="font-size:0.75rem; color:#64748b;">${roleDisplay}</div>
        `;
        userInfoDiv.style.display = 'block';
    }
}

// 4. REALTIME LISTENER OTIMIZADO
export function setupRealtime(centerDate) {
    if (state.unsubscribeSnapshot) {
        state.unsubscribeSnapshot();
        state.unsubscribeSnapshot = null;
    }

    const startDate = new Date(centerDate);
    startDate.setDate(startDate.getDate() - 30);
    const endDate = new Date(centerDate);
    endDate.setDate(endDate.getDate() + 30);

    const formatDate = (dateObj) => {
        const y = dateObj.getFullYear();
        const m = String(dateObj.getMonth() + 1).padStart(2, '0');
        const d = String(dateObj.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    };

    const startString = formatDate(startDate);
    const endString = formatDate(endDate);

    const q = query(
        collection(db, "appointments"), 
        where("date", ">=", startString),
        where("date", "<=", endString),
        limit(2000) 
    );
    
    state.unsubscribeSnapshot = onSnapshot(q, (snapshot) => {
        let appts = [];
        snapshot.forEach((doc) => {
            appts.push({ id: doc.id, ...doc.data() });
        });
        
        // --- NOVA REGRA: SE FOR CORRETOR, BAIXA SÓ OS DELE ---
        if (state.userProfile && isBrokerRole(state.userProfile.role)) {
            const keys = new Set([state.userProfile.email, state.userProfile.id].filter(Boolean));
            appts = appts.filter((a) => keys.has(a.brokerId));
        }

        state.appointments = appts.filter((a) => !a.deletedAt);
        renderMain();
    }, (error) => {
        console.error("Erro no listener realtime:", error);
    });
}
async function cleanupExpiredDeletedAppointments() {
    const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
    const cutoff = Date.now() - THIRTY_DAYS_MS;

    const snap = await getDocs(query(collection(db, "appointments"), limit(2000)));
    const deletions = [];

    snap.forEach((d) => {
        const data = d.data();
        if (!data.deletedAt) return;

        const deletedAtMs = new Date(data.deletedAt).getTime();
        if (deletedAtMs < cutoff) {
            deletions.push(deleteDoc(doc(db, "appointments", d.id)));
        }
    });

    if (deletions.length > 0) {
        await Promise.all(deletions);
        console.log(`[Limpeza] ${deletions.length} registros permanentemente excluídos.`);
    }
}
