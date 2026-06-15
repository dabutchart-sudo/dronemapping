// Version 44 - Live Interaction Diagnostics
document.addEventListener('DOMContentLoaded', async () => {

    const statusEl = document.getElementById('cesium-status');
    let isTokenValid = false;

    // ========================================================
    // 1. INJECT DEBUG HUD
    // ========================================================
    const debugBox = document.createElement('div');
    debugBox.style.cssText = "position:absolute; top:80px; right:20px; width:320px; height: 300px; overflow-y: hidden; background:rgba(0,0,0,0.85); color:#0f0; font-family:monospace; font-size:11px; padding:10px; z-index:9999; pointer-events:none; border: 1px solid #0f0; border-radius: 4px;";
    document.body.appendChild(debugBox);

    function logDebug(msg) {
        console.log(msg);
        const p = document.createElement('div');
        p.innerText = `> ${msg}`;
        debugBox.prepend(p);
        if(debugBox.childNodes.length > 20) debugBox.lastChild.remove();
    }

    logDebug("System Initialized. Awaiting token...");

    // ========================================================
    // TOKEN DIAGNOSTIC TEST
    // ========================================================
    if (typeof CONFIG !== 'undefined' && CONFIG.CESIUM_ION_TOKEN) {
        Cesium.Ion.defaultAccessToken = CONFIG.CESIUM_ION_TOKEN;
        
        try {
            await Cesium.IonResource.fromAssetId(1);
            if (statusEl) { statusEl.innerText = 'Token Valid ✔'; statusEl.style.background = '#2ecc71'; }
            isTokenValid = true;
            logDebug("Token validated successfully.");
        } catch (error) {
            if (statusEl) { statusEl.innerText = 'Token Invalid ✖'; statusEl.style.background = '#e74c3c'; }
            logDebug("ERROR: Token failed validation.");
            alert("CESIUM TOKEN ERROR: The map will not load correctly. Please verify your token in config.js.");
        }
    } else {
        if (statusEl) { statusEl.innerText = 'No Token Found'; statusEl.style.background = '#e74c3c'; }
        logDebug("ERROR: No token found in config.js");
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
            logDebug("3D Buildings loaded.");
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
            logDebug("Satellite imagery loaded.");
        });
    } else {
        imageryLayers.addImageryProvider(osmLayerProvider);
        isSatellite = false;
        document.getElementById('layer-toggle-btn').innerHTML = '🌍';
    }

    document.getElementById('layer-toggle-btn').addEventListener('click', async (e) => {
        if (!isTokenValid && isSatellite) return; 
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
                viewer.camera.flyTo({ destination: Cesium.Cartesian3.fromDegrees(position.coords.longitude, position.coords.latitude, 500) });
            });
        }
    });

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

    const radiusInputEl = document.getElementById('orbit-radius');
    const globalSpeedEl = document.getElementById('global-speed');
    const orbitSettingsPanel = document.getElementById('orbit-settings');
    const gridSettingsPanel = document.getElementById('grid-settings');
    const floatingItemPanel = document.getElementById('floating-item-panel');

    function clearPreviews() {
        previewEntities.forEach(ent => viewer.entities.remove(ent));
        previewEntities = [];
    }

    function setMode(mode) {
        currentMode = mode;
        logDebug(`Mode changed to: ${mode.toUpperCase()}`);
        
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

    // ========================================================
    // CESIUM 3D INTERACTION LOGIC & DIAGNOSTICS
    // ========================================================
    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
    let relocatingItem = null;
    let clickDownPos = null;
    let isShiftDown = false;

    document.addEventListener('keydown', (e) => { if (e.key === 'Shift') isShiftDown = true; });
    document.addEventListener('keyup', (e) => { if (e.key === 'Shift') isShiftDown = false; });

    function getEarthPosition(position) {
        let cartesian;
        let source = "none";
        
        if (viewer.scene.pickPositionSupported) {
            cartesian = viewer.scene.pickPosition(position);
            if (cartesian) source = "PickPosition (3D Object)";
        }
        
        if (!cartesian) {
            const ray = viewer.camera.getPickRay(position);
            cartesian = viewer.scene.globe.pick(ray, viewer.scene);
            if (cartesian) source = "Globe.Pick (Terrain)";
        }

        if (cartesian) {
            const cartographic = Cesium.Cartographic.fromCartesian(cartesian);
            if (cartographic && cartographic.height < 15000) {
                logDebug(`Hit: ${source} | Alt: ${cartographic.height.toFixed(1)}m`);
                return {
                    lat: Cesium.Math.toDegrees(cartographic.latitude),
                    lng: Cesium.Math.toDegrees(cartographic.longitude)
                };
            } else {
                logDebug(`Miss: Coordinates too high (${cartographic ? cartographic.height.toFixed(1) : 'unknown'}m)`);
            }
        } else {
            logDebug(`Miss: Raycast hit void/sky.`);
        }
        return null;
    }

    handler.setInputAction(function(click) {
        clickDownPos = click.position;
        logDebug(`Mouse DOWN at x:${Math.round(click.position.x)}, y:${Math.round(click.position.y)}`);
    }, Cesium.ScreenSpaceEventType.LEFT_DOWN);

    handler.setInputAction(function(movement) {
        if (!relocatingItem && currentMode !== 'orbit' && currentMode !== 'grid') return;

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
        }
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

    handler.setInputAction(function(click) {
        logDebug("Mouse UP detected.");

        if (relocatingItem) {
            logDebug("Finished relocating item.");
            relocatingItem = null;
            viewer.scene.screenSpaceCameraController.enableInputs = true; 
            redrawScene(true); 
            return; 
        }

        // Check for drag
        if (clickDownPos) {
            const dx = Math.abs(click.position.x - clickDownPos.x);
            const dy = Math.abs(click.position.y - clickDownPos.y);
            if (dx > 5 || dy > 5) {
                logDebug(`Click ignored: Drag detected (dx:${Math.round(dx)}, dy:${Math.round(dy)})`);
                return; 
            }
        }

        const picked = viewer.scene.pick(click.position);

        if (picked && picked.id && picked.id.isInteractive) {
            const itemId = picked.id.itemId;
            const itemType = picked.id.itemType;
            logDebug(`Clicked Existing Entity: ${itemType.toUpperCase()}`);

            if (currentMode === 'orbit' && orbitStep === 1) return;
            if (currentMode === 'grid' && gridStep === 1) return;

            if (itemType === 'wp') {
                if (isShiftDown) {
                    if (selectedWpIds.includes(itemId)) selectedWpIds = selectedWpIds.filter(id => id !== itemId);
                    else selectedWpIds.push(itemId);
                } else {
                    if (selectedWpIds.length === 1 && selectedWpIds[0] === itemId) {
                        logDebug("Initiating waypoint drag relocation.");
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
                logDebug("Initiating POI drag relocation.");
                relocatingItem = { type: 'poi', id: itemId };
                viewer.scene.screenSpaceCameraController.enableInputs = false; 
                redrawScene(false); 
            }
            return; 
        }

        if (currentMode === 'select') {
            logDebug("Select Mode: Clicked empty map, clearing selection.");
            selectedWpIds = [];
            redrawScene(false);
            return;
        }

        logDebug(`Processing click for mode: ${currentMode}`);
        const coords = getEarthPosition(click.position);
        if (!coords) {
            logDebug("Cannot place item: Earth coordinates could not be resolved.");
            return;
        }

        if (currentMode === 'orbit') {
            if (orbitStep === 0) {
                orbitStep = 1; orbitCenterLatLng = coords;
                logDebug("Orbit step 1: Center set.");
            } else if (orbitStep === 1) {
                orbitStep = 0; clearPreviews();
                generateOrbit(orbitCenterLatLng.lat, orbitCenterLatLng.lng);
                orbitCenterLatLng = null;
                logDebug("Orbit step 2: Path generated.");
            }
        } else if (currentMode === 'grid') {
            if (gridStep === 0) {
                gridStep = 1; gridCenterLatLng = coords;
                logDebug("Grid step 1: Center set.");
            } else if (gridStep === 1) {
                gridStep = 0; clearPreviews();
                generateGrid(gridCenterLatLng.lat, gridCenterLatLng.lng);
                gridCenterLatLng = null;
                logDebug("Grid step 2: Path generated.");
            }
        } else if (currentMode === 'waypoint') {
            logDebug(`Creating Waypoint at ${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}`);
            const wp = addWaypoint(coords.lat, coords.lng);
            selectedWpIds = [wp.id]; 
            actionStack.push({ type: 'waypoint', id: wp.id });
            redrawScene(true);
        } else if (currentMode === 'poi') {
            logDebug(`Creating POI at ${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}`);
            const p = addPOI(coords.lat, coords.lng);
            actionStack.push({ type: 'poi', id: p.id });
        }
    }, Cesium.ScreenSpaceEventType.LEFT_UP);

    // ========================================================
    // LOGIC & DATA GENERATION (Abbreviated for focus)
    // ========================================================
    function addWaypoint(lat, lng, altitude = 50, linkedPoiId = 'none', hasPhoto = false) {
        let initialActions = [];
        if (hasPhoto) { initialActions = [{ type: 'hover', param: 2 }, { type: 'photo', param: 0 }]; }
        const waypoint = { id: Date.now() + Math.random(), lat: lat, lng: lng, altitude: altitude, speed: null, curveRadius: 0, linkedPoiId: linkedPoiId, calculatedPitch: 0, actions: initialActions, _groundHeight: 0 };
        waypoints.push(waypoint);
        return waypoint;
    }

    function addPOI(lat, lng) {
        const poiIndex = pois.length + 1;
        const poi = { id: 'poi_' + Date.now() + Math.random(), name: `POI ${poiIndex}`, lat: lat, lng: lng, altitude: 15, _groundHeight: 0 };
        pois.push(poi);
        redrawScene(true);
        return poi;
    }

    // Includes stubs for standard logic to prevent errors
    function generateOrbit(lat, lng) { setMode('select'); redrawScene(true); }
    function generateGrid(lat, lng) { setMode('select'); redrawScene(true); }
    function updateUI() { if(selectedWpIds.length === 0) floatingItemPanel.style.display = 'none'; else floatingItemPanel.style.display = 'block'; }

    let renderCounter = 0; 
    async function redrawScene(sampleTerrain = true) {
        const currentRender = ++renderCounter;
        if (sampleTerrain && isTokenValid) {
            const cartographics = waypoints.concat(pois).map(i => Cesium.Cartographic.fromDegrees(i.lng, i.lat));
            let tp = viewer.terrainProvider || viewer.scene.terrainProvider;
            if (cartographics.length > 0 && tp) {
                try { await Cesium.sampleTerrainMostDetailed(tp, cartographics); } catch (e) {}
            }
            if (currentRender !== renderCounter) return; 
            let cIdx = 0;
            waypoints.forEach(wp => { wp._groundHeight = cartographics.length > 0 ? (cartographics[cIdx++].height || 0) : 0; });
            pois.forEach(poi => { poi._groundHeight = cartographics.length > 0 ? (cartographics[cIdx++].height || 0) : 0; });
        }

        viewer.entities.removeAll();
        pois.forEach((poi) => {
            const ent = viewer.entities.add({ position: Cesium.Cartesian3.fromDegrees(poi.lng, poi.lat, poi.altitude + (poi._groundHeight || 0)), point: { pixelSize: 12, color: Cesium.Color.ORANGE, outlineColor: Cesium.Color.WHITE, outlineWidth: 2 }});
            ent.isInteractive = true; ent.itemType = 'poi'; ent.itemId = poi.id;
        });

        waypoints.forEach((wp, index) => {
            const isSelected = selectedWpIds.includes(wp.id);
            const color = isSelected ? Cesium.Color.YELLOW : Cesium.Color.DODGERBLUE;
            const ent = viewer.entities.add({ position: Cesium.Cartesian3.fromDegrees(wp.lng, wp.lat, wp.altitude + (wp._groundHeight || 0)), point: { pixelSize: isSelected ? 16 : 12, color: color, outlineColor: Cesium.Color.WHITE, outlineWidth: 2 }});
            ent.isInteractive = true; ent.itemType = 'wp'; ent.itemId = wp.id;
        });
        updateUI();
    }

    document.getElementById('clear-btn').addEventListener('click', function() {
        waypoints = []; pois = []; actionStack = []; selectedWpIds = [];
        redrawScene(false);
    });

    setTimeout(() => redrawScene(true), 1000);
});
