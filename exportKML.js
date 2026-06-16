// exportKML.js
import { waypoints, pois } from './stateManager.js';

export function generateKML() {
    if (waypoints.length < 2) return;

    // KML colors are AABBGGRR (Alpha, Blue, Green, Red)
    let kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>3D Planner Flight Path</name>
    <Style id="pathStyle">
      <LineStyle>
        <color>ffffff00</color> <width>4</width>
      </LineStyle>
    </Style>
    <Style id="wpStyle">
      <IconStyle>
        <Icon><href>http://maps.google.com/mapfiles/kml/paddle/blu-blank.png</href></Icon>
      </IconStyle>
    </Style>
    <Style id="poiStyle">
      <IconStyle>
        <Icon><href>http://maps.google.com/mapfiles/kml/paddle/orange-blank.png</href></Icon>
      </IconStyle>
    </Style>`;

    // 1. Add POIs
    pois.forEach((poi) => {
        kml += `
    <Placemark>
      <name>${poi.name}</name>
      <styleUrl>#poiStyle</styleUrl>
      <Point>
        <extrude>1</extrude>
        <altitudeMode>relativeToGround</altitudeMode>
        <coordinates>${poi.lng},${poi.lat},${poi.altitude}</coordinates>
      </Point>
    </Placemark>`;
    });

    // 2. Add Waypoints
    waypoints.forEach((wp, index) => {
        kml += `
    <Placemark>
      <name>WP ${index + 1}</name>
      <styleUrl>#wpStyle</styleUrl>
      <Point>
        <extrude>1</extrude>
        <altitudeMode>relativeToGround</altitudeMode>
        <coordinates>${wp.lng},${wp.lat},${wp.altitude}</coordinates>
      </Point>
    </Placemark>`;
    });

    // 3. Add Flight Path (LineString)
    kml += `
    <Placemark>
      <name>Flight Path</name>
      <styleUrl>#pathStyle</styleUrl>
      <LineString>
        <extrude>1</extrude>
        <tessellate>1</tessellate>
        <altitudeMode>relativeToGround</altitudeMode>
        <coordinates>`;
    
    waypoints.forEach(wp => {
        kml += `\n          ${wp.lng},${wp.lat},${wp.altitude}`;
    });

    kml += `
        </coordinates>
      </LineString>
    </Placemark>
  </Document>
</kml>`;

    // Trigger File Download
    const blob = new Blob([kml], { type: 'application/vnd.google-earth.kml+xml;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a"); 
    link.setAttribute("href", url); 
    link.setAttribute("download", "google_earth_mission.kml"); 
    document.body.appendChild(link); 
    link.click(); 
    document.body.removeChild(link);
}
