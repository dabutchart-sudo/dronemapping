# Drone Mapping / DJI Fly 3D Mission Planner

A browser-based 3D drone mission-planning prototype built around CesiumJS.

## What exists today

The current `main` branch is a static JavaScript application labelled **DJI Fly 3D Planner v26 (Cesium)**. It supports:

- placing and editing waypoints on a 3D Cesium map;
- points of interest (POIs);
- altitude and curve-radius editing;
- waypoint photo/hover actions;
- orbit generation;
- mission distance/time information;
- exporting DJI-style KMZ, Litchi CSV, and KML mission data.

The implementation is already separated into map, UI, state, and export modules rather than being only an experiment in a single HTML file.

## Current portfolio status

**Review / Retirement — retained, not archived.**

The repository contains a meaningful prototype, but its intended end product and supported drone/import workflow have not yet been reconfirmed. No active development epic should be created until that product decision is made.

See issue #1 for the portfolio review and next decision.

## Important security note

The repository historically contained a Cesium ion access token in `config.js`. Treat any token committed to Git history as exposed. Before this project is revived, revoke/rotate that credential and choose an appropriate configuration strategy for a browser application.

## Architecture

- `index.html` — application shell and controls
- `main.js` — application startup/render coordination
- `mapEngine.js` — Cesium map and 3D mission rendering/interaction
- `uiController.js` — sidebar/editor UI behaviour
- `stateManager.js` — in-memory mission state
- `exportDJI.js` — DJI-style KMZ/WPML generation
- `exportLitchi.js` — Litchi CSV export
- `exportKML.js` — KML export
- `style.css` — application styling
- `config.js` — current Cesium configuration; see security note above

## Before further development

1. Reconfirm the actual drone/model and target flight application/workflow.
2. Decide whether the goal is mission planning, mapping/photogrammetry planning, cinematic waypoint planning, or a combination.
3. Validate generated exports against the intended real application/device rather than assuming format compatibility from code alone.
4. Rotate the exposed Cesium credential.
5. Only then create `DESIGN.md`, `DEVELOPMENT.md`, `AGENTS.md`, an implementation epic, and a board if the project is being actively resumed.

Until then, preserve the working prototype and avoid speculative rewrites.