// main.js
import { initMap, redrawMap3D } from './mapEngine.js';
import { initUI, updateSidebarUI } from './uiController.js';

document.addEventListener('DOMContentLoaded', async () => {
    
    // The central render loop
    function onStateChange() {
        redrawMap3D();
        updateSidebarUI();
    }

    // Initialize the separated components
    initMap(onStateChange);
    initUI(onStateChange);
    
    // Initial UI render
    onStateChange();
});
