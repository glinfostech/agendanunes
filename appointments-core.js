import { state } from "./config.js";
import { showDialog, getPropertyList } from "./utils.js";

// --- MAPEAMENTO DE TELEFONES DOS CORRETORES ---
// --- BUSCA DINÂMICA DE TELEFONE ---
export function getBrokerPhoneByName(name) {
    if (!name) return null;
    
    // Procura o corretor pelo nome na lista que veio do banco de dados
    const broker = state.brokers.find(b => 
        b.name.toLowerCase() === name.toLowerCase() || 
        name.toLowerCase().includes(b.name.toLowerCase())
    );

    // Se achou o corretor e ele possui telefone cadastrado no CRUD, retorna.
    if (broker && broker.phone) {
        return broker.phone;
    }
    
    return null;
}

export function isTimeLocked(dateStr, timeStr) {
    if (!dateStr || !timeStr) return false;
    const now = new Date();
    const [y, m, d] = dateStr.split('-').map(Number);
    const [h, min] = timeStr.split(':').map(Number);
    const apptDate = new Date(y, m - 1, d, h, min);
    return apptDate < new Date(now.getTime() - 60000);
}

export function getLockMessage() {
    return "Horário passado. Contate o admin para alterar.";
}

export function getConsultantName(email) {
    if (!email) return "";
    if (state.availableConsultants) {
        const found = state.availableConsultants.find(c => c.email === email);
        if (found) return found.name;
    }
    return email.split("@")[0].charAt(0).toUpperCase() + email.split("@")[0].slice(1);
}

export async function sendWhatsapp(name, phone, appt, brokerName, actionType = "create") {
    if (!phone) return showDialog("Erro", "Telefone não encontrado.");

    const dateParts = appt.date.split("-");
    const formattedDate = `${dateParts[2]}/${dateParts[1]}`;
    const firstProperty = getPropertyList(appt)[0] || { reference: appt.reference || "", propertyAddress: appt.propertyAddress || "" };

    let cleanPhone = phone.replace(/\D/g, "");
    if (!cleanPhone.startsWith("55")) cleanPhone = "55" + cleanPhone;

    let msg = "";
    if (actionType === "update") {
        msg = `*ATUALIZAÇÃO DE VISITA*
Olá ${brokerName}, houve uma alteração:
📅 Data: ${formattedDate}
⏰ Hora: ${appt.startTime}
📍 Endereço: ${firstProperty.propertyAddress}
👤 Cliente: ${name}`;
    } else if (actionType === "delete") {
        msg = `*VISITA CANCELADA/EXCLUÍDA*
Olá ${brokerName}, um agendamento foi apagado:
📅 Data: ${formattedDate}
⏰ Hora: ${appt.startTime}
📍 Endereço: ${firstProperty.propertyAddress}
👤 Cliente: ${name}`;
    } else {
        msg = `Olá ${brokerName}, nova visita agendada:
📅 Data: ${formattedDate}
⏰ Hora: ${appt.startTime}
📍 Endereço: ${firstProperty.propertyAddress}
👤 Cliente: ${name}`;
    }

    if (firstProperty.reference) msg += `\nRef: ${firstProperty.reference}`;

    const url = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(msg)}`;
    window.open(url, "_blank");
}

export function createWhatsappButton(name, phone, appt, brokerName) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "btn btn-whatsapp";
    btn.innerHTML = `<i class="fab fa-whatsapp"></i> WhatsApp`;
    btn.onclick = () => {
        if (!phone) return alert("Telefone não cadastrado.");
        const dateParts = appt.date.split("-");
        const firstProperty = getPropertyList(appt)[0] || { reference: appt.reference || "", propertyAddress: appt.propertyAddress || "" };
        const msg = `Olá ${name}, estou entrando em contato para confirmar sua visita no imóvel da rua ${firstProperty.propertyAddress} (Ref: ${firstProperty.reference || ''}) com o corretor ${brokerName} no dia ${dateParts[2]}/${dateParts[1]} às ${appt.startTime}.`;

        let cleanPhone = phone.replace(/\D/g, "");
        if (cleanPhone && !cleanPhone.startsWith("55") && cleanPhone.length > 9) cleanPhone = "55" + cleanPhone;

        window.open(`https://wa.me/${cleanPhone}?text=${encodeURIComponent(msg)}`, "_blank");
    };
    return btn;
}

export async function handleBrokerNotification(brokerId, brokerName, actionType, appointmentData) {
    try {
        if (!appointmentData || appointmentData.isEvent) return;
        if (!brokerId) return;
        if (!["create", "update", "delete"].includes(actionType)) return;

        const broker = state.brokers.find((b) => b.id === brokerId || b.docId === brokerId);
        const resolvedBrokerName = brokerName || broker?.name || "Corretor";
        const brokerPhone = broker?.phone || getBrokerPhoneByName(resolvedBrokerName);

        if (!brokerPhone) {
            const actionLabel = actionType === "delete" ? "apagado" : "salvo";
            await showDialog("Aviso", `Agendamento ${actionLabel}, mas o corretor ${resolvedBrokerName} não possui telefone cadastrado.`);
            return;
        }

        const clients = Array.isArray(appointmentData.clients) ? appointmentData.clients : [];
        const firstClient = clients.find((c) => String(c?.name || "").trim()) || { name: "Cliente" };

        const promptByAction = {
            create: `Agendamento criado com sucesso. Deseja enviar no WhatsApp para ${resolvedBrokerName}?`,
            update: `Agendamento editado com sucesso. Deseja enviar atualização para ${resolvedBrokerName}?`,
            delete: `Agendamento apagado com sucesso. Deseja avisar ${resolvedBrokerName} no WhatsApp?`
        };

        const shouldSend = await showDialog(
            "Notificação WhatsApp",
            promptByAction[actionType],
            [
                { text: "Agora não", value: false, class: "btn-cancel" },
                { text: "Enviar", value: true, class: "btn-confirm" }
            ]
        );

        if (!shouldSend) return;

        await sendWhatsapp(firstClient.name, brokerPhone, appointmentData, resolvedBrokerName, actionType);
    } catch (e) {
        console.error("Erro na notificação (ignorado para não travar):", e);
    }
}
