// exportLitchi.js
import { waypoints, pois } from './stateManager.js';

export function generateLitchi(globalSpeed) {
    if (waypoints.length < 2) return;
    
    let csvContent = "latitude,longitude,altitude(m),heading(deg),curvesize(m),rotationdir,gimbalmode,gimbalpitchangle,actiontype1,actionparam1,actiontype2,actionparam2,actiontype3,actionparam3,actiontype4,actionparam4,actiontype5,actionparam5,actiontype6,actionparam6,actiontype7,actionparam7,actiontype8,actionparam8,actiontype9,actionparam9,actiontype10,actionparam10,actiontype11,actionparam11,actiontype12,actionparam12,actiontype13,actionparam13,actiontype14,actionparam14,actiontype15,actionparam15,altitudemode,speed(m/s),poi_latitude,poi_longitude,poi_altitude(m),poi_altitudemode,photo_timeinterval,photo_distinterval\n";

    waypoints.forEach(wp => {
        let gimbalmode = 0, poiLat = 0, poiLng = 0, poiAlt = 0, pitchOutput = 0; 
        if (wp.linkedPoiId !== 'none') {
            const targetPoi = pois.find(p => p.id === wp.linkedPoiId);
            if (targetPoi) { 
                gimbalmode = 1; 
                poiLat = targetPoi.lat; 
                poiLng = targetPoi.lng; 
                poiAlt = targetPoi.altitude; 
                pitchOutput = wp.calculatedPitch || 0; 
            }
        }

        let litchiActions = [];
        for(let i = 0; i < 15; i++) {
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
    const link = document.createElement("a"); 
    link.setAttribute("href", url); 
    link.setAttribute("download", "litchi_mission.csv"); 
    document.body.appendChild(link); 
    link.click(); 
    document.body.removeChild(link);
}
