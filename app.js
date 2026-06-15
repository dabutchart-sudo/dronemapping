// Version 41 - With Corrected Token Diagnostics
document.addEventListener('DOMContentLoaded', async () => {

    const statusEl = document.getElementById('cesium-status');
    let isTokenValid = false;

    // ========================================================
    // TOKEN DIAGNOSTIC TEST (Corrected for 404/Auth)
    // ========================================================
    if (typeof CONFIG !== 'undefined' && CONFIG.CESIUM_ION_TOKEN) {
        Cesium.Ion.defaultAccessToken = CONFIG.CESIUM_ION_TOKEN;
        
        try {
            // Ping the Cesium World Terrain endpoint using the proper Authorization header
            const res = await fetch('https://api.cesium.com/v1/assets/1/endpoint', {
                headers: {
                    'Authorization': `Bearer ${CONFIG.CESIUM_ION_TOKEN}`
                }
            });
            
            if (res.status === 401) {
                if (statusEl) { statusEl.innerText = 'Token Invalid ✖'; statusEl.style.background = '#e74c3c'; }
                alert("CESIUM TOKEN ERROR: Your access token returned a 401 Unauthorized. The token has expired, been deleted, or is invalid.");
            } else if (res.ok) {
                if (statusEl) { statusEl.innerText = 'Token Valid ✔'; statusEl.style.background = '#2ecc71'; }
                isTokenValid = true;
            } else {
                if (statusEl) { statusEl.innerText = `API Error: ${res.status}`; statusEl.style.background = '#e67e22'; }
                console.warn(`Unexpected Cesium API response: ${res.status}`);
            }
        } catch (e) {
            if (statusEl) { statusEl.innerText = 'Network Error'; statusEl.style.background = '#e74c3c'; }
            console.error("Token verification failed to reach Cesium API:", e);
        }
    } else {
        if (statusEl) { statusEl.innerText = 'No Token Found'; statusEl.style.background = '#e74c3c'; }
        alert("Warning: CESIUM_ION_TOKEN not found in config.js. 3D maps will not load.");
    }

    // ========================================================
    // CESIUM 3D INITIALIZATION
    // ========================================================
    const viewer = new Cesium.Viewer('cesiumContainer', {
        terrain: Cesium.Terrain.fromWorldTerrain(), 
        animation: false,
        timeline: false,
        homeButton: false,
        fullscreenButton: false,
        geocoder: false,
        baseLayerPicker: false, 
        imageryProvider: false, 
        navigationHelpButton: false,
        infoBox: false,
        selectionIndicator: false,
        sceneModePicker: false
    });

    viewer.scene.globe.depthTestAgainstTerrain = true;

    if (isTokenValid) {
        Cesium.createOsmBuildingsAsync().then(buildings => {
            viewer.scene.primitives.add(buildings);
        });
    }

    viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(0.9006, 51.8959, 1000),
        orientation: { pitch: Cesium.Math.toRadians(-45.0) }
    });

    // ========================================================
    // MAP TOGGLE & KEYBOARD CONTROLS
    // ========================================================
    const imageryLayers = viewer.imageryLayers;
    let isSatellite = true;

    const osmLayerProvider = new Cesium.UrlTemplateImageryProvider({
        url: 'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
        credit: '© OpenStreetMap contributors'
    });

    if (isTokenValid) {
        Cesium.createWorldImageryAsync({ style: Cesium.IonWorldImageryStyle.AERIAL_WITH_LABELS }).then(provider => {
            imageryLayers.addImageryProvider(provider);
        });
    } else {
        imageryLayers.addImageryProvider(osmLayerProvider);
        isSatellite = false;
        document.getElementById('layer-toggle-btn').innerHTML = '🌍';
    }

    document.getElementById('layer-toggle-btn').addEventListener('click', async (e) => {
        if (!isTokenValid && isSatellite) return; // Prevent crashes if token is dead

        imageryLayers.removeAll();
        if (isSatellite) {
            imageryLayers.addImageryProvider(osmLayerProvider);
            e.target.innerHTML = '🌍';
            isSatellite = false;
        } else {
            const satProvider = await Cesium.createWorldImageryAsync({ style: Cesium.IonWorldImageryStyle.AERIAL_WITH_LABELS });
            imageryLayers.addImageryProvider(satProvider);
            e.target.innerHTML = '🗺️';
            isSatellite = true;
        }
    });

    document.getElementById('locate-btn').addEventListener('click', () => {
        if ("geolocation" in navigator) {
            navigator.geolocation.getCurrentPosition((position) => {
                viewer.camera.flyTo({
                    destination: Cesium.Cartesian3.fromDegrees(position.coords.longitude, position.coords.latitude, 500)
                });
            });
        }
    });

    if ("geolocation" in navigator) {
        navigator.geolocation.getCurrentPosition((position) => {
            viewer.camera.flyTo({
                destination: Cesium.Cartesian3.fromDegrees(position.coords.longitude, position.coords.latitude, 800),
                orientation: { pitch: Cesium.Math.toRadians(-60.0) }
            });
        });
    }

    document.addEventListener('keydown', (e) => {
        const tagName = e.target.tagName.toLowerCase();
        if (tagName === 'input' || tagName === 'select') return;
        
        const amount = viewer.camera.positionCartographic.height / 20; 
        
        switch(e.key) {
            case 'ArrowUp': viewer.camera.moveUp(amount); break;
            case 'ArrowDown': viewer.camera.moveDown(amount); break;
            case 'ArrowLeft': viewer.camera.moveLeft(amount); break;
            case 'ArrowRight': viewer.camera.moveRight(amount); break;
        }
    });

    // ========================================================
    // CAMERA CONTROLS (PITCH & ROTATE)
    // ========================================================
    document.getElementById('zoom-in-btn').addEventListener('click', () => viewer.camera.zoomIn(viewer.camera.positionCartographic.height * 0.3));
    document.getElementById('zoom-out-btn').addEventListener('click', () => viewer.camera.zoomOut(viewer.camera.positionCartographic.height * 0.3));

    function rotateCamera(degrees) {
        const windowCenter = new Cesium.Cartesian2(viewer.canvas.clientWidth / 2, viewer.canvas.clientHeight / 2);
        const ray = viewer.camera.getPickRay(windowCenter);
        const centerCartesian = viewer.scene.globe.pick(ray, viewer.scene);
        
        if (!centerCartesian) return;

        const currentHeading = viewer.camera.heading;
        const range = Cesium.Cartesian3.distance(viewer.camera.position, centerCartesian);
        
        viewer.camera.flyToBoundingSphere(new Cesium.BoundingSphere(centerCartesian, 0), {
            offset: new Cesium.HeadingPitchRange(currentHeading + Cesium.Math.toRadians(degrees), viewer.camera.pitch, range),
            duration: 0.5 
        });
    }

    function pitchCamera(degrees) {
        const windowCenter = new Cesium.Cartesian2(viewer.canvas.clientWidth / 2, viewer.canvas.clientHeight / 2);
        const ray = viewer.camera.getPickRay(windowCenter);
        const centerCartesian = viewer.scene.globe.pick(ray, viewer.scene);
        
        if (!centerCartesian) return;

        const currentPitch = viewer.camera.pitch;
        const range = Cesium.Cartesian3.distance(viewer.camera.position, centerCartesian);
        
        let newPitch = currentPitch + Cesium.Math.toRadians(degrees);
        if (newPitch > Cesium.Math.toRadians(-10)) newPitch = Cesium.Math.toRadians(-10);
        if (newPitch < Cesium.Math.toRadians(-85)) newPitch = Cesium.Math.toRadians(-85);

        viewer.camera.flyToBoundingSphere(new Cesium.BoundingSphere(centerCartesian, 0), {
            offset: new Cesium.HeadingPitchRange(viewer.camera.heading, newPitch, range),
            duration: 0.5 
        });
    }

    document.getElementById('rotate-left-btn').addEventListener('click', () => rotateCamera(-15));
    document.getElementById('rotate-right-btn').addEventListener('click', () => rotateCamera(15));
    document.getElementById('pitch-up-btn').addEventListener('click', () => pitchCamera(10));
    document.getElementById('pitch-down-btn').addEventListener('click', () => pitchCamera(-10));
    
    document.getElementById('north-btn').addEventListener('click', () => {
        const windowCenter = new Cesium.Cartesian2(viewer.canvas.clientWidth / 2, viewer.canvas.clientHeight / 2);
        const ray = viewer.camera.getPickRay(windowCenter);
        const centerCartesian = viewer.scene.globe.pick(ray, viewer.scene);
        
        if (!centerCartesian) return;

        const range = Cesium.Cartesian3.distance(viewer.camera.position, centerCartesian);
        
        viewer.camera.flyToBoundingSphere(new Cesium.BoundingSphere(centerCartesian, 0), {
            offset: new Cesium.HeadingPitchRange(0, viewer.camera.pitch, range),
            duration: 1.0
        });
    });

    function panToWaypoint(wp) {
        if (!wp) return;
        const currentCarto = viewer.camera.positionCartographic;
        const dest = Cesium.Cartesian3.fromDegrees(wp.lng, wp.lat, currentCarto.height);
        viewer.camera.flyTo({
            destination: dest,
            orientation: {
                heading: viewer.camera.heading,
                pitch: viewer.camera.pitch,
                roll: viewer.camera.roll
            },
            duration: 0.5
        });
    }

    // ========================================================
    // APPLICATION STATE
    // ========================================================
    let currentMode = 'select'; 
    let waypoints = [];
    let pois = [];
    let actionStack = []; 
    let selectedWpIds = []; 
    
    let orbitStep = 0, orbitCenterLatLng = null, currentOrbitRadius = 30;
    let gridStep = 0, gridCenterLatLng = null;

    let previewEntities = []; 

    const undoBtn = document.getElementById('undo-btn');
    const clearBtn = document.getElementById('clear-btn');
    const exportDjiBtn = document.getElementById('export-dji-btn');
    const exportLitchiBtn = document.getElementById('export-litchi-btn');
    
    const orbitSettingsPanel = document.getElementById('orbit-settings');
    const gridSettingsPanel = document.getElementById('grid-settings');
    const radiusInputEl = document.getElementById('orbit-radius');
    const globalSpeedEl = document.getElementById('global-speed');
    const finishActionEl = document.getElementById('finish-action');
    const simBtn = document.getElementById('sim-btn');
    const simControls = document.getElementById('sim-controls');
    const simStopBtn = document.getElementById('sim-stop-btn');
    const simScrubber = document.getElementById('sim-scrubber');
    const simCurrentTimeEl = document.getElementById('sim-current-time');
    const simTotalTimeEl = document.getElementById('sim-total-time');

    const floatingItemPanel = document.getElementById('floating-item-panel');
    const singleWpControls = document.getElementById('single-wp-controls');
    const missionStatsCounts = document.getElementById('mission-stats-counts');
    const missionStatsFlight = document.getElementById('mission-stats-flight');

    function clearPreviews() {
        previewEntities.forEach(ent => viewer.entities.remove(ent));
        previewEntities = [];
    }

    function setMode(mode) {
        currentMode = mode;
        orbitSettingsPanel.style.display = (mode === 'orbit') ? 'block' : 'none';
        gridSettingsPanel.style.display = (mode === 'grid') ? 'block' : 'none';
        
        document.querySelectorAll('.mode-toolbar-btn').forEach(btn => {
            if (btn.dataset.mode === mode) btn.classList.add('active');
            else btn.classList.remove('active');
        });

        if (orbitStep === 1) { orbitStep = 0; orbitCenterLatLng = null; clearPreviews(); }
        if (gridStep === 1) { gridStep = 0; gridCenterLatLng = null; clearPreviews(); }
    }
    
    document.querySelectorAll('.mode-toolbar-btn').forEach(btn => {
        btn.addEventListener('click', (e) => setMode(e.currentTarget.dataset.mode));
    });

    globalSpeedEl.addEventListener('input', () => updateUI());

    // ========================================================
    // FLOATING EDITOR & HUD LOGIC
    // ========================================================
    function getDistance(lat1, lon1, lat2, lon2) {
        const c1 = Cesium.Cartesian3.fromDegrees(lon1, lat1);
        const c2 = Cesium.Cartesian3.fromDegrees(lon2, lat2);
        return Cesium.Cartesian3.distance(c1, c2);
    }

    function updateHUD() {
        let totalDist = 0;
        let totalTime = 0;
        const baseSpeed = parseFloat(globalSpeedEl.value) || 5;

        for (let i = 0; i < waypoints.length - 1; i++) {
            const dist = getDistance(waypoints[i].lat, waypoints[i].lng, waypoints[i+1].lat, waypoints[i+1].lng);
            totalDist += dist;
            const legSpeed = waypoints[i].speed ? waypoints[i].speed : baseSpeed;
            totalTime += (dist / legSpeed);
            waypoints[i].actions.forEach(a => { if(a.type === 'hover') totalTime += parseFloat(a.param) || 0; });
        }
        
        if (waypoints.length > 0) {
            waypoints[waypoints.length-1].actions.forEach(a => { if(a.type === 'hover') totalTime += parseFloat(a.param) || 0; });
        }

        const mins = Math.floor(totalTime / 60);
        const secs = Math.round(totalTime % 60);

        missionStatsCounts.innerText = `Waypoints: ${waypoints.length} | POIs: ${pois.length}`;
        missionStatsFlight.innerText = `Distance: ${totalDist.toFixed(1)}m | Est. Time: ${mins}m ${secs}s`;
    }

    function updateUI() {
        updateHUD();

        if (selectedWpIds.length === 0) {
            floatingItemPanel.style.display = 'none';
            return;
        }

        floatingItemPanel.style.display = 'block';

        const isBulk = selectedWpIds.length > 1;
        document.getElementById('wp-editor-title').innerText = isBulk ? `Editing ${selectedWpIds.length} Waypoints` : `Waypoint ${getWpIndex(selectedWpIds[0])}`;

        singleWpControls.style.display = isBulk ? 'none' : 'flex';
        document.getElementById('poi-pitch-container').style.display = isBulk ? 'none' : 'grid';

        const navigatorPanel = document.getElementById('wp-navigator');
        if (navigatorPanel) navigatorPanel.style.display = isBulk ? 'none' : 'block';

        const primaryWp = waypoints.find(w => w.id === selectedWpIds[0]);

        const altInput = document.getElementById('wp-edit-alt');
        const curveInput = document.getElementById('wp-edit-curve');
        const speedInput = document.getElementById('wp-edit-speed');
        const poiSelect = document.getElementById('wp-edit-poi');
        const gimbalInput = document.getElementById('wp-edit-gimbal');

        altInput.value = isBulk ? '' : primaryWp.altitude;
        curveInput.value = isBulk ? '' : primaryWp.curveRadius;
        speedInput.value = isBulk ? '' : (primaryWp.speed || '');
        
        altInput.placeholder = isBulk ? 'Multiple' : '';
        curveInput.placeholder = isBulk ? 'Multiple' : '';
        speedInput.placeholder = isBulk ? 'Multiple' : 'Global';

        let poiOptions = `<option value="none">None (Follow Course)</option>`;
        pois.forEach(p => {
            const selected = (!isBulk && primaryWp.linkedPoiId === p.id) ? 'selected' : '';
            poiOptions += `<option value="${p.id}" ${selected}>${p.name}</option>`;
        });
        poiSelect.innerHTML = poiOptions;

        if (!isBulk) {
            if (primaryWp.linkedPoiId === 'none') {
                if (primaryWp.calculatedPitch === -90) {
                    gimbalInput.value = '-90.0° (Nadir)';
                } else {
                    gimbalInput.value = 'N/A';
                    primaryWp.calculatedPitch = 0;
                }
            } else {
                const targetPoi = pois.find(p => p.id === primaryWp.linkedPoiId);
                if (targetPoi) {
                    const horizDist = getDistance(primaryWp.lat, primaryWp.lng, targetPoi.lat, targetPoi.lng);
                    const wpAbsAlt = primaryWp.altitude + (primaryWp._groundHeight || 0);
                    const poiAbsAlt = targetPoi.altitude + (targetPoi._groundHeight || 0);
                    const altDiff = poiAbsAlt - wpAbsAlt;
                    
                    const pitchDeg = (Math.atan2(altDiff, horizDist) * 180) / Math.PI;
                    gimbalInput.value = `${pitchDeg.toFixed(1)}°`;
                    primaryWp.calculatedPitch = pitchDeg; 
                }
            }
        }

        const actionsList = document.getElementById('wp-actions-list');
        if (isBulk) {
            actionsList.innerHTML = `<p style="font-size: 12px; color: #7f8c8d; font-style: italic;">Actions locked in bulk mode.</p>`;
            document.getElementById('add-action-btn').disabled = true;
        } else {
            document.getElementById('add-action-btn').disabled = false;
            actionsList.innerHTML = '';
            primaryWp.actions.forEach((action, idx) => {
                const div = document.createElement('div');
                div.className = 'action-item';
                if (action.type === 'photo') {
                    div.innerHTML = `<span>📷 Take Photo</span> <button class="remove-action-btn" data-idx="${idx}">X</button>`;
                } else if (action.type === 'hover') {
                    div.innerHTML = `<span>⏳ Hover <input type="number" class="hover-time-input" data-idx="${idx}" value="${action.param}" min="1"> s</span> <button class="remove-action-btn" data-idx="${idx}">X</button>`;
                }
                actionsList.appendChild(div);
            });
        }

        const navLabel = document.getElementById('nav-label');
        if (navLabel) navLabel.innerText = isBulk ? `Bulk Mode` : `${getWpIndex(selectedWpIds[0])} / ${waypoints.length}`;
    }

    function getWpIndex(id) { return waypoints.findIndex(w => w.id === id) + 1; }

    document.getElementById('wp-edit-alt').addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        if (isNaN(val)) return;
        selectedWpIds.forEach(id => { waypoints.find(w => w.id === id).altitude = val; });
        redrawScene(false); 
    });

    document.getElementById('wp-edit-curve').addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        if (isNaN(val)) return;
        selectedWpIds.forEach(id => { waypoints.find(w => w.id === id).curveRadius = val; });
    });

    document.getElementById('wp-edit-speed').addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        selectedWpIds.forEach(id => { waypoints.find(w => w.id === id).speed = isNaN(val) ? null : val; });
        redrawScene(false); 
    });

    document.getElementById('wp-edit-poi').addEventListener('change', (e) => {
        const val = e.target.value;
        selectedWpIds.forEach(id => { waypoints.find(w => w.id === id).linkedPoiId = val; });
        redrawScene(false);
    });

    document.getElementById('add-action-btn').addEventListener('click', () => {
        if (selectedWpIds.length !== 1) return;
        const wp = waypoints.find(w => w.id === selectedWpIds[0]);
        const type = document.getElementById('add-action-type').value;
        if (type === 'photo') wp.actions.push({ type: 'photo', param: 0 });
        if (type === 'hover') wp.actions.push({ type: 'hover', param: 2 }); 
        updateUI();
    });

    document.getElementById('wp-actions-list').addEventListener('click', (e) => {
        if (e.target.classList.contains('remove-action-btn')) {
            const idx = parseInt(e.target.dataset.idx);
            const wp = waypoints.find(w => w.id === selectedWpIds[0]);
            wp.actions.splice(idx, 1);
            updateUI();
        }
    });

    document.getElementById('wp-actions-list').addEventListener('input', (e) => {
        if (e.target.classList.contains('hover-time-input')) {
            const idx = parseInt(e.target.dataset.idx);
            const wp = waypoints.find(w => w.id === selectedWpIds[0]);
            wp.actions[idx].param = parseFloat(e.target.value) || 1;
        }
    });

    document.getElementById('deselect-btn').addEventListener('click', () => {
        selectedWpIds = [];
        redrawScene(false);
    });

    function moveWaypoint(index, direction) {
        if (direction === -1 && index > 0) {
            const temp = waypoints[index];
            waypoints[index] = waypoints[index - 1];
            waypoints[index - 1] = temp;
        } else if (direction === 1 && index < waypoints.length - 1) {
            const temp = waypoints[index];
            waypoints[index] = waypoints[index + 1];
            waypoints[index + 1] = temp;
        }
        redrawScene(false);
    }
    
    function moveWaypointToEdge(index, toTop) {
        if (toTop && index > 0) {
            const wp = waypoints.splice(index, 1)[0];
            waypoints.unshift(wp);
        } else if (!toTop && index < waypoints.length - 1) {
            const wp = waypoints.splice(index, 1)[0];
            waypoints.push(wp);
        }
        redrawScene(false);
    }

    document.getElementById('wp-move-top').addEventListener('click', () => { if (selectedWpIds.length !== 1) return; moveWaypointToEdge(waypoints.findIndex(w => w.id === selectedWpIds[0]), true); });
    document.getElementById('wp-move-up').addEventListener('click', () => { if (selectedWpIds.length !== 1) return; moveWaypoint(waypoints.findIndex(w => w.id === selectedWpIds[0]), -1); });
    document.getElementById('wp-move-down').addEventListener('click', () => { if (selectedWpIds.length !== 1) return; moveWaypoint(waypoints.findIndex(w => w.id === selectedWpIds[0]), 1); });
    document.getElementById('wp-move-bottom').addEventListener('click', () => { if (selectedWpIds.length !== 1) return; moveWaypointToEdge(waypoints.findIndex(w => w.id === selectedWpIds[0]), false); });

    document.getElementById('wp-delete').addEventListener('click', () => {
        if (selectedWpIds.length !== 1) return;
        waypoints = waypoints.filter(w => w.id !== selectedWpIds[0]);
        selectedWpIds = [];
        redrawScene(true);
    });

    document.getElementById('nav-prev').addEventListener('click', () => {
        if (selectedWpIds.length !== 1) return;
        let idx = waypoints.findIndex(w => w.id === selectedWpIds[0]);
        if (idx > 0) { 
            const newWp = waypoints[idx - 1];
            selectedWpIds = [newWp.id]; 
            redrawScene(false); 
            panToWaypoint(newWp);
        }
    });

    document.getElementById('nav-next').addEventListener('click', () => {
        if (selectedWpIds.length !== 1) return;
        let idx = waypoints.findIndex(w => w.id === selectedWpIds[0]);
        if (idx < waypoints.length - 1) { 
            const newWp = waypoints[idx + 1];
            selectedWpIds = [newWp.id]; 
            redrawScene(false); 
            panToWaypoint(newWp);
        }
    });

    document.getElementById('select-all-btn').addEventListener('click', () => {
        selectedWpIds = waypoints.map(wp => wp.id);
        redrawScene(false);
    });

    undoBtn.addEventListener('click', () => {
        const lastAction = actionStack.pop();
        if (!lastAction) return;

        if (lastAction.type === 'waypoint') {
            waypoints = waypoints.filter(wp => wp.id !== lastAction.id);
            selectedWpIds = selectedWpIds.filter(id => id !== lastAction.id);
        } else if (lastAction.type === 'poi') {
            pois = pois.filter(p => p.id !== lastAction.id);
        } else if (lastAction.type === 'orbit') {
            pois = pois.filter(p => p.id !== lastAction.poiId);
            waypoints = waypoints.filter(wp => !lastAction.wpIds.includes(wp.id));
            selectedWpIds = selectedWpIds.filter(id => !lastAction.wpIds.includes(id));
        } else if (lastAction.type === 'grid') {
            waypoints = waypoints.filter(wp => !lastAction.wpIds.includes(wp.id));
            selectedWpIds = selectedWpIds.filter(id => !lastAction.wpIds.includes(id));
        }
        redrawScene(false);
    });

    clearBtn.addEventListener('click', function() {
        waypoints = []; pois = []; actionStack = []; selectedWpIds = [];
        redrawScene(false);
    });

    // ========================================================
    // CESIUM 3D INTERACTION (CLICK TO MOVE)
    // ========================================================
    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    let relocatingItem = null;
    let clickDownPos = null;
    let isShiftDown = false;

    document.addEventListener('keydown', (e) => { if (e.key === 'Shift') isShiftDown = true; });
    document.addEventListener('keyup', (e) => { if (e.key === 'Shift') isShiftDown = false; });

    function getEarthPosition(position) {
        const ray = viewer.camera.getPickRay(position);
        const cartesian = viewer.scene.globe.pick(ray, viewer.scene);
        if (cartesian) {
            const cartographic = Cesium.Cartographic.fromCartesian(cartesian);
            return {
                lat: Cesium.Math.toDegrees(cartographic.latitude),
                lng: Cesium.Math.toDegrees(cartographic.longitude)
            };
        }
        return null;
    }

    handler.setInputAction(function(click) {
        clickDownPos = click.position;
    }, Cesium.ScreenSpaceEventType.LEFT_DOWN);

    handler.setInputAction(function(movement) {
        const coords = getEarthPosition(movement.endPosition);
        if (!coords) return;

        if (relocatingItem) {
            if (relocatingItem.type === 'wp') {
                const wp = waypoints.find(w => w.id === relocatingItem.id);
                if (wp) { wp.lat = coords.lat; wp.lng = coords.lng; }
            } else if (relocatingItem.type === 'poi') {
                const p = pois.find(p => p.id === relocatingItem.id);
                if (p) { p.lat = coords.lat; p.lng = coords.lng; }
            }
            redrawScene(false); 
            return;
        }

        if (currentMode === 'orbit' && orbitStep === 1 && orbitCenterLatLng) {
            let distance = getDistance(orbitCenterLatLng.lat, orbitCenterLatLng.lng, coords.lat, coords.lng);
            currentOrbitRadius = Math.max(5, distance);
            radiusInputEl.value = Math.round(currentOrbitRadius);
            
            clearPreviews();
            previewEntities.push(viewer.entities.add({
                position: Cesium.Cartesian3.fromDegrees(orbitCenterLatLng.lng, orbitCenterLatLng.lat),
                ellipse: { semiMinorAxis: currentOrbitRadius, semiMajorAxis: currentOrbitRadius, material: Cesium.Color.PURPLE.withAlpha(0.2), outline: true, outlineColor: Cesium.Color.PURPLE }
            }));
        } 
        else if (currentMode === 'grid' && gridStep === 1 && gridCenterLatLng) {
            const latDiff = Math.abs(coords.lat - gridCenterLatLng.lat);
            const lngDiff = Math.abs(coords.lng - gridCenterLatLng.lng);
            
            clearPreviews();
            previewEntities.push(viewer.entities.add({
                rectangle: {
                    coordinates: Cesium.Rectangle.fromDegrees(
                        gridCenterLatLng.lng - lngDiff, gridCenterLatLng.lat - latDiff,
                        gridCenterLatLng.lng + lngDiff, gridCenterLatLng.lat + latDiff
                    ),
                    material: Cesium.Color.TEAL.withAlpha(0.2),
                    outline: true, outlineColor: Cesium.Color.TEAL
                }
            }));
            
            const earthRadius = 6378137;
            const widthM = (lngDiff * Math.PI / 180) * earthRadius * Math.cos(gridCenterLatLng.lat * Math.PI / 180) * 2;
            const lengthM = (latDiff * Math.PI / 180) * earthRadius * 2;
            
            document.getElementById('grid-width').value = Math.max(5, Math.round(widthM));
            document.getElementById('grid-length').value = Math.max(5, Math.round(lengthM));
        }
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

    handler.setInputAction(function(click) {
        if (relocatingItem) {
            relocatingItem = null;
            viewer.scene.screenSpaceCameraController.enableInputs = true; 
            redrawScene(true); 
            return; 
        }

        if (clickDownPos) {
            const dx = Math.abs(click.position.x - clickDownPos.x);
            const dy = Math.abs(click.position.y - clickDownPos.y);
            if (dx > 5 || dy > 5) return; 
        }

        const picked = viewer.scene.pick(click.position);

        if (picked && picked.id && picked.id.isInteractive) {
            if (currentMode === 'orbit' && orbitStep === 1) return;
            if (currentMode === 'grid' && gridStep === 1) return;

            const itemId = picked.id.itemId;
            const itemType = picked.id.itemType;

            if (itemType === 'wp') {
                if (isShiftDown) {
                    if (selectedWpIds.includes(itemId)) {
                        selectedWpIds = selectedWpIds.filter(id => id !== itemId);
                    } else {
                        selectedWpIds.push(itemId);
                    }
                } else {
                    if (selectedWpIds.length === 1 && selectedWpIds[0] === itemId) {
                        relocatingItem = { type: 'wp', id: itemId };
                        viewer.scene.screenSpaceCameraController.enableInputs = false; 
                        redrawScene(false); 
                        return; 
                    } else {
                        selectedWpIds = [itemId];
                    }
                }
                redrawScene(false);
            } else if (itemType === 'poi') {
                relocatingItem = { type: 'poi', id: itemId };
                viewer.scene.screenSpaceCameraController.enableInputs = false; 
                redrawScene(false); 
            }
            return; 
        }

        if (currentMode === 'select') {
            selectedWpIds = [];
            redrawScene(false);
            return;
        }

        const coords = getEarthPosition(click.position);
        if (!coords) return;

        if (currentMode === 'orbit') {
            if (orbitStep === 0) {
                orbitStep = 1; orbitCenterLatLng = coords;
            } else if (orbitStep === 1) {
                orbitStep = 0; clearPreviews();
                generateOrbit(orbitCenterLatLng.lat, orbitCenterLatLng.lng);
                orbitCenterLatLng = null;
            }
        } else if (currentMode === 'grid') {
            if (gridStep === 0) {
                gridStep = 1; gridCenterLatLng = coords;
            } else if (gridStep === 1) {
                gridStep = 0; clearPreviews();
                generateGrid(gridCenterLatLng.lat, gridCenterLatLng.lng);
                gridCenterLatLng = null;
            }
        } else if (currentMode === 'waypoint') {
            const wp = addWaypoint(coords.lat, coords.lng);
            selectedWpIds = [wp.id]; 
            actionStack.push({ type: 'waypoint', id: wp.id });
            redrawScene(true);
        } else if (currentMode === 'poi') {
            const p = addPOI(coords.lat, coords.lng);
            actionStack.push({ type: 'poi', id: p.id });
        }
    }, Cesium.ScreenSpaceEventType.LEFT_UP);

    // ========================================================
    // LOGIC & DATA GENERATION
    // ========================================================
    function addWaypoint(lat, lng, altitude = 50, linkedPoiId = 'none', hasPhoto = false) {
        let initialActions = [];
        if (hasPhoto) { initialActions = [{ type: 'hover', param: 2 }, { type: 'photo', param: 0 }]; }
        const waypoint = { 
            id: Date.now() + Math.random(), lat: lat, lng: lng, altitude: altitude, speed: null,
            curveRadius: 0, linkedPoiId: linkedPoiId, calculatedPitch: 0, actions: initialActions,
            _groundHeight: 0 
        };
        waypoints.push(waypoint);
        return waypoint;
    }

    function addPOI(lat, lng) {
        const poiIndex = pois.length + 1;
        const poi = { 
            id: 'poi_' + Date.now() + Math.random(), name: `POI ${poiIndex}`, 
            lat: lat, lng: lng, altitude: 15, _groundHeight: 0
        };
        pois.push(poi);
        redrawScene(true);
        return poi;
    }

    function generateOrbit(centerLat, centerLng) {
        const radiusMeters = parseFloat(radiusInputEl.value);
        const altitude = parseFloat(document.getElementById('orbit-alt').value);
        const photoCount = parseInt(document.getElementById('orbit-count').value);
        const centerPoi = addPOI(centerLat, centerLng);
        const earthRadius = 6378137; 
        const generatedWpIds = [];
        
        for (let i = 0; i < photoCount; i++) {
            const angleRad = ((360 / photoCount) * i) * (Math.PI / 180);
            const wpLat = centerLat + ((radiusMeters * Math.cos(angleRad)) / earthRadius) * (180 / Math.PI);
            const wpLng = centerLng + ((radiusMeters * Math.sin(angleRad)) / earthRadius) * (180 / Math.PI) / Math.cos(centerLat * Math.PI / 180);
            const wp = addWaypoint(wpLat, wpLng, altitude, centerPoi.id, true);
            generatedWpIds.push(wp.id);
        }
        actionStack.push({ type: 'orbit', poiId: centerPoi.id, wpIds: generatedWpIds });
        setMode('select');
        redrawScene(true);
    }

    function generateGrid(centerLat, centerLng) {
        const widthMeters = parseFloat(document.getElementById('grid-width').value);
        const lengthMeters = parseFloat(document.getElementById('grid-length').value);
        const spacing = parseFloat(document.getElementById('grid-spacing').value);
        const altitude = parseFloat(document.getElementById('grid-alt').value);
        const earthRadius = 6378137;
        const generatedWpIds = [];

        const cols = Math.floor(widthMeters / spacing) + 1;
        const rows = Math.floor(lengthMeters / spacing) + 1;
        const startLatOffset = -lengthMeters / 2;
        const startLngOffset = -widthMeters / 2;

        for (let c = 0; c < cols; c++) {
            const isUp = c % 2 === 0;
            for (let r = 0; r < rows; r++) {
                const actualRow = isUp ? r : (rows - 1 - r);
                const yOffset = startLatOffset + (actualRow * spacing);
                const xOffset = startLngOffset + (c * spacing);

                const wpLat = centerLat + (yOffset / earthRadius) * (180 / Math.PI);
                const wpLng = centerLng + (xOffset / earthRadius) * (180 / Math.PI) / Math.cos(centerLat * Math.PI / 180);

                const wp = addWaypoint(wpLat, wpLng, altitude, 'none', true);
                wp.calculatedPitch = -90; 
                generatedWpIds.push(wp.id);
            }
        }
        actionStack.push({ type: 'grid', wpIds: generatedWpIds });
        setMode('select');
        redrawScene(true);
    }

    // ========================================================
    // CESIUM 3D RENDER ENGINE
    // ========================================================
    let renderCounter = 0; 

    async function redrawScene(sampleTerrain = true) {
        const currentRender = ++renderCounter;

        if (sampleTerrain) {
            const cartographics = [];
            waypoints.forEach(wp => cartographics.push(Cesium.Cartographic.fromDegrees(wp.lng, wp.lat)));
            pois.forEach(poi => cartographics.push(Cesium.Cartographic.fromDegrees(poi.lng, poi.lat)));

            let tp = viewer.terrainProvider || viewer.scene.terrainProvider;
            
            // SECURITY CHECK: Only try to sample terrain if the token was validated successfully
            if (cartographics.length > 0 && tp && isTokenValid) {
                try {
                    await Cesium.sampleTerrainMostDetailed(tp, cartographics);
                } catch (e) { console.warn("Terrain sample failed, defaulting to 0"); }
            }

            if (currentRender !== renderCounter) return; 

            let cIdx = 0;
            waypoints.forEach(wp => { wp._groundHeight = cartographics.length > 0 ? (cartographics[cIdx++].height || 0) : 0; });
            pois.forEach(poi => { poi._groundHeight = cartographics.length > 0 ? (cartographics[cIdx++].height || 0) : 0; });
        }

        viewer.entities.removeAll();

        if (waypoints.length > 1) {
            const positions = [];
            waypoints.forEach(wp => {
                const absoluteZ = wp.altitude + (wp._groundHeight || 0);
                positions.push(Cesium.Cartesian3.fromDegrees(wp.lng, wp.lat, absoluteZ));
            });
            viewer.entities.add({
                polyline: { positions: positions, width: 4, material: new Cesium.PolylineDashMaterialProperty({color: Cesium.Color.DODGERBLUE}) }
            });
        }

        pois.forEach((poi) => {
            const poiAbsoluteZ = poi.altitude + (poi._groundHeight || 0);
            
            let pColor = Cesium.Color.ORANGE;
            if (relocatingItem && relocatingItem.type === 'poi' && relocatingItem.id === poi.id) pColor = Cesium.Color.LIMEGREEN;

            const ent = viewer.entities.add({
                position: Cesium.Cartesian3.fromDegrees(poi.lng, poi.lat, poiAbsoluteZ),
                point: { pixelSize: 12, color: pColor, outlineColor: Cesium.Color.WHITE, outlineWidth: 2 },
                label: { text: poi.name, font: '12pt sans-serif', style: Cesium.LabelStyle.FILL_AND_OUTLINE, outlineWidth: 2, verticalOrigin: Cesium.VerticalOrigin.BOTTOM, pixelOffset: new Cesium.Cartesian2(0, -15) }
            });
            ent.isInteractive = true;
            ent.itemType = 'poi';
            ent.itemId = poi.id;
            
            viewer.entities.add({ polyline: { positions: Cesium.Cartesian3.fromDegreesArrayHeights([poi.lng, poi.lat, poi._groundHeight || 0, poi.lng, poi.lat, poiAbsoluteZ]), width: 2, material: pColor.withAlpha(0.5) } });
        });

        waypoints.forEach((wp, index) => {
            const isSelected = selectedWpIds.includes(wp.id);
            
            let color = Cesium.Color.DODGERBLUE;
            if (relocatingItem && relocatingItem.type === 'wp' && relocatingItem.id === wp.id) {
                color = Cesium.Color.LIMEGREEN;
            } else if (isSelected) {
                color = Cesium.Color.YELLOW;
            }

            const wpAbsoluteZ = wp.altitude + (wp._groundHeight || 0);
            
            const ent = viewer.entities.add({
                position: Cesium.Cartesian3.fromDegrees(wp.lng, wp.lat, wpAbsoluteZ),
                point: { pixelSize: isSelected ? 16 : 12, color: color, outlineColor: Cesium.Color.WHITE, outlineWidth: 2 },
                label: { text: `WP ${index+1}`, font: 'bold 12pt sans-serif', fillColor: color, style: Cesium.LabelStyle.FILL_AND_OUTLINE, outlineWidth: 2, verticalOrigin: Cesium.VerticalOrigin.BOTTOM, pixelOffset: new Cesium.Cartesian2(0, -15) }
            });
            ent.isInteractive = true;
            ent.itemType = 'wp';
            ent.itemId = wp.id;

            viewer.entities.add({ polyline: { positions: Cesium.Cartesian3.fromDegreesArrayHeights([wp.lng, wp.lat, wp._groundHeight || 0, wp.lng, wp.lat, wpAbsoluteZ]), width: 2, material: color.withAlpha(0.5) } });

            if (wp.linkedPoiId !== 'none') {
                const targetPoi = pois.find(p => p.id === wp.linkedPoiId);
                if (targetPoi) {
                    const poiAbsoluteZ = targetPoi.altitude + (targetPoi._groundHeight || 0);

                    const distance = getDistance(wp.lat, wp.lng, targetPoi.lat, targetPoi.lng);
                    const earthRadius = 6378137;
                    const dLng = (targetPoi.lng - wp.lng) * Math.cos(wp.lat * Math.PI / 180);
                    const dLat = targetPoi.lat - wp.lat;
                    
                    const headingRad = Math.atan2(dLng, dLat); 
                    const halfFovRad = (75 / 2) * (Math.PI / 180);
                    
                    const leftLat = wp.lat + (distance * Math.cos(headingRad - halfFovRad) / earthRadius) * (180 / Math.PI);
                    const leftLng = wp.lng + (distance * Math.sin(headingRad - halfFovRad) / earthRadius) * (180 / Math.PI) / Math.cos(wp.lat * Math.PI / 180);
                    const rightLat = wp.lat + (distance * Math.cos(headingRad + halfFovRad) / earthRadius) * (180 / Math.PI);
                    const rightLng = wp.lng + (distance * Math.sin(headingRad + halfFovRad) / earthRadius) * (180 / Math.PI) / Math.cos(wp.lat * Math.PI / 180);

                    viewer.entities.add({ polyline: { positions: Cesium.Cartesian3.fromDegreesArrayHeights([wp.lng, wp.lat, wpAbsoluteZ, targetPoi.lng, targetPoi.lat, poiAbsoluteZ]), width: 2, material: new Cesium.PolylineDashMaterialProperty({color: Cesium.Color.YELLOW}) } });
                    viewer.entities.add({
                        polygon: {
                            hierarchy: new Cesium.PolygonHierarchy(Cesium.Cartesian3.fromDegreesArrayHeights([
                                wp.lng, wp.lat, wpAbsoluteZ,
                                leftLng, leftLat, poiAbsoluteZ,
                                rightLng, rightLat, poiAbsoluteZ
                            ])),
                            material: Cesium.Color.YELLOW.withAlpha(0.2),
                            perPositionHeight: true
                        }
                    });
                }
            }
        });

        const canExport = waypoints.length > 1;
        exportDjiBtn.disabled = !canExport;
        exportLitchiBtn.disabled = !canExport;
        simBtn.disabled = !canExport; 
        
        updateUI();
    }

    // ========================================================
    // SIMULATION ENGINE WITH DYNAMIC FOV
    // ========================================================
    let simDroneEntity = null;
    let simFovEntity = null;
    let isScrubbing = false;

    function getDynamicFovCorners(time, posProp, orientProp, pitchProp) {
        const pos = posProp.getValue(time);
        const droneOrientQuat = orientProp.getValue(time);
        if (!pos || !droneOrientQuat) return null;

        const pitchDeg = pitchProp.getValue(time) || 0;
        const pitchQuat = Cesium.Quaternion.fromAxisAngle(Cesium.Cartesian3.UNIT_Y, Cesium.Math.toRadians(pitchDeg));
        const combinedQuat = Cesium.Quaternion.multiply(droneOrientQuat, pitchQuat, new Cesium.Quaternion());

        const transform = Cesium.Matrix4.fromRotationTranslation(Cesium.Matrix3.fromQuaternion(combinedQuat), pos);
        
        const d = 50; 
        const w = d * Math.tan(Cesium.Math.toRadians(35)); 
        const h = w * (9/16); 

        const tl = new Cesium.Cartesian3(d, w, h);
        const tr = new Cesium.Cartesian3(d, -w, h);
        const bl = new Cesium.Cartesian3(d, w, -h);
        const br = new Cesium.Cartesian3(d, -w, -h);

        return {
            pos: pos,
            tl: Cesium.Matrix4.multiplyByPoint(transform, tl, new Cesium.Cartesian3()),
            tr: Cesium.Matrix4.multiplyByPoint(transform, tr, new Cesium.Cartesian3()),
            bl: Cesium.Matrix4.multiplyByPoint(transform, bl, new Cesium.Cartesian3()),
            br: Cesium.Matrix4.multiplyByPoint(transform, br, new Cesium.Cartesian3())
        };
    }

    function formatTime(secs) {
        const m = Math.floor(secs / 60).toString().padStart(2, '0');
        const s = Math.floor(secs % 60).toString().padStart(2, '0');
        return `${m}:${s}`;
    }

    simScrubber.addEventListener('mousedown', () => isScrubbing = true);
    simScrubber.addEventListener('mouseup', () => isScrubbing = false);
    simScrubber.addEventListener('input', (e) => {
        if (!viewer.clock.startTime) return;
        const seconds = parseFloat(e.target.value);
        viewer.clock.currentTime = Cesium.JulianDate.addSeconds(viewer.clock.startTime, seconds, new Cesium.JulianDate());
        simCurrentTimeEl.innerText = formatTime(seconds);
    });

    viewer.clock.onTick.addEventListener((clock) => {
        if (isScrubbing || simBtn.style.display === 'block') return; 
        const elapsed = Cesium.JulianDate.secondsDifference(clock.currentTime, clock.startTime);
        simScrubber.value = elapsed;
        simCurrentTimeEl.innerText = formatTime(elapsed);
    });

    simBtn.addEventListener('click', () => {
        if (waypoints.length < 2) return;
        
        const baseSpeed = parseFloat(globalSpeedEl.value) || 5;
        let currentTime = Cesium.JulianDate.now();
        const startTime = currentTime.clone();
        
        const positionProperty = new Cesium.SampledPositionProperty();
        const pitchProperty = new Cesium.SampledProperty(Number);
        const orientationProperty = new Cesium.SampledProperty(Cesium.Quaternion);
        
        for(let i=0; i<waypoints.length; i++) {
            const wp = waypoints[i];
            const wpAbsZ = wp.altitude + (wp._groundHeight || 0);
            const pos = Cesium.Cartesian3.fromDegrees(wp.lng, wp.lat, wpAbsZ);
            
            let heading = 0;
            if (wp.linkedPoiId !== 'none') {
                const poi = pois.find(p => p.id === wp.linkedPoiId);
                if (poi) {
                    const dx = (poi.lng - wp.lng) * Math.cos(wp.lat * Math.PI / 180);
                    const dy = poi.lat - wp.lat;
                    heading = Math.atan2(dx, dy) - Math.PI / 2;
                }
            } else if (i < waypoints.length - 1) {
                const nextWp = waypoints[i+1];
                const dx = (nextWp.lng - wp.lng) * Math.cos(wp.lat * Math.PI / 180);
                const dy = nextWp.lat - wp.lat;
                heading = Math.atan2(dx, dy) - Math.PI / 2;
            } else if (i > 0) {
                const prevWp = waypoints[i-1];
                const dx = (wp.lng - prevWp.lng) * Math.cos(prevWp.lat * Math.PI / 180);
                const dy = wp.lat - prevWp.lat;
                heading = Math.atan2(dx, dy) - Math.PI / 2;
            }

            const hpr = new Cesium.HeadingPitchRoll(heading, 0, 0);
            const quat = Cesium.Transforms.headingPitchRollQuaternion(pos, hpr);

            positionProperty.addSample(currentTime, pos);
            pitchProperty.addSample(currentTime, wp.calculatedPitch || 0);
            orientationProperty.addSample(currentTime, quat);
            
            let hoverTime = 0;
            wp.actions.forEach(a => { if(a.type === 'hover') hoverTime += parseFloat(a.param) || 0; });
            if (hoverTime > 0) {
                currentTime = Cesium.JulianDate.addSeconds(currentTime, hoverTime, new Cesium.JulianDate());
                positionProperty.addSample(currentTime, pos);
                pitchProperty.addSample(currentTime, wp.calculatedPitch || 0);
                orientationProperty.addSample(currentTime, quat);
            }
            
            if (i < waypoints.length - 1) {
                const nextWp = waypoints[i+1];
                const nextAbsZ = nextWp.altitude + (nextWp._groundHeight || 0);
                const nextPos = Cesium.Cartesian3.fromDegrees(nextWp.lng, nextWp.lat, nextAbsZ);
                const dist = Cesium.Cartesian3.distance(pos, nextPos);
                
                const travelSpeed = wp.speed ? wp.speed : baseSpeed;
                const travelSeconds = dist / travelSpeed;
                
                currentTime = Cesium.JulianDate.addSeconds(currentTime, travelSeconds, new Cesium.JulianDate());
            }
        }
        
        const stopTime = currentTime.clone();
        
        viewer.clock.startTime = startTime;
        viewer.clock.stopTime = stopTime;
        viewer.clock.currentTime = startTime;
        viewer.clock.clockRange = Cesium.ClockRange.CLAMPED; 
        viewer.clock.multiplier = 1; 
        viewer.clock.shouldAnimate = true;

        const totalDuration = Cesium.JulianDate.secondsDifference(stopTime, startTime);
        simScrubber.max = totalDuration;
        simScrubber.value = 0;
        simTotalTimeEl.innerText = formatTime(totalDuration);
        simCurrentTimeEl.innerText = "00:00";
        
        if (simDroneEntity) viewer.entities.remove(simDroneEntity);
        if (simFovEntity) viewer.entities.remove(simFovEntity);
        
        simDroneEntity = viewer.entities.add({
            availability: new Cesium.TimeIntervalCollection([new Cesium.TimeInterval({ start: startTime, stop: stopTime })]),
            position: positionProperty,
            orientation: orientationProperty,
            box: {
                dimensions: new Cesium.Cartesian3(0.3, 0.3, 0.1), 
                material: Cesium.Color.DARKGRAY, outline: true, outlineColor: Cesium.Color.BLACK
            },
            point: { pixelSize: 12, color: Cesium.Color.RED, outlineColor: Cesium.Color.WHITE, outlineWidth: 2 },
            path: { resolution: 1, material: new Cesium.PolylineGlowMaterialProperty({ glowPower: 0.1, color: Cesium.Color.CYAN }), width: 3 }
        });

        simFovEntity = viewer.entities.add({
            availability: new Cesium.TimeIntervalCollection([new Cesium.TimeInterval({ start: startTime, stop: stopTime })]),
            polyline: {
                positions: new Cesium.CallbackProperty((time) => {
                    const pts = getDynamicFovCorners(time, positionProperty, orientationProperty, pitchProperty);
                    if (!pts) return [];
                    return [
                        pts.pos, pts.tl, pts.tr, pts.pos,
                        pts.tr, pts.br, pts.pos,
                        pts.br, pts.bl, pts.pos,
                        pts.bl, pts.tl
                    ];
                }, false),
                width: 2,
                material: Cesium.Color.CYAN.withAlpha(0.6)
            },
            polygon: {
                hierarchy: new Cesium.CallbackProperty((time) => {
                    const pts = getDynamicFovCorners(time, positionProperty, orientationProperty, pitchProperty);
                    if (!pts) return undefined;
                    return new Cesium.PolygonHierarchy([pts.tl, pts.tr, pts.br, pts.bl]);
                }, false),
                material: Cesium.Color.CYAN.withAlpha(0.2),
                perPositionHeight: true
            }
        });
        
        simBtn.style.display = 'none';
        simControls.style.display = 'flex';
    });

    simStopBtn.addEventListener('click', () => {
        viewer.clock.shouldAnimate = false;
        if (simDroneEntity) viewer.entities.remove(simDroneEntity);
        if (simFovEntity) viewer.entities.remove(simFovEntity);
        simBtn.style.display = 'block';
        simControls.style.display = 'none';
    });

    // ========================================================
    // EXPORT ENGINES
    // ========================================================
    exportDjiBtn.addEventListener('click', function() {
        if (waypoints.length < 2) return;
        let globalSpeed = parseFloat(globalSpeedEl.value) || 5;
        let finishAction = finishActionEl.value; 
        const zip = new JSZip();
        let waypointElementsXml = '';
        
        waypoints.forEach((wp, index) => {
            let headingMode = 'followWayline';
            let poiStructureXml = '';

            if (wp.linkedPoiId !== 'none') {
                const targetPoi = pois.find(p => p.id === wp.linkedPoiId);
                if (targetPoi) {
                    headingMode = 'towardPOI';
                    poiStructureXml = `<wpml:waypointPoiPoint><wpml:waypointPoiCoordinate>${targetPoi.lng},${targetPoi.lat}</wpml:waypointPoiCoordinate><wpml:waypointPoiAltitude>${targetPoi.altitude}</wpml:waypointPoiAltitude></wpml:waypointPoiPoint>`;
                }
            }

            let turnMode = wp.curveRadius > 0 ? 'coordinateTurn' : 'toPointAndStopWithDiscontinuityAngle';
            let turnParamXml = `<wpml:waypointTurnParam><wpml:waypointTurnMode>${turnMode}</wpml:waypointTurnMode><wpml:waypointTurnDampingDist>${wp.curveRadius}</wpml:waypointTurnDampingDist></wpml:waypointTurnParam>`;

            let actionXml = `<wpml:hasAction>0</wpml:hasAction>`;
            if (wp.actions.length > 0) {
                let innerActions = '';
                wp.actions.forEach((act, aIdx) => {
                    let funcStr = act.type === 'photo' ? 'takePhoto' : 'hover';
                    let paramStr = act.type === 'photo' ? `<wpml:fileSuffix>wp_${index + 1}</wpml:fileSuffix>` : `<wpml:hoverTime>${act.param}</wpml:hoverTime>`;
                    innerActions += `<wpml:action><wpml:actionId>${aIdx}</wpml:actionId><wpml:actionActuatorFunc>${funcStr}</wpml:actionActuatorFunc><wpml:actionActuatorFuncParam>${paramStr}</wpml:actionActuatorFuncParam></wpml:action>`;
                });
                actionXml = `<wpml:hasAction>1</wpml:hasAction><wpml:actionGroup><wpml:actionGroupId>${index}</wpml:actionGroupId><wpml:actionGroupStartIndex>${index}</wpml:actionGroupStartIndex><wpml:actionGroupEndIndex>${index}</wpml:actionGroupEndIndex><wpml:actionGroupMode>sequence</wpml:actionGroupMode>${innerActions}</wpml:actionGroup>`;
            }

            const wpSpeed = wp.speed ? wp.speed : globalSpeed;
            waypointElementsXml += `<Placemark><Point><coordinates>${wp.lng},${wp.lat}</coordinates></Point><wpml:index>${index}</wpml:index><wpml:executeHeight>${wp.altitude}</wpml:executeHeight><wpml:waypointSpeed>${wpSpeed}</wpml:waypointSpeed><wpml:waypointHeadingMode>${headingMode}</wpml:waypointHeadingMode>${poiStructureXml}${turnParamXml}${actionXml}<wpml:useGlobalHeight>0</wpml:useGlobalHeight></Placemark>`;
        });

        const kmlContent = `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2" xmlns:wpml="http://www.dji.com/wpmz/1.0.4"><Document><wpml:createTime>${Date.now()}</wpml:createTime><wpml:updateTime>${Date.now()}</wpml:updateTime><Folder><wpml:templateId>0</wpml:templateId><wpml:executeHeightMode>relativeToStartPoint</wpml:executeHeightMode><wpml:waylineCoordinateSysParam><wpml:coordinateSysType>WGS84</wpml:coordinateSysType><wpml:heightMode>EGM96</wpml:heightMode></wpml:waylineCoordinateSysParam><wpml:autoFlightSpeed>${globalSpeed}</wpml:autoFlightSpeed><wpml:globalWaypointTurnMode>toPointAndStopWithDiscontinuityAngle</wpml:globalWaypointTurnMode><wpml:missionFinishAction>${finishAction}</wpml:missionFinishAction><wpml:gimbalPitchMode>usePointSetting</wpml:gimbalPitchMode>${waypointElementsXml}</Folder></Document></kml>`;

        zip.folder("wpmz").file("template.kml", kmlContent);
        zip.generateAsync({ type: "blob" }).then(function(content) {
            const element = document.createElement('a'); element.href = URL.createObjectURL(content); element.download = "dji_fly_mission.kmz"; document.body.appendChild(element); element.click(); document.body.removeChild(element);
        });
    });

    exportLitchiBtn.addEventListener('click', function() {
        if (waypoints.length < 2) return;
        let globalSpeed = parseFloat(globalSpeedEl.value) || 5;
        let csvContent = "latitude,longitude,altitude(m),heading(deg),curvesize(m),rotationdir,gimbalmode,gimbalpitchangle,actiontype1,actionparam1,actiontype2,actionparam2,actiontype3,actionparam3,actiontype4,actionparam4,actiontype5,actionparam5,actiontype6,actionparam6,actiontype7,actionparam7,actiontype8,actionparam8,actiontype9,actionparam9,actiontype10,actionparam10,actiontype11,actionparam11,actiontype12,actionparam12,actiontype13,actionparam13,actiontype14,actionparam14,actiontype15,actionparam15,altitudemode,speed(m/s),poi_latitude,poi_longitude,poi_altitude(m),poi_altitudemode,photo_timeinterval,photo_distinterval\n";

        waypoints.forEach(wp => {
            let gimbalmode = 0, poiLat = 0, poiLng = 0, poiAlt = 0, pitchOutput = 0; 
            
            if (wp.linkedPoiId !== 'none') {
                const targetPoi = pois.find(p => p.id === wp.linkedPoiId);
                if (targetPoi) { gimbalmode = 1; poiLat = targetPoi.lat; poiLng = targetPoi.lng; poiAlt = targetPoi.altitude; pitchOutput = wp.calculatedPitch || 0; }
            } else if (wp.calculatedPitch === -90) {
                pitchOutput = -90; gimbalmode = 0; 
            }

            let litchiActions = [];
            for(let i=0; i<15; i++) {
                if (i < wp.actions.length) {
                    let act = wp.actions[i];
                    if (act.type === 'photo') { litchiActions.push(1, 0); }
                    if (act.type === 'hover') { litchiActions.push(0, act.param * 1000); } 
                } else {
                    litchiActions.push(-1, 0); 
                }
            }

            const wpSpeed = wp.speed ? wp.speed : globalSpeed;

            let row = [
                wp.lat.toFixed(7), wp.lng.toFixed(7), wp.altitude, 0, wp.curveRadius, 0, gimbalmode, pitchOutput,
                ...litchiActions, 0, wpSpeed, poiLat.toFixed(7), poiLng.toFixed(7), poiAlt, 0, 0, 0 
            ];
            csvContent += row.join(",") + "\n";
        });

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a"); link.setAttribute("href", url); link.setAttribute("download", "litchi_mission.csv"); document.body.appendChild(link); link.click(); document.body.removeChild(link);
    });

    setTimeout(() => redrawScene(true), 1000);
});
