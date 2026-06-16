// mapEngine.js
import { currentMode, waypoints, pois, selectedWpIds, addWaypoint, addPOI, setSelectedWpIds, clearSelection, pushAction, setMode } from './stateManager.js';
import { getOrbitParams, updateOrbitRadiusUI, setModeDropdown } from './uiController.js';
import { CESIUM_ION_TOKEN } from './config.js'; // <-- Added import

let viewer;
let orbitStep = 0;
let orbitCenterCartesian = null;
let orbitPreviewEntity = null;
let notifyStateChange;

export function initMap(onStateChange) {
    notifyStateChange = onStateChange;
    
    // Authenticate with your personal token
    Cesium.Ion.defaultAccessToken = CESIUM_ION_TOKEN; // <-- Added token assignment
    
// Initialize Cesium
    viewer = new Cesium.Viewer('map', {
        terrain: Cesium.Terrain.fromWorldTerrain(),
        
        // ADD THIS: Forces OpenStreetMap imagery instead of the default Bing Maps
        baseLayer: new Cesium.ImageryLayer(new Cesium.OpenStreetMapImageryProvider({
            url : 'https://tile.openstreetmap.org/'
        })),

        baseLayerPicker: false,
        geocoder: false,
        homeButton: false,
        infoBox: false,
        navigationHelpButton: false,
        sceneModePicker: false,
        timeline: false,
        animation: false
    });

    // Default camera position
    viewer.camera.flyTo({
        destination: Cesium.Cartesian3.fromDegrees(0.9006, 51.8959, 800),
        orientation: {
            heading: Cesium.Math.toRadians(0.0),
            pitch: Cesium.Math.toRadians(-45.0),
        }
    });

    const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);

    // Mouse Move (For Orbit Preview)
    handler.setInputAction(function (movement) {
        if (currentMode === 'orbit' && orbitStep === 1 && orbitCenterCartesian) {
            const ray = viewer.camera.getPickRay(movement.endPosition);
            const position = viewer.scene.globe.pick(ray, viewer.scene);
            
            if (Cesium.defined(position)) {
                let distance = Cesium.Cartesian3.distance(orbitCenterCartesian, position);
                const currentOrbitRadius = Math.max(5, distance);
                updateOrbitRadiusUI(Math.round(currentOrbitRadius));
                
                if (orbitPreviewEntity) viewer.entities.remove(orbitPreviewEntity);
                
                orbitPreviewEntity = viewer.entities.add({
                    position: orbitCenterCartesian,
                    ellipse: {
                        semiMinorAxis: currentOrbitRadius,
                        semiMajorAxis: currentOrbitRadius,
                        material: Cesium.Color.PURPLE.withAlpha(0.3),
                        outline: true,
                        outlineColor: Cesium.Color.PURPLE
                    }
                });
            }
        }
    }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);

    // Mouse Clicks
    handler.setInputAction(function (click) {
        const ray = viewer.camera.getPickRay(click.position);
        const position = viewer.scene.globe.pick(ray, viewer.scene);
        const pickedObject = viewer.scene.pick(click.position);

        // 1. Handle clicking existing entities
        if (Cesium.defined(pickedObject) && pickedObject.id && pickedObject.id.properties) {
            const itemType = pickedObject.id.properties.type.getValue();
            const itemId = pickedObject.id.properties.id.getValue();
            
            if (itemType === 'wp') {
                setSelectedWpIds([itemId]);
                notifyStateChange();
            } else if (itemType === 'poi') {
                clearSelection();
                notifyStateChange();
            }
            return; 
        }

        // 2. Handle placement on globe
        if (Cesium.defined(position) && currentMode !== 'select') {
            const cartographic = Cesium.Cartographic.fromCartesian(position);
            const lng = Cesium.Math.toDegrees(cartographic.longitude);
            const lat = Cesium.Math.toDegrees(cartographic.latitude);
            
            if (currentMode === 'orbit') {
                if (orbitStep === 0) {
                    orbitStep = 1;
                    orbitCenterCartesian = position;
                } else if (orbitStep === 1) {
                    orbitStep = 0;
                    if (orbitPreviewEntity) viewer.entities.remove(orbitPreviewEntity);
                    const centerCartographic = Cesium.Cartographic.fromCartesian(orbitCenterCartesian);
                    generateOrbit(Cesium.Math.toDegrees(centerCartographic.latitude), Cesium.Math.toDegrees(centerCartographic.longitude));
                    orbitCenterCartesian = null;
                }
            } else if (currentMode === 'waypoint') {
                const wp = addWaypoint(lat, lng, 50); 
                setSelectedWpIds([wp.id]); 
                pushAction({ type: 'waypoint', id: wp.id });
                notifyStateChange();
            } else if (currentMode === 'poi') {
                const p = addPOI(lat, lng);
                pushAction({ type: 'poi', id: p.id });
                notifyStateChange();
            }
        } else if (currentMode === 'select') {
            clearSelection();
            notifyStateChange();
        }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
}

export function resetOrbitState() {
    orbitStep = 0;
    orbitCenterCartesian = null;
    if (orbitPreviewEntity && viewer) {
        viewer.entities.remove(orbitPreviewEntity);
    }
}

function generateOrbit(centerLat, centerLng) {
    const { radiusMeters, altitude, photoCount } = getOrbitParams();
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
    setModeDropdown('select');
    notifyStateChange();
}

export function redrawMap3D() {
    if (!viewer) return;
    viewer.entities.removeAll();

    pois.forEach((poi) => {
        viewer.entities.add({
            position: Cesium.Cartesian3.fromDegrees(poi.lng, poi.lat, poi.altitude),
            properties: { type: 'poi', id: poi.id },
            point: { pixelSize: 12, color: Cesium.Color.ORANGE, outlineColor: Cesium.Color.WHITE, outlineWidth: 2, heightReference: Cesium.HeightReference.NONE },
            label: { text: `${poi.name}\n(${poi.altitude}m)`, font: '12pt sans-serif', fillColor: Cesium.Color.WHITE, style: Cesium.LabelStyle.FILL_AND_OUTLINE, outlineColor: Cesium.Color.BLACK, outlineWidth: 2, verticalOrigin: Cesium.VerticalOrigin.BOTTOM, pixelOffset: new Cesium.Cartesian2(0, -15) }
        });
        
        viewer.entities.add({
            polyline: { positions: [Cesium.Cartesian3.fromDegrees(poi.lng, poi.lat, 0), Cesium.Cartesian3.fromDegrees(poi.lng, poi.lat, poi.altitude)], width: 1, material: new Cesium.PolylineDashMaterialProperty({ color: Cesium.Color.ORANGE.withAlpha(0.5) }) }
        });
    });

    const wpPositions = [];
    waypoints.forEach((wp, index) => {
        const isSelected = selectedWpIds.includes(wp.id);
        const color = isSelected ? Cesium.Color.YELLOW : Cesium.Color.DODGERBLUE;
        const wpCartesian = Cesium.Cartesian3.fromDegrees(wp.lng, wp.lat, wp.altitude);
        
        wpPositions.push(wpCartesian);

        viewer.entities.add({
            position: wpCartesian,
            properties: { type: 'wp', id: wp.id },
            point: { pixelSize: isSelected ? 16 : 12, color: color, outlineColor: Cesium.Color.WHITE, outlineWidth: 2 },
            label: { text: `WP ${index + 1}\n(${wp.altitude}m)`, font: '12pt sans-serif', fillColor: Cesium.Color.WHITE, style: Cesium.LabelStyle.FILL_AND_OUTLINE, outlineColor: Cesium.Color.BLACK, outlineWidth: 2, verticalOrigin: Cesium.VerticalOrigin.BOTTOM, pixelOffset: new Cesium.Cartesian2(0, -15) }
        });

        viewer.entities.add({
            polyline: { positions: [Cesium.Cartesian3.fromDegrees(wp.lng, wp.lat, 0), wpCartesian], width: 1, material: new Cesium.PolylineDashMaterialProperty({ color: color.withAlpha(0.4) }) }
        });

        if (wp.linkedPoiId !== 'none') {
            const targetPoi = pois.find(p => p.id === wp.linkedPoiId);
            if (targetPoi) {
                viewer.entities.add({
                    polyline: { positions: [wpCartesian, Cesium.Cartesian3.fromDegrees(targetPoi.lng, targetPoi.lat, targetPoi.altitude)], width: 2, material: new Cesium.PolylineDashMaterialProperty({ color: Cesium.Color.YELLOW.withAlpha(0.8) }) }
                });
            }
        }
    });

    if (wpPositions.length > 1) {
        viewer.entities.add({
            polyline: { positions: wpPositions, width: 4, material: new Cesium.PolylineDashMaterialProperty({ color: Cesium.Color.CYAN }) }
        });
    }
}
