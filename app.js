document.addEventListener('DOMContentLoaded', async () => {
    
    Cesium.Ion.defaultAccessToken = CONFIG.CESIUM_ION_TOKEN;

    const viewer = new Cesium.Viewer('map', {
        terrain: Cesium.Terrain.fromWorldTerrain(),
        animation: false, timeline: false, infoBox: false, homeButton: false, navigationHelpButton: false,
        baseLayerPicker: true, geocoder: true, sceneModePicker: false
    });

    // Default Start Location (Colchester)
    const homeLocation = { lng: 0.9006, lat: 51.8959, alt: 3000 };

    viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(homeLocation.lng, homeLocation.lat, homeLocation.alt),
        orientation: { heading: 0.0, pitch: Cesium.Math.toRadians(-45.0), roll: 0.0 }
    });

    // ========================================================
    // MAP NAVIGATION CONTROLS (NEW)
    // ========================================================
    document.getElementById('nav-north-btn').addEventListener('click', () => {
        viewer.camera.flyTo({
            destination: viewer.camera.position,
            orientation: { heading: 0.0, pitch: viewer.camera.pitch, roll: viewer.camera.roll },
            duration: 1.0 
        });
    });

    document.getElementById('nav-home-btn').addEventListener('click', () => {
        viewer.camera.flyTo({
            destination: Cesium.Cartesian3.fromDegrees(homeLocation.lng, homeLocation.lat, homeLocation.alt),
            orientation: { heading: 0.0, pitch: Cesium.Math.toRadians(-45.0), roll: 0.0 },
            duration: 1.5
        });
    });

    document.getElementById('nav-location-btn').addEventListener('click', () => {
        if ("geolocation" in navigator) {
            navigator.geolocation.getCurrentPosition((position) => {
                viewer.camera.flyTo({
                    destination: Cesium.Cartesian3.fromDegrees(position.coords.longitude, position.coords.latitude, 1500),
                    orientation: { heading: 0.0, pitch: Cesium.Math.toRadians(-45.0), roll: 0.0 },
                    duration: 1.5
                });
            }, (error) => {
                alert("Geolocation permission denied or unavailable.");
                console.error(error);
            });
        } else {
            alert("Geolocation is not supported by your browser.");
        }
    });

    // State Variables
    let currentMode = 'waypoint'; 
    let waypoints = [];
    let pois = [];
    let mapEntities = []; 
    let actionStack = []; 
    let selectedWpIds = []; 
    let orbitStep = 0, orbitCenterCartesian = null, orbitPreviewEntity = null, currentOrbitRadius = 30;
    let draggedItem = null, wasDragged = false;
    let isShiftDown = false;
    let simDroneEntity = null; 

    // Shift Key Tracker
    document.addEventListener('keydown', e => { if (e.key === 'Shift') isShiftDown = true; });
    document.addEventListener('keyup', e => { if (e.key === 'Shift') isShiftDown = false; });

    // DOM Bindings
    const undoBtn = document.getElementById('undo-btn');
    const clearBtn = document.getElementById('clear-btn');
    const exportDjiBtn = document.getElementById('export-dji-btn');
    const exportLitchiBtn = document.getElementById('export-litchi-btn');
    const playSimBtn = document.getElementById('play-sim-btn'); 
    const stopSimBtn = document.getElementById('stop-sim-btn'); 
    const modeSelectEl = document.getElementById('mode-select');
    const orbitSettingsPanel = document.getElementById('orbit-settings');
    const radiusInputEl = document.getElementById('orbit-radius');
    const zoomSlider = document.getElementById('zoom-slider');
    const globalSpeedEl = document.getElementById('global-speed');

    // UI Panels
    const overviewPanel = document.getElementById('mission-overview-panel');
    const editorPanel = document.getElementById('wp-editor-panel');
    const navigatorPanel = document.getElementById('wp-navigator');
    const missionStatsCounts = document.getElementById('mission-stats-counts');
    const missionStatsFlight = document.getElementById('mission-stats-flight');
    const singleWpControls = document.getElementById('single-wp-controls');

    // UI Mode Switching
    function setMode(mode) {
        currentMode = mode;
        orbitSettingsPanel.style.display = (mode === 'orbit') ? 'block' : 'none';

        if (mode === 'waypoint') modeSelectEl.style.backgroundColor = '#007bff';
        if (mode === 'poi') modeSelectEl.style.backgroundColor = '#e67e22';
        if (mode === 'orbit') modeSelectEl.style.backgroundColor = '#9b59b6';

        if (orbitStep === 1) {
            orbitStep = 0;
            orbitCenterCartesian = null;
            viewer.scene.screenSpaceCameraController.enableInputs = true;
            if (orbitPreviewEntity) {
                viewer.entities.remove(orbitPreviewEntity);
                orbitPreviewEntity = null;
            }
        }
    }
    modeSelectEl.addEventListener('change', (e) => setMode(e.target.value));
    globalSpeedEl.addEventListener('input', () => updateSidebarUI());

    // ========================================================
    // SIDEBAR EDITOR & HUD LOGIC
    // ========================================================
    function updateHUD() {
        let totalDist = 0;
        for (let i = 0; i < waypoints.length - 1; i++) {
            const p1 = Cesium.Cartesian3.fromDegrees(waypoints[i].lng, waypoints[i].lat, waypoints[i].terrainHeight + waypoints[i].altitude);
            const p2 = Cesium.Cartesian3.fromDegrees(waypoints[i+1].lng, waypoints[i+1].lat, waypoints[i+1].terrainHeight + waypoints[i+1].altitude);
            totalDist += Cesium.Cartesian3.distance(p1, p2);
        }
        
        const speed = parseFloat(globalSpeedEl.value) || 5;
        const totalTime = totalDist / speed;
        const mins = Math.floor(totalTime / 60);
        const secs = Math.round(totalTime % 60);

        missionStatsCounts.innerText = `Waypoints: ${waypoints.length} | POIs: ${pois.length}`;
        missionStatsFlight.innerText = `Distance: ${totalDist.toFixed(1)}m | Est. Time: ${mins}m ${secs}s`;
    }

    function updateSidebarUI() {
        updateHUD();

        if (selectedWpIds.length === 0) {
            overviewPanel.style.display = 'block';
            editorPanel.style.display = 'none';
            navigatorPanel.style.display = 'none';
            return;
        }

        overviewPanel.style.display = 'none';
        editorPanel.style.display = 'flex';
        navigatorPanel.style.display = 'block';

        const isBulk = selectedWpIds.length > 1;
        document.getElementById('wp-editor-title').innerText = isBulk ? `Editing ${selectedWpIds.length} Waypoints` : `Waypoint ${getWpIndex(selectedWpIds[0])}`;

        singleWpControls.style.display = isBulk ? 'none' : 'flex';
        document.getElementById('poi-pitch-container').style.display = isBulk ? 'none' : 'grid';

        const primaryWp = waypoints.find(w => w.id === selectedWpIds[0]);

        const altInput = document.getElementById('wp-edit-alt');
        const curveInput = document.getElementById('wp-edit-curve');
        const poiSelect = document.getElementById('wp-edit-poi');
        const gimbalInput = document.getElementById('wp-edit-gimbal');

        altInput.value = isBulk ? '' : primaryWp.altitude;
        curveInput.value = isBulk ? '' : primaryWp.curveRadius;
        altInput.placeholder = isBulk ? 'Multiple' : '';
        curveInput.placeholder = isBulk ? 'Multiple' : '';

        let poiOptions = `<option value="none">None (Follow Course)</option>`;
        pois.forEach(p => {
            const selected = (!isBulk && primaryWp.linkedPoiId === p.id) ? 'selected' : '';
            poiOptions += `<option value="${p.id}" ${selected}>${p.name}</option>`;
        });
        poiSelect.innerHTML = poiOptions;

        // Auto-Calculate Gimbal Pitch
        if (!isBulk) {
            if (primaryWp.linkedPoiId === 'none') {
                gimbalInput.value = 'N/A';
                primaryWp.calculatedPitch = 0;
            } else {
                const targetPoi = pois.find(p => p.id === primaryWp.linkedPoiId);
                if (targetPoi) {
                    const wpGround = Cesium.Cartesian3.fromDegrees(primaryWp.lng, primaryWp.lat, 0);
                    const poiGround = Cesium.Cartesian3.fromDegrees(targetPoi.lng, targetPoi.lat, 0);
                    const horizDist = Cesium.Cartesian3.distance(wpGround, poiGround);
                    const altDiff = (targetPoi.terrainHeight + targetPoi.altitude) - (primaryWp.terrainHeight + primaryWp.altitude);
                    const pitchDeg = Cesium.Math.toDegrees(Math.atan2(altDiff, horizDist));
                    
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

        document.getElementById('nav-label').innerText = isBulk ? `Bulk Mode` : `${getWpIndex(selectedWpIds[0])} / ${waypoints.length}`;
    }

    function getWpIndex(id) { return waypoints.findIndex(w => w.id === id) + 1; }

    // Editor Event Listeners
    document.getElementById('wp-edit-alt').addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        if (isNaN(val)) return;
        selectedWpIds.forEach(id => { waypoints.find(w => w.id === id).altitude = val; });
        redrawMap();
    });

    document.getElementById('wp-edit-curve').addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        if (isNaN(val)) return;
        selectedWpIds.forEach(id => { waypoints.find(w => w.id === id).curveRadius = val; });
    });

    document.getElementById('wp-edit-poi').addEventListener('change', (e) => {
        const val = e.target.value;
        selectedWpIds.forEach(id => { waypoints.find(w => w.id === id).linkedPoiId = val; });
        redrawMap();
    });

    document.getElementById('add-action-btn').addEventListener('click', () => {
        if (selectedWpIds.length !== 1) return;
        const wp = waypoints.find(w => w.id === selectedWpIds[0]);
        const type = document.getElementById('add-action-type').value;
        if (type === 'photo') wp.actions.push({ type: 'photo', param: 0 });
        if (type === 'hover') wp.actions.push({ type: 'hover', param: 3 }); 
        updateSidebarUI();
    });

    document.getElementById('wp-actions-list').addEventListener('click', (e) => {
        if (e.target.classList.contains('remove-action-btn')) {
            const idx = parseInt(e.target.dataset.idx);
            const wp = waypoints.find(w => w.id === selectedWpIds[0]);
            wp.actions.splice(idx, 1);
            updateSidebarUI();
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
        redrawMap();
    });

    document.getElementById('select-all-btn').addEventListener('click', () => {
        selectedWpIds = waypoints.map(wp => wp.id);
        redrawMap();
    });

    // ========================================================
    // WAYPOINT REORDERING & DELETION
    // ========================================================
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
        redrawMap();
    }

    function moveWaypointToEdge(index, toTop) {
        if (toTop && index > 0) {
            const wp = waypoints.splice(index, 1)[0];
            waypoints.unshift(wp);
        } else if (!toTop && index < waypoints.length - 1) {
            const wp = waypoints.splice(index, 1)[0];
            waypoints.push(wp);
        }
        redrawMap();
    }

    document.getElementById('wp-move-top').addEventListener('click', () => {
        if (selectedWpIds.length !== 1) return;
        moveWaypointToEdge(waypoints.findIndex(w => w.id === selectedWpIds[0]), true);
    });
    document.getElementById('wp-move-up').addEventListener('click', () => {
        if (selectedWpIds.length !== 1) return;
        moveWaypoint(waypoints.findIndex(w => w.id === selectedWpIds[0]), -1);
    });
    document.getElementById('wp-move-down').addEventListener('click', () => {
        if (selectedWpIds.length !== 1) return;
        moveWaypoint(waypoints.findIndex(w => w.id === selectedWpIds[0]), 1);
    });
    document.getElementById('wp-move-bottom').addEventListener('click', () => {
        if (selectedWpIds.length !== 1) return;
        moveWaypointToEdge(waypoints.findIndex(w => w.id === selectedWpIds[0]), false);
    });

    document.getElementById('wp-delete').addEventListener('click', () => {
        if (selectedWpIds.length !== 1) return;
        waypoints = waypoints.filter(w => w.id !== selectedWpIds[0]);
        selectedWpIds = [];
        redrawMap();
    });

    // ========================================================
    // NAVIGATOR BUTTONS
    // ========================================================
    document.getElementById('nav-prev').addEventListener('click', () => {
        if (selectedWpIds.length !== 1) return;
        let idx = waypoints.findIndex(w => w.id === selectedWpIds[0]);
        if (idx > 0) {
            selectedWpIds = [waypoints[idx - 1].id];
            redrawMap();
        }
    });

    document.getElementById('nav-next').addEventListener('click', () => {
        if (selectedWpIds.length !== 1) return;
        let idx = waypoints.findIndex(w => w.id === selectedWpIds[0]);
        if (idx < waypoints.length - 1) {
            selectedWpIds = [waypoints[idx + 1].id];
            redrawMap();
        }
    });

    // ========================================================
    // ZOOM SLIDER & UNDO/CLEAR
    // ========================================================
    zoomSlider.addEventListener('input', (e) => {
        const targetHeight = parseInt(e.target.value);
        const currentCarto = Cesium.Cartographic.fromCartesian(viewer.camera.position);
        viewer.camera.setView({
            destination: Cesium.Cartesian3.fromRadians(currentCarto.longitude, currentCarto.latitude, targetHeight),
            orientation: { heading: viewer.camera.heading, pitch: viewer.camera.pitch, roll: viewer.camera.roll }
        });
    });

    viewer.camera.changed.addEventListener(() => {
        const currentHeight = Cesium.Cartographic.fromCartesian(viewer.camera.position).height;
        zoomSlider.value = Math.max(10, Math.min(20000, currentHeight));
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
        }
        redrawMap();
    });

    clearBtn.addEventListener('click', function() {
        stopSimulation(); 
        waypoints = []; pois = []; actionStack = []; selectedWpIds = [];
        redrawMap();
    });

    // ========================================================
    // MAP INTERACTION (Clicks, Drags, Selection via Cesium Modifiers)
    // ========================================================
    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);

    function handleMapClick(click, isShift) {
        if (currentMode === 'orbit' && orbitStep === 1) return; 

        const pickedObject = viewer.scene.pick(click.position);
        
        if (Cesium.defined(pickedObject) && pickedObject.id && pickedObject.id.customData) {
            draggedItem = pickedObject.id.customData; 
            wasDragged = false;
            viewer.scene.screenSpaceCameraController.enableInputs = false; 
            
            if (draggedItem.type === 'wp') {
                if (isShift) {
                    if (selectedWpIds.includes(draggedItem.item.id)) {
                        selectedWpIds = selectedWpIds.filter(id => id !== draggedItem.item.id);
                    } else {
                        selectedWpIds.push(draggedItem.item.id);
                    }
                } else {
                    selectedWpIds = [draggedItem.item.id];
                }
                redrawMap();
            }
        } else {
            if (currentMode !== 'waypoint') {
                selectedWpIds = [];
                redrawMap();
            }
        }
    }

    handler.setInputAction(function(click) { handleMapClick(click, false); }, Cesium.ScreenSpaceEventType.LEFT_DOWN);
    handler.setInputAction(function(click) { handleMapClick(click, true); }, Cesium.ScreenSpaceEventType.LEFT_DOWN, Cesium.KeyboardEventModifier.SHIFT);

    handler.setInputAction(function (movement) {
        if (currentMode === 'orbit' && orbitStep === 1 && orbitCenterCartesian) {
            const ray = viewer.camera.getPickRay(movement.endPosition);
            const position = viewer.scene.globe.pick(ray, viewer.scene);
            if (Cesium.defined(position)) {
                let distance = Cesium.Cartesian3.distance(orbitCenterCartesian, position);
                radiusInputEl.value = Math.round(Math.max(5, distance));
            }
        }

        if (draggedItem) {
            wasDragged = true;
            const ray = viewer.camera.getPickRay(movement.endPosition);
            const position = viewer.scene.globe.pick(ray, viewer.scene);
            if (position) {
                const carto = Cesium.Cartographic.fromCartesian(position);
                draggedItem.item.lat = Cesium.Math.toDegrees(carto.latitude);
                draggedItem.item.lng = Cesium.Math.toDegrees(carto.longitude);
                draggedItem.item.terrainHeight = carto.height || 0;
                redrawMap(); 
            }
        }
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

    handler.setInputAction(function (click) {
        if (draggedItem) {
            draggedItem = null;
            viewer.scene.screenSpaceCameraController.enableInputs = true;
            setTimeout(() => { wasDragged = false; }, 50);
        }
    }, Cesium.ScreenSpaceEventType.LEFT_UP);

    handler.setInputAction(function (click) {
        if (wasDragged) return; 

        const ray = viewer.camera.getPickRay(click.position);
        const position = viewer.scene.globe.pick(ray, viewer.scene);
        if (!Cesium.defined(position)) return;

        const cartographic = Cesium.Cartographic.fromCartesian(position);
        const lng = Cesium.Math.toDegrees(cartographic.longitude);
        const lat = Cesium.Math.toDegrees(cartographic.latitude);
        const terrainHeight = cartographic.height || 0; 

        if (currentMode === 'orbit') {
            if (orbitStep === 0) {
                orbitStep = 1;
                orbitCenterCartesian = position;
                viewer.scene.screenSpaceCameraController.enableInputs = false;
                orbitPreviewEntity = viewer.entities.add({
                    position: orbitCenterCartesian,
                    ellipse: {
                        semiMinorAxis: new Cesium.CallbackProperty(() => parseFloat(radiusInputEl.value), false),
                        semiMajorAxis: new Cesium.CallbackProperty(() => parseFloat(radiusInputEl.value), false),
                        material: Cesium.Color.PURPLE.withAlpha(0.3), outline: true, outlineColor: Cesium.Color.PURPLE
                    }
                });
            } else if (orbitStep === 1) {
                orbitStep = 0;
                viewer.scene.screenSpaceCameraController.enableInputs = true;
                if (orbitPreviewEntity) { viewer.entities.remove(orbitPreviewEntity); orbitPreviewEntity = null; }
                const centerCarto = Cesium.Cartographic.fromCartesian(orbitCenterCartesian);
                generateOrbit(Cesium.Math.toDegrees(centerCarto.latitude), Cesium.Math.toDegrees(centerCarto.longitude), centerCarto.height || 0);
                orbitCenterCartesian = null;
            }
        } else if (currentMode === 'waypoint') {
            const pickedObject = viewer.scene.pick(click.position);
            if (!Cesium.defined(pickedObject) || !pickedObject.id || !pickedObject.id.customData) {
                const wp = addWaypoint(lat, lng, terrainHeight);
                selectedWpIds = [wp.id]; 
                actionStack.push({ type: 'waypoint', id: wp.id });
                redrawMap();
            }
        } else if (currentMode === 'poi') {
            const p = addPOI(lat, lng, terrainHeight);
            actionStack.push({ type: 'poi', id: p.id });
        }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    // ========================================================
    // LOGIC & DATA GENERATION
    // ========================================================
    function addWaypoint(lat, lng, terrainHeight, altitude = 50, linkedPoiId = 'none', hasPhoto = false) {
        const waypoint = {
            id: Date.now() + Math.random(),
            lat: lat, lng: lng, terrainHeight: terrainHeight, altitude: altitude, curveRadius: 0, linkedPoiId: linkedPoiId,
            calculatedPitch: 0,
            actions: hasPhoto ? [{type: 'photo', param: 0}] : [] 
        };
        waypoints.push(waypoint);
        return waypoint;
    }

    function addPOI(lat, lng, terrainHeight) {
        const poiIndex = pois.length + 1;
        const poi = { id: 'poi_' + Date.now() + Math.random(), name: `POI ${poiIndex}`, lat: lat, lng: lng, terrainHeight: terrainHeight, altitude: 15 };
        pois.push(poi);
        redrawMap();
        return poi;
    }

    function generateOrbit(centerLat, centerLng, centerTerrainHeight) {
        const radiusMeters = parseFloat(radiusInputEl.value);
        const altitude = parseFloat(document.getElementById('orbit-alt').value);
        const photoCount = parseInt(document.getElementById('orbit-count').value);

        const centerPoi = addPOI(centerLat, centerLng, centerTerrainHeight);
        const earthRadius = 6378137; 
        const generatedWpIds = [];
        
        for (let i = 0; i < photoCount; i++) {
            const angleRad = ((360 / photoCount) * i) * (Math.PI / 180);
            const wpLat = centerLat + ((radiusMeters * Math.cos(angleRad)) / earthRadius) * (180 / Math.PI);
            const wpLng = centerLng + ((radiusMeters * Math.sin(angleRad)) / earthRadius) * (180 / Math.PI) / Math.cos(centerLat * Math.PI / 180);
            const wp = addWaypoint(wpLat, wpLng, centerTerrainHeight, altitude, centerPoi.id, true);
            generatedWpIds.push(wp.id);
        }
        
        actionStack.push({ type: 'orbit', poiId: centerPoi.id, wpIds: generatedWpIds });
        setMode('waypoint');
        modeSelectEl.value = 'waypoint';
        redrawMap();
    }

    // ========================================================
    // CESIUM RENDER ENGINE
    // ========================================================
    function redrawMap() {
        mapEntities.forEach(entity => viewer.entities.remove(entity));
        mapEntities = [];

        waypoints.forEach((wp, index) => {
            const absoluteHeight = wp.terrainHeight + wp.altitude;
            const isSelected = selectedWpIds.includes(wp.id);
            
            const pointColor = isSelected ? Cesium.Color.YELLOW : Cesium.Color.DODGERBLUE;
            const labelScale = isSelected ? 1.2 : 1.0;

            const entity = viewer.entities.add({
                position: Cesium.Cartesian3.fromDegrees(wp.lng, wp.lat, absoluteHeight),
                point: { 
                    pixelSize: isSelected ? 16 : 14, 
                    color: pointColor, 
                    outlineColor: Cesium.Color.WHITE, 
                    outlineWidth: 2,
                    disableDepthTestDistance: Number.POSITIVE_INFINITY 
                },
                label: {
                    text: `WP ${index + 1}\n(${wp.altitude}m)`,
                    font: '14pt sans-serif',
                    scale: labelScale,
                    fillColor: isSelected ? Cesium.Color.YELLOW : Cesium.Color.WHITE,
                    style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                    outlineWidth: 2,
                    verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                    pixelOffset: new Cesium.Cartesian2(0, -10),
                    disableDepthTestDistance: Number.POSITIVE_INFINITY 
                }
            });
            entity.customData = { type: 'wp', item: wp };
            mapEntities.push(entity);

            const stem = viewer.entities.add({
                polyline: {
                    positions: [ Cesium.Cartesian3.fromDegrees(wp.lng, wp.lat, wp.terrainHeight), Cesium.Cartesian3.fromDegrees(wp.lng, wp.lat, absoluteHeight) ],
                    width: isSelected ? 2.5 : 1.5,
                    material: new Cesium.PolylineDashMaterialProperty({ color: isSelected ? Cesium.Color.YELLOW.withAlpha(0.8) : Cesium.Color.WHITE.withAlpha(0.8) }),
                    disableDepthTestDistance: Number.POSITIVE_INFINITY
                }
            });
            mapEntities.push(stem);

            if (wp.linkedPoiId !== 'none') {
                const targetPoi = pois.find(p => p.id === wp.linkedPoiId);
                if (targetPoi) {
                    const sightline = viewer.entities.add({
                        polyline: {
                            positions: [ Cesium.Cartesian3.fromDegrees(wp.lng, wp.lat, absoluteHeight), Cesium.Cartesian3.fromDegrees(targetPoi.lng, targetPoi.lat, targetPoi.terrainHeight + targetPoi.altitude) ],
                            width: 2, material: new Cesium.PolylineDashMaterialProperty({ color: Cesium.Color.YELLOW.withAlpha(0.8) }), disableDepthTestDistance: Number.POSITIVE_INFINITY
                        }
                    });
                    mapEntities.push(sightline);
                }
            }
        });

        pois.forEach((poi, index) => {
            const absoluteHeight = poi.terrainHeight + poi.altitude;
            const entity = viewer.entities.add({
                position: Cesium.Cartesian3.fromDegrees(poi.lng, poi.lat, absoluteHeight),
                point: { pixelSize: 14, color: Cesium.Color.ORANGE, outlineColor: Cesium.Color.WHITE, outlineWidth: 2, disableDepthTestDistance: Number.POSITIVE_INFINITY },
                label: { text: `${poi.name}\n(${poi.altitude}m)`, font: '12pt sans-serif', style: Cesium.LabelStyle.FILL_AND_OUTLINE, outlineWidth: 2, verticalOrigin: Cesium.VerticalOrigin.BOTTOM, pixelOffset: new Cesium.Cartesian2(0, -10), disableDepthTestDistance: Number.POSITIVE_INFINITY }
            });
            entity.customData = { type: 'poi', item: poi };
            mapEntities.push(entity);
            mapEntities.push(viewer.entities.add({
                polyline: { positions: [ Cesium.Cartesian3.fromDegrees(poi.lng, poi.lat, poi.terrainHeight), Cesium.Cartesian3.fromDegrees(poi.lng, poi.lat, absoluteHeight) ], width: 1.5, material: new Cesium.PolylineDashMaterialProperty({ color: Cesium.Color.ORANGE.withAlpha(0.6) }), disableDepthTestDistance: Number.POSITIVE_INFINITY }
            }));
        });

        if (waypoints.length > 1) {
            const linePositions = waypoints.map(wp => Cesium.Cartesian3.fromDegrees(wp.lng, wp.lat, wp.terrainHeight + wp.altitude));
            mapEntities.push(viewer.entities.add({
                polyline: { positions: linePositions, width: 4, material: new Cesium.PolylineDashMaterialProperty({ color: Cesium.Color.DODGERBLUE }), depthFailMaterial: new Cesium.PolylineDashMaterialProperty({ color: Cesium.Color.DODGERBLUE.withAlpha(0.3) }) }
            }));
        }

        const canExport = waypoints.length > 1;
        exportDjiBtn.disabled = !canExport;
        exportLitchiBtn.disabled = !canExport;
        
        playSimBtn.disabled = !canExport;
        stopSimBtn.disabled = !canExport;
        
        updateSidebarUI();
    }

    // ========================================================
    // 3D FLIGHT SIMULATION ENGINE (SCALED)
    // ========================================================
    playSimBtn.addEventListener('click', () => {
        if (waypoints.length < 2) return;
        stopSimulation(); 

        const speed = parseFloat(globalSpeedEl.value) || 5;
        const positionProperty = new Cesium.SampledPositionProperty();
        
        let startTime = Cesium.JulianDate.fromDate(new Date());
        let currentTime = startTime;

        const startWp = waypoints[0];
        const startCart = Cesium.Cartesian3.fromDegrees(startWp.lng, startWp.lat, startWp.terrainHeight + startWp.altitude);
        positionProperty.addSample(currentTime, startCart);

        for (let i = 1; i < waypoints.length; i++) {
            const prevWp = waypoints[i-1];
            const currWp = waypoints[i];
            
            const p1 = Cesium.Cartesian3.fromDegrees(prevWp.lng, prevWp.lat, prevWp.terrainHeight + prevWp.altitude);
            const p2 = Cesium.Cartesian3.fromDegrees(currWp.lng, currWp.lat, currWp.terrainHeight + currWp.altitude);
            
            const dist = Cesium.Cartesian3.distance(p1, p2);
            const timeToTravel = dist / speed; 
            
            currentTime = Cesium.JulianDate.addSeconds(currentTime, timeToTravel, new Cesium.JulianDate());
            positionProperty.addSample(currentTime, p2);
        }

        const stopTime = currentTime;

        viewer.clock.startTime = startTime;
        viewer.clock.stopTime = stopTime;
        viewer.clock.currentTime = startTime;
        viewer.clock.clockRange = Cesium.ClockRange.CLAMPED; 
        viewer.clock.multiplier = 1.0;
        viewer.clock.shouldAnimate = true;

        simDroneEntity = viewer.entities.add({
            availability: new Cesium.TimeIntervalCollection([new Cesium.TimeInterval({
                start: startTime,
                stop: stopTime
            })]),
            position: positionProperty,
            orientation: new Cesium.VelocityOrientationProperty(positionProperty),
            ellipsoid: {
                radii: new Cesium.Cartesian3(0.15, 0.15, 0.05),
                material: Cesium.Color.RED,
                outline: true,
                outlineColor: Cesium.Color.WHITE
            },
            path: {
                resolution: 1,
                material: new Cesium.PolylineGlowMaterialProperty({
                    glowPower: 0.1,
                    color: Cesium.Color.CYAN
                }),
                width: 5
            }
        });

        viewer.trackedEntity = simDroneEntity;
    });

    stopSimBtn.addEventListener('click', stopSimulation);

    function stopSimulation() {
        if (simDroneEntity) {
            viewer.entities.remove(simDroneEntity);
            simDroneEntity = null;
        }
        viewer.trackedEntity = undefined;
        viewer.clock.shouldAnimate = false;
    }

    // ========================================================
    // DJI WPML (KMZ) EXPORT ENGINE
    // ========================================================
    exportDjiBtn.addEventListener('click', function() {
        if (waypoints.length < 2) return;
        let globalSpeed = parseFloat(globalSpeedEl.value) || 5;
        const zip = new JSZip();
        let waypointElementsXml = '';
        
        waypoints.forEach((wp, index) => {
            let headingMode = 'followWayline';
            let poiStructureXml = '';

            if (wp.linkedPoiId !== 'none') {
                const targetPoi = pois.find(p => p.id === wp.linkedPoiId);
                if (targetPoi) {
                    headingMode = 'towardPOI';
                    poiStructureXml = `
            <wpml:waypointPoiPoint>
              <wpml:waypointPoiCoordinate>${targetPoi.lng},${targetPoi.lat}</wpml:waypointPoiCoordinate>
              <wpml:waypointPoiAltitude>${targetPoi.altitude}</wpml:waypointPoiAltitude>
            </wpml:waypointPoiPoint>`;
                }
            }

            let turnMode = wp.curveRadius > 0 ? 'coordinateTurn' : 'toPointAndStopWithDiscontinuityAngle';
            let turnParamXml = `
            <wpml:waypointTurnParam>
                <wpml:waypointTurnMode>${turnMode}</wpml:waypointTurnMode>
                <wpml:waypointTurnDampingDist>${wp.curveRadius}</wpml:waypointTurnDampingDist>
            </wpml:waypointTurnParam>`;

            let actionXml = `<wpml:hasAction>0</wpml:hasAction>`;
            if (wp.actions.length > 0) {
                let innerActions = '';
                wp.actions.forEach((act, aIdx) => {
                    let funcStr = act.type === 'photo' ? 'takePhoto' : 'hover';
                    let paramStr = act.type === 'photo' ? `<wpml:fileSuffix>wp_${index + 1}</wpml:fileSuffix>` : `<wpml:hoverTime>${act.param}</wpml:hoverTime>`;
                    
                    innerActions += `
              <wpml:action>
                <wpml:actionId>${aIdx}</wpml:actionId>
                <wpml:actionActuatorFunc>${funcStr}</wpml:actionActuatorFunc>
                <wpml:actionActuatorFuncParam>${paramStr}</wpml:actionActuatorFuncParam>
              </wpml:action>`;
                });

                actionXml = `
            <wpml:hasAction>1</wpml:hasAction>
            <wpml:actionGroup>
              <wpml:actionGroupId>${index}</wpml:actionGroupId>
              <wpml:actionGroupStartIndex>${index}</wpml:actionGroupStartIndex>
              <wpml:actionGroupEndIndex>${index}</wpml:actionGroupEndIndex>
              <wpml:actionGroupMode>sequence</wpml:actionGroupMode>${innerActions}
            </wpml:actionGroup>`;
            }

            waypointElementsXml += `
          <Placemark>
            <Point><coordinates>${wp.lng},${wp.lat}</coordinates></Point>
            <wpml:index>${index}</wpml:index>
            <wpml:executeHeight>${wp.altitude}</wpml:executeHeight>
            <wpml:waypointSpeed>${globalSpeed}</wpml:waypointSpeed>
            <wpml:waypointHeadingMode>${headingMode}</wpml:waypointHeadingMode>${poiStructureXml}${turnParamXml}${actionXml}
            <wpml:useGlobalHeight>0</wpml:useGlobalHeight>
          </Placemark>`;
        });

        const kmlContent = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:wpml="http://www.dji.com/wpmz/1.0.4">
  <Document>
    <wpml:createTime>${Date.now()}</wpml:createTime><wpml:updateTime>${Date.now()}</wpml:updateTime>
    <Folder>
      <wpml:templateId>0</wpml:templateId>
      <wpml:executeHeightMode>relativeToStartPoint</wpml:executeHeightMode>
      <wpml:waylineCoordinateSysParam><wpml:coordinateSysType>WGS84</wpml:coordinateSysType><wpml:heightMode>EGM96</wpml:heightMode></wpml:waylineCoordinateSysParam>
      <wpml:autoFlightSpeed>${globalSpeed}</wpml:autoFlightSpeed>
      <wpml:gimbalPitchMode>usePointSetting</wpml:gimbalPitchMode>
      ${waypointElementsXml}
    </Folder>
  </Document>
</kml>`;

        zip.folder("wpmz").file("template.kml", kmlContent);
        zip.generateAsync({ type: "blob" }).then(function(content) {
            const element = document.createElement('a'); element.href = URL.createObjectURL(content); element.download = "dji_fly_mission.kmz"; document.body.appendChild(element); element.click(); document.body.removeChild(element);
        });
    });

    // ========================================================
    // LITCHI CSV EXPORT ENGINE
    // ========================================================
    exportLitchiBtn.addEventListener('click', function() {
        if (waypoints.length < 2) return;
        let globalSpeed = parseFloat(globalSpeedEl.value) || 5;
        let csvContent = "latitude,longitude,altitude(m),heading(deg),curvesize(m),rotationdir,gimbalmode,gimbalpitchangle,actiontype1,actionparam1,actiontype2,actionparam2,actiontype3,actionparam3,actiontype4,actionparam4,actiontype5,actionparam5,actiontype6,actionparam6,actiontype7,actionparam7,actiontype8,actionparam8,actiontype9,actionparam9,actiontype10,actionparam10,actiontype11,actionparam11,actiontype12,actionparam12,actiontype13,actionparam13,actiontype14,actionparam14,actiontype15,actionparam15,altitudemode,speed(m/s),poi_latitude,poi_longitude,poi_altitude(m),poi_altitudemode,photo_timeinterval,photo_distinterval\n";

        waypoints.forEach(wp => {
            let gimbalmode = 0, poiLat = 0, poiLng = 0, poiAlt = 0, pitchOutput = 0; 
            if (wp.linkedPoiId !== 'none') {
                const targetPoi = pois.find(p => p.id === wp.linkedPoiId);
                if (targetPoi) { gimbalmode = 1; poiLat = targetPoi.lat; poiLng = targetPoi.lng; poiAlt = targetPoi.altitude; pitchOutput = wp.calculatedPitch || 0; }
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

            let row = [
                wp.lat.toFixed(7), wp.lng.toFixed(7), wp.altitude, 0, wp.curveRadius, 0, gimbalmode, pitchOutput,
                ...litchiActions,
                0, globalSpeed, poiLat.toFixed(7), poiLng.toFixed(7), poiAlt, 0, 0, 0 
            ];
            csvContent += row.join(",") + "\n";
        });

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a"); link.setAttribute("href", url); link.setAttribute("download", "litchi_mission.csv"); document.body.appendChild(link); link.click(); document.body.removeChild(link);
    });

});
