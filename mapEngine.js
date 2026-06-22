// mapEngine.js
import { currentMode, waypoints, pois, selectedWpIds, selectedPoiId, movingEntity, addWaypoint, addPOI, setSelectedWpIds, setSelectedPoiId, clearSelection, setMovingEntity, clearMovingEntity, updateWpLocation, updatePoiLocation, pushAction, setMode } from './stateManager.js';
import { promptOrbitParams, updateModeUI } from './uiController.js';
import { CESIUM_ION_TOKEN } from './config.js'; 

let viewer;
let isDraggingOrbit = false;
let orbitCenterCartesian = null;
let orbitPreviewEntity = null;
let orbitPreviewEntities = [];
let dynamicOrbitRadius = 5; 
let notifyStateChange;
let liveMoveCartesian = null; 

export function initMap(onStateChange) {
    notifyStateChange = onStateChange;
    
    Cesium.Ion.defaultAccessToken = CESIUM_ION_TOKEN; 
    
    viewer = new Cesium.Viewer('map', {
        terrain: Cesium.Terrain.fromWorldTerrain(),
        baseLayerPicker: false,
        geocoder: false,
        homeButton: false,
        infoBox: false,
        navigationHelpButton: false,
        sceneModePicker: false,
        timeline: false,
        animation: false
    });

    viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(0.9006, 51.8959, 800),
        orientation: {
            heading: Cesium.Math.toRadians(0.0),
            pitch: Cesium.Math.toRadians(-45.0),
        }
    });

    setupCameraControls();

    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);

    // 1. LEFT_DOWN: Handles Drag Starts (Orbit sizing)
    handler.setInputAction(function (click) {
        if (currentMode === 'orbit') {
            const ray = viewer.camera.getPickRay(click.position);
            const position = viewer.scene.globe.pick(ray, viewer.scene);
            
            if (Cesium.defined(position)) {
                isDraggingOrbit = true;
                orbitCenterCartesian = position;
                dynamicOrbitRadius = 5;
                
                // Disable map panning while sizing the orbit
                viewer.scene.screenSpaceCameraController.enableInputs = false;

                const centerCarto = Cesium.Cartographic.fromCartesian(orbitCenterCartesian);

                orbitPreviewEntity = viewer.entities.add({
                    position: orbitCenterCartesian,
                    ellipse: {
                        semiMinorAxis: new Cesium.CallbackProperty(() => dynamicOrbitRadius, false),
                        semiMajorAxis: new Cesium.CallbackProperty(() => dynamicOrbitRadius, false),
                        material: Cesium.Color.PURPLE.withAlpha(0.3),
                        outline: true,
                        outlineColor: Cesium.Color.PURPLE
                    }
                });

                // Generate 16 dots for previewing the waypoints while dragging
                for (let i = 0; i < 16; i++) {
                    const angleRad = ((360 / 16) * i) * (Math.PI / 180);
                    orbitPreviewEntities.push(viewer.entities.add({
                        position: new Cesium.CallbackProperty(() => {
                            const earthRadius = 6378137;
                            const centerLat = Cesium.Math.toDegrees(centerCarto.latitude);
                            const centerLng = Cesium.Math.toDegrees(centerCarto.longitude);
                            const wpLat = centerLat + ((dynamicOrbitRadius * Math.cos(angleRad)) / earthRadius) * (180 / Math.PI);
                            const wpLng = centerLng + ((dynamicOrbitRadius * Math.sin(angleRad)) / earthRadius) * (180 / Math.PI) / Math.cos(centerLat * Math.PI / 180);
                            return Cesium.Cartesian3.fromDegrees(wpLng, wpLat, centerCarto.height);
                        }, false),
                        point: { pixelSize: 8, color: Cesium.Color.YELLOW.withAlpha(0.8), outlineColor: Cesium.Color.BLACK, outlineWidth: 1 }
                    }));
                }
            }
        }
    }, Cesium.ScreenSpaceEventType.LEFT_DOWN);

    // 2. MOUSE_MOVE: Handles dynamic radius scaling and entity dragging
    handler.setInputAction(function (movement) {
        const ray = viewer.camera.getPickRay(movement.endPosition);
        const position = viewer.scene.globe.pick(ray, viewer.scene);
        
        if (currentMode === 'orbit' && isDraggingOrbit && orbitCenterCartesian && Cesium.defined(position)) {
            let distance = Cesium.Cartesian3.distance(orbitCenterCartesian, position);
            dynamicOrbitRadius = Math.max(5, distance);
        }

        if (currentMode === 'select' && movingEntity && Cesium.defined(position)) {
            liveMoveCartesian = position;
        }
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

    // 3. LEFT_UP: Handles Drag Ends (Orbit confirmation popup)
    handler.setInputAction(function (click) {
        if (currentMode === 'orbit' && isDraggingOrbit) {
            isDraggingOrbit = false;
            viewer.scene.screenSpaceCameraController.enableInputs = true; // Re-enable map panning

            // Trigger the modal popup
            promptOrbitParams(dynamicOrbitRadius, (params) => {
                const centerCarto = Cesium.Cartographic.fromCartesian(orbitCenterCartesian);
                generateOrbit(Cesium.Math.toDegrees(centerCarto.latitude), Cesium.Math.toDegrees(centerCarto.longitude), params);
                resetOrbitState();
            }, () => {
                resetOrbitState();
            });
        }
    }, Cesium.ScreenSpaceEventType.LEFT_UP);

    // 4. LEFT_CLICK: Handles single-click logic (Waypoints, POIs, Selecting)
    handler.setInputAction(function (click) {
        if (currentMode === 'orbit') return; // Handled exclusively by DOWN/UP logic above

        const ray = viewer.camera.getPickRay(click.position);
        const position = viewer.scene.globe.pick(ray, viewer.scene);
        const pickedObject = viewer.scene.pick(click.position);

        if (currentMode === 'select') {
            if (movingEntity) {
                if (liveMoveCartesian) {
                    const carto = Cesium.Cartographic.fromCartesian(liveMoveCartesian);
                    const lat = Cesium.Math.toDegrees(carto.latitude);
                    const lng = Cesium.Math.toDegrees(carto.longitude);
                    if (movingEntity.type === 'wp') updateWpLocation(movingEntity.id, lat, lng);
                    if (movingEntity.type === 'poi') updatePoiLocation(movingEntity.id, lat, lng);
                }
                clearMovingEntity();
                notifyStateChange();
                return;
            }

            if (Cesium.defined(pickedObject) && pickedObject.id && pickedObject.id.properties) {
                const itemType = pickedObject.id.properties.type.getValue();
                const itemId = pickedObject.id.properties.id.getValue();
                
                if (itemType === 'wp') {
                    if (selectedWpIds.length === 1 && selectedWpIds[0] === itemId) {
                        setMovingEntity('wp', itemId);
                        const wp = waypoints.find(w => w.id === itemId);
                        liveMoveCartesian = Cesium.Cartesian3.fromDegrees(wp.lng, wp.lat, wp.altitude);
                    } else {
                        setSelectedWpIds([itemId]);
                    }
                    notifyStateChange();
                    return; 
                } else if (itemType === 'poi') {
                    if (selectedPoiId === itemId) {
                        setMovingEntity('poi', itemId);
                        const p = pois.find(x => x.id === itemId);
                        liveMoveCartesian = Cesium.Cartesian3.fromDegrees(p.lng, p.lat, p.altitude);
                    } else {
                        setSelectedPoiId(itemId);
                    }
                    notifyStateChange();
                    return;
                }
            } else {
                clearSelection();
                notifyStateChange();
                return;
            }
        }

        if (Cesium.defined(position) && currentMode !== 'select') {
            const cartographic = Cesium.Cartographic.fromCartesian(position);
            const lng = Cesium.Math.toDegrees(cartographic.longitude);
            const lat = Cesium.Math.toDegrees(cartographic.latitude);
            
            if (currentMode === 'waypoint') {
                const wp = addWaypoint(lat, lng, 50); 
                setSelectedWpIds([wp.id]); 
                pushAction({ type: 'waypoint', id: wp.id });
                notifyStateChange();
            } else if (currentMode === 'poi') {
                const p = addPOI(lat, lng);
                pushAction({ type: 'poi', id: p.id });
                notifyStateChange();
            }
        }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
}

function setupCameraControls() {
    const zoomInBtn = document.getElementById('nav-zoom-in');
    const zoomOutBtn = document.getElementById('nav-zoom-out');
    const tiltUpBtn = document.getElementById('nav-tilt-up');
    const tiltDownBtn = document.getElementById('nav-tilt-down');

    if (zoomInBtn) zoomInBtn.addEventListener('click', () => { viewer.camera.zoomIn(viewer.camera.positionCartographic.height * 0.2); });
    if (zoomOutBtn) zoomOutBtn.addEventListener('click', () => { viewer.camera.zoomOut(viewer.camera.positionCartographic.height * 0.2); });
    if (tiltUpBtn) tiltUpBtn.addEventListener('click', () => { viewer.camera.lookUp(Cesium.Math.toRadians(10)); });
    if (tiltDownBtn) tiltDownBtn.addEventListener('click', () => { viewer.camera.lookDown(Cesium.Math.toRadians(10)); });

    const activeKeys = {};
    window.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
        
        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
            activeKeys[e.key] = true;
            e.preventDefault(); 
        }
    }, { passive: false });

    window.addEventListener('keyup', (e) => {
        if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
            activeKeys[e.key] = false;
        }
    });

    viewer.scene.preUpdate.addEventListener(() => {
        const cameraHeight = viewer.camera.positionCartographic.height;
        const moveRate = cameraHeight * 0.015;

        if (activeKeys['ArrowUp']) viewer.camera.moveUp(moveRate);
        if (activeKeys['ArrowDown']) viewer.camera.moveDown(moveRate);
        if (activeKeys['ArrowLeft']) viewer.camera.moveLeft(moveRate);
        if (activeKeys['ArrowRight']) viewer.camera.moveRight(moveRate);
    });
}

export function resetOrbitState() {
    isDraggingOrbit = false;
    orbitCenterCartesian = null;
    
    if (orbitPreviewEntity && viewer) {
        viewer.entities.remove(orbitPreviewEntity);
        orbitPreviewEntity = null;
    }
    
    orbitPreviewEntities.forEach(ent => viewer.entities.remove(ent));
    orbitPreviewEntities = [];
    
    if (viewer) {
        viewer.scene.screenSpaceCameraController.enableInputs = true; 
    }
}

function generateOrbit(centerLat, centerLng, params) {
    const { radiusMeters, altitude, photoCount } = params;
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
    
    pushAction({ type: 'orbit', poiId: centerPoi.id, wpIds: generatedWpIds });
    setMode('select'); 
    updateModeUI('select');
    notifyStateChange();
}

export function redrawMap3D() {
    if (!viewer) return;
    viewer.entities.removeAll();

    pois.forEach((poi) => {
        const isMoving = movingEntity && movingEntity.type === 'poi' && movingEntity.id === poi.id;
        const isSelected = selectedPoiId === poi.id;
        
        let pointColor = isSelected ? Cesium.Color.YELLOW : Cesium.Color.ORANGE;
        if (isMoving) pointColor = Cesium.Color.LIME;

        let positionProp, groundProp;
        if (isMoving) {
            positionProp = new Cesium.CallbackProperty(() => {
                if (!liveMoveCartesian) return Cesium.Cartesian3.fromDegrees(poi.lng, poi.lat, poi.altitude);
                const carto = Cesium.Cartographic.fromCartesian(liveMoveCartesian);
                return Cesium.Cartesian3.fromRadians(carto.longitude, carto.latitude, poi.altitude);
            }, false);
            groundProp = new Cesium.CallbackProperty(() => {
                if (!liveMoveCartesian) return Cesium.Cartesian3.fromDegrees(poi.lng, poi.lat, 0);
                const carto = Cesium.Cartographic.fromCartesian(liveMoveCartesian);
                return Cesium.Cartesian3.fromRadians(carto.longitude, carto.latitude, 0);
            }, false);
        } else {
            positionProp = Cesium.Cartesian3.fromDegrees(poi.lng, poi.lat, poi.altitude);
            groundProp = Cesium.Cartesian3.fromDegrees(poi.lng, poi.lat, 0);
        }

        viewer.entities.add({
            position: positionProp,
            properties: { type: 'poi', id: poi.id },
            point: { pixelSize: isSelected || isMoving ? 16 : 12, color: pointColor, outlineColor: Cesium.Color.WHITE, outlineWidth: 2, heightReference: Cesium.HeightReference.NONE },
            label: { text: `${poi.name}\n(${poi.altitude}m)`, font: '12pt sans-serif', fillColor: Cesium.Color.WHITE, style: Cesium.LabelStyle.FILL_AND_OUTLINE, outlineColor: Cesium.Color.BLACK, outlineWidth: 2, verticalOrigin: Cesium.VerticalOrigin.BOTTOM, pixelOffset: new Cesium.Cartesian2(0, -15) }
        });
        
        viewer.entities.add({
            polyline: { 
                positions: new Cesium.CallbackProperty(() => {
                    let p1 = groundProp.getValue ? groundProp.getValue(viewer.clock.currentTime) : groundProp;
                    let p2 = positionProp.getValue ? positionProp.getValue(viewer.clock.currentTime) : positionProp;
                    return [p1, p2];
                }, false),
                width: isSelected || isMoving ? 4 : 2, 
                material: new Cesium.PolylineDashMaterialProperty({ color: pointColor, dashLength: 10 }) 
            }
        });
    });

    waypoints.forEach((wp, index) => {
        const isMoving = movingEntity && movingEntity.type === 'wp' && movingEntity.id === wp.id;
        const isSelected = selectedWpIds.includes(wp.id);
        
        let pointColor = isSelected ? Cesium.Color.YELLOW : Cesium.Color.DODGERBLUE;
        if (isMoving) pointColor = Cesium.Color.LIME;
        
        let positionProp, groundProp;
        if (isMoving) {
            positionProp = new Cesium.CallbackProperty(() => {
                if (!liveMoveCartesian) return Cesium.Cartesian3.fromDegrees(wp.lng, wp.lat, wp.altitude);
                const carto = Cesium.Cartographic.fromCartesian(liveMoveCartesian);
                return Cesium.Cartesian3.fromRadians(carto.longitude, carto.latitude, wp.altitude);
            }, false);
            groundProp = new Cesium.CallbackProperty(() => {
                if (!liveMoveCartesian) return Cesium.Cartesian3.fromDegrees(wp.lng, wp.lat, 0);
                const carto = Cesium.Cartographic.fromCartesian(liveMoveCartesian);
                return Cesium.Cartesian3.fromRadians(carto.longitude, carto.latitude, 0);
            }, false);
        } else {
            positionProp = Cesium.Cartesian3.fromDegrees(wp.lng, wp.lat, wp.altitude);
            groundProp = Cesium.Cartesian3.fromDegrees(wp.lng, wp.lat, 0);
        }

        viewer.entities.add({
            position: positionProp,
            properties: { type: 'wp', id: wp.id },
            point: { pixelSize: isSelected || isMoving ? 16 : 12, color: pointColor, outlineColor: Cesium.Color.WHITE, outlineWidth: 2 },
            label: { text: `WP ${index + 1}\n(${wp.altitude}m)`, font: '12pt sans-serif', fillColor: Cesium.Color.WHITE, style: Cesium.LabelStyle.FILL_AND_OUTLINE, outlineColor: Cesium.Color.BLACK, outlineWidth: 2, verticalOrigin: Cesium.VerticalOrigin.BOTTOM, pixelOffset: new Cesium.Cartesian2(0, -15) }
        });

        viewer.entities.add({
            polyline: { 
                positions: new Cesium.CallbackProperty(() => {
                    let p1 = groundProp.getValue ? groundProp.getValue(viewer.clock.currentTime) : groundProp;
                    let p2 = positionProp.getValue ? positionProp.getValue(viewer.clock.currentTime) : positionProp;
                    return [p1, p2];
                }, false),
                width: isSelected || isMoving ? 4 : 2, 
                material: new Cesium.PolylineDashMaterialProperty({ color: pointColor, dashLength: 10 }) 
            }
        });

        if (wp.linkedPoiId !== 'none') {
            const targetPoi = pois.find(p => p.id === wp.linkedPoiId);
            if (targetPoi) {
                viewer.entities.add({
                    polyline: { 
                        positions: new Cesium.CallbackProperty(() => {
                            let p1 = positionProp.getValue ? positionProp.getValue(viewer.clock.currentTime) : positionProp;
                            
                            let p2;
                            const isPoiMoving = movingEntity && movingEntity.type === 'poi' && movingEntity.id === targetPoi.id;
                            if (isPoiMoving && liveMoveCartesian) {
                                const carto = Cesium.Cartographic.fromCartesian(liveMoveCartesian);
                                p2 = Cesium.Cartesian3.fromRadians(carto.longitude, carto.latitude, targetPoi.altitude);
                            } else {
                                p2 = Cesium.Cartesian3.fromDegrees(targetPoi.lng, targetPoi.lat, targetPoi.altitude);
                            }

                            return [p1, p2];
                        }, false), 
                        width: 2, 
                        material: new Cesium.PolylineDashMaterialProperty({ color: Cesium.Color.YELLOW.withAlpha(0.8) }) 
                    }
                });
            }
        }
    });

    if (waypoints.length > 1) {
        viewer.entities.add({
            polyline: { 
                positions: new Cesium.CallbackProperty(() => {
                    return waypoints.map(wp => {
                        const isMoving = movingEntity && movingEntity.type === 'wp' && movingEntity.id === wp.id;
                        if (isMoving && liveMoveCartesian) {
                            const carto = Cesium.Cartographic.fromCartesian(liveMoveCartesian);
                            return Cesium.Cartesian3.fromRadians(carto.longitude, carto.latitude, wp.altitude);
                        }
                        return Cesium.Cartesian3.fromDegrees(wp.lng, wp.lat, wp.altitude);
                    });
                }, false), 
                width: 4, 
                material: new Cesium.PolylineDashMaterialProperty({ color: Cesium.Color.CYAN }) 
            }
        });
    }
}
