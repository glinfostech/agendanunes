// appointments-actions.js
import { db, state, BROKERS } from "./config.js";
import { checkOverlap, showDialog } from "./utils.js";
import { 
    doc, addDoc, updateDoc, collection, query, where, writeBatch, getDocs, deleteDoc 
} from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";
import { isTimeLocked } from "./appointments-core.js";

// --- AÇÃO: SALVAR AGENDAMENTO ---
export async function saveAppointmentAction(formData) {
    const id = formData.id;
    const isNew = !id;
    const isAdmin = state.userProfile.role === "admin";
    // Super Admin: gl.infostech@gmail.com (Bypass total)
    const isSuperAdmin = (state.userProfile.email === "gl.infostech@gmail.com");
    
    let oldAppt = null;
    if (!isNew) {
        oldAppt = state.appointments.find(a => a.id === id);
        if (!oldAppt) throw new Error("Erro: Visita original não encontrada.");
    }

    const amICreator = isNew ? true : (oldAppt.createdBy === state.userProfile.email);

    let isLocked = false;
    if (!isNew && !isSuperAdmin) {
        isLocked = isTimeLocked(oldAppt.date, oldAppt.startTime);
    }

    // --- NOVA VALIDAÇÃO DE SEGURANÇA ---
    if (isLocked && !isSuperAdmin) {
        const proposedOwner = (isAdmin && formData.adminSelectedOwner) ? formData.adminSelectedOwner : (oldAppt.createdBy);
        
        const brokerChanged = (oldAppt.brokerId !== formData.brokerId);
        const ownerChanged = (oldAppt.createdBy !== proposedOwner);

        if (brokerChanged || ownerChanged) {
            if (!amICreator) {
                throw new Error("Ação Bloqueada: Como a visita já excedeu o tempo limite, apenas o Criador pode alterar o Corretor ou Responsável.");
            }
        }
    }
    // --------------------------------------------------

    let finalOwnerEmail = isNew ? state.userProfile.email : oldAppt.createdBy;
    let finalOwnerName = isNew ? state.userProfile.name : oldAppt.createdByName;

    if (isAdmin && formData.adminSelectedOwner) {
        finalOwnerEmail = formData.adminSelectedOwner;
        const consultantObj = state.availableConsultants ? state.availableConsultants.find(c => c.email === finalOwnerEmail) : null;
        finalOwnerName = consultantObj ? consultantObj.name : (finalOwnerEmail === oldAppt?.createdBy ? oldAppt.createdByName : finalOwnerEmail);
    }

    const linkedConsultantEmail = String(formData.linkedConsultantEmail || finalOwnerEmail || "").trim();
    const linkedConsultantObj = state.availableConsultants ? state.availableConsultants.find(c => c.email === linkedConsultantEmail) : null;
    const linkedConsultantName = linkedConsultantObj ? linkedConsultantObj.name : (linkedConsultantEmail === finalOwnerEmail ? finalOwnerName : linkedConsultantEmail);

    // Objeto base para Salvar
    const nowIso = new Date().toISOString();

    const appointmentData = {
        brokerId: formData.brokerId,
        date: formData.date,
        startTime: formData.startTime,
        endTime: formData.endTime,
        isEvent: formData.isEvent,
        
        status: formData.status || "agendada",
        statusObservation: formData.statusObservation || "",
        isRented: formData.isRented || false, // NOVO CAMPO SALVO AQUI

        eventComment: formData.eventComment || "",
        properties: formData.properties || [],
        reference: formData.reference || "",
        propertyAddress: formData.propertyAddress || "",
        clients: formData.clients || [],
        sharedWith: formData.sharedWith || [],

        linkedConsultantEmail,
        linkedConsultantName,
        
        createdBy: finalOwnerEmail,
        createdByName: finalOwnerName,
        
        updatedAt: nowIso,
        updatedBy: state.userProfile.email,
        isEdited: !isNew,
        editedAt: !isNew ? nowIso : null
    };

    if (isNew) {
        appointmentData.createdAt = nowIso;
        appointmentData.isEdited = false;
        appointmentData.editedAt = null;
        if (!formData.isEvent) {
            const conflict = checkOverlap(appointmentData.brokerId, appointmentData.date, appointmentData.startTime, appointmentData.endTime, null, appointmentData.isEvent);
            if (conflict) throw new Error(conflict);
        }
    } else {
        if (!formData.isEvent) {
            const conflict = checkOverlap(appointmentData.brokerId, appointmentData.date, appointmentData.startTime, appointmentData.endTime, id, appointmentData.isEvent);
            if (conflict) throw new Error(conflict);
        }
    }

    // --- REGISTRO DE HISTÓRICO (Audit Log) ---
    if (!isNew) {
        const historyLog = oldAppt.history ? [...oldAppt.history] : [];
        const changes = detectChanges(oldAppt, appointmentData);
        
        if (changes.length > 0) {
            historyLog.push({
                date: new Date().toLocaleString("pt-BR"),
                user: state.userProfile.name,
                action: changes.join("; ")
            });
            appointmentData.history = historyLog;
        } else {
             appointmentData.history = historyLog;
        }
    } else {
        appointmentData.history = [{
            date: new Date().toLocaleString("pt-BR"),
            user: state.userProfile.name,
            action: "Criação do Agendamento"
        }];
    }

    // --- SALVAR NO FIRESTORE ---
    const isRecurrent = (isNew && isAdmin && formData.recurrence && formData.recurrence.days && formData.recurrence.days.length > 0 && formData.recurrence.endDate);

    try {
        if (isRecurrent) {
            const batch = writeBatch(db);
            const generatedDates = generateRecurrenceDates(formData.date, formData.recurrence.endDate, formData.recurrence.days);
            if (generatedDates.length === 0) throw new Error("Nenhuma data gerada para a recorrência selecionada.");

            generatedDates.forEach(dateStr => {
                const ref = doc(collection(db, "appointments"));
                const clone = { ...appointmentData, date: dateStr, isEdited: false, editedAt: null };
                batch.set(ref, clone);
            });
            await batch.commit();

            const firstRecurringAppt = { ...appointmentData, date: generatedDates[0], isEdited: false, editedAt: null };
            return {
                message: `${generatedDates.length} agendamentos criados com recorrência!`,
                actionType: "create",
                appointment: firstRecurringAppt
            };
        }

        if (isNew) {
            const createdRef = await addDoc(collection(db, "appointments"), appointmentData);
            return {
                message: "Agendamento salvo com sucesso!",
                actionType: "create",
                appointment: { id: createdRef.id, ...appointmentData }
            };
        }

        await updateDoc(doc(db, "appointments", id), appointmentData);
        return {
            message: "Agendamento salvo com sucesso!",
            actionType: "update",
            appointment: { id, ...appointmentData }
        };
    } catch (error) {
        console.error("Erro ao salvar:", error);
        throw new Error("Falha ao se comunicar com o banco de dados.");
    }
}

// --- AÇÃO: DELETAR AGENDAMENTO ---
export async function deleteAppointmentAction(appt) {
    try {
        await deleteDoc(doc(db, "appointments", appt.id));
        return true;
    } catch (err) {
        console.error("Erro ao deletar:", err);
        throw err;
    }
}

// --- FUNÇÕES DE APOIO ---
function detectChanges(oldAppt, newData) {
    const changes = [];
    const fields = {
        brokerId: "Corretor",
        date: "Data",
        startTime: "Início",
        endTime: "Fim",
        status: "Status",
        statusObservation: "Obs. Status",
        isRented: "Imóvel Alugado", // NOVA LINHA PARA HISTÓRICO
        createdBy: "Responsável"
    };
    
    for (let key in fields) {
        let oldVal = oldAppt[key];
        let newVal = newData[key];
        
        if (key === "brokerId") {
            if (oldVal !== newVal) {
                const oldName = BROKERS.find(b => b.id === oldVal)?.name || oldVal;
                const newName = BROKERS.find(b => b.id === newVal)?.name || newVal;
                changes.push(`Corretor: de '${oldName}' para '${newName}'`);
            }
        } else if (key === "createdBy") {
            if (oldVal !== newVal) {
                 changes.push(`Responsável alterado`);
            }
        } else if (key === "isEvent") {
             // Ignora ou trata diferente
        } else {
            if (String(oldVal || "").trim() !== String(newVal || "").trim()) {
                changes.push(`${fields[key]}: alterado`);
            }
        }
    }
    
    const oldProperties = JSON.stringify(oldAppt.properties || []);
    const newProperties = JSON.stringify(newData.properties || []);
    if (oldProperties !== newProperties) {
        changes.push("Imóveis: alterado");
    }

    const getClientSig = (c) => `${c.name?.trim()}`;
    const oldSigs = oldAppt.clients ? oldAppt.clients.map(getClientSig) : [];
    const newSigs = newData.clients ? newData.clients.map(getClientSig) : [];
    
    if (JSON.stringify(oldSigs.sort()) !== JSON.stringify(newSigs.sort())) {
         changes.push("Clientes: alterado");
    }

    return changes;
}

function generateRecurrenceDates(startDateStr, endDateStr, daysOfWeekArray) {
    const dates = [];
    let current = new Date(startDateStr + "T12:00:00"); 
    const end = new Date(endDateStr + "T12:00:00");
    
    while (current <= end) {
        if (daysOfWeekArray.includes(current.getDay())) {
            dates.push(current.toISOString().split("T")[0]);
        }
        current.setDate(current.getDate() + 1);
    }
    return dates;
}