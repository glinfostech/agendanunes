//appointments-ui.js: Só cuida da aparência. Abre o modal, preenche os campos, esconde/mostra botões e controla as abas (Evento vs Visita).

import { state, BROKERS } from "./config.js";
import { addClientRow, addPropertyRow } from "./interactions.js";
import { getClientList, getPropertyList } from "./utils.js";
import { 
    isTimeLocked, 
    getLockMessage, 
    createWhatsappButton,
    getConsultantName
} from "./appointments-core.js";

// --- FUNÇÃO DE LEITURA DO FORMULÁRIO (EXTRAI DADOS PARA O CONTROLADOR) ---
export function getFormDataFromUI() {
    const idRaw = document.getElementById("appt-id").value;
    const id = idRaw ? idRaw.trim() : "";
    const chkIsEvent = document.getElementById("form-is-event");
    
    // Coleta Clientes
    let clientsData = [];
    const rows = document.querySelectorAll(".client-item-row");
    rows.forEach(row => {
        const nameInput = row.querySelector(".client-name-input");
        const phoneInput = row.querySelector(".client-phone-input");
        const addedByInput = row.querySelector(".client-added-by");
        const addedByNameInput = row.querySelector(".client-added-by-name");
        const addedAtInput = row.querySelector(".client-added-at");
        if(nameInput && nameInput.value.trim()) {
            clientsData.push({ 
                name: nameInput.value.trim(), 
                phone: phoneInput.value.trim(), 
                addedBy: addedByInput.value, 
                addedByName: addedByNameInput ? addedByNameInput.value : "", 
                addedAt: addedAtInput ? addedAtInput.value : ""
            });
        }
    });

    // Coleta Checkboxes de Compartilhamento
    let sharedWith = [];
    const checkboxes = document.querySelectorAll("#share-checkboxes input[type='checkbox']");
    checkboxes.forEach(chk => { if (chk.checked) sharedWith.push(chk.value); });

    // Coleta Recorrência (se houver)
    const recurrenceEnd = document.getElementById("recurrence-end-date").value;
    const recurrenceDays = Array.from(document.querySelectorAll("input[name='recurrence-day']:checked")).map(c => parseInt(c.value));

    // Owner Select (Admin)
    const ownerSelect = document.getElementById("form-owner-select");
    let adminSelectedOwner = ownerSelect ? ownerSelect.value : null;

    const linkedConsultantSelect = document.getElementById("form-linked-consultant");
    const linkedConsultantEmail = linkedConsultantSelect ? linkedConsultantSelect.value : "";

    // Elementos de Status (Novos)
    const statusEl = document.getElementById("form-status");
    const statusObsEl = document.getElementById("form-status-obs");
    const statusRentedEl = document.getElementById("form-status-rented"); // NOVO: Captura o checkbox

    return {
        id,
        brokerId: document.getElementById("form-broker").value,
        date: document.getElementById("form-date").value,
        startTime: document.getElementById("form-start").value,
        endTime: document.getElementById("form-end").value,
        isEvent: chkIsEvent.checked,
        
        // --- NOVOS CAMPOS DE STATUS ---
        status: statusEl ? statusEl.value : "agendada",
        statusObservation: statusObsEl ? statusObsEl.value : "",
        isRented: statusRentedEl ? statusRentedEl.checked : false, // NOVO: Retorna o valor do checkbox
        // ------------------------------

        eventComment: document.getElementById("form-event-comment").value,
        properties: getPropertiesFromUI(),
        reference: getFirstPropertyField("reference"),
        propertyAddress: getFirstPropertyField("propertyAddress"),
        clients: clientsData,
        sharedWith: sharedWith,
        recurrence: {
            endDate: recurrenceEnd,
            days: recurrenceDays
        },
        adminSelectedOwner,
        linkedConsultantEmail
    };
}

// --- LÓGICA DE ABERTURA E APARÊNCIA DO MODAL ---
export function openAppointmentModal(appt, defaults = {}, onDeleteCallback) {
    const modal = document.getElementById("modal");
    const btnSave = document.getElementById("btn-save");
    const btnDel = document.getElementById("btn-delete");
    const lockWarning = document.getElementById("lock-warning");
    const chkIsEvent = document.getElementById("form-is-event");
    const recurrenceSection = document.getElementById("recurrence-section");
    const headerInfo = document.getElementById("creation-info-header");
    
    const divEventType = document.getElementById("div-event-type");
    const inpBroker = document.getElementById("form-broker");
    
    const whatsContainer = document.getElementById("whatsapp-buttons-container");
    const shareCheckboxes = document.getElementById("share-checkboxes");
    const shareSection = document.getElementById("share-section");
    let btnAddClient = document.getElementById("btn-add-client"); 
    let btnAddProperty = document.getElementById("btn-add-property");

    const propertiesContainer = document.getElementById("properties-container");
    const inpDate = document.getElementById("form-date");
    const inpEventComment = document.getElementById("form-event-comment");
    const inpStart = document.getElementById("form-start");
    const inpEnd = document.getElementById("form-end");
    const inpLinkedConsultant = document.getElementById("form-linked-consultant");

    // --- ELEMENTOS DE STATUS ---
    const inpStatus = document.getElementById("form-status");
    const divStatusObs = document.getElementById("div-status-obs");
    const lblStatusObs = document.getElementById("lbl-status-obs");
    const inpStatusObs = document.getElementById("form-status-obs");
    
    const divStatusRented = document.getElementById("div-status-rented"); // NOVO
    const inpStatusRented = document.getElementById("form-status-rented"); // NOVO

    if(btnSave) btnSave.disabled = false;
    modal.classList.add("open");
    document.getElementById("appt-id").value = appt ? appt.id : "";

    // --- SETUP LAYOUT ---
    setupCustomLayout(inpBroker, divEventType);

    // --- PREENCHIMENTO CAMPOS ---
    populateBrokerField(inpBroker, null, null, appt, defaults);
    populateDateField(inpDate, null, null, appt, defaults);
    populateLinkedConsultantField(inpLinkedConsultant, appt);

    whatsContainer.innerHTML = ""; 
    lockWarning.style.display = "none";

    // --- LÓGICA DE STATUS (PREENCHIMENTO E EVENTOS) ---
    if (inpStatus) {
        const currentStatus = (appt && appt.status) ? appt.status : "agendada";
        inpStatus.value = currentStatus;
        if(inpStatusObs) inpStatusObs.value = (appt && appt.statusObservation) ? appt.statusObservation : "";
        if(inpStatusRented) inpStatusRented.checked = (appt && appt.isRented) ? true : false; // NOVO: Puxa do banco se estava marcado

        const updateStatusUI = () => {
            const val = inpStatus.value;
            
            // NOVO: Regra para mostrar/esconder a div do checkbox "Imóvel Alugado"
            if (divStatusRented) {
                if (val === "realizado" || val === "realizada") {
                    divStatusRented.classList.remove("hidden");
                } else {
                    divStatusRented.classList.add("hidden");
                    if (inpStatusRented) inpStatusRented.checked = false; // Desmarca ao esconder
                }
            }

            if (val === "agendada") {
                if(divStatusObs) divStatusObs.classList.add("hidden");
            } else {
                if(divStatusObs) divStatusObs.classList.remove("hidden");
                if (val === "cancelada") {
                    if(lblStatusObs) lblStatusObs.innerText = "Motivo do Cancelamento / Problema";
                    if(inpStatusObs) inpStatusObs.placeholder = "Descreva o motivo do cancelamento...";
                } else { // REMOVIDA A OPÇÃO "alugada" DAQUI
                    if(lblStatusObs) lblStatusObs.innerText = "Interesse do Cliente / Feedback";
                    if(inpStatusObs) inpStatusObs.placeholder = "O cliente gostou? Fez proposta? (Opcional)";
                }
            }
        };

        inpStatus.onchange = updateStatusUI;
        updateStatusUI(); 
    }

    // --- PERMISSÕES (LÓGICA AJUSTADA) ---
    const amICreator = appt ? appt.createdBy === state.userProfile.email : true; 
    const isAdmin = state.userProfile.role === "admin";
    const isSuperAdmin = (state.userProfile.email === "gl.infostech@gmail.com");
    const amIShared = appt && appt.sharedWith && appt.sharedWith.includes(state.userProfile.email);
    
    // CoreEditor: Admin ou Criador
    const isCoreEditor = (isAdmin || amICreator);
    // CanSaveAny: Pode salvar se for Editor, Criador ou Compartilhado
    const canSaveAny = (isCoreEditor || amIShared);
    
    // Lógica de Trava Temporal
    let isLocked = false;
    if (appt && isTimeLocked(appt.date, appt.startTime) && !isSuperAdmin) {
        isLocked = true;
        lockWarning.style.display = "block";
        lockWarning.innerText = getLockMessage(appt.date);
    }

    // --- REGRAS ESPECÍFICAS PEDIDAS NO PROMPT ---
    
    // 1. Quem pode editar o STATUS?
    // Regra: Criador/Admin pode SEMPRE. Compartilhados só se NÃO estiver bloqueado.
    const canEditStatus = (amICreator || isAdmin) || (canSaveAny && !isLocked);

    // 2. Quem pode interagir com o GERAL (Campos principais)?
    // Regra original: Ninguém se estiver bloqueado.
    const canInteractGeneral = canSaveAny && !isLocked;

    // 3. O botão SALVAR deve aparecer?
    // Aparece se puder interagir no geral OU se puder editar Status (mesmo bloqueado)
    const showSaveButton = canInteractGeneral || (isLocked && (amICreator || isAdmin));
    
    // 4. Pode deletar?
    const createdAtMs = appt?.createdAt ? new Date(appt.createdAt).getTime() : 0;
    const withinGraceWindow = Boolean(createdAtMs) && (Date.now() - createdAtMs <= 15 * 60 * 1000);
    const canDelete = isCoreEditor && (!isLocked || isSuperAdmin || (amICreator && withinGraceWindow));

    const isEvent = appt ? appt.isEvent : false;
    divEventType.classList.toggle("hidden", !canSaveAny);

    // --- UPDATE FORM STATE ---
    const updateFormState = () => {
        const isEvt = chkIsEvent.checked;
        const clContainer = document.getElementById("clients-container");
        const clientHeader = document.querySelector(".clients-header-row");
        
        // Bloqueio Geral (Data, Hora, Endereço...)
        const disableCore = !isCoreEditor || isLocked;

        inpBroker.disabled = disableCore;
        inpDate.disabled = disableCore;
        inpStart.disabled = disableCore;
        inpEnd.disabled = disableCore;
        if (inpLinkedConsultant) inpLinkedConsultant.disabled = disableCore;
        togglePropertiesDisabled(disableCore || isEvt, disableCore);
        inpEventComment.disabled = disableCore;
        chkIsEvent.disabled = disableCore;

        // --- MUDANÇA 1: Status segue permissão específica ---
        if(inpStatus) inpStatus.disabled = !canEditStatus;
        if(inpStatusObs) inpStatusObs.disabled = !canEditStatus;
        if(inpStatusRented) inpStatusRented.disabled = !canEditStatus; // NOVO: Segue a mesma regra do status

        const ownerSelect = document.getElementById("form-owner-select");
        if(ownerSelect) ownerSelect.disabled = disableCore;

        if (isEvt) {
            propertiesContainer.classList.add("hidden");
            if (btnAddProperty) btnAddProperty.classList.add("hidden");
            inpEventComment.parentElement.classList.remove("hidden");
            if(clContainer) clContainer.classList.add("hidden");
            if(clientHeader) clientHeader.classList.add("hidden");
            if(btnAddClient) btnAddClient.classList.add("hidden");
        } else {
            propertiesContainer.classList.remove("hidden");
            if (btnAddProperty) btnAddProperty.classList.toggle("hidden", !canInteractGeneral);
            inpEventComment.parentElement.classList.add("hidden");
            if(clContainer) clContainer.classList.remove("hidden");
            if(clientHeader) clientHeader.classList.remove("hidden");
            // Botão Adicionar Cliente: segue regra geral de interação (bloqueado se Locked)
            if(btnAddClient) btnAddClient.classList.toggle("hidden", !canInteractGeneral);
            enforceClientRowPermissions(isLocked, isCoreEditor, chkIsEvent.checked);
        }
    };

    chkIsEvent.checked = isEvent; 
    chkIsEvent.dispatchEvent(new Event('change')); 
    chkIsEvent.onclick = updateFormState;
    updateFormState(); // Init

    // --- RECORRÊNCIA (ADMIN) ---
    if (isAdmin && !appt) {
        recurrenceSection.classList.remove("hidden");
        document.getElementById("recurrence-end-date").value = "";
        document.querySelectorAll("input[name='recurrence-day']").forEach(c => c.checked = false);
    } else {
        recurrenceSection.classList.add("hidden");
    }

    // --- BOTÕES DE AÇÃO VISUAL ---
    // MUDANÇA 3: Botão Salvar visível se puder salvar algo (mesmo que só o status)
    btnSave.classList.toggle("hidden", !showSaveButton);
    btnDel.classList.toggle("hidden", !canDelete);
    
    // Configura o botão de adicionar cliente
    if(btnAddClient) {
        const newBtn = btnAddClient.cloneNode(true);
        btnAddClient.parentNode.replaceChild(newBtn, btnAddClient);
        btnAddClient = newBtn;
        btnAddClient.onclick = (e) => {
             e.preventDefault(); e.stopPropagation(); 
             const nowStr = new Date().toLocaleString("pt-BR");
             addClientRow("", "", state.userProfile.email, 0, true, state.userProfile.name, nowStr);
        };
    }

    if(btnAddProperty) {
        const newBtnProperty = btnAddProperty.cloneNode(true);
        btnAddProperty.parentNode.replaceChild(newBtnProperty, btnAddProperty);
        btnAddProperty = newBtnProperty;
        
        // Garante que o botão comece visível (pode ter sido escondido num clique anterior)
        btnAddProperty.style.display = ""; 
        
        btnAddProperty.onclick = (e) => {
             e.preventDefault(); e.stopPropagation();
             let rowsCount = document.querySelectorAll(".property-item-row").length;
             
             if (rowsCount < 4) {
                 addPropertyRow("", "", rowsCount, canInteractGeneral && !chkIsEvent.checked);
                 rowsCount++; // Atualiza a contagem após adicionar
             }
             
             // Se após adicionar chegou em 4, esconde o botão
             if (rowsCount >= 4) {
                 btnAddProperty.style.display = "none";
             }
        };
    }

    // --- PREENCHIMENTO DE DADOS ESPECÍFICOS ---
    if (appt) {
        document.getElementById("modal-title").innerText = isEvent ? "Evento/Aviso" : "Detalhes da Visita";
        renderHeaderInfo(headerInfo, appt, isAdmin, isSuperAdmin);
        renderHistoryLogs(appt, isAdmin);

        if (isEvent) {
            inpEventComment.value = appt.eventComment || "";
            renderPropertiesInput([], false);
        } else {
            renderPropertiesInput(getPropertyList(appt), canInteractGeneral && !isEvent);
            // Clientes só editáveis se não bloqueado geral
            renderClientsInput(getClientList(appt), canInteractGeneral, amICreator, isAdmin, appt);
        }
        inpStart.value = appt.startTime;
        inpEnd.value = appt.endTime;

        if ((canInteractGeneral) && !isEvent) {
            const clientList = getClientList(appt);
            let targetClient = null;
            if (isCoreEditor) {
                 if (clientList.length > 0) targetClient = clientList[0];
            } else if (amIShared) {
                 targetClient = clientList.find(c => c.addedBy === state.userProfile.email);
            }
            const brokerNameForWhats = BROKERS.find((b) => b.id === appt.brokerId)?.name || "Desconhecido";
            if (targetClient && targetClient.phone) whatsContainer.appendChild(
                createWhatsappButton(targetClient.name, targetClient.phone, appt, brokerNameForWhats)
            );
        }
    } else {
        // NOVO AGENDAMENTO
        setupNewAppointmentUI(defaults, inpBroker, null, null, inpDate, null, null, inpEventComment, inpStart, inpEnd, updateFormState);
    }

    // --- COMPARTILHAMENTO ---
    setupShareSection(shareCheckboxes, shareSection, isCoreEditor, isLocked, isEvent, appt);

    // --- BOTÃO DELETAR ---
    btnDel.onclick = () => {
        if(onDeleteCallback) onDeleteCallback(appt);
    };
    
    setupClientObserver(enforceClientRowPermissions, isLocked, isCoreEditor, chkIsEvent);
}

// --- FUNÇÕES AUXILIARES DE UI ---

function setupCustomLayout(inpBroker, divEventType) {
    const brokerContainer = inpBroker.parentElement; 
    let topRowWrapper = document.getElementById("custom-top-row-wrapper");
    if (!topRowWrapper) {
        topRowWrapper = document.createElement("div");
        topRowWrapper.id = "custom-top-row-wrapper";
        topRowWrapper.style.display = "flex";
        topRowWrapper.style.alignItems = "center";
        topRowWrapper.style.gap = "15px";
        topRowWrapper.style.marginBottom = "10px";
        brokerContainer.parentNode.insertBefore(topRowWrapper, brokerContainer);
        brokerContainer.style.flex = "1"; 
        brokerContainer.style.marginBottom = "0";
        topRowWrapper.appendChild(brokerContainer);
        const separator = document.createElement("div");
        separator.style.borderLeft = "1px solid #e2e8f0";
        separator.style.height = "35px";
        separator.style.margin = "0 5px";
        topRowWrapper.appendChild(separator);
        divEventType.style.marginBottom = "0"; 
        divEventType.style.flex = "1"; 
        divEventType.style.display = "flex"; 
        divEventType.style.alignItems = "center"; 
        divEventType.style.justifyContent = "flex-start"; 
        topRowWrapper.appendChild(divEventType);
    }
}

function populateBrokerField(inpBroker, brokerStatic, btnChangeBroker, appt, defaults) {
    inpBroker.innerHTML = ""; 
    BROKERS.forEach(b => {
        const opt = document.createElement("option");
        opt.value = b.id; opt.innerText = b.name; inpBroker.appendChild(opt);
    });
    const brokerId = appt ? appt.brokerId : defaults.brokerId;
    inpBroker.value = brokerId;
    
    inpBroker.classList.remove("hidden");
}

function populateDateField(inpDate, dateStatic, btnChangeDate, appt, defaults) {
    const targetDate = appt ? appt.date : defaults.date;
    inpDate.value = targetDate;
    
    inpDate.classList.remove("hidden");
}

function populateLinkedConsultantField(selectEl, appt) {
    if (!selectEl) return;

    const fallbackEmail = appt?.linkedConsultantEmail || appt?.createdBy || state.userProfile?.email || "";
    const currentName = appt?.linkedConsultantName || appt?.createdByName || "";

    let options = '<option value="">Selecione um consultor</option>';
    const sortedConsultants = [...(state.availableConsultants || [])].sort((a, b) => a.name.localeCompare(b.name));
    sortedConsultants.forEach((c) => {
        const selected = c.email === fallbackEmail ? 'selected' : '';
        options += `<option value="${c.email}" ${selected}>${c.name}</option>`;
    });

    if (fallbackEmail && !sortedConsultants.find((c) => c.email === fallbackEmail)) {
        options += `<option value="${fallbackEmail}" selected>${currentName || fallbackEmail} (Inativo)</option>`;
    }

    selectEl.innerHTML = options;
    if (fallbackEmail) selectEl.value = fallbackEmail;
}

function enforceClientRowPermissions(isLocked, isCoreEditor, isEvtMode) {
    const rows = document.querySelectorAll(".client-item-row");
    if(isEvtMode) return; 

    rows.forEach(row => {
        const addedByInput = row.querySelector(".client-added-by");
        const rowOwner = addedByInput ? addedByInput.value : "";
        const isMine = (rowOwner === state.userProfile.email);
        
        // Clientes: Se está bloqueado, ninguém edita dados do cliente.
        let canEditThisRow = (!isLocked) && (isCoreEditor || isMine);
        
        const nameInp = row.querySelector(".client-name-input");
        const phoneInp = row.querySelector(".client-phone-input");
        if(nameInp) nameInp.disabled = !canEditThisRow;
        if(phoneInp) phoneInp.disabled = !canEditThisRow;

        const btnWrap = row.querySelector(".remove-client-btn-container");
        const btnDel = row.querySelector(".remove-client-btn");
        if (btnDel) {
            const showRemove = canEditThisRow && rows.length > 1;
            btnDel.style.display = showRemove ? "flex" : "none";
            if (btnWrap) btnWrap.style.display = showRemove ? "flex" : "none";
        }

    });
}

function setupClientObserver(enforceFn, isLocked, isCoreEditor, chkIsEvent) {
    const clientsContainer = document.getElementById("clients-container");
    if(clientsContainer) {
        if(clientsContainer._permissionObserver) {
            clientsContainer._permissionObserver.disconnect();
        }
        const observer = new MutationObserver(() => {
            enforceFn(isLocked, isCoreEditor, chkIsEvent.checked);
        });
        observer.observe(clientsContainer, { childList: true, subtree: true });
        clientsContainer._permissionObserver = observer;
    }
}

function setupNewAppointmentUI(defaults, inpBroker, brokerStatic, btnChangeBroker, inpDate, dateStatic, btnChangeDate, inpEventComment, inpStart, inpEnd, updateFormState) {
    document.getElementById("modal-title").innerText = "Novo Agendamento";
    const headerInfo = document.getElementById("creation-info-header");
    if(headerInfo) headerInfo.innerHTML = "";
    
    inpBroker.classList.remove("hidden");
    inpBroker.disabled = false;
    
    inpDate.classList.remove("hidden");

    renderPropertiesInput([], true); inpEventComment.value = "";
    document.getElementById("clients-container").innerHTML = "";
    const nowStr = new Date().toLocaleString("pt-BR");
    
    addClientRow("", "", state.userProfile.email, 0, true, state.userProfile.name, nowStr);

    inpStart.value = defaults.time;
    const [h, m] = defaults.time.split(":").map(Number);
    const endH = h + 1 >= 24 ? "24" : (h + 1).toString();
    inpEnd.value = `${endH.padStart(2,"0")}:${m.toString().padStart(2,"0")}`;
    
    document.getElementById("audit-log-container").classList.add("hidden");
    
    const historyContainer = document.getElementById("history-logs-container");
    if (historyContainer) historyContainer.style.display = "none";

    const inpStatus = document.getElementById("form-status");
    const inpStatusObs = document.getElementById("form-status-obs");
    const inpStatusRented = document.getElementById("form-status-rented"); // NOVO: Limpa checkbox em novo agendamento
    if(inpStatus) inpStatus.value = "agendada";
    if(inpStatusObs) inpStatusObs.value = "";
    if(inpStatusRented) inpStatusRented.checked = false; // NOVO: Garante que vem desmarcado
    
    updateFormState();
}

function renderHeaderInfo(headerInfo, appt, isAdmin, isSuperAdmin) {
    if(!headerInfo) return;
    const creationDate = appt.createdAt ? new Date(appt.createdAt).toLocaleString("pt-BR") : "N/A";
    let originalCreatorName = appt.createdByName;
    if (appt.history && appt.history.length > 0) originalCreatorName = appt.history[0].user; 
    let idBadgeHtml = (isAdmin || isSuperAdmin) ? `<div class="id-badge">#${appt.id.slice(0, 5).toUpperCase()}</div>` : "";
    let recurrenceIcon = appt.groupId ? `<span class="recurrence-icon"><i class="fas fa-sync-alt"></i></span>` : "";

    let ownerHtml = "";
    if (isAdmin) {
        let options = "";
        const currentOwnerEmail = appt.createdBy;
        const sortedConsultants = [...state.availableConsultants].sort((a,b) => a.name.localeCompare(b.name));
        sortedConsultants.forEach(c => {
            const selected = c.email === currentOwnerEmail ? "selected" : "";
            options += `<option value="${c.email}" ${selected}>${c.name}</option>`;
        });
        if (!state.availableConsultants.find(c => c.email === currentOwnerEmail)) options += `<option value="${currentOwnerEmail}" selected>${appt.createdByName} (Inativo)</option>`;
        ownerHtml = `<div class="owner-select-wrapper"><label>Responsável:</label><select id="form-owner-select" class="owner-select-styled">${options}</select></div>`;
    } else {
        ownerHtml = `<div class="owner-select-wrapper"><label>Responsável:</label><span style="font-weight:600; font-size:0.9rem; color:#334155;">${appt.createdByName}</span></div>`;
    }
    headerInfo.innerHTML = `<div class="meta-header-container"><div class="meta-left-group">${ownerHtml}<span class="meta-info-text">Criado por <strong>${originalCreatorName}</strong> em ${creationDate} ${recurrenceIcon}</span></div>${idBadgeHtml}</div>`;
}

function renderHistoryLogs(appt, isAdmin) {
    if (isAdmin && appt && appt.history && appt.history.length > 0) {
        let historyContainer = document.getElementById("history-logs-container");
        if (!historyContainer) {
            historyContainer = document.createElement("div");
            historyContainer.id = "history-logs-container";
            historyContainer.style.marginTop = "20px";
            historyContainer.style.padding = "10px";
            historyContainer.style.backgroundColor = "#f1f5f9";
            historyContainer.style.borderRadius = "6px";
            historyContainer.style.border = "1px solid #e2e8f0";
            historyContainer.style.fontSize = "0.8rem";
            historyContainer.style.maxHeight = "150px";
            historyContainer.style.overflowY = "auto";
            
            const formStart = document.getElementById("form-start"); 
            if(formStart && formStart.form) {
                 formStart.form.appendChild(historyContainer);
            } else {
                 const modalContent = document.querySelector(".modal-content") || document.getElementById("modal");
                 modalContent.appendChild(historyContainer);
            }
        }

        historyContainer.innerHTML = `<h4 style="margin:0 0 10px 0; font-size:0.9rem; color:#334155; border-bottom:1px solid #cbd5e1; padding-bottom:5px;">Histórico de Edições (Admin)</h4>`;
        historyContainer.style.display = "block";

        const sortedHistory = [...appt.history].reverse();
        sortedHistory.forEach(log => {
            const logItem = document.createElement("div");
            logItem.style.marginBottom = "8px";
            logItem.style.lineHeight = "1.4";
            const actionStyle = "color:#475569;";
            const metaStyle = "font-weight:bold; color:#0f172a;";
            logItem.innerHTML = `<div style="${metaStyle}">${log.date} - ${log.user}</div><div style="${actionStyle}">${log.action}</div>`;
            historyContainer.appendChild(logItem);
        });
    } else {
        const historyContainer = document.getElementById("history-logs-container");
        if (historyContainer) historyContainer.style.display = "none";
    }
}

function setupShareSection(shareCheckboxes, shareSection, isCoreEditor, isLocked, isEvent, appt) {
    shareCheckboxes.innerHTML = "";
    const canShare = isCoreEditor && !isLocked && !isEvent;
    
    if (state.availableConsultants.length > 0 && !isEvent) {
        shareSection.classList.remove("hidden");
        const currentShared = (appt && appt.sharedWith) ? appt.sharedWith : [];
        state.availableConsultants.forEach(c => {
            if (c.email === state.userProfile.email) return;
            const div = document.createElement("div");
            div.className = "checkbox-item";
            const chk = document.createElement("input");
            chk.type = "checkbox"; 
            chk.value = c.email;
            chk.checked = currentShared.includes(c.email);
            chk.disabled = !canShare;
            div.appendChild(chk);
            div.appendChild(document.createTextNode(c.name));
            shareCheckboxes.appendChild(div);
        });

        const btnSelAll = document.getElementById("btn-select-all");
        if(btnSelAll) {
            btnSelAll.style.display = canShare ? "block" : "none";
            btnSelAll.onclick = () => {
                const chks = document.querySelectorAll("#share-checkboxes input[type='checkbox']:not(:disabled)");
                const allC = Array.from(chks).every(c => c.checked);
                chks.forEach(c => c.checked = !allC);
            };
        }
    } else {
        shareSection.classList.add("hidden");
    }
}

export function renderClientsInput(clients, formEditable, isCreator, isAdmin, apptContext = null) {
    const clientsContainer = document.getElementById("clients-container");
    clientsContainer.innerHTML = "";
    if (!clients || clients.length === 0) {
        const nowStr = new Date().toLocaleString("pt-BR");
        addClientRow("", "", state.userProfile.email, 0, formEditable, state.userProfile.name, nowStr);
    } else {
        clients.forEach((c, index) => {
            addClientRow(c.name || "", c.phone || "", c.addedBy, index, formEditable, c.addedByName || "", c.addedAt || "");
        });
    }
}

function getPropertiesFromUI() {
    const rows = document.querySelectorAll(".property-item-row");
    const properties = [];
    rows.forEach((row) => {
        const refInput = row.querySelector(".property-reference-input");
        const addressInput = row.querySelector(".property-address-input");
        const reference = refInput ? refInput.value.trim() : "";
        const propertyAddress = addressInput ? addressInput.value.trim() : "";
        if (reference || propertyAddress) properties.push({ reference, propertyAddress });
    });
    return properties;
}

function getFirstPropertyField(field) {
    const firstProperty = getPropertiesFromUI()[0] || { reference: "", propertyAddress: "" };
    return field === "reference" ? firstProperty.reference : firstProperty.propertyAddress;
}

function renderPropertiesInput(properties, editable) {
    const container = document.getElementById("properties-container");
    if (!container) return;
    container.innerHTML = "";

    const propList = (properties && properties.length > 0) ? properties : [{ reference: "", propertyAddress: "" }];
    propList.forEach((prop, idx) => {
        addPropertyRow(prop.reference || "", prop.propertyAddress || "", idx, editable);
    });
}

function togglePropertiesDisabled(disabled, disableRemove = false) {
    document.querySelectorAll(".property-reference-input, .property-address-input").forEach(inp => {
        inp.disabled = disabled;
    });
    document.querySelectorAll(".remove-property-btn").forEach(btn => {
        btn.disabled = disabled || disableRemove;
    });
}