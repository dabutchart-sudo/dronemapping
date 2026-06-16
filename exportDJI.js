// exportDJI.js
import { waypoints, pois } from './stateManager.js';

export function generateDJI(globalSpeed) {
    if (waypoints.length < 2) return;
    
    const zip = new JSZip(); // Available globally via CDN
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
        const element = document.createElement('a'); 
        element.href = URL.createObjectURL(content); 
        element.download = "dji_fly_mission.kmz"; 
        document.body.appendChild(element); 
        element.click(); 
        document.body.removeChild(element);
    });
}
