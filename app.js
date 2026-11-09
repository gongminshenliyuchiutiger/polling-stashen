/**
 * 投開票所工作人員手冊 3D 互動導覽模型 - 介面控制與互動邏輯
 */

document.addEventListener("DOMContentLoaded", () => {
    let currentMode = "polling";
    let currentStationIndex = 0;
    let autoTourTimer = null;

    // 取得當前模式的導覽站點陣列
    function getActiveStations() {
        return currentMode === "polling"
            ? HANDBOOK_DATA.pollingStations
            : HANDBOOK_DATA.countingStations;
    }

    // 初始化 3D 場景引擎
    const viewer3D = new PollingStation3D(
        "canvas-container",
        "labels-container",
        (selectedStation) => {
            const list = getActiveStations();
            const idx = list.findIndex(s => s.id === selectedStation.id);
            if (idx !== -1) {
                currentStationIndex = idx;
            }
            renderStationDetail(selectedStation, currentStationIndex, list.length);
            renderStationPills();
        }
    );

    // 渲染右側站點快速切換膠囊
    function renderStationPills() {
        const list = getActiveStations();
        const container = document.getElementById("station-pills-list");
        container.innerHTML = "";

        list.forEach((st, idx) => {
            const btn = document.createElement("button");
            btn.className = `station-pill ${idx === currentStationIndex ? "active" : ""}`;
            btn.style.setProperty("--pill-color", st.badgeColor);
            btn.innerHTML = `
                <span>${st.step}.</span>
                <i class="${st.icon}"></i>
                <span>${st.name.split("（")[0]}</span>
            `;
            btn.addEventListener("click", () => {
                stopAutoTour();
                currentStationIndex = idx;
                viewer3D.selectStation(st.id, true);
            });
            container.appendChild(btn);
        });
    }

    // 渲染右側站點詳細職務與佈置規範
    function renderStationDetail(station, index, total) {
        document.getElementById("station-progress-text").textContent = `${index + 1} / ${total}`;

        const iconBox = document.getElementById("detail-icon-box");
        iconBox.style.background = station.badgeColor;
        document.getElementById("detail-icon").className = station.icon;

        document.getElementById("detail-category").innerHTML = `<i class="fa-solid fa-user-tag"></i> ${station.roleCategory}`;
        document.getElementById("detail-pageref").innerHTML = `<i class="fa-solid fa-book-open"></i> ${station.pageRef}`;
        document.getElementById("detail-title").textContent = `${station.step}. ${station.name}`;
        document.getElementById("detail-summary").textContent = station.summary;

        const dutiesList = document.getElementById("detail-duties-list");
        dutiesList.innerHTML = station.duties
            .map(duty => `<li><i class="fa-solid fa-circle-check"></i><span>${duty}</span></li>`)
            .join("");
    }

    // 初始渲染第一站
    renderStationPills();
    renderStationDetail(HANDBOOK_DATA.pollingStations[0], 0, HANDBOOK_DATA.pollingStations.length);

    // 模式切換按鈕 (投票所佈置 vs 開票所佈置)
    const btnPolling = document.getElementById("btn-mode-polling");
    const btnCounting = document.getElementById("btn-mode-counting");
    const countingToast = document.getElementById("counting-toast");

    function switchSceneMode(mode) {
        stopAutoTour();
        currentMode = mode;
        currentStationIndex = 0;

        btnPolling.classList.toggle("active", mode === "polling");
        btnCounting.classList.toggle("active", mode === "counting");

        // 重置動態模擬按鈕狀態
        const simBtn = document.getElementById("btn-simulate-flow");
        simBtn.classList.remove("active");
        document.getElementById("sim-btn-label").textContent = mode === "polling" ? "模擬投票動線" : "模擬唱票計票";
        countingToast.classList.add("hidden");

        viewer3D.setMode(mode, true);
        renderStationPills();
    }

    btnPolling.addEventListener("click", () => switchSceneMode("polling"));
    btnCounting.addEventListener("click", () => switchSceneMode("counting"));

    // 上一站點 / 下一站點按鈕
    document.getElementById("btn-prev-station").addEventListener("click", () => {
        stopAutoTour();
        const list = getActiveStations();
        currentStationIndex = (currentStationIndex - 1 + list.length) % list.length;
        viewer3D.selectStation(list[currentStationIndex].id, true);
    });

    document.getElementById("btn-next-station").addEventListener("click", () => {
        stopAutoTour();
        const list = getActiveStations();
        currentStationIndex = (currentStationIndex + 1) % list.length;
        viewer3D.selectStation(list[currentStationIndex].id, true);
    });

    // 3D 視角與模擬工具列控制
    document.getElementById("btn-view-overview").addEventListener("click", () => {
        stopAutoTour();
        viewer3D.resetCameraOverview();
    });

    document.getElementById("btn-view-top").addEventListener("click", () => {
        stopAutoTour();
        viewer3D.setTopDownView();
    });

    const btnToggleFlow = document.getElementById("btn-toggle-flow");
    btnToggleFlow.addEventListener("click", () => {
        const visible = viewer3D.toggleFlowHelpers();
        btnToggleFlow.classList.toggle("active", visible);
    });

    const btnSimFlow = document.getElementById("btn-simulate-flow");
    btnSimFlow.addEventListener("click", () => {
        const active = viewer3D.toggleSimulation();
        btnSimFlow.classList.toggle("active", active);
        if (currentMode === "counting") {
            countingToast.classList.toggle("hidden", !active);
        } else {
            countingToast.classList.add("hidden");
        }
    });

    // 開票唱票動態回呼更新氣泡文字
    window.onCountingCallTick = (candidateIdx, counts) => {
        const names = [
            "1 號 快樂鯉魚 一票！（記票員複唱並劃記「正」字）",
            "2 號 秋老虎 一票！（記票員複唱並劃記「正」字）",
            "3 號 公民神 一票！（記票員複唱並劃記「正」字）",
            "發現爭議票！會同主任管理員與主任監察員認定"
        ];
        const textEl = document.getElementById("counting-toast-text");
        if (textEl) {
            textEl.textContent = `${names[candidateIdx]} ｜ 目前累計：${counts[candidateIdx]} 票`;
        }
    };

    // 停電輔助照明模擬按鈕
    const btnEmergency = document.getElementById("btn-emergency-light");
    btnEmergency.addEventListener("click", () => {
        const isEmergency = viewer3D.toggleEmergencyLighting();
        btnEmergency.classList.toggle("active", isEmergency);
    });

    // 自動巡覽導覽功能
    const btnAutoTour = document.getElementById("btn-auto-tour");
    function stopAutoTour() {
        if (autoTourTimer) {
            clearInterval(autoTourTimer);
            autoTourTimer = null;
            btnAutoTour.classList.remove("active");
        }
    }

    btnAutoTour.addEventListener("click", () => {
        if (autoTourTimer) {
            stopAutoTour();
        } else {
            btnAutoTour.classList.add("active");
            const list = getActiveStations();
            viewer3D.selectStation(list[currentStationIndex].id, true);
            autoTourTimer = setInterval(() => {
                const activeList = getActiveStations();
                currentStationIndex = (currentStationIndex + 1) % activeList.length;
                viewer3D.selectStation(activeList[currentStationIndex].id, true);
            }, 4200);
        }
    });

    // 行動裝置抽屜展開/收合控制
    const sidebar = document.getElementById("info-sidebar");
    const drawerBtn = document.getElementById("btn-mobile-drawer");
    const drawerChevron = document.getElementById("drawer-chevron");
    drawerBtn.addEventListener("click", () => {
        const isOpen = sidebar.classList.toggle("open");
        drawerChevron.className = isOpen ? "fa-solid fa-chevron-down" : "fa-solid fa-chevron-up";
    });

    // =========================================================================
    // 知識庫 Modals 渲染與互動
    // =========================================================================
    function renderWorkflowModal(key = "dayBefore") {
        const wf = HANDBOOK_DATA.workflows[key];
        const body = document.getElementById("workflow-content-body");
        body.innerHTML = `
            <h3 class="rules-section-title"><i class="${wf.icon}"></i> ${wf.title}</h3>
            <div class="timeline-list">
                ${wf.steps.map(st => `
                    <div class="timeline-card">
                        <div class="timeline-num">${st.num}</div>
                        <div class="timeline-info">
                            <h4>${st.title}</h4>
                            <p>${st.desc}</p>
                        </div>
                    </div>
                `).join("")}
            </div>
        `;
    }

    document.querySelectorAll(".workflow-tab-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            document.querySelectorAll(".workflow-tab-btn").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            renderWorkflowModal(btn.dataset.wf);
        });
    });

    function renderRulesModal() {
        const body = document.getElementById("rules-content-body");
        body.innerHTML = `
            <h3 class="rules-section-title"><i class="fa-solid fa-ban"></i> 參、維持投開票所秩序：六大禁止與制止事項（手冊第 06-07 頁）</h3>
            <div class="rules-grid">
                ${HANDBOOK_DATA.regulations.prohibitedActs.map(item => `
                    <div class="rule-card">
                        <div class="rule-card-head">
                            <i class="${item.icon}"></i>
                            <h4>${item.title}</h4>
                        </div>
                        <p>${item.desc}</p>
                    </div>
                `).join("")}
            </div>
            <h3 class="rules-section-title"><i class="fa-solid fa-hands-holding-child"></i> 陸、協助身心障礙選舉人投票注意事項（手冊第 19 頁）</h3>
            <div class="rules-grid">
                ${HANDBOOK_DATA.regulations.accessibilityRules.map(item => `
                    <div class="rule-card access">
                        <div class="rule-card-head">
                            <i class="${item.icon}"></i>
                            <h4>${item.title}</h4>
                        </div>
                        <p>${item.desc}</p>
                    </div>
                `).join("")}
            </div>
        `;
    }

    function renderCommissionsList(filterText = "") {
        const grid = document.getElementById("commissions-grid");
        const kw = filterText.trim().toLowerCase();
        const filtered = HANDBOOK_DATA.commissions.filter(c =>
            c.name.toLowerCase().includes(kw) ||
            c.address.toLowerCase().includes(kw) ||
            c.phone.toLowerCase().includes(kw) ||
            c.region.toLowerCase().includes(kw)
        );
        grid.innerHTML = filtered.map(c => `
            <div class="commission-card">
                <h4>
                    <span><i class="fa-solid fa-building-flag"></i> ${c.name}</span>
                    <span class="meta-tag">${c.region}</span>
                </h4>
                <p><i class="fa-solid fa-phone"></i> 電話：${c.phone}</p>
                <p><i class="fa-solid fa-location-dot"></i> 地址：${c.address}</p>
            </div>
        `).join("");
    }

    document.getElementById("commission-search").addEventListener("input", (e) => {
        renderCommissionsList(e.target.value);
    });

    function renderQuizModal() {
        const body = document.getElementById("quiz-content-body");
        body.innerHTML = HANDBOOK_DATA.quizQuestions.map((item, qIdx) => `
            <div class="quiz-card" data-qidx="${qIdx}">
                <div class="quiz-q"><i class="fa-solid fa-circle-question"></i> 第 ${qIdx + 1} 題：${item.q}</div>
                <div class="quiz-options">
                    ${item.options.map((opt, oIdx) => `
                        <button class="quiz-opt-btn" data-q="${qIdx}" data-o="${oIdx}">
                            <i class="fa-regular fa-circle"></i>
                            <span>${opt}</span>
                        </button>
                    `).join("")}
                </div>
                <div id="quiz-exp-${qIdx}" class="quiz-explain hidden">
                    <i class="fa-solid fa-lightbulb"></i> <strong>解析：</strong>${item.explanation}
                </div>
            </div>
        `).join("");

        body.querySelectorAll(".quiz-opt-btn").forEach(btn => {
            btn.addEventListener("click", () => {
                const qIdx = parseInt(btn.dataset.q, 10);
                const oIdx = parseInt(btn.dataset.o, 10);
                const qData = HANDBOOK_DATA.quizQuestions[qIdx];
                const card = btn.closest(".quiz-card");

                card.querySelectorAll(".quiz-opt-btn").forEach((b, idx) => {
                    b.disabled = true;
                    const icon = b.querySelector("i");
                    if (idx === qData.answer) {
                        b.classList.add("correct");
                        icon.className = "fa-solid fa-circle-check";
                    } else if (idx === oIdx && oIdx !== qData.answer) {
                        b.classList.add("wrong");
                        icon.className = "fa-solid fa-circle-xmark";
                    }
                });

                document.getElementById(`quiz-exp-${qIdx}`).classList.remove("hidden");
            });
        });
    }

    // 初始化所有 Modal 內容並綁定開關事件
    renderWorkflowModal("dayBefore");
    renderRulesModal();
    renderCommissionsList();
    renderQuizModal();

    document.querySelectorAll("[data-modal]").forEach(btn => {
        btn.addEventListener("click", () => {
            const targetId = btn.dataset.modal;
            document.getElementById(targetId).classList.remove("hidden");
        });
    });

    document.querySelectorAll("[data-close]").forEach(btn => {
        btn.addEventListener("click", () => {
            btn.closest(".modal-backdrop").classList.add("hidden");
        });
    });

    document.querySelectorAll(".modal-backdrop").forEach(backdrop => {
        backdrop.addEventListener("click", (e) => {
            if (e.target === backdrop) {
                backdrop.classList.add("hidden");
            }
        });
    });

    // =========================================================================
    // 左下角吉祥物自由拖曳功能 (支援滑鼠與觸控，可移動到畫面任何地方)
    // =========================================================================
    const mascot = document.getElementById("draggable-mascot");
    let isDraggingMascot = false;
    let dragOffsetX = 0;
    let dragOffsetY = 0;

    mascot.addEventListener("pointerdown", (e) => {
        isDraggingMascot = true;
        mascot.setPointerCapture(e.pointerId);
        const rect = mascot.getBoundingClientRect();
        dragOffsetX = e.clientX - rect.left;
        dragOffsetY = e.clientY - rect.top;
        mascot.style.transition = "none";
    });

    mascot.addEventListener("pointermove", (e) => {
        if (!isDraggingMascot) return;
        const maxX = window.innerWidth - mascot.offsetWidth;
        const maxY = window.innerHeight - mascot.offsetHeight;
        const newLeft = Math.max(0, Math.min(maxX, e.clientX - dragOffsetX));
        const newTop = Math.max(0, Math.min(maxY, e.clientY - dragOffsetY));

        mascot.style.left = `${newLeft}px`;
        mascot.style.top = `${newTop}px`;
        mascot.style.bottom = "auto";
        mascot.style.right = "auto";
    });

    const endMascotDrag = (e) => {
        if (!isDraggingMascot) return;
        isDraggingMascot = false;
        if (e.pointerId !== undefined && mascot.hasPointerCapture(e.pointerId)) {
            mascot.releasePointerCapture(e.pointerId);
        }
        mascot.style.transition = "transform 0.15s ease";
    };

    mascot.addEventListener("pointerup", endMascotDrag);
    mascot.addEventListener("pointercancel", endMascotDrag);

    // 視窗縮放時確保已拖曳之吉祥物不會超出畫面邊界
    window.addEventListener("resize", () => {
        if (mascot.style.top && mascot.style.top !== "auto") {
            const rect = mascot.getBoundingClientRect();
            const maxX = Math.max(0, window.innerWidth - mascot.offsetWidth);
            const maxY = Math.max(0, window.innerHeight - mascot.offsetHeight);
            if (rect.left > maxX) mascot.style.left = `${maxX}px`;
            if (rect.top > maxY) mascot.style.top = `${maxY}px`;
        }
    });
});
