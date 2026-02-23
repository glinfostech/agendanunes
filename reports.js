import { db, state, BROKERS } from "./config.js";
import { collection, query, getDocs } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";

let currentReportData = [];

function normalizeRole(role) {
    return String(role || "").trim().toLowerCase();
}

export function initReports() {
    if (!state.userProfile || normalizeRole(state.userProfile.role) !== "admin") return;
    injectReportButton();
    injectReportModal();
}

function injectReportButton() {
    const controls = document.querySelector(".navbar .controls-section");
    if (!controls || document.querySelector(".btn-report")) return;

    const btn = document.createElement("button");
    btn.className = "btn-report";
    btn.type = "button";
    btn.innerHTML = `<i class="fas fa-chart-line"></i> Relatórios`;
    btn.onclick = openReportModal;

    controls.prepend(btn);
}

function injectReportModal() {
    if (document.getElementById("report-modal")) return;

    const modalHtml = `
    <div id="report-modal" class="report-modal">
        <div class="report-content">
            <div class="report-header">
                <h2><i class="fas fa-trophy"></i> Ranking de Taxa de Conversão</h2>
                <button class="btn-close-report" onclick="closeReportModal()"><i class="fas fa-times"></i></button>
            </div>

            <div class="report-filters">
                <div class="filters-grid">
                    <div class="filter-group">
                        <label>Data Inicial</label>
                        <input type="date" id="rep-start-date" class="form-control">
                    </div>

                    <div class="filter-group">
                        <label>Data Final</label>
                        <input type="date" id="rep-end-date" class="form-control">
                    </div>

                    <div class="filter-group">
                        <label>Corretor</label>
                        <select id="rep-broker" class="form-control">
                            <option value="">Todos</option>
                            ${BROKERS.map((b) => `<option value="${b.id}">${b.name}</option>`).join("")}
                        </select>
                    </div>

                    <div class="filter-group">
                        <label>Consultor</label>
                        <select id="rep-consultant" class="form-control">
                            <option value="">Todos</option>
                        </select>
                    </div>

                    <div class="filter-group button-group">
                        <button class="btn-generate" onclick="generateReport()">
                            <i class="fas fa-search"></i> Gerar
                        </button>
                    </div>
                </div>
            </div>

            <div class="report-results" id="report-results-area">
                <div class="placeholder-msg">Selecione os filtros e clique em Gerar</div>
            </div>
        </div>
    </div>`;

    document.body.insertAdjacentHTML("beforeend", modalHtml);

    const modal = document.getElementById("report-modal");
    modal.addEventListener("click", (e) => {
        if (e.target === modal) closeReportModal();
    });

    document.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && modal.classList.contains("open")) closeReportModal();
    });
}

window.openReportModal = openReportModal;
window.closeReportModal = closeReportModal;
window.generateReport = generateReport;
window.changeReportPage = changeReportPage;

function openReportModal() {
    populateConsultants();

    const now = new Date();
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0];
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split("T")[0];

    document.getElementById("rep-start-date").value = firstDay;
    document.getElementById("rep-end-date").value = lastDay;
    document.getElementById("report-modal").classList.add("open");
}

function closeReportModal() {
    document.getElementById("report-modal").classList.remove("open");
}

function populateConsultants() {
    const select = document.getElementById("rep-consultant");
    if (!select) return;

    const currentVal = select.value;
    select.innerHTML = '<option value="">Todos</option>';

    if (state.availableConsultants && state.availableConsultants.length > 0) {
        state.availableConsultants.forEach((c) => {
            const opt = document.createElement("option");
            opt.value = c.name;
            opt.textContent = c.name;
            select.appendChild(opt);
        });
    }
    select.value = currentVal;
}

async function generateReport() {
    const startDate = document.getElementById("rep-start-date").value;
    const endDate = document.getElementById("rep-end-date").value;
    const brokerId = document.getElementById("rep-broker").value;
    const consultantName = document.getElementById("rep-consultant").value;
    const consultantObj = state.availableConsultants.find((c) => c.name === consultantName);
    const consultantEmail = consultantObj ? consultantObj.email : "";

    if (!startDate || !endDate) {
        alert("Selecione data inicial e final");
        return;
    }

    const container = document.getElementById("report-results-area");
    container.innerHTML = '<div class="loading-spinner">Carregando ranking...</div>';

    try {
        const snapshot = await getDocs(query(collection(db, "appointments")));
        const filtered = snapshot.docs
            .map((doc) => ({ id: doc.id, ...doc.data() }))
            .filter((item) => {
                if (item.isEvent) return false;
                if (item.deletedAt) return false;
                if (!item.date) return false;
                if (item.date < startDate || item.date > endDate) return false;
                if (brokerId && item.brokerId !== brokerId) return false;
                if (consultantName) {
                    const sharedList = Array.isArray(item.sharedWith) ? item.sharedWith : [];
                    const isOwnerByName = item.createdByName === consultantName;
                    const isOwnerByEmail = consultantEmail && item.createdBy === consultantEmail;
                    const isShared = consultantEmail && sharedList.includes(consultantEmail);
                    if (!isOwnerByName && !isOwnerByEmail && !isShared) return false;
                }
                return true;
            });

        currentReportData = buildRankingData(filtered);
        renderReportTable(startDate, endDate);
    } catch (err) {
        console.error(err);
        container.innerHTML = `<div class="error-msg">Erro ao gerar: ${err.message}</div>`;
    }
}

function buildRankingData(appointments) {
    const groups = new Map();

    appointments.forEach((item) => {
        const brokerId = item.brokerId || "desconhecido";
        const brokerName = BROKERS.find((b) => b.id === brokerId)?.name || item.brokerName || "Sem corretor";

        if (!groups.has(brokerId)) {
            groups.set(brokerId, {
                corretor: brokerName,
                visitasTotais: 0,
                canceladas: 0,
                realizadas: 0,
                alugados: 0
            });
        }

        const row = groups.get(brokerId);
        row.visitasTotais += 1;

        const status = String(item.status || "agendada").toLowerCase();
        
        if (status === "cancelada") row.canceladas += 1;
        
        if (status === "realizada") {
            row.realizadas += 1;
            
            // VERIFICAÇÃO CORRIGIDA AQUI: 
            // Agora ele lê a propriedade booleana salva pelo checkbox (ex: isRented, rented, etc)
            if (item.isRented === true || item.rented === true || item.alugado === true) {
                row.alugados += 1;
            }
        }
        
        // Mantido apenas por segurança caso haja dados muito antigos no banco salvos dessa forma
        if (status === "alugada" || status === "alugado") row.alugados += 1;
    });

    return Array.from(groups.values())
        .map((row) => {
            const realizadas = Math.max(0, row.realizadas);
            
            // --- NOVA REGRA DE 3 APLICADA AQUI ---
// Taxa de Conversão = Alugados / Visitas Totais (O funil completo)
const taxaConversao = row.visitasTotais > 0 ? (row.alugados / row.visitasTotais) * 100 : 0;

// Taxa Efetiva = Alugados / Visitas Realizadas (Eficiência da visita presencial)
const taxaEfetiva = realizadas > 0 ? (row.alugados / realizadas) * 100 : 0;

            return {
                ...row,
                realizadas,
                taxaConversao,
                taxaEfetiva
            };
        })
        .sort((a, b) => b.taxaConversao - a.taxaConversao);
}

function formatPercent(value) {
    return `${Number(value || 0).toLocaleString("pt-BR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    })}%`;
}

function getRankLabel(index) {
    const pos = index + 1;
    const medal = pos === 1 ? "🥇" : pos === 2 ? "🥈" : pos === 3 ? "🥉" : "";
    return `${pos}º${medal ? `<span class="rank-medal"> ${medal}</span>` : ""}`;
}

function formatPeriod(startDate, endDate) {
    const [y1, m1, d1] = startDate.split("-");
    const [y2, m2, d2] = endDate.split("-");
    return `${d1}/${m1}/${y1} até ${d2}/${m2}/${y2}`;
}

function renderReportTable(startDate, endDate) {
    const container = document.getElementById("report-results-area");
    const rankingRows = currentReportData || [];

    const totals = rankingRows.reduce(
        (acc, row) => {
            acc.corretores += 1;
            acc.visitasTotais += row.visitasTotais;
            acc.canceladas += row.canceladas;
            acc.realizadas += row.realizadas || 0;
            acc.alugados += row.alugados;
            return acc;
        },
        {
            corretores: 0,
            visitasTotais: 0,
            canceladas: 0,
            realizadas: 0,
            alugados: 0
        }
    );

    // --- NOVA REGRA DE 3 APLICADA NO TOTAL GERAL AQUI ---
const taxaConversaoGeral = totals.visitasTotais > 0 ? (totals.alugados / totals.visitasTotais) * 100 : 0;
const taxaEfetivaGeral = totals.realizadas > 0 ? (totals.alugados / totals.realizadas) * 100 : 0;


    let html = `
    <div class="ranking-dark-wrapper">
        <div class="ranking-title">Ranking de Taxa de Conversão <span class="ranking-subtitle">(${formatPeriod(startDate, endDate)})</span></div>
        <div class="report-table-container ranking-table-container">
            <table class="report-table ranking-dark-table">
                <thead>
                    <tr>
                        <th>Rank</th>
                        <th>Corretor</th>
                        <th>Visitas Totais</th>
                        <th>Canceladas</th>
                        <th>Visitas Realizadas</th>
                        <th>Alugados</th>
                        <th class="th-right">Taxa Conversão</th>
                        <th class="th-right">Taxa Efetiva</th>
                    </tr>
                </thead>
                <tbody>
    `;

    if (rankingRows.length === 0) {
        html += '<tr><td colspan="8" class="rank-empty">Nenhuma movimentação encontrada para os filtros selecionados.</td></tr>';
    } else {
        rankingRows.forEach((row, index) => {
            html += `
            <tr>
                <td class="rank-col">${getRankLabel(index)}</td>
                <td class="broker-col">${row.corretor}</td>
                <td>${row.visitasTotais}</td>
                <td>${row.canceladas}</td>
                <td>${row.realizadas}</td>
                <td>${row.alugados}</td>
                <td class="pct-col">${formatPercent(row.taxaConversao)}</td>
                <td class="pct-col">${formatPercent(row.taxaEfetiva)}</td>
            </tr>`;
        });
    }

    html += `
                </tbody>
                <tfoot>
                    <tr class="total-geral-row">
                        <td>TOTAL GERAL</td>
                        <td>${totals.corretores} corretores</td>
                        <td>${totals.visitasTotais}</td>
                        <td>${totals.canceladas}</td>
                        <td>${totals.realizadas}</td>
                        <td>${totals.alugados}</td>
                        <td class="pct-col">${formatPercent(taxaConversaoGeral)}</td>
                        <td class="pct-col">${formatPercent(taxaEfetivaGeral)}</td>
                    </tr>
                </tfoot>
            </table>
        </div>
    </div>`;

    container.innerHTML = html;
}

function changeReportPage() {
    /* Mantido por compatibilidade global. */
}