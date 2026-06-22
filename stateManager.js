// stateManager.js

// 1. Core State Variables
export let currentMode = 'waypoint';
export const waypoints = [];
export const pois = [];
export const actionStack = [];
export const selectedWpIds = [];
export let selectedPoiId = null;
export let movingEntity = null; // Stores { type: 'wp' | 'poi', id: string }

// 2. Mode & Selection Handling
export function setMode(mode) {
    currentMode = mode;
}

export function setSelectedWpIds(ids) {
    selectedWpIds.length = 0; // Clear existing WP selection
    ids.forEach(id => selectedWpIds.push(id));
    selectedPoiId = null; // Clear POI selection
    movingEntity = null; // Stop moving if selection is forced via code
}

export function setSelectedPoiId(id) {
    selectedPoiId = id;
    selectedWpIds.length = 0; // Clear WP selection
    movingEntity = null;
}

export function clearSelection() {
    selectedWpIds.length = 0;
    selectedPoiId = null;
    movingEntity = null;
}

export function setMovingEntity(type, id) {
    movingEntity = { type, id };
}

export function clearMovingEntity() {
    movingEntity = null;
}

export function updateWpLocation(id, lat, lng) {
    const wp = waypoints.find(w => w.id === id);
    if (wp) { wp.lat = lat; wp.lng = lng; }
}

export function updatePoiLocation(id, lat, lng) {
    const p = pois.find(p => p.id === id);
    if (p) { p.lat = lat; p.lng = lng; }
}

// 3. Waypoint & POI Creation
export function addWaypoint(lat, lng, altitude = 50, linkedPoiId = 'none', hasPhoto = false) {
    const waypoint = {
        id: Date.now() + Math.random(),
        lat: lat, 
        lng: lng, 
        altitude: altitude, 
        curveRadius: 0, 
        linkedPoiId: linkedPoiId, 
        calculatedPitch: 0,
        actions: hasPhoto ? [{type: 'photo', param: 0}] : [] 
    };
    waypoints.push(waypoint);
    return waypoint;
}

export function addPOI(lat, lng) {
    const poiIndex = pois.length + 1;
    const poi = { 
        id: 'poi_' + Date.now() + Math.random(), 
        name: `POI ${poiIndex}`, 
        lat: lat, 
        lng: lng, 
        altitude: 15 
    };
    pois.push(poi);
    return poi;
}

// 4. Deletion & Ordering
export function deleteWaypoint(id) {
    const index = waypoints.findIndex(w => w.id === id);
    if (index !== -1) waypoints.splice(index, 1);
    
    const selectedIndex = selectedWpIds.indexOf(id);
    if (selectedIndex !== -1) selectedWpIds.splice(selectedIndex, 1);
    
    if (movingEntity && movingEntity.id === id) movingEntity = null;
}

export function deletePOI(id) {
    const index = pois.findIndex(p => p.id === id);
    if (index !== -1) pois.splice(index, 1);
    
    if (selectedPoiId === id) selectedPoiId = null;
    if (movingEntity && movingEntity.id === id) movingEntity = null;
}

export function moveWaypoint(index, direction) {
    if (direction === -1 && index > 0) {
        const temp = waypoints[index];
        waypoints[index] = waypoints[index - 1];
        waypoints[index - 1] = temp;
    } else if (direction === 1 && index < waypoints.length - 1) {
        const temp = waypoints[index];
        waypoints[index] = waypoints[index + 1];
        waypoints[index + 1] = temp;
    }
}

export function getWpIndex(id) {
    return waypoints.findIndex(w => w.id === id) + 1;
}

// 5. Global Actions (Undo / Clear)
export function pushAction(action) {
    actionStack.push(action);
}

export function popAction() {
    return actionStack.pop();
}

export function clearAll() {
    waypoints.length = 0;
    pois.length = 0;
    actionStack.length = 0;
    selectedWpIds.length = 0;
    selectedPoiId = null;
    movingEntity = null;
}
