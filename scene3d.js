/**
 * 投開票所 3D 互動導覽場景引擎 (Three.js + GSAP)
 * 負責建構投票所模式、開票所模式、3D 人物與設施模型、動態模擬動畫與相機導覽控制
 */

class PollingStation3D {
    constructor(containerId, labelsContainerId, onSelectStation) {
        this.container = document.getElementById(containerId);
        this.labelsContainer = document.getElementById(labelsContainerId);
        this.onSelectStation = onSelectStation;

        this.mode = "polling"; // 'polling' | 'counting'
        this.selectedId = null;
        this.showFlowHelpers = true;
        this.emergencyLightMode = false;
        this.simulatingFlow = false;

        this.interactables = [];
        this.stationGroups = new Map();
        this.labelElements = new Map();
        this.animatedCharacters = [];

        // 計票模擬狀態
        this.tallyCounts = [13, 8, 17, 1];
        this.tallyCanvas = null;
        this.tallyTexture = null;
        this.callingTimer = 0;
        this.voterSimProgress = 0;

        this.clock = new THREE.Clock();
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        this.pointerDownPos = new THREE.Vector2();

        this.initScene();
        this.buildArchitecture();
        this.buildPollingScene();
        this.buildCountingScene();
        this.setMode("polling", false);
        this.bindEvents();
        this.animate();
    }

    initScene() {
        const width = this.container.clientWidth || window.innerWidth;
        const height = this.container.clientHeight || window.innerHeight;

        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x0f172a);
        this.scene.fog = new THREE.FogExp2(0x0f172a, 0.015);

        this.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 120);
        this.camera.position.set(0, 14.5, 19.5);

        this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
        this.renderer.setSize(width, height);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        this.container.appendChild(this.renderer.domElement);

        this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.06;
        this.controls.maxPolarAngle = Math.PI / 2 - 0.04;
        this.controls.minDistance = 3.5;
        this.controls.maxDistance = 36;
        this.controls.target.set(0, 1.0, 0.5);

        // 燈光系統
        this.ambientLight = new THREE.AmbientLight(0xffffff, 0.68);
        this.scene.add(this.ambientLight);

        this.mainDirLight = new THREE.DirectionalLight(0xfffbeb, 0.85);
        this.mainDirLight.position.set(8, 18, 12);
        this.mainDirLight.castShadow = true;
        this.mainDirLight.shadow.mapSize.width = 2048;
        this.mainDirLight.shadow.mapSize.height = 2048;
        this.mainDirLight.shadow.camera.near = 1;
        this.mainDirLight.shadow.camera.far = 45;
        const d = 14;
        this.mainDirLight.shadow.camera.left = -d;
        this.mainDirLight.shadow.camera.right = d;
        this.mainDirLight.shadow.camera.top = d;
        this.mainDirLight.shadow.camera.bottom = -d;
        this.mainDirLight.shadow.bias = -0.0005;
        this.scene.add(this.mainDirLight);

        this.fillLight = new THREE.DirectionalLight(0x93c5fd, 0.35);
        this.fillLight.position.set(-12, 10, -10);
        this.scene.add(this.fillLight);

        // 停電緊急輔助照明燈 (預設關閉)
        this.emergencySpot1 = new THREE.SpotLight(0xfef08a, 0, 22, Math.PI / 3, 0.4, 1);
        this.emergencySpot1.position.set(-6, 5.2, -5.8);
        this.emergencySpot1.target.position.set(0, 0, -1);
        this.scene.add(this.emergencySpot1);
        this.scene.add(this.emergencySpot1.target);

        this.emergencySpot2 = new THREE.SpotLight(0xfef08a, 0, 22, Math.PI / 3, 0.4, 1);
        this.emergencySpot2.position.set(6, 5.2, -5.8);
        this.emergencySpot2.target.position.set(2, 0, 0);
        this.scene.add(this.emergencySpot2);
        this.scene.add(this.emergencySpot2.target);

        // 選中目標的高亮光環
        const ringGeo = new THREE.RingGeometry(1.1, 1.45, 48);
        ringGeo.rotateX(-Math.PI / 2);
        const ringMat = new THREE.MeshBasicMaterial({
            color: 0x38bdf8,
            side: THREE.DoubleSide,
            transparent: true,
            opacity: 0.85
        });
        this.highlightRing = new THREE.Mesh(ringGeo, ringMat);
        this.highlightRing.position.y = 0.04;
        this.highlightRing.visible = false;
        this.scene.add(this.highlightRing);
    }

    // 工具：繪製高解析度 Canvas 文字貼圖
    createSignTexture(width, height, drawCallback) {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        drawCallback(ctx, width, height);
        const tex = new THREE.CanvasTexture(canvas);
        tex.needsUpdate = true;
        return tex;
    }

    // 建構建築主體（地板、牆面、出入口、走廊、緊急照明設備）
    buildArchitecture() {
        this.archGroup = new THREE.Group();
        this.scene.add(this.archGroup);

        // 外部地面基座
        const baseGeo = new THREE.BoxGeometry(24, 0.4, 20);
        const baseMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.9 });
        const baseMesh = new THREE.Mesh(baseGeo, baseMat);
        baseMesh.position.set(0, -0.22, 1);
        baseMesh.receiveShadow = true;
        this.archGroup.add(baseMesh);

        // 室內木質磁磚地板貼圖
        const floorTex = this.createSignTexture(512, 512, (ctx, w, h) => {
            ctx.fillStyle = "#f8fafc";
            ctx.fillRect(0, 0, w, h);
            ctx.strokeStyle = "#e2e8f0";
            ctx.lineWidth = 4;
            const step = 64;
            for (let i = 0; i <= w; i += step) {
                ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, h); ctx.stroke();
                ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(w, i); ctx.stroke();
            }
        });
        floorTex.wrapS = THREE.RepeatWrapping;
        floorTex.wrapT = THREE.RepeatWrapping;
        floorTex.repeat.set(6, 5);

        const floorGeo = new THREE.PlaneGeometry(20, 14);
        const floorMat = new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.65 });
        const floor = new THREE.Mesh(floorGeo, floorMat);
        floor.rotation.x = -Math.PI / 2;
        floor.receiveShadow = true;
        this.archGroup.add(floor);

        // 走廊地板 (前方出入口外)
        const corridorGeo = new THREE.PlaneGeometry(20, 3.6);
        const corridorMat = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, roughness: 0.8 });
        const corridor = new THREE.Mesh(corridorGeo, corridorMat);
        corridor.rotation.x = -Math.PI / 2;
        corridor.position.set(0, 0.005, 8.8);
        corridor.receiveShadow = true;
        this.archGroup.add(corridor);

        // 牆體材質
        const wallMat = new THREE.MeshStandardMaterial({ color: 0xfef9c3, roughness: 0.75 });
        const wainscotMat = new THREE.MeshStandardMaterial({ color: 0xd9f99d, roughness: 0.7 });

        // 後牆 (Z = -7)
        const backWall = new THREE.Mesh(new THREE.BoxGeometry(20.4, 5.6, 0.35), wallMat);
        backWall.position.set(0, 2.8, -7);
        backWall.receiveShadow = true;
        this.archGroup.add(backWall);

        const backWainscot = new THREE.Mesh(new THREE.BoxGeometry(20.1, 1.2, 0.38), wainscotMat);
        backWainscot.position.set(0, 0.6, -6.98);
        this.archGroup.add(backWainscot);

        // 左牆 (X = -10)
        const leftWall = new THREE.Mesh(new THREE.BoxGeometry(0.35, 5.6, 14.3), wallMat);
        leftWall.position.set(-10, 2.8, 0);
        leftWall.receiveShadow = true;
        this.archGroup.add(leftWall);

        // 右牆 (X = 10)
        const rightWall = new THREE.Mesh(new THREE.BoxGeometry(0.35, 5.6, 14.3), wallMat);
        rightWall.position.set(10, 2.8, 0);
        rightWall.receiveShadow = true;
        this.archGroup.add(rightWall);

        // 前方矮隔牆 (Z = 7，留出左側入口 X=-8..-5 與右側出口 X=5..8)
        const frontWallMat = new THREE.MeshStandardMaterial({
            color: 0xe2e8f0,
            roughness: 0.6,
            transparent: true,
            opacity: 0.55
        });
        const fwLeft = new THREE.Mesh(new THREE.BoxGeometry(1.6, 2.2, 0.28), frontWallMat);
        fwLeft.position.set(-9.2, 1.1, 7.0);
        this.archGroup.add(fwLeft);

        const fwCenter = new THREE.Mesh(new THREE.BoxGeometry(9.6, 1.3, 0.28), frontWallMat);
        fwCenter.position.set(0, 0.65, 7.0);
        this.archGroup.add(fwCenter);

        const fwRight = new THREE.Mesh(new THREE.BoxGeometry(1.6, 2.2, 0.28), frontWallMat);
        fwRight.position.set(9.2, 1.1, 7.0);
        this.archGroup.add(fwRight);

        // 入口處與出口處門框標示牌
        this.buildDoorwayArch(-6.6, 7.0, "入 口 處", "#0284c7", "ENTRANCE");
        this.buildDoorwayArch(6.6, 7.0, "出 口 處", "#059669", "EXIT");

        // 後牆上方緊急輔助照明燈具模型 (對應手冊：電燈失明開啟輔助照明設備)
        this.emergencyLampMeshes = [];
        [-6, 6].forEach(xPos => {
            const lampBox = new THREE.Mesh(
                new THREE.BoxGeometry(0.9, 0.35, 0.25),
                new THREE.MeshStandardMaterial({ color: 0x334155 })
            );
            lampBox.position.set(xPos, 5.1, -6.75);
            this.archGroup.add(lampBox);

            const bulbMat = new THREE.MeshBasicMaterial({ color: 0x475569 });
            const bulb1 = new THREE.Mesh(new THREE.SphereGeometry(0.14, 16, 16), bulbMat);
            bulb1.position.set(xPos - 0.22, 5.1, -6.6);
            const bulb2 = new THREE.Mesh(new THREE.SphereGeometry(0.14, 16, 16), bulbMat);
            bulb2.position.set(xPos + 0.22, 5.1, -6.6);
            this.archGroup.add(bulb1, bulb2);
            this.emergencyLampMeshes.push(bulbMat);
        });
    }

    buildDoorwayArch(x, z, title, colorHex, subText) {
        const group = new THREE.Group();
        group.position.set(x, 0, z);

        const pillarMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.5 });
        const pLeft = new THREE.Mesh(new THREE.BoxGeometry(0.22, 3.2, 0.32), pillarMat);
        pLeft.position.set(-1.6, 1.6, 0);
        const pRight = new THREE.Mesh(new THREE.BoxGeometry(0.22, 3.2, 0.32), pillarMat);
        pRight.position.set(1.6, 1.6, 0);
        group.add(pLeft, pRight);

        const signTex = this.createSignTexture(512, 128, (ctx, w, h) => {
            ctx.fillStyle = colorHex;
            ctx.fillRect(0, 0, w, h);
            ctx.strokeStyle = "#ffffff";
            ctx.lineWidth = 8;
            ctx.strokeRect(8, 8, w - 16, h - 16);
            ctx.fillStyle = "#ffffff";
            ctx.font = "bold 52px 'Microsoft JhengHei', sans-serif";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText(`${title} (${subText})`, w / 2, h / 2);
        });
        const header = new THREE.Mesh(
            new THREE.BoxGeometry(3.44, 0.72, 0.36),
            new THREE.MeshBasicMaterial({ map: signTex })
        );
        header.position.set(0, 3.2, 0);
        group.add(header);
        this.archGroup.add(group);
    }

    // 建立精緻 3D 人物模型
    createPersonMesh(options = {}) {
        const {
            shirtColor = 0x3b82f6,
            pantsColor = 0x1e293b,
            skinColor = 0xfde68a,
            hairColor = 0x1f2937,
            isSeated = false,
            isPolice = false,
            hasGlasses = false,
            badgeColor = 0xfef08a,
            inWheelchair = false
        } = options;

        const group = new THREE.Group();

        // 身體
        const torsoGeo = new THREE.CylinderGeometry(0.26, 0.3, 0.75, 16);
        const torsoMat = new THREE.MeshStandardMaterial({ color: shirtColor, roughness: 0.6 });
        const torso = new THREE.Mesh(torsoGeo, torsoMat);
        torso.position.y = isSeated ? 0.95 : 1.15;
        torso.castShadow = true;
        group.add(torso);

        // 工作證名牌
        if (!inWheelchair) {
            const badge = new THREE.Mesh(
                new THREE.BoxGeometry(0.14, 0.1, 0.04),
                new THREE.MeshBasicMaterial({ color: badgeColor })
            );
            badge.position.set(0.12, torso.position.y + 0.15, 0.27);
            group.add(badge);
        }

        // 頭部
        const headGeo = new THREE.SphereGeometry(0.24, 20, 20);
        const headMat = new THREE.MeshStandardMaterial({ color: skinColor, roughness: 0.5 });
        const head = new THREE.Mesh(headGeo, headMat);
        head.position.y = torso.position.y + 0.62;
        head.castShadow = true;
        group.add(head);

        // 眼睛
        const eyeMat = new THREE.MeshBasicMaterial({ color: 0x111827 });
        const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 8), eyeMat);
        eyeL.position.set(-0.08, head.position.y + 0.03, 0.21);
        const eyeR = new THREE.Mesh(new THREE.SphereGeometry(0.03, 8, 8), eyeMat);
        eyeR.position.set(0.08, head.position.y + 0.03, 0.21);
        group.add(eyeL, eyeR);

        // 眼鏡
        if (hasGlasses) {
            const glassMat = new THREE.MeshBasicMaterial({ color: 0x1e293b, wireframe: true });
            const gL = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.01, 8, 16), glassMat);
            gL.position.set(-0.08, head.position.y + 0.03, 0.23);
            const gR = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.01, 8, 16), glassMat);
            gR.position.set(0.08, head.position.y + 0.03, 0.23);
            group.add(gL, gR);
        }

        // 頭髮或警察帽
        if (isPolice) {
            const cap = new THREE.Mesh(
                new THREE.CylinderGeometry(0.27, 0.25, 0.16, 16),
                new THREE.MeshStandardMaterial({ color: 0x1e3a8a })
            );
            cap.position.set(0, head.position.y + 0.2, 0);
            const visor = new THREE.Mesh(
                new THREE.BoxGeometry(0.32, 0.04, 0.22),
                new THREE.MeshStandardMaterial({ color: 0x0f172a })
            );
            visor.position.set(0, head.position.y + 0.14, 0.18);
            const goldStar = new THREE.Mesh(
                new THREE.SphereGeometry(0.04, 8, 8),
                new THREE.MeshBasicMaterial({ color: 0xfacc15 })
            );
            goldStar.position.set(0, head.position.y + 0.21, 0.26);
            group.add(cap, visor, goldStar);
        } else {
            const hair = new THREE.Mesh(
                new THREE.SphereGeometry(0.25, 16, 16, 0, Math.PI * 2, 0, Math.PI * 0.58),
                new THREE.MeshStandardMaterial({ color: hairColor, roughness: 0.8 })
            );
            hair.position.y = head.position.y + 0.02;
            hair.rotation.x = -0.15;
            group.add(hair);
        }

        // 手臂
        const armGeo = new THREE.CylinderGeometry(0.07, 0.07, 0.55, 12);
        const armL = new THREE.Mesh(armGeo, torsoMat);
        armL.position.set(-0.34, torso.position.y, 0.05);
        armL.rotation.z = 0.18;
        const armR = new THREE.Mesh(armGeo, torsoMat);
        armR.position.set(0.34, torso.position.y, 0.05);
        armR.rotation.z = -0.18;
        group.add(armL, armR);

        // 腿部或輪椅
        const legMat = new THREE.MeshStandardMaterial({ color: pantsColor, roughness: 0.7 });
        if (inWheelchair) {
            const wheelMat = new THREE.MeshStandardMaterial({ color: 0x334155 });
            const rimMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8 });
            [-0.36, 0.36].forEach(wx => {
                const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.38, 0.04, 12, 24), wheelMat);
                wheel.rotation.y = Math.PI / 2;
                wheel.position.set(wx, 0.42, 0);
                const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.02, 16), rimMat);
                hub.rotation.z = Math.PI / 2;
                hub.position.set(wx, 0.42, 0);
                group.add(wheel, hub);
            });
            const seat = new THREE.Mesh(
                new THREE.BoxGeometry(0.68, 0.08, 0.65),
                new THREE.MeshStandardMaterial({ color: 0x0284c7 })
            );
            seat.position.set(0, 0.55, 0.05);
            const back = new THREE.Mesh(
                new THREE.BoxGeometry(0.68, 0.65, 0.08),
                new THREE.MeshStandardMaterial({ color: 0x0284c7 })
            );
            back.position.set(0, 0.9, -0.25);
            group.add(seat, back);
        } else if (isSeated) {
            // 坐姿椅與腿
            const chairMat = new THREE.MeshStandardMaterial({ color: 0x64748b });
            const seat = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.06, 0.55), chairMat);
            seat.position.set(0, 0.52, 0);
            const back = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.55, 0.06), chairMat);
            back.position.set(0, 0.82, -0.25);
            const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.52, 8), chairMat);
            pole.position.set(0, 0.26, 0);
            group.add(seat, back, pole);
        } else {
            const legGeo = new THREE.CylinderGeometry(0.1, 0.09, 0.78, 12);
            const legL = new THREE.Mesh(legGeo, legMat);
            legL.position.set(-0.13, 0.39, 0);
            const legR = new THREE.Mesh(legGeo, legMat);
            legR.position.set(0.13, 0.39, 0);
            group.add(legL, legR);
        }

        this.animatedCharacters.push({ mesh: group, baseY: group.position.y, phase: Math.random() * Math.PI * 2 });
        return group;
    }

    // 建立辦公桌模型
    createDeskMesh(width = 1.8, depth = 0.9, height = 0.78, topColor = 0xfbbf24) {
        const group = new THREE.Group();
        const top = new THREE.Mesh(
            new THREE.BoxGeometry(width, 0.08, depth),
            new THREE.MeshStandardMaterial({ color: topColor, roughness: 0.55 })
        );
        top.position.y = height;
        top.castShadow = true;
        top.receiveShadow = true;
        group.add(top);

        const legMat = new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.6 });
        const legGeo = new THREE.CylinderGeometry(0.04, 0.04, height, 10);
        const offsets = [
            [-width / 2 + 0.1, -depth / 2 + 0.1],
            [width / 2 - 0.1, -depth / 2 + 0.1],
            [-width / 2 + 0.1, depth / 2 - 0.1],
            [width / 2 - 0.1, depth / 2 - 0.1]
        ];
        offsets.forEach(([lx, lz]) => {
            const leg = new THREE.Mesh(legGeo, legMat);
            leg.position.set(lx, height / 2, lz);
            leg.castShadow = true;
            group.add(leg);
        });
        return group;
    }

    // 建立圈票處遮屏模型 (一般 / 無障礙輪椅專用)
    createVotingBoothMesh(isWheelchair = false) {
        const group = new THREE.Group();
        const tableH = isWheelchair ? 0.72 : 0.92;
        const boothW = isWheelchair ? 1.55 : 1.25;
        const boothD = 1.05;
        const screenH = 1.05;

        const frameMat = new THREE.MeshStandardMaterial({
            color: isWheelchair ? 0xbae6fd : 0xe0f2fe,
            roughness: 0.45
        });
        const borderMat = new THREE.MeshStandardMaterial({ color: 0x0284c7, roughness: 0.4 });

        // 桌板
        const table = new THREE.Mesh(new THREE.BoxGeometry(boothW, 0.06, boothD), frameMat);
        table.position.y = tableH;
        table.castShadow = true;
        group.add(table);

        // 桌腳
        const legGeo = new THREE.CylinderGeometry(0.035, 0.035, tableH, 10);
        [
            [-boothW / 2 + 0.08, -boothD / 2 + 0.08],
            [boothW / 2 - 0.08, -boothD / 2 + 0.08],
            [-boothW / 2 + 0.08, boothD / 2 - 0.08],
            [boothW / 2 - 0.08, boothD / 2 - 0.08]
        ].forEach(([lx, lz]) => {
            const leg = new THREE.Mesh(legGeo, borderMat);
            leg.position.set(lx, tableH / 2, lz);
            group.add(leg);
        });

        // 遮屏三面擋板 (缺口朝向 Z+ 出入口工作人員方向，符合手冊第04頁規定)
        const backPanel = new THREE.Mesh(new THREE.BoxGeometry(boothW, screenH, 0.05), frameMat);
        backPanel.position.set(0, tableH + screenH / 2, -boothD / 2 + 0.025);
        backPanel.castShadow = true;
        group.add(backPanel);

        const leftPanel = new THREE.Mesh(new THREE.BoxGeometry(0.05, screenH, boothD), frameMat);
        leftPanel.position.set(-boothW / 2 + 0.025, tableH + screenH / 2, 0);
        leftPanel.castShadow = true;
        group.add(leftPanel);

        const rightPanel = new THREE.Mesh(new THREE.BoxGeometry(0.05, screenH, boothD), frameMat);
        rightPanel.position.set(boothW / 2 - 0.025, tableH + screenH / 2, 0);
        rightPanel.castShadow = true;
        group.add(rightPanel);

        // 圈選工具與紅色印台
        const inkPad = new THREE.Mesh(
            new THREE.BoxGeometry(0.18, 0.04, 0.14),
            new THREE.MeshStandardMaterial({ color: 0xdc2626 })
        );
        inkPad.position.set(0.22, tableH + 0.04, -0.12);
        const stampTool = new THREE.Mesh(
            new THREE.CylinderGeometry(0.025, 0.025, 0.14, 12),
            new THREE.MeshStandardMaterial({ color: 0xfef08a })
        );
        stampTool.position.set(-0.15, tableH + 0.08, -0.12);
        group.add(inkPad, stampTool);

        // 視障投票輔助器 (無障礙遮屏配備)
        if (isWheelchair) {
            const brailleAid = new THREE.Mesh(
                new THREE.BoxGeometry(0.32, 0.02, 0.24),
                new THREE.MeshStandardMaterial({ color: 0xfde047 })
            );
            brailleAid.position.set(-0.28, tableH + 0.04, 0.1);
            group.add(brailleAid);

            // 無障礙輪椅標誌貼圖 (使用 Font Awesome \uf193 圖示與文字)
            const wcTex = this.createSignTexture(256, 256, (ctx, w, h) => {
                ctx.fillStyle = "#e0f2fe";
                ctx.fillRect(0, 0, w, h);
                ctx.strokeStyle = "#0284c7";
                ctx.lineWidth = 10;
                ctx.strokeRect(12, 12, w - 24, h - 24);
                ctx.fillStyle = "#0369a1";
                ctx.font = "900 84px 'Font Awesome 6 Free'";
                ctx.textAlign = "center";
                ctx.fillText("\uf193", w / 2, 125);
                ctx.font = "bold 30px 'Microsoft JhengHei', sans-serif";
                ctx.fillText("無障礙圈票處", w / 2, 205);
            });
            const wcSign = new THREE.Mesh(
                new THREE.PlaneGeometry(0.75, 0.75),
                new THREE.MeshBasicMaterial({ map: wcTex })
            );
            wcSign.position.set(0, tableH + screenH / 2, -boothD / 2 + 0.06);
            group.add(wcSign);
        } else {
            // 一般圈票處規定標語貼紙
            const ruleTex = this.createSignTexture(256, 256, (ctx, w, h) => {
                ctx.fillStyle = "#fef9c3";
                ctx.fillRect(0, 0, w, h);
                ctx.strokeStyle = "#ca8a04";
                ctx.lineWidth = 8;
                ctx.strokeRect(8, 8, w - 16, h - 16);
                ctx.fillStyle = "#dc2626";
                ctx.font = "bold 28px 'Microsoft JhengHei', sans-serif";
                ctx.textAlign = "center";
                ctx.fillText("圈票處規定", w / 2, 48);
                ctx.fillStyle = "#1e293b";
                ctx.font = "bold 20px 'Microsoft JhengHei', sans-serif";
                ctx.fillText("1.請用圈選工具圈選", w / 2, 95);
                ctx.fillText("2.蓋私章或指印無效", w / 2, 135);
                ctx.fillText("3.禁止窺視刺探圈選", w / 2, 175);
                ctx.fillText("4.圈選後勿出示他人", w / 2, 215);
            });
            const ruleSign = new THREE.Mesh(
                new THREE.PlaneGeometry(0.72, 0.72),
                new THREE.MeshBasicMaterial({ map: ruleTex })
            );
            ruleSign.position.set(0, tableH + screenH / 2, -boothD / 2 + 0.06);
            group.add(ruleSign);
        }

        return group;
    }

    // 建立投票匭模型 (含選舉種類顏色識別貼紙與投入口)
    createBallotBoxMesh() {
        const group = new THREE.Group();

        // 底座墊高台
        const stand = new THREE.Mesh(
            new THREE.BoxGeometry(1.4, 0.45, 1.05),
            new THREE.MeshStandardMaterial({ color: 0x78350f, roughness: 0.7 })
        );
        stand.position.y = 0.225;
        stand.castShadow = true;
        group.add(stand);

        // 投票匭本體
        const boxBody = new THREE.Mesh(
            new THREE.BoxGeometry(1.15, 0.95, 0.85),
            new THREE.MeshStandardMaterial({ color: 0xfef3c7, roughness: 0.4 })
        );
        boxBody.position.y = 0.92;
        boxBody.castShadow = true;
        group.add(boxBody);

        // 投票匭上蓋與雙投入口
        const lid = new THREE.Mesh(
            new THREE.BoxGeometry(1.2, 0.12, 0.9),
            new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.4, roughness: 0.3 })
        );
        lid.position.y = 1.42;
        group.add(lid);

        [-0.26, 0.26].forEach(sx => {
            const slot = new THREE.Mesh(
                new THREE.BoxGeometry(0.28, 0.04, 0.08),
                new THREE.MeshBasicMaterial({ color: 0x0f172a })
            );
            slot.position.set(sx, 1.47, 0);
            group.add(slot);
        });

        // 投票匭正面識別貼紙 (國旗標誌 + 選舉種類顏色識別貼紙)
        const boxTex = this.createSignTexture(512, 384, (ctx, w, h) => {
            ctx.fillStyle = "#fef3c7";
            ctx.fillRect(0, 0, w, h);
            ctx.strokeStyle = "#b45309";
            ctx.lineWidth = 12;
            ctx.strokeRect(10, 10, w - 20, h - 20);

            // 顏色識別貼紙條 (粉紅、淺黃、淺藍)
            ctx.fillStyle = "#f472b6";
            ctx.fillRect(36, 36, 130, 55);
            ctx.fillStyle = "#facc15";
            ctx.fillRect(190, 36, 130, 55);
            ctx.fillStyle = "#38bdf8";
            ctx.fillRect(344, 36, 130, 55);

            ctx.fillStyle = "#dc2626";
            ctx.fillRect(180, 120, 152, 100);
            ctx.fillStyle = "#1d4ed8";
            ctx.fillRect(180, 120, 76, 52);
            ctx.fillStyle = "#ffffff";
            ctx.beginPath();
            ctx.arc(218, 146, 16, 0, Math.PI * 2);
            ctx.fill();

            ctx.fillStyle = "#dc2626";
            ctx.font = "bold 54px 'Microsoft JhengHei', sans-serif";
            ctx.textAlign = "center";
            ctx.fillText("投 票 匭", w / 2, 295);
            ctx.fillStyle = "#475569";
            ctx.font = "bold 24px 'Microsoft JhengHei', sans-serif";
            ctx.fillText("公開查驗加封 · 顏色識別貼紙", w / 2, 345);
        });

        const frontFace = new THREE.Mesh(
            new THREE.PlaneGeometry(1.08, 0.85),
            new THREE.MeshBasicMaterial({ map: boxTex })
        );
        frontFace.position.set(0, 0.92, 0.43);
        group.add(frontFace);

        return group;
    }

    // 註冊可互動 3D 站點與對應 HTML 懸浮標籤
    registerInteractiveStation(stationData, parentGroup, targetMeshGroup) {
        targetMeshGroup.userData.stationId = stationData.id;
        targetMeshGroup.traverse(child => {
            if (child.isMesh) {
                child.userData.stationId = stationData.id;
                this.interactables.push(child);
            }
        });
        parentGroup.add(targetMeshGroup);
        this.stationGroups.set(stationData.id, {
            data: stationData,
            group: targetMeshGroup,
            mode: parentGroup === this.pollingGroup ? "polling" : "counting"
        });
    }

    // 建構【模式一：投票所之佈置】3D 物件 (對應手冊第 04-05 頁)
    buildPollingScene() {
        this.pollingGroup = new THREE.Group();
        this.scene.add(this.pollingGroup);

        const stations = HANDBOOK_DATA.pollingStations;

        // 1. 入口處與禁帶手機標示 + 手機放置籃 + 無障礙坡道
        const entranceGroup = new THREE.Group();
        // 投開票所銜稱直立牌
        const titleTex = this.createSignTexture(256, 512, (ctx, w, h) => {
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(0, 0, w, h);
            ctx.strokeStyle = "#dc2626";
            ctx.lineWidth = 14;
            ctx.strokeRect(10, 10, w - 20, h - 20);
            ctx.fillStyle = "#1e293b";
            ctx.font = "bold 36px 'Microsoft JhengHei', sans-serif";
            ctx.textAlign = "center";
            const lines = ["第", "0168", "投", "開", "票", "所"];
            lines.forEach((ch, idx) => ctx.fillText(ch, w / 2, 85 + idx * 70));
        });
        const titleBoard = new THREE.Mesh(
            new THREE.BoxGeometry(0.75, 1.8, 0.12),
            new THREE.MeshBasicMaterial({ map: titleTex })
        );
        titleBoard.position.set(-8.6, 1.2, 7.35);
        entranceGroup.add(titleBoard);

        // 禁止攜帶手機標語牌 & 手機放置籃桌
        const phoneSignTex = this.createSignTexture(512, 384, (ctx, w, h) => {
            ctx.fillStyle = "#fef2f2";
            ctx.fillRect(0, 0, w, h);
            ctx.strokeStyle = "#dc2626";
            ctx.lineWidth = 16;
            ctx.strokeRect(12, 12, w - 24, h - 24);
            ctx.fillStyle = "#dc2626";
            ctx.font = "bold 46px 'Microsoft JhengHei', sans-serif";
            ctx.textAlign = "center";
            ctx.fillText("禁止攜帶手機入場", w / 2, 85);
            ctx.fillStyle = "#1e293b";
            ctx.font = "bold 30px 'Microsoft JhengHei', sans-serif";
            ctx.fillText("請關機並放入手機放置籃", w / 2, 165);
            ctx.fillText("違者依選罷法處罰", w / 2, 225);
            ctx.fillStyle = "#2563eb";
            ctx.fillText("【 手機放置籃代管處 】", w / 2, 310);
        });
        const phoneSign = new THREE.Mesh(
            new THREE.BoxGeometry(1.25, 0.95, 0.1),
            new THREE.MeshBasicMaterial({ map: phoneSignTex })
        );
        phoneSign.position.set(-7.6, 1.35, 6.2);
        phoneSign.rotation.y = 0.35;
        entranceGroup.add(phoneSign);

        // 手機放置籃與小桌
        const basketTable = this.createDeskMesh(0.8, 0.6, 0.72, 0xe2e8f0);
        basketTable.position.set(-7.2, 0, 7.6);
        const phoneBasket = new THREE.Mesh(
            new THREE.BoxGeometry(0.45, 0.18, 0.35),
            new THREE.MeshStandardMaterial({ color: 0x0284c7 })
        );
        phoneBasket.position.set(-7.2, 0.82, 7.6);
        entranceGroup.add(basketTable, phoneBasket);

        // 無障礙坡道
        const ramp = new THREE.Mesh(
            new THREE.BoxGeometry(2.6, 0.12, 1.4),
            new THREE.MeshStandardMaterial({ color: 0x38bdf8 })
        );
        ramp.position.set(-6.6, 0.04, 7.9);
        ramp.rotation.x = 0.06;
        entranceGroup.add(ramp);

        this.registerInteractiveStation(stations[0], this.pollingGroup, entranceGroup);

        // 2. 查驗身分證管理員 & 警衛人員
        const idClerkGroup = new THREE.Group();
        const idDesk = this.createDeskMesh(1.2, 0.75, 0.75, 0xfbbf24);
        idDesk.position.set(-5.6, 0, 6.3);
        idClerkGroup.add(idDesk);

        const idClerk = this.createPersonMesh({ shirtColor: 0x2563eb, isSeated: true, hairColor: 0x1e293b });
        idClerk.position.set(-5.6, 0, 5.7);
        idClerkGroup.add(idClerk);

        const policeOfficer = this.createPersonMesh({ shirtColor: 0x1e3a8a, pantsColor: 0x0f172a, isPolice: true });
        policeOfficer.position.set(-8.2, 0, 5.8);
        policeOfficer.rotation.y = 0.3;
        idClerkGroup.add(policeOfficer);

        this.registerInteractiveStation(stations[1], this.pollingGroup, idClerkGroup);

        // 3. 領票處 (管理員 ×2、監察員 ×2、選舉人名冊、選舉票)
        const issuingGroup = new THREE.Group();
        const issuingDesk1 = this.createDeskMesh(1.6, 0.9, 0.78, 0xfcd34d);
        issuingDesk1.position.set(-5.8, 0, 2.2);
        issuingDesk1.rotation.y = Math.PI / 2;
        const issuingDesk2 = this.createDeskMesh(1.6, 0.9, 0.78, 0xfcd34d);
        issuingDesk2.position.set(-5.8, 0, 0.4);
        issuingDesk2.rotation.y = Math.PI / 2;
        issuingGroup.add(issuingDesk1, issuingDesk2);

        // 桌面選舉人名冊與選票疊
        const rosterBook = new THREE.Mesh(
            new THREE.BoxGeometry(0.45, 0.06, 0.35),
            new THREE.MeshStandardMaterial({ color: 0xf97316 })
        );
        rosterBook.position.set(-5.7, 0.85, 2.2);
        const ballotStack1 = new THREE.Mesh(
            new THREE.BoxGeometry(0.35, 0.08, 0.25),
            new THREE.MeshStandardMaterial({ color: 0xfbcfe8 })
        );
        ballotStack1.position.set(-5.7, 0.85, 0.6);
        const ballotStack2 = new THREE.Mesh(
            new THREE.BoxGeometry(0.35, 0.08, 0.25),
            new THREE.MeshStandardMaterial({ color: 0xfef08a })
        );
        ballotStack2.position.set(-5.7, 0.85, 0.15);
        issuingGroup.add(rosterBook, ballotStack1, ballotStack2);

        // 領票處管理員 2 位 (坐姿面向右方動線)
        const clerk1 = this.createPersonMesh({ shirtColor: 0xec4899, isSeated: true });
        clerk1.position.set(-6.55, 0, 2.2);
        clerk1.rotation.y = Math.PI / 2;
        const clerk2 = this.createPersonMesh({ shirtColor: 0x3b82f6, isSeated: true });
        clerk2.position.set(-6.55, 0, 0.4);
        clerk2.rotation.y = Math.PI / 2;

        // 領票處監察員 2 位 (後方站立監督)
        const sup1 = this.createPersonMesh({ shirtColor: 0x16a34a, hasGlasses: true });
        sup1.position.set(-7.65, 0, 2.2);
        sup1.rotation.y = Math.PI / 2;
        const sup2 = this.createPersonMesh({ shirtColor: 0x0d9488 });
        sup2.position.set(-7.65, 0, 0.4);
        sup2.rotation.y = Math.PI / 2;
        issuingGroup.add(clerk1, clerk2, sup1, sup2);

        this.registerInteractiveStation(stations[2], this.pollingGroup, issuingGroup);

        // 4. 2m~2.5m 等候線與圈票處管理員 & 監察員
        const waitingGroup = new THREE.Group();
        const lineTex = this.createSignTexture(512, 128, (ctx, w, h) => {
            ctx.fillStyle = "#facc15";
            ctx.fillRect(0, 0, w, h);
            ctx.fillStyle = "#0f172a";
            ctx.font = "bold 44px 'Microsoft JhengHei', sans-serif";
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.fillText("等 候 線 (距離遮屏 2m ~ 2.5m)", w / 2, h / 2);
        });
        const waitingLineMesh = new THREE.Mesh(
            new THREE.PlaneGeometry(7.2, 0.55),
            new THREE.MeshBasicMaterial({ map: lineTex })
        );
        waitingLineMesh.rotation.x = -Math.PI / 2;
        waitingLineMesh.position.set(0.2, 0.02, -2.1);
        waitingGroup.add(waitingLineMesh);

        // 距離標線虛線 (2m ~ 2.5m)
        const distTex = this.createSignTexture(256, 256, (ctx, w, h) => {
            ctx.clearRect(0, 0, w, h);
            ctx.strokeStyle = "#f97316";
            ctx.lineWidth = 10;
            ctx.setLineDash([20, 14]);
            ctx.beginPath(); ctx.moveTo(w / 2, 10); ctx.lineTo(w / 2, h - 10); ctx.stroke();
            ctx.fillStyle = "#ea580c";
            ctx.font = "bold 38px sans-serif";
            ctx.textAlign = "center";
            ctx.fillText("2m~2.5m", w / 2, h / 2);
        });
        [-1.8, 2.2].forEach(dx => {
            const distPlane = new THREE.Mesh(
                new THREE.PlaneGeometry(1.6, 2.2),
                new THREE.MeshBasicMaterial({ map: distTex, transparent: true })
            );
            distPlane.rotation.x = -Math.PI / 2;
            distPlane.position.set(dx, 0.02, -3.4);
            waitingGroup.add(distPlane);
        });

        const boothClerk = this.createPersonMesh({ shirtColor: 0xf97316 });
        boothClerk.position.set(-1.2, 0, -1.2);
        const boothSup = this.createPersonMesh({ shirtColor: 0xca8a04, hasGlasses: true });
        boothSup.position.set(1.2, 0, 0.2);
        waitingGroup.add(boothClerk, boothSup);

        this.registerInteractiveStation(stations[3], this.pollingGroup, waitingGroup);

        // 5. 圈票處遮屏 (2 座一般遮屏 + 1 座無障礙輪椅遮屏 + 輪椅選舉人示範)
        const boothsGroup = new THREE.Group();
        const booth1 = this.createVotingBoothMesh(false);
        booth1.position.set(-2.6, 0, -5.2);
        const booth2 = this.createVotingBoothMesh(false);
        booth2.position.set(0.0, 0, -5.2);
        const booth3Wheelchair = this.createVotingBoothMesh(true);
        booth3Wheelchair.position.set(2.8, 0, -5.2);
        boothsGroup.add(booth1, booth2, booth3Wheelchair);

        // 乘坐輪椅之選舉人示範模型
        const wcVoter = this.createPersonMesh({
            shirtColor: 0x10b981,
            inWheelchair: true
        });
        wcVoter.position.set(4.5, 0, -4.5);
        wcVoter.rotation.y = -0.5;
        boothsGroup.add(wcVoter);

        this.registerInteractiveStation(stations[4], this.pollingGroup, boothsGroup);

        // 6. 投票處 (投票匭、投票處管理員、投票處監察員)
        const ballotAreaGroup = new THREE.Group();
        const ballotBox1 = this.createBallotBoxMesh();
        ballotBox1.position.set(6.2, 0, -1.2);
        ballotBox1.rotation.y = -0.35;
        const ballotBox2 = this.createBallotBoxMesh();
        ballotBox2.position.set(6.8, 0, 0.8);
        ballotBox2.rotation.y = -0.45;
        ballotAreaGroup.add(ballotBox1, ballotBox2);

        const boxClerk = this.createPersonMesh({ shirtColor: 0x84cc16, hasGlasses: true });
        boxClerk.position.set(5.2, 0, 1.8);
        boxClerk.rotation.y = -0.5;
        const boxSup = this.createPersonMesh({ shirtColor: 0x0ea5e9 });
        boxSup.position.set(7.6, 0, -2.5);
        boxSup.rotation.y = -0.6;
        ballotAreaGroup.add(boxClerk, boxSup);

        this.registerInteractiveStation(stations[5], this.pollingGroup, ballotAreaGroup);

        // 7. 主任管理員 & 主任監察員
        const chiefsGroup = new THREE.Group();
        const chiefDesk = this.createDeskMesh(2.2, 0.9, 0.78, 0xfbbf24);
        chiefDesk.position.set(0.5, 0, 5.2);
        const chiefAdmin = this.createPersonMesh({ shirtColor: 0x0284c7, pantsColor: 0x0f172a });
        chiefAdmin.position.set(-0.3, 0, 4.4);
        chiefAdmin.rotation.y = Math.PI;
        const chiefSup = this.createPersonMesh({ shirtColor: 0xdb2777, hasGlasses: true });
        chiefSup.position.set(1.3, 0, 4.4);
        chiefSup.rotation.y = Math.PI;
        chiefsGroup.add(chiefDesk, chiefAdmin, chiefSup);

        this.registerInteractiveStation(stations[6], this.pollingGroup, chiefsGroup);

        // 8. 出口處
        const exitGroup = new THREE.Group();
        const exitSignTex = this.createSignTexture(256, 256, (ctx, w, h) => {
            ctx.fillStyle = "#ecfdf5";
            ctx.fillRect(0, 0, w, h);
            ctx.strokeStyle = "#059669";
            ctx.lineWidth = 14;
            ctx.strokeRect(10, 10, w - 20, h - 20);
            ctx.fillStyle = "#059669";
            ctx.font = "bold 44px 'Microsoft JhengHei', sans-serif";
            ctx.textAlign = "center";
            ctx.fillText("投票出口", w / 2, 95);
            ctx.font = "900 68px 'Font Awesome 6 Free'";
            ctx.fillText("\uf061", w / 2, 190);
        });
        const exitBoard = new THREE.Mesh(
            new THREE.BoxGeometry(0.85, 1.1, 0.1),
            new THREE.MeshBasicMaterial({ map: exitSignTex })
        );
        exitBoard.position.set(8.2, 1.1, 6.4);
        exitBoard.rotation.y = -0.35;
        exitGroup.add(exitBoard);

        this.registerInteractiveStation(stations[7], this.pollingGroup, exitGroup);

        // 投票動線地面箭頭與動態模擬選舉人
        this.pollingFlowGroup = new THREE.Group();
        this.pollingGroup.add(this.pollingFlowGroup);

        const arrowPoints = [
            { x: -6.4, z: 7.4, rot: Math.PI },
            { x: -4.6, z: 4.2, rot: Math.PI * 0.85 },
            { x: -4.2, z: 1.2, rot: Math.PI * 0.65 },
            { x: -2.2, z: -1.2, rot: Math.PI * 0.75 },
            { x: 0.0, z: -3.2, rot: Math.PI },
            { x: 3.2, z: -2.2, rot: -Math.PI * 0.6 },
            { x: 5.5, z: 2.2, rot: 0 },
            { x: 6.5, z: 5.8, rot: 0 }
        ];

        const arrowTex = this.createSignTexture(128, 128, (ctx, w, h) => {
            ctx.clearRect(0, 0, w, h);
            ctx.fillStyle = "rgba(56, 189, 248, 0.85)";
            ctx.beginPath();
            ctx.moveTo(w / 2, 12);
            ctx.lineTo(w - 18, h / 2 + 10);
            ctx.lineTo(w / 2 + 18, h / 2 + 10);
            ctx.lineTo(w / 2 + 18, h - 12);
            ctx.lineTo(w / 2 - 18, h - 12);
            ctx.lineTo(w / 2 - 18, h / 2 + 10);
            ctx.lineTo(18, h / 2 + 10);
            ctx.closePath();
            ctx.fill();
        });

        arrowPoints.forEach(pt => {
            const arrowMesh = new THREE.Mesh(
                new THREE.PlaneGeometry(0.95, 0.95),
                new THREE.MeshBasicMaterial({ map: arrowTex, transparent: true })
            );
            arrowMesh.rotation.x = -Math.PI / 2;
            arrowMesh.rotation.z = pt.rot;
            arrowMesh.position.set(pt.x, 0.025, pt.z);
            this.pollingFlowGroup.add(arrowMesh);
        });

        // 動態模擬選舉人 (預設隱藏，啟動動線模擬時沿路徑移動)
        this.simVoter = this.createPersonMesh({ shirtColor: 0xf43f5e, pantsColor: 0x1e293b });
        this.simVoter.position.set(-6.5, 0, 8.2);
        this.simVoter.visible = false;
        this.pollingGroup.add(this.simVoter);
    }

    // 建構【模式二：開票所之佈置】3D 物件 (對應手冊第 12-13 頁)
    buildCountingScene() {
        this.countingGroup = new THREE.Group();
        this.scene.add(this.countingGroup);

        const stations = HANDBOOK_DATA.countingStations;

        // 1. 檢票處 (中央投票匭 + 檢票管理員)
        const inspectGroup = new THREE.Group();
        const centerBox = this.createBallotBoxMesh();
        centerBox.position.set(4.5, 0, -0.5);
        const inspectClerk = this.createPersonMesh({ shirtColor: 0x84cc16, hasGlasses: true });
        inspectClerk.position.set(3.2, 0, -0.8);
        inspectGroup.add(centerBox, inspectClerk);
        this.registerInteractiveStation(stations[0], this.countingGroup, inspectGroup);

        // 2. 唱票處 (唱票管理員 + 檢票唱票監察員 + 選票展示)
        const callingGroup = new THREE.Group();
        const callerClerk = this.createPersonMesh({ shirtColor: 0xec4899 });
        callerClerk.position.set(1.5, 0, -0.8);
        // 手持選票
        this.heldBallot = new THREE.Mesh(
            new THREE.BoxGeometry(0.38, 0.28, 0.02),
            new THREE.MeshBasicMaterial({ color: 0xffffff })
        );
        this.heldBallot.position.set(1.1, 1.5, -0.45);
        const callSup = this.createPersonMesh({ shirtColor: 0x0ea5e9 });
        callSup.position.set(-0.4, 0, -0.5);
        callingGroup.add(callerClerk, this.heldBallot, callSup);
        this.registerInteractiveStation(stations[1], this.countingGroup, callingGroup);

        // 3. 記票處 (後方牆面「正」字選舉記票紙板架 + 記票管理員 + 記票監察員)
        const tallyGroup = new THREE.Group();
        this.tallyCanvas = document.createElement("canvas");
        this.tallyCanvas.width = 1024;
        this.tallyCanvas.height = 512;
        this.tallyTexture = new THREE.CanvasTexture(this.tallyCanvas);
        this.updateTallyBoardCanvas();

        const tallyBoard = new THREE.Mesh(
            new THREE.BoxGeometry(6.8, 3.2, 0.16),
            new THREE.MeshBasicMaterial({ map: this.tallyTexture })
        );
        tallyBoard.position.set(0, 2.7, -6.65);
        tallyGroup.add(tallyBoard);

        const tallyClerk = this.createPersonMesh({ shirtColor: 0xf97316 });
        tallyClerk.position.set(2.6, 0, -5.6);
        const tallySup = this.createPersonMesh({ shirtColor: 0x8b5cf6, hasGlasses: true });
        tallySup.position.set(-2.8, 0, -5.6);
        tallyGroup.add(tallyClerk, tallySup);
        this.registerInteractiveStation(stations[2], this.countingGroup, tallyGroup);

        // 4. 整票計票處 (左側長桌 + 整票計票員 ×2 + 整票計票監察員 + 每100張一疊選票)
        const sortingGroup = new THREE.Group();
        const sortDesk1 = this.createDeskMesh(1.8, 1.0, 0.78, 0xe2e8f0);
        sortDesk1.position.set(-4.6, 0, -1.2);
        sortDesk1.rotation.y = 0.35;
        const sortDesk2 = this.createDeskMesh(1.8, 1.0, 0.78, 0xe2e8f0);
        sortDesk2.position.set(-3.9, 0, 0.5);
        sortDesk2.rotation.y = 0.35;
        sortingGroup.add(sortDesk1, sortDesk2);

        // 桌面分類選票疊 (每 100 張 1 疊)
        for (let i = 0; i < 6; i++) {
            const stack = new THREE.Mesh(
                new THREE.BoxGeometry(0.32, 0.12, 0.45),
                new THREE.MeshStandardMaterial({ color: i % 2 === 0 ? 0xfef08a : 0xfbcfe8 })
            );
            stack.position.set(-4.7 + (i % 2) * 0.45, 0.86, -1.6 + Math.floor(i / 2) * 0.9);
            stack.rotation.y = 0.35;
            sortingGroup.add(stack);
        }

        const sortClerk1 = this.createPersonMesh({ shirtColor: 0xfacc15, isSeated: true });
        sortClerk1.position.set(-5.6, 0, -1.4);
        sortClerk1.rotation.y = 1.2;
        const sortClerk2 = this.createPersonMesh({ shirtColor: 0x4ade80, isSeated: true });
        sortClerk2.position.set(-5.1, 0, 0.2);
        sortClerk2.rotation.y = 1.2;
        const sortSup = this.createPersonMesh({ shirtColor: 0x3b82f6 });
        sortSup.position.set(-4.6, 0, 2.0);
        sortSup.rotation.y = 2.2;
        sortingGroup.add(sortClerk1, sortClerk2, sortSup);
        this.registerInteractiveStation(stations[3], this.countingGroup, sortingGroup);

        // 5. 開票所主任管理員 & 主任監察員
        const countingChiefsGroup = new THREE.Group();
        const cAdmin = this.createPersonMesh({ shirtColor: 0x14b8a6 });
        cAdmin.position.set(1.2, 0, 1.9);
        cAdmin.rotation.y = Math.PI;
        const cSup = this.createPersonMesh({ shirtColor: 0xf472b6, hasGlasses: true });
        cSup.position.set(-1.6, 0, 1.9);
        cSup.rotation.y = Math.PI;
        countingChiefsGroup.add(cAdmin, cSup);
        this.registerInteractiveStation(stations[4], this.countingGroup, countingChiefsGroup);

        // 6. 參觀席與紅絨繩欄杆 & 警衛人員 (對應手冊第 12-13 頁)
        const audienceGroup = new THREE.Group();
        const poleMat = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, metalness: 0.7, roughness: 0.2 });
        const ropeMat = new THREE.MeshStandardMaterial({ color: 0xdc2626, roughness: 0.5 });

        for (let i = -3; i <= 3; i++) {
            const px = i * 2.1;
            const stanchion = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.0, 12), poleMat);
            stanchion.position.set(px, 0.5, 3.6);
            const topBall = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 12), poleMat);
            topBall.position.set(px, 1.05, 3.6);
            audienceGroup.add(stanchion, topBall);

            if (i < 3) {
                const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 2.1, 8), ropeMat);
                rope.rotation.z = Math.PI / 2;
                rope.position.set(px + 1.05, 0.88, 3.6);
                audienceGroup.add(rope);
            }
        }

        // 參觀席民眾與座椅 (6 位參觀民眾)
        const viewerColors = [0xf9a8d4, 0x93c5fd, 0xfde047, 0x86efac, 0xc4b5fd, 0xfdba74];
        for (let i = 0; i < 6; i++) {
            const vx = -5.2 + i * 2.08;
            const viewer = this.createPersonMesh({
                shirtColor: viewerColors[i],
                isSeated: true
            });
            viewer.position.set(vx, 0, 5.2);
            viewer.rotation.y = Math.PI;
            audienceGroup.add(viewer);
        }

        const cPolice = this.createPersonMesh({ shirtColor: 0x1e3a8a, isPolice: true });
        cPolice.position.set(7.4, 0, 4.2);
        audienceGroup.add(cPolice);

        this.registerInteractiveStation(stations[5], this.countingGroup, audienceGroup);
    }

    // 繪製「正」字選舉記票紙 Canvas (對應手冊第 13、17 頁)
    updateTallyBoardCanvas(highlightCandidate = -1) {
        if (!this.tallyCanvas) return;
        const ctx = this.tallyCanvas.getContext("2d");
        const w = this.tallyCanvas.width;
        const h = this.tallyCanvas.height;

        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, w, h);
        ctx.strokeStyle = "#1e293b";
        ctx.lineWidth = 8;
        ctx.strokeRect(12, 12, w - 24, h - 24);

        // 標題列
        ctx.fillStyle = "#1e3a8a";
        ctx.fillRect(20, 20, w - 40, 68);
        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 36px 'Microsoft JhengHei', sans-serif";
        ctx.textAlign = "center";
        ctx.fillText("選 舉 記 票 紙 （每票劃 1 筆 · 每一「正」字 5 票）", w / 2, 66);

        const candidates = [
            { num: "1號", name: "快樂鯉魚", count: this.tallyCounts[0] },
            { num: "2號", name: "秋老虎", count: this.tallyCounts[1] },
            { num: "3號", name: "公民神", count: this.tallyCounts[2] },
            { num: "無效票", name: "認定欄", count: this.tallyCounts[3] }
        ];

        const colW = (w - 40) / candidates.length;
        candidates.forEach((cand, idx) => {
            const x = 20 + idx * colW;
            if (idx === highlightCandidate) {
                ctx.fillStyle = "#fef9c3";
                ctx.fillRect(x, 88, colW, h - 108);
            }
            ctx.strokeStyle = "#334155";
            ctx.lineWidth = 4;
            ctx.strokeRect(x, 88, colW, h - 108);

            // 號次與姓名
            ctx.fillStyle = idx === 3 ? "#dc2626" : "#0f172a";
            ctx.font = "bold 28px 'Microsoft JhengHei', sans-serif";
            ctx.fillText(`${cand.num} ${cand.name}`, x + colW / 2, 130);

            ctx.beginPath();
            ctx.moveTo(x, 150);
            ctx.lineTo(x + colW, 150);
            ctx.stroke();

            // 繪製「正」字筆劃
            const fullZheng = Math.floor(cand.count / 5);
            const rem = cand.count % 5;
            const remChars = ["", "一", "ㄒ", "上", "止"];

            ctx.fillStyle = "#dc2626";
            ctx.font = "bold 44px 'Microsoft JhengHei', sans-serif";
            let rowY = 205;
            for (let z = 0; z < fullZheng; z++) {
                ctx.fillText("正", x + colW / 2, rowY);
                rowY += 54;
            }
            if (rem > 0) {
                ctx.fillText(remChars[rem], x + colW / 2, rowY);
            }

            // 底部總票數記載 (符合手冊第17頁規定)
            ctx.fillStyle = "#1e293b";
            ctx.font = "bold 26px 'Microsoft JhengHei', sans-serif";
            ctx.fillText(`計 ${cand.count} 票`, x + colW / 2, h - 38);
        });

        if (this.tallyTexture) {
            this.tallyTexture.needsUpdate = true;
        }
    }

    // 切換『投票所佈置』與『開票所佈置』模式
    setMode(mode, animateCamera = true) {
        this.mode = mode;
        this.simulatingFlow = false;
        if (this.simVoter) this.simVoter.visible = false;

        this.pollingGroup.visible = mode === "polling";
        this.countingGroup.visible = mode === "counting";

        this.rebuildFloatingLabels();

        const firstStation = mode === "polling"
            ? HANDBOOK_DATA.pollingStations[0]
            : HANDBOOK_DATA.countingStations[0];

        if (animateCamera) {
            this.resetCameraOverview();
        }
        this.selectStation(firstStation.id, false);
    }

    // 重建 3D 空間對應之 HTML 懸浮標籤 (全面使用 Font Awesome)
    rebuildFloatingLabels() {
        this.labelsContainer.innerHTML = "";
        this.labelElements.clear();

        const list = this.mode === "polling"
            ? HANDBOOK_DATA.pollingStations
            : HANDBOOK_DATA.countingStations;

        list.forEach(st => {
            const el = document.createElement("button");
            el.className = "hotspot-label";
            el.dataset.id = st.id;
            el.style.setProperty("--badge-color", st.badgeColor);
            el.innerHTML = `
                <span class="hotspot-step">${st.step}</span>
                <i class="${st.icon}"></i>
                <span class="hotspot-text">${st.name}</span>
            `;
            el.addEventListener("click", (e) => {
                e.stopPropagation();
                this.selectStation(st.id, true);
            });
            this.labelsContainer.appendChild(el);
            this.labelElements.set(st.id, el);
        });
    }

    // 選擇指定導覽點並飛越鏡頭
    selectStation(stationId, flyCamera = true) {
        const entry = this.stationGroups.get(stationId);
        if (!entry) return;

        this.selectedId = stationId;

        // 更新標籤選中狀態
        this.labelElements.forEach((el, id) => {
            el.classList.toggle("active", id === stationId);
        });

        // 移動地面高亮光環
        const pos = entry.data.position;
        this.highlightRing.position.set(pos.x, 0.04, pos.z);
        this.highlightRing.material.color.set(entry.data.badgeColor);
        this.highlightRing.visible = true;

        if (flyCamera && window.gsap) {
            const cam = entry.data.cameraPos;
            const look = entry.data.lookAt;
            gsap.to(this.camera.position, {
                x: cam.x,
                y: cam.y,
                z: cam.z,
                duration: 1.15,
                ease: "power3.out"
            });
            gsap.to(this.controls.target, {
                x: look.x,
                y: look.y,
                z: look.z,
                duration: 1.15,
                ease: "power3.out"
            });
        }

        if (this.onSelectStation) {
            this.onSelectStation(entry.data);
        }
    }

    // 相機視角預設控制 (全景 / 俯視平面圖 / 選舉人視角)
    resetCameraOverview() {
        if (!window.gsap) return;
        gsap.to(this.camera.position, { x: 0, y: 14.5, z: 19.5, duration: 1.1, ease: "power2.out" });
        gsap.to(this.controls.target, { x: 0, y: 1.0, z: 0.5, duration: 1.1, ease: "power2.out" });
    }

    setTopDownView() {
        if (!window.gsap) return;
        gsap.to(this.camera.position, { x: 0, y: 24.5, z: 0.8, duration: 1.1, ease: "power2.out" });
        gsap.to(this.controls.target, { x: 0, y: 0, z: 0, duration: 1.1, ease: "power2.out" });
    }

    // 切換動線與距離標示顯示
    toggleFlowHelpers() {
        this.showFlowHelpers = !this.showFlowHelpers;
        if (this.pollingFlowGroup) {
            this.pollingFlowGroup.visible = this.showFlowHelpers;
        }
        return this.showFlowHelpers;
    }

    // 切換停電緊急輔助照明模擬 (手冊第 14 頁：電燈失明開啟輔助照明設備)
    toggleEmergencyLighting() {
        this.emergencyLightMode = !this.emergencyLightMode;
        if (this.emergencyLightMode) {
            this.ambientLight.intensity = 0.16;
            this.mainDirLight.intensity = 0.12;
            this.emergencySpot1.intensity = 2.2;
            this.emergencySpot2.intensity = 2.2;
            this.emergencyLampMeshes.forEach(mat => mat.color.setHex(0xfef08a));
        } else {
            this.ambientLight.intensity = 0.68;
            this.mainDirLight.intensity = 0.85;
            this.emergencySpot1.intensity = 0;
            this.emergencySpot2.intensity = 0;
            this.emergencyLampMeshes.forEach(mat => mat.color.setHex(0x475569));
        }
        return this.emergencyLightMode;
    }

    // 啟動 / 停止 3D 動態流程模擬 (投票人動線 / 開票唱票計票)
    toggleSimulation() {
        this.simulatingFlow = !this.simulatingFlow;
        this.voterSimProgress = 0;
        if (this.mode === "polling" && this.simVoter) {
            this.simVoter.visible = this.simulatingFlow;
        }
        return this.simulatingFlow;
    }

    bindEvents() {
        window.addEventListener("resize", () => {
            const w = this.container.clientWidth || window.innerWidth;
            const h = this.container.clientHeight || window.innerHeight;
            this.camera.aspect = w / h;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(w, h);
        });

        const dom = this.renderer.domElement;
        dom.addEventListener("pointerdown", (e) => {
            this.pointerDownPos.set(e.clientX, e.clientY);
        });

        dom.addEventListener("pointerup", (e) => {
            const dist = Math.hypot(e.clientX - this.pointerDownPos.x, e.clientY - this.pointerDownPos.y);
            if (dist > 6) return; // 拖曳旋轉不觸發點擊選取

            const rect = dom.getBoundingClientRect();
            this.mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
            this.mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

            this.raycaster.setFromCamera(this.mouse, this.camera);
            const activeMeshes = this.interactables.filter(m => {
                const stId = m.userData.stationId;
                const entry = this.stationGroups.get(stId);
                return entry && entry.mode === this.mode;
            });

            const intersects = this.raycaster.intersectObjects(activeMeshes, true);
            if (intersects.length > 0) {
                const hitId = intersects[0].object.userData.stationId;
                if (hitId) {
                    this.selectStation(hitId, true);
                }
            }
        });
    }

    updateLabelsProjection() {
        const width = this.container.clientWidth;
        const height = this.container.clientHeight;
        const list = this.mode === "polling"
            ? HANDBOOK_DATA.pollingStations
            : HANDBOOK_DATA.countingStations;

        list.forEach(st => {
            const el = this.labelElements.get(st.id);
            if (!el) return;

            const vec = new THREE.Vector3(st.position.x, st.position.y + 0.9, st.position.z);
            vec.project(this.camera);

            if (vec.z > 1) {
                el.style.opacity = "0";
                el.style.pointerEvents = "none";
                return;
            }

            const x = (vec.x * 0.5 + 0.5) * width;
            const y = (-(vec.y * 0.5) + 0.5) * height;
            el.style.opacity = "1";
            el.style.pointerEvents = "auto";
            el.style.transform = `translate(-50%, -100%) translate(${x}px, ${y}px)`;
        });
    }

    animate() {
        requestAnimationFrame(() => this.animate());

        const delta = this.clock.getDelta();
        const elapsed = this.clock.getElapsedTime();

        this.controls.update();

        // 選中光環脈衝動畫
        if (this.highlightRing.visible) {
            const scale = 1 + Math.sin(elapsed * 4) * 0.08;
            this.highlightRing.scale.set(scale, 1, scale);
        }

        // 3D 角色輕微呼吸律動
        this.animatedCharacters.forEach(item => {
            item.mesh.position.y = item.baseY + Math.sin(elapsed * 2.5 + item.phase) * 0.025;
        });

        // 動態模擬：投票人動線 / 開票唱票
        if (this.simulatingFlow) {
            if (this.mode === "polling" && this.simVoter) {
                this.voterSimProgress = (this.voterSimProgress + delta * 0.16) % 1;
                const waypoints = [
                    new THREE.Vector3(-6.6, 0, 8.2), // 1. 入口進入
                    new THREE.Vector3(-6.4, 0, 6.2), // 2. 查驗身分證 & 放手機
                    new THREE.Vector3(-4.6, 0, 1.4), // 3. 領票處簽章領票
                    new THREE.Vector3(-0.2, 0, -2.1), // 4. 2m~2.5m 等候線
                    new THREE.Vector3(0.0, 0, -4.6), // 5. 圈票處遮屏圈票
                    new THREE.Vector3(5.4, 0, -0.8), // 6. 投票匭投票
                    new THREE.Vector3(6.6, 0, 8.2)   // 7. 出口離開
                ];
                const totalSegs = waypoints.length - 1;
                const scaled = this.voterSimProgress * totalSegs;
                const idx = Math.floor(scaled);
                const t = scaled - idx;
                const p1 = waypoints[idx];
                const p2 = waypoints[Math.min(idx + 1, totalSegs)];
                this.simVoter.position.lerpVectors(p1, p2, t);
                this.simVoter.lookAt(p2.x, this.simVoter.position.y, p2.z);
            } else if (this.mode === "counting") {
                this.callingTimer += delta;
                if (this.heldBallot) {
                    this.heldBallot.position.y = 1.5 + Math.sin(elapsed * 6) * 0.12;
                }
                if (this.callingTimer > 1.8) {
                    this.callingTimer = 0;
                    const pick = Math.random() < 0.92 ? Math.floor(Math.random() * 3) : 3;
                    this.tallyCounts[pick]++;
                    this.updateTallyBoardCanvas(pick);
                    if (window.onCountingCallTick) {
                        window.onCountingCallTick(pick, this.tallyCounts);
                    }
                }
            }
        }

        this.renderer.render(this.scene, this.camera);
        this.updateLabelsProjection();
    }
}
