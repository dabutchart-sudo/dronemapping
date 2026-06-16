// uiController.js
import { waypoints, pois, selectedWpIds, actionStack, setMode, getWpIndex, deleteWaypoint, moveWaypoint, setSelectedWpIds, popAction, clearAll } from './stateManager.js';
import { generateDJI } from './exportDJI.js';
import { generateLitchi } from './exportLitchi.js';
import { resetOrbitState } from './mapEngine.js';

let notifyStateChange;

// DOM Element Caches
const modeSelectEl = document.getElementById('mode-select');
const orbitSettingsPanel = document.getElementById('orbit-settings');
const radiusInputEl = document.getElementById('orbit-radius');
const globalSpeedEl = document.getElementById('global-speed');
const overviewPanel = document.getElementById('mission-overview-panel');
const editorPanel = document.getElementById('wp-editor-panel');
const navigatorPanel = document.getElementById('wp-navigator');
const exportDjiBtn = document.getElementById('export-dji-btn');
const exportLitchiBtn = document.getElementById('export-litchi-btn');

export function initUI(onStateChange) {
    notifyStateChange = onStateChange;

    // Mode Switching
    modeSelectEl.addEventListener('change', (e) => {
        const mode = e.target.value;
        setMode(mode);
        orbitSettingsPanel.style.display = (mode === 'orbit') ? 'block' : 'none';
        
        if (mode === 'select') modeSelectEl.style.backgroundColor = '#34495e';
        else if (mode === 'waypoint') modeSelectEl.style.backgroundColor = '#007bff';
        else if (mode === 'poi') modeSelectEl.style.backgroundColor = '#e67e22';
        else if (mode === 'orbit') modeSelectEl.style.backgroundColor = '#9b59b6';

        resetOrbitState();
    });

    globalSpeedEl.addEventListener('input', updateSidebarUI);

    // Global Actions
    document.getElementById('undo-btn').addEventListener('click', () => {
        const lastAction = popAction();
        if (!lastAction) return;

        if (lastAction.type === 'waypoint') {
            deleteWaypoint(lastAction.id);
        } else if (lastAction.type === 'poi') {
            const index = pois.findIndex(p => p.id === lastAction.id);
            if (index !== -1) pois.splice(index, 1);
        } else if (lastAction.type === 'orbit') {
            const poiIndex = pois.findIndex(p => p.id === lastAction.poiId);
            if (poiIndex !== -1) pois.splice(poiIndex, 1);
            lastAction.wpIds.forEach(id => deleteWaypoint(id));
        }
        notifyStateChange();
    });

    document.getElementById('clear-btn').addEventListener('click', () => {
        clearAll();
        notifyStateChange();
    });

    // Exporters
    exportDjiBtn.addEventListener('click', () => generateDJI(parseFloat(globalSpeedEl.value) || 5));
    exportLitchiBtn.addEventListener('click', () => generateLitchi(parseFloat(globalSpeedEl.value) || 5));

    // Editor Panel Interactions
    document.getElementById('wp-edit-alt').addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        if (isNaN(val)) return;
        selectedWpIds.forEach(id => { waypoints.find(w => w.id === id).altitude = val; });
        notifyStateChange();
    });

    document.getElementById('wp-edit-curve').addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        if (isNaN(val)) return;
        selectedWpIds.forEach(id => { waypoints.find(w => w.id === id).curveRadius = val; });
    });

    document.getElementById('wp-edit-poi').addEventListener('change', (e) => {
        const val = e.target.value;
        selectedWpIds.forEach(id => { waypoints.find(w => w.id === id).linkedPoiId = val; });
        notifyStateChange();
    });

    document.getElementById('deselect-btn').addEventListener('click', () => {
        setSelectedWpIds([]);
        notifyStateChange();
    });

    document.getElementById('select-all-btn').addEventListener('click', () => {
        setSelectedWpIds(waypoints.map(wp => wp.id));
        notifyStateChange();
    });

    // Reordering & Deletion
    document.getElementById('wp-move-up').addEventListener('click', () => { 
        if (selectedWpIds.length !== 1) return; 
        moveWaypoint(waypoints.findIndex(w => w.id === selectedWpIds[0]), -1); 
        notifyStateChange();
    });
    
    document.getElementById('wp-move-down').addEventListener('click', () => { 
        if (selectedWpIds.length !== 1) return; 
        moveWaypoint(waypoints.findIndex(w => w.id === selectedWpIds[0]), 1); 
        notifyStateChange();
    });

    document.getElementById('wp-delete').addEventListener('click', () => {
        if (selectedWpIds.length !== 1) return;
        deleteWaypoint(selectedWpIds[0]);
        notifyStateChange();
    });

    // Navigator
    document.getElementById('nav-prev').addEventListener('click', () => {
        if (selectedWpIds.length !== 1) return;
        let idx = waypoints.findIndex(w => w.id === selectedWpIds[0]);
        if (idx > 0) { setSelectedWpIds([waypoints[idx - 1].id]); notifyStateChange(); }
    });

    document.getElementById('nav-next').addEventListener('click', () => {
        if (selectedWpIds.length !== 1) return;
        let idx = waypoints.findIndex(w => w.id === selectedWpIds[0]);
        if (idx < waypoints.length - 1) { setSelectedWpIds([waypoints[idx + 1].id]); notifyStateChange(); }
    });

    // Actions
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
}

export function getOrbitParams() {
    return {
        radiusMeters: parseFloat(radiusInputEl.value),
        altitude: parseFloat(document.getElementById('orbit-alt').value),
        photoCount: parseInt(document.getElementById('orbit-count').value)
    };
}

export function updateOrbitRadiusUI(val) {
    radiusInputEl.value = val;
}

export function setModeDropdown(val) {
    modeSelectEl.value = val;
    modeSelectEl.dispatchEvent(new Event('change'));
}

export function updateSidebarUI() {
    let totalDist = 0;
    for (let i = 0; i < waypoints.length - 1; i++) {
        const p1 = Cesium.Cartesian3.fromDegrees(waypoints[i].lng, waypoints[i].lat, waypoints[i].altitude);
        const p2 = Cesium.Cartesian3.fromDegrees(waypoints[i+1].lng, waypoints[i+1].lat, waypoints[i+1].altitude);
        totalDist += Cesium.Cartesian3.distance(p1, p2);
    }
    
    const speed = parseFloat(globalSpeedEl.value) || 5;
    const totalTime = totalDist / speed;
    const mins = Math.floor(totalTime / 60);
    const secs = Math.round(totalTime % 60);

    document.getElementById('mission-stats-counts').innerText = `Waypoints: ${waypoints.length} | POIs: ${pois.length}`;
    document.getElementById('mission-stats-flight').innerText = `Distance: ${totalDist.toFixed(1)}m | Est. Time: ${mins}m ${secs}s`;

    exportDjiBtn.disabled = waypoints.length < 2;
    exportLitchiBtn.disabled = waypoints.length < 2;

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

    document.getElementById('single-wp-controls').style.display = isBulk ? 'none' : 'flex';
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

    if (!isBulk) {
        if (primaryWp.linkedPoiId === 'none') {
            gimbalInput.value = 'N/A';
            primaryWp.calculatedPitch = 0;
        } else {
            const targetPoi = pois.find(p => p.id === primaryWp.linkedPoiId);
            if (targetPoi) {
                const wpCartesian = Cesium.Cartesian3.fromDegrees(primaryWp.lng, primaryWp.lat, primaryWp.altitude);
                const poiCartesian = Cesium.Cartesian3.fromDegrees(targetPoi.lng, targetPoi.lat, targetPoi.altitude);
                const distance = Cesium.Cartesian3.distance(wpCartesian, poiCartesian);
                const altDiff = targetPoi.altitude - primaryWp.altitude;
                const pitchDeg = (Math.asin(altDiff / distance) * 180) / Math.PI;
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
