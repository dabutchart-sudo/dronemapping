document.addEventListener('DOMContentLoaded', async () => {

    // 1. Initialize Leaflet Map (2D)
    const map = L.map('map').setView([51.8959, 0.9006], 16);

    // Standard OpenStreetMap (Labeled, Non-Satellite)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);

    // Try to get user location
    if ("geolocation" in navigator) {
        navigator.geolocation.getCurrentPosition((position) => {
            map.setView([position.coords.latitude, position.coords.longitude], 16);
        });
    }

    // State Variables
    let currentMode = 'waypoint'; 
    let waypoints = [];
    let pois = [];
    let actionStack = []; 
    let selectedWpIds = []; 
    let orbitStep = 0, orbitCenterLatLng = null, currentOrbitRadius = 30;

    // Map Layers (to clear and redraw)
    let mapLayers = L.layerGroup().addTo(map);
    let orbitPreviewLayer = L.layerGroup().addTo(map);

    // DOM Bindings
    const undoBtn = document.getElementById('undo-btn');
    const clearBtn = document.getElementById('clear-btn');
    const exportDjiBtn = document.getElementById('export-dji-btn');
    const exportLitchiBtn = document.getElementById('export-litchi-btn');
    const modeSelectEl = document.getElementById('mode-select');
    const orbitSettingsPanel = document.getElementById('orbit-settings');
    const radiusInputEl = document.getElementById('orbit-radius');
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
        modeSelectEl.style.backgroundColor = (mode === 'waypoint') ? '#007bff' : (mode === 'poi') ? '#e67e22' : '#9b59b6';
        if (orbitStep === 1) { 
            orbitStep = 0; 
            orbitCenterLatLng = null; 
            orbitPreviewLayer.clearLayers(); 
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
            const p1 = L.latLng(waypoints[i].lat, waypoints[i].lng);
            const p2 = L.latLng(waypoints[i+1].lat, waypoints[i+1].lng);
            totalDist += p1.distanceTo(p2); // Leaflet has native distance calculation!
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

        // Auto-Calculate Gimbal Pitch (Flat 2D Math)
        if (!isBulk) {
            if (primaryWp.linkedPoiId === 'none') {
                gimbalInput.value = 'N/A';
                primaryWp.calculatedPitch = 0;
            } else {
                const targetPoi = pois.find(p => p.id === primaryWp.linkedPoiId);
                if (targetPoi) {
                    const horizDist = L.latLng(primaryWp.lat, primaryWp.lng).distanceTo(L.latLng(targetPoi.lat, targetPoi.lng));
                    const altDiff = targetPoi.altitude - primaryWp.altitude; // Simplified for 2D flat earth
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

    document.getElementById('wp-move-top').addEventListener('click', () => { if (selectedWpIds.length !== 1) return; moveWaypointToEdge(waypoints.findIndex(w => w.id === selectedWpIds[0]), true); });
    document.getElementById('wp-move-up').addEventListener('click', () => { if (selectedWpIds.length !== 1) return; moveWaypoint(waypoints.findIndex(w => w.id === selectedWpIds[0]), -1); });
    document.getElementById('wp-move-down').addEventListener('click', () => { if (selectedWpIds.length !== 1) return; moveWaypoint(waypoints.findIndex(w => w.id === selectedWpIds[0]), 1); });
    document.getElementById('wp-move-bottom').addEventListener('click', () => { if (selectedWpIds.length !== 1) return; moveWaypointToEdge(waypoints.findIndex(w => w.id === selectedWpIds[0]), false); });

    document.getElementById('wp-delete').addEventListener('click', () => {
        if (selectedWpIds.length !== 1) return;
        waypoints = waypoints.filter(w => w.id !== selectedWpIds[0]);
        selectedWpIds = [];
        redrawMap();
    });

    // ========================================================
    // NAVIGATOR BUTTONS & UNDO
    // ========================================================
    document.getElementById('nav-prev').addEventListener('click', () => {
        if (selectedWpIds.length !== 1) return;
        let idx = waypoints.findIndex(w => w.id === selectedWpIds[0]);
        if (idx > 0) { selectedWpIds = [waypoints[idx - 1].id]; redrawMap(); }
    });

    document.getElementById('nav-next').addEventListener('click', () => {
        if (selectedWpIds.length !== 1) return;
        let idx = waypoints.findIndex(w => w.id === selectedWpIds[0]);
        if (idx < waypoints.length - 1) { selectedWpIds = [waypoints[idx + 1].id]; redrawMap(); }
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
        waypoints = []; pois = []; actionStack = []; selectedWpIds = [];
        redrawMap();
    });

    // ========================================================
    // 2D LEAFLET MAP INTERACTION (Clicks, Drags, Selection)
    // ========================================================

    map.on('mousemove', function(e) {
        if (currentMode === 'orbit' && orbitStep === 1 && orbitCenterLatLng) {
            let distance = orbitCenterLatLng.distanceTo(e.latlng);
            currentOrbitRadius = Math.max(5, distance);
            radiusInputEl.value = Math.round(currentOrbitRadius);
            
            orbitPreviewLayer.clearLayers();
            L.circle(orbitCenterLatLng, {radius: currentOrbitRadius, color: 'purple', weight: 2, fillOpacity: 0.2}).addTo(orbitPreviewLayer);
        }
    });

    map.on('click', function(e) {
        const lat = e.latlng.lat;
        const lng = e.latlng.lng;

        if (currentMode === 'orbit') {
            if (orbitStep === 0) {
                orbitStep = 1;
                orbitCenterLatLng = e.latlng;
            } else if (orbitStep === 1) {
                orbitStep = 0;
                orbitPreviewLayer.clearLayers();
                generateOrbit(orbitCenterLatLng.lat, orbitCenterLatLng.lng);
                orbitCenterLatLng = null;
            }
        } else if (currentMode === 'waypoint') {
            const wp = addWaypoint(lat, lng);
            selectedWpIds = [wp.id]; 
            actionStack.push({ type: 'waypoint', id: wp.id });
            redrawMap();
        } else if (currentMode === 'poi') {
            const p = addPOI(lat, lng);
            actionStack.push({ type: 'poi', id: p.id });
        }
    });

    // Reusable click handler for markers
    function handleMarkerClick(e, itemType, itemId) {
        L.DomEvent.stopPropagation(e); // Prevent map click from firing
        if (currentMode === 'orbit' && orbitStep === 1) return;

        if (itemType === 'wp') {
            if (e.originalEvent.shiftKey) {
                if (selectedWpIds.includes(itemId)) {
                    selectedWpIds = selectedWpIds.filter(id => id !== itemId);
                } else {
                    selectedWpIds.push(itemId);
                }
            } else {
                selectedWpIds = [itemId];
            }
            redrawMap();
        } else {
            selectedWpIds = [];
            redrawMap();
        }
    }

    // ========================================================
    // LOGIC & DATA GENERATION
    // ========================================================
    function addWaypoint(lat, lng, altitude = 50, linkedPoiId = 'none', hasPhoto = false) {
        const waypoint = {
            id: Date.now() + Math.random(),
            lat: lat, lng: lng, altitude: altitude, curveRadius: 0, linkedPoiId: linkedPoiId, calculatedPitch: 0,
            actions: hasPhoto ? [{type: 'photo', param: 0}] : [] 
        };
        waypoints.push(waypoint);
        return waypoint;
    }

    function addPOI(lat, lng) {
        const poiIndex = pois.length + 1;
        const poi = { id: 'poi_' + Date.now() + Math.random(), name: `POI ${poiIndex}`, lat: lat, lng: lng, altitude: 15 };
        pois.push(poi);
        redrawMap();
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
        setMode('waypoint');
        modeSelectEl.value = 'waypoint';
        redrawMap();
    }

    // ========================================================
    // 2D LEAFLET RENDER ENGINE
    // ========================================================
    function redrawMap() {
        mapLayers.clearLayers();

        // 1. Draw Flight Path
        if (waypoints.length > 1) {
            const latlngs = waypoints.map(wp => [wp.lat, wp.lng]);
            L.polyline(latlngs, {color: '#3498db', weight: 4, dashArray: '5, 10'}).addTo(mapLayers);
        }

        // 2. Draw Sightlines to POIs
        waypoints.forEach(wp => {
            if (wp.linkedPoiId !== 'none') {
                const targetPoi = pois.find(p => p.id === wp.linkedPoiId);
                if (targetPoi) {
                    L.polyline([[wp.lat, wp.lng], [targetPoi.lat, targetPoi.lng]], {color: '#f1c40f', weight: 2, dashArray: '4, 4'}).addTo(mapLayers);
                }
            }
        });

        // 3. Draw POIs
        pois.forEach((poi, index) => {
            const iconHtml = `<div class="custom-leaflet-label poi">${poi.name}<br>(${poi.altitude}m)</div>`;
            const icon = L.divIcon({ className: 'custom-icon', html: iconHtml, iconSize: [80, 40], iconAnchor: [40, 40] });
            
            const marker = L.marker([poi.lat, poi.lng], { icon: icon, draggable: true }).addTo(mapLayers);
            
            // Render the visual dot
            L.circleMarker([poi.lat, poi.lng], { radius: 6, fillColor: '#e67e22', color: '#fff', weight: 2, fillOpacity: 1 }).addTo(mapLayers);

            marker.on('dragend', function(e) {
                poi.lat = e.target.getLatLng().lat;
                poi.lng = e.target.getLatLng().lng;
                redrawMap();
            });
            marker.on('click', (e) => handleMarkerClick(e, 'poi', poi.id));
        });

        // 4. Draw Waypoints
        waypoints.forEach((wp, index) => {
            const isSelected = selectedWpIds.includes(wp.id);
            const color = isSelected ? '#f1c40f' : '#3498db';
            const labelClass = isSelected ? 'custom-leaflet-label selected' : 'custom-leaflet-label';
            
            const iconHtml = `<div class="${labelClass}">WP ${index + 1}<br>(${wp.altitude}m)</div>`;
            const icon = L.divIcon({ className: 'custom-icon', html: iconHtml, iconSize: [80, 40], iconAnchor: [40, 40] });
            
            const marker = L.marker([wp.lat, wp.lng], { icon: icon, draggable: true }).addTo(mapLayers);
            
            L.circleMarker([wp.lat, wp.lng], { radius: isSelected ? 8 : 6, fillColor: color, color: '#fff', weight: 2, fillOpacity: 1 }).addTo(mapLayers);

            marker.on('dragend', function(e) {
                wp.lat = e.target.getLatLng().lat;
                wp.lng = e.target.getLatLng().lng;
                redrawMap();
            });
            marker.on('click', (e) => handleMarkerClick(e, 'wp', wp.id));
        });

        const canExport = waypoints.length > 1;
        exportDjiBtn.disabled = !canExport;
        exportLitchiBtn.disabled = !canExport;
        
        updateSidebarUI();
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

            waypointElementsXml += `<Placemark><Point><coordinates>${wp.lng},${wp.lat}</coordinates></Point><wpml:index>${index}</wpml:index><wpml:executeHeight>${wp.altitude}</wpml:executeHeight><wpml:waypointSpeed>${globalSpeed}</wpml:waypointSpeed><wpml:waypointHeadingMode>${headingMode}</wpml:waypointHeadingMode>${poiStructureXml}${turnParamXml}${actionXml}<wpml:useGlobalHeight>0</wpml:useGlobalHeight></Placemark>`;
        });

        const kmlContent = `<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2" xmlns:wpml="http://www.dji.com/wpmz/1.0.4"><Document><wpml:createTime>${Date.now()}</wpml:createTime><wpml:updateTime>${Date.now()}</wpml:updateTime><Folder><wpml:templateId>0</wpml:templateId><wpml:executeHeightMode>relativeToStartPoint</wpml:executeHeightMode><wpml:waylineCoordinateSysParam><wpml:coordinateSysType>WGS84</wpml:coordinateSysType><wpml:heightMode>EGM96</wpml:heightMode></wpml:waylineCoordinateSysParam><wpml:autoFlightSpeed>${globalSpeed}</wpml:autoFlightSpeed><wpml:gimbalPitchMode>usePointSetting</wpml:gimbalPitchMode>${waypointElementsXml}</Folder></Document></kml>`;

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
