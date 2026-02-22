// utils.js
import { state, TIME_START } from "./config.js";

// --- FUNÇÕES AUXILIARES ---
export function toMinutes(t) { 
    if (!t || typeof t !== 'string') return 0; // Proteção contra o erro t.split
    const [h, m] = t.split(":").map(Number); 
    return h * 60 + m; 
}

export function isoDate(d) { 
    const z = d.getTimezoneOffset() * 60 * 1000;
    const localDate = new Date(d - z);
    return localDate.toISOString().split("T")[0];
}

export function translateRole(r) { 
    return r === "admin" ? "Admin" : r === "consultant" ? "Consultora" : "Corretor"; 
}

export function getRow(t) { 
    const [h, m] = t.split(":").map(Number); 
    return (h - TIME_START) * 2 + (m === 30 ? 1 : 0) + 2; 
}

export function getStartOfWeek(d) { 
    const date = new Date(d); 
    const day = date.getDay(); 
    const diff = date.getDate() - day + (day === 0 ? -6 : 1); 
    return new Date(date.setDate(diff)); 
}

export function getClientList(appt) {
    if (appt.clients && Array.isArray(appt.clients) && appt.clients.length > 0) {
        return appt.clients;
    }
    if (appt.clientName) {
        return [{ name: appt.clientName, phone: appt.clientPhone || "", addedBy: appt.createdBy }]; 
    }
    return [];
}

export function getPropertyList(appt) {
    if (appt && Array.isArray(appt.properties) && appt.properties.length > 0) {
        return appt.properties
            .map((prop) => ({
                reference: String(prop?.reference || "").trim(),
                propertyAddress: String(prop?.propertyAddress || "").trim()
            }))
            .filter((prop) => prop.reference || prop.propertyAddress);
    }

    const legacyReference = String(appt?.reference || "").trim();
    const legacyAddress = String(appt?.propertyAddress || "").trim();
    if (legacyReference || legacyAddress) {
        return [{ reference: legacyReference, propertyAddress: legacyAddress }];
    }

    return [];
}

// --- LÓGICA DE NEGÓCIO E CONFLITOS ---

export function checkOverlap(brokerId, dateStr, startStr, endStr, excludeId = null, isNewEvent = false) {
    // Eventos (Avisos) não bloqueiam a agenda
    if (isNewEvent) return false;
  
    const newStart = toMinutes(startStr);
    const newEnd = toMinutes(endStr);
    
    return state.appointments.some((appt) => {
      if (appt.id === excludeId) return false;
      if (appt.isEvent) return false; // Ignora eventos existentes para fins de bloqueio
  
      if (appt.brokerId !== brokerId) return false;
      if (appt.date !== dateStr) return false;
      const existStart = toMinutes(appt.startTime);
      const existEnd = toMinutes(appt.endTime);
      return newStart < existEnd && newEnd > existStart;
    });
}

export function checkTimeOverlap(appt1, appt2) {
    const start1 = toMinutes(appt1.startTime);
    const end1 = toMinutes(appt1.endTime);
    const start2 = toMinutes(appt2.startTime);
    const end2 = toMinutes(appt2.endTime);
    return start1 < end2 && end1 > start2;
}
  
export function checkDateLock(dateStr) {
    if (state.userProfile && state.userProfile.role === 'admin') return false;

    const today = new Date();
    today.setHours(0,0,0,0);
    
    const [y, m, d] = dateStr.split('-').map(Number);
    const targetDate = new Date(y, m - 1, d);

    if (targetDate.getTime() < today.getTime()) return true;

    if (targetDate.getTime() === today.getTime()) {
        const now = new Date();
        const currentHour = now.getHours();
        const currentMin = now.getMinutes();
        const dayOfWeek = now.getDay(); 

        // Regra Sábado (após 12:30)
        if (dayOfWeek === 6) {
            if (currentHour > 12 || (currentHour === 12 && currentMin >= 30)) return true;
        }
        // Regra Semana (após 18:00)
        else if (dayOfWeek >= 1 && dayOfWeek <= 5) {
            if (currentHour >= 18) return true;
        }
    }
    return false;
}
// utils.js (Adicione ao final, mantendo as outras funções)

export function showDialog(title, message, buttons = []) {
  return new Promise((resolve) => {
    const overlay = document.getElementById("custom-dialog");
    const titleEl = document.getElementById("dialog-title");
    const textEl = document.getElementById("dialog-text");
    const actionsEl = document.getElementById("dialog-actions");

    titleEl.innerText = title;
    textEl.innerText = message;
    actionsEl.innerHTML = ""; // Limpa botões anteriores

    // Se nenhum botão for passado, cria um padrão "OK"
    if (buttons.length === 0) {
        buttons = [{ text: "OK", value: true, class: "btn-confirm" }];
    }

    buttons.forEach(btn => {
        const button = document.createElement("button");
        button.innerText = btn.text;
        button.className = `btn-dialog ${btn.class || 'btn-confirm'}`;
        
        button.onclick = () => {
            overlay.classList.add("hidden");
            resolve(btn.value);
        };
        actionsEl.appendChild(button);
    });

    overlay.classList.remove("hidden");
  });
}