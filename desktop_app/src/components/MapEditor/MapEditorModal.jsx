import React, { useRef, useEffect, useState, useCallback } from 'react';
import { useMapStore } from '../../stores/mapStore';
import { useFleetStore } from '../../stores/fleetStore';
import translations from '../../translations';
import './MapEditor.css';

const MapEditorModal = ({ onClose }) => {
    const canvasRef = useRef(null);
    const containerRef = useRef(null);
    const {
        width: mapWidth,
        height: mapHeight,
        zones,
        docks,
        setZones,
        setDocks,
        setDimensions
    } = useMapStore();

    const { settings } = useFleetStore();
    const lang = settings.language || 'en';
    const t = (key) => translations[lang][key] || key;

    const [localZones, setLocalZones] = useState([]);
    const [localDocks, setLocalDocks] = useState([]);
    const [selectedZoneId, setSelectedZoneId] = useState(null);
    const [selectedDockId, setSelectedDockId] = useState(null);

    const [scale, setScale] = useState(40);
    const [offset, setOffset] = useState({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState(false);
    const [dragMode, setDragMode] = useState('none'); // 'pan', 'move_zone', 'move_dock', 'resize_zone'
    const [resizeHandle, setResizeHandle] = useState(null);
    const lastMousePosRef = useRef({ x: 0, y: 0 });

    useEffect(() => {
        setLocalZones(JSON.parse(JSON.stringify(zones || [])));
        setLocalDocks(JSON.parse(JSON.stringify(docks || [])));
    }, [zones, docks]);

    const handleSave = () => {
        setZones(localZones);
        setDocks(localDocks);
        if (typeof onClose === 'function') {
            onClose();
        }
    };

    const worldToCanvas = useCallback((wx, wy) => {
        const canvas = canvasRef.current;
        if (!canvas) return { x: 0, y: 0 };
        const centerX = canvas.width / 2;
        const centerY = canvas.height / 2;
        return {
            x: centerX + (wx - mapWidth / 2) * scale + offset.x,
            y: centerY - (wy - mapHeight / 2) * scale + offset.y
        };
    }, [scale, offset, mapWidth, mapHeight]);

    const canvasToWorld = useCallback((cx, cy) => {
        const canvas = canvasRef.current;
        if (!canvas) return { x: 0, y: 0 };
        const centerX = canvas.width / 2;
        const centerY = canvas.height / 2;
        return {
            x: (cx - centerX - offset.x) / scale + mapWidth / 2,
            y: -(cy - centerY - offset.y) / scale + mapHeight / 2
        };
    }, [scale, offset, mapWidth, mapHeight]);

    const fitMap = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const padding = 40;
        const availableW = canvas.width - padding * 2;
        const availableH = canvas.height - padding * 2;
        const scaleW = availableW / mapWidth;
        const scaleH = availableH / mapHeight;
        const newScale = Math.min(scaleW, scaleH, 100);
        setScale(newScale);
        setOffset({ x: 0, y: 0 });
    }, [mapWidth, mapHeight]);

    const draw = useCallback(() => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        if (!ctx) return;

        ctx.fillStyle = '#1e1e2e';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        const wTopLeft = worldToCanvas(0, mapHeight);
        const wBottomRight = worldToCanvas(mapWidth, 0);

        ctx.fillStyle = '#181825';
        ctx.fillRect(wTopLeft.x, wTopLeft.y, wBottomRight.x - wTopLeft.x, wBottomRight.y - wTopLeft.y);
        ctx.strokeStyle = '#444';
        ctx.strokeRect(wTopLeft.x, wTopLeft.y, wBottomRight.x - wTopLeft.x, wBottomRight.y - wTopLeft.y);

        // Grid
        ctx.strokeStyle = '#333';
        ctx.beginPath();
        for (let i = 0; i <= mapWidth; i++) {
            const s = worldToCanvas(i, 0);
            const e = worldToCanvas(i, mapHeight);
            ctx.moveTo(s.x, s.y);
            ctx.lineTo(e.x, e.y);
        }
        for (let i = 0; i <= mapHeight; i++) {
            const s = worldToCanvas(0, i);
            const e = worldToCanvas(mapWidth, i);
            ctx.moveTo(s.x, s.y);
            ctx.lineTo(e.x, e.y);
        }
        ctx.stroke();

        // Draw Zones
        localZones.forEach(zone => {
            const tl = worldToCanvas(zone.x, zone.y + zone.height);
            const br = worldToCanvas(zone.x + zone.width, zone.y);
            const isSelected = zone.id === selectedZoneId;

            ctx.fillStyle = zone.color + '40';
            ctx.fillRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);

            ctx.strokeStyle = isSelected ? '#fff' : zone.color;
            ctx.lineWidth = isSelected ? 2 : 1;
            if (isSelected) ctx.setLineDash([5, 5]);
            ctx.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
            ctx.setLineDash([]);

            ctx.fillStyle = '#fff';
            ctx.font = '12px Inter';
            ctx.textAlign = 'center';
            ctx.fillText(zone.label || zone.type, (tl.x + br.x) / 2, (tl.y + br.y) / 2);

            if (isSelected) {
                const hs = 8;
                ctx.fillStyle = '#fff';
                [tl, { x: br.x, y: tl.y }, { x: tl.x, y: br.y }, br].forEach(p => {
                    ctx.fillRect(p.x - hs / 2, p.y - hs / 2, hs, hs);
                });
            }
        });

        // Draw Docks
        localDocks.forEach(dock => {
            const pos = worldToCanvas(dock.x, dock.y);
            const isSelected = dock.id === selectedDockId;
            const size = 15;

            ctx.fillStyle = isSelected ? '#fff' : '#2c3e50cc';
            ctx.strokeStyle = isSelected ? '#00d4ff' : '#95a5a6';
            ctx.lineWidth = 2;

            ctx.beginPath();
            ctx.rect(pos.x - size, pos.y - size, size * 2, size * 2);
            ctx.fill();
            ctx.stroke();

            const angleRad = -(dock.theta || 0) * (Math.PI / 180);
            ctx.strokeStyle = isSelected ? '#00d4ff' : '#fff';
            ctx.beginPath();
            ctx.moveTo(pos.x, pos.y);
            ctx.lineTo(pos.x + Math.cos(angleRad) * size, pos.y + Math.sin(angleRad) * size);
            ctx.stroke();

            ctx.fillStyle = '#fff';
            ctx.font = 'bold 10px Inter';
            ctx.textAlign = 'center';
            ctx.fillText(dock.label || dock.id, pos.x, pos.y - size - 5);
        });

    }, [localZones, localDocks, selectedZoneId, selectedDockId, worldToCanvas, mapWidth, mapHeight, scale, offset]);

    useEffect(() => {
        const handleResize = () => {
            const canvas = canvasRef.current;
            const container = containerRef.current;
            if (!canvas || !container) return;
            canvas.width = container.clientWidth;
            canvas.height = container.clientHeight;
        };
        handleResize();
        window.addEventListener('resize', handleResize);
        setTimeout(fitMap, 100);
        return () => window.removeEventListener('resize', handleResize);
    }, [fitMap]);

    useEffect(() => {
        const id = requestAnimationFrame(draw);
        return () => cancelAnimationFrame(id);
    }, [draw]);

    const handleMouseDown = (e) => {
        const rect = canvasRef.current.getBoundingClientRect();
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;
        const worldPos = canvasToWorld(cx, cy);

        if (selectedZoneId) {
            const z = localZones.find(z => z.id === selectedZoneId);
            if (z) {
                const tl = worldToCanvas(z.x, z.y + z.height);
                const br = worldToCanvas(z.x + z.width, z.y);
                const hs = 8;
                const hit = (px, py) => Math.abs(cx - px) < hs && Math.abs(cy - py) < hs;
                if (hit(tl.x, tl.y)) { setDragMode('resize_zone'); setResizeHandle('tl'); setIsDragging(true); return; }
                if (hit(br.x, tl.y)) { setDragMode('resize_zone'); setResizeHandle('tr'); setIsDragging(true); return; }
                if (hit(tl.x, br.y)) { setDragMode('resize_zone'); setResizeHandle('bl'); setIsDragging(true); return; }
                if (hit(br.x, br.y)) { setDragMode('resize_zone'); setResizeHandle('br'); setIsDragging(true); return; }
            }
        }

        // Check Docks
        for (let i = localDocks.length - 1; i >= 0; i--) {
            const d = localDocks[i];
            const p = worldToCanvas(d.x, d.y);
            if (Math.abs(cx - p.x) < 20 && Math.abs(cy - p.y) < 20) {
                setSelectedDockId(d.id);
                setSelectedZoneId(null);
                setDragMode('move_dock');
                setIsDragging(true);
                lastMousePosRef.current = worldPos;
                return;
            }
        }

        // Check Zones
        for (let i = localZones.length - 1; i >= 0; i--) {
            const z = localZones[i];
            if (worldPos.x >= z.x && worldPos.x <= z.x + z.width && worldPos.y >= z.y && worldPos.y <= z.y + z.height) {
                setSelectedZoneId(z.id);
                setSelectedDockId(null);
                setDragMode('move_zone');
                setIsDragging(true);
                lastMousePosRef.current = worldPos;
                return;
            }
        }

        setDragMode('pan');
        setIsDragging(true);
        lastMousePosRef.current = { x: e.clientX, y: e.clientY };
        setSelectedZoneId(null);
        setSelectedDockId(null);
    };

    const handleMouseMove = (e) => {
        if (!isDragging) return;
        const rect = canvasRef.current.getBoundingClientRect();
        const worldPos = canvasToWorld(e.clientX - rect.left, e.clientY - rect.top);

        if (dragMode === 'pan') {
            setOffset(prev => ({ x: prev.x + (e.clientX - lastMousePosRef.current.x), y: prev.y + (e.clientY - lastMousePosRef.current.y) }));
            lastMousePosRef.current = { x: e.clientX, y: e.clientY };
        } else if (dragMode === 'move_zone' && selectedZoneId) {
            const dx = worldPos.x - lastMousePosRef.current.x;
            const dy = worldPos.y - lastMousePosRef.current.y;
            setLocalZones(prev => prev.map(z => z.id === selectedZoneId ? { ...z, x: z.x + dx, y: z.y + dy } : z));
            lastMousePosRef.current = worldPos;
        } else if (dragMode === 'move_dock' && selectedDockId) {
            const dx = worldPos.x - lastMousePosRef.current.x;
            const dy = worldPos.y - lastMousePosRef.current.y;
            setLocalDocks(prev => prev.map(d => d.id === selectedDockId ? { ...d, x: d.x + dx, y: d.y + dy } : d));
            lastMousePosRef.current = worldPos;
        } else if (dragMode === 'resize_zone' && selectedZoneId) {
            const wx = Math.round(worldPos.x * 20) / 20;
            const wy = Math.round(worldPos.y * 20) / 20;
            setLocalZones(prev => prev.map(z => {
                if (z.id !== selectedZoneId) return z;
                let nx = z.x, ny = z.y, nw = z.width, nh = z.height;
                if (resizeHandle === 'tl') { nx = wx; nw = (z.x + z.width) - wx; nh = wy - z.y; }
                else if (resizeHandle === 'tr') { nw = wx - z.x; nh = wy - z.y; }
                else if (resizeHandle === 'bl') { nx = wx; nw = (z.x + z.width) - wx; ny = wy; nh = (z.y + z.height) - wy; }
                else if (resizeHandle === 'br') { nw = wx - z.x; ny = wy; nh = (z.y + z.height) - wy; }
                if (nw < 0.2) nw = 0.2; if (nh < 0.2) nh = 0.2;
                return { ...z, x: nx, y: ny, width: nw, height: nh };
            }));
        }
    };

    const handleMouseUp = () => setIsDragging(false);

    const addNewZone = (type) => {
        const colors = { loading: '#3498db', unloading: '#e74c3c', storage: '#95a5a6', charging: '#f39c12', obstacle: '#555' };
        const nz = { id: `z_${Date.now()}`, x: mapWidth / 2 - 1, y: mapHeight / 2 - 1, width: 2, height: 2, type, label: type, color: colors[type] };
        setLocalZones([...localZones, nz]);
        setSelectedZoneId(nz.id);
        setSelectedDockId(null);
    };

    const addNewDock = () => {
        const nd = { id: `d_${Date.now()}`, x: mapWidth / 2, y: mapHeight / 2, theta: 0, label: 'Dock', robotId: '' };
        setLocalDocks([...localDocks, nd]);
        setSelectedDockId(nd.id);
        setSelectedZoneId(null);
    };

    return (
        <div className="map-editor-overlay">
            <div className="map-editor-modal">
                <div className="editor-header">
                    <h3>{t('design_map')}</h3>
                    <div className="actions">
                        <button className="btn btn-secondary" onClick={() => { if (typeof onClose === 'function') onClose(); }}>{t('cancel')}</button>
                        <button className="btn btn-primary" onClick={handleSave}>{t('save_changes')}</button>
                    </div>
                </div>
                <div className="editor-body">
                    <div className="toolbar">
                        <h4>{t('tools')}</h4>
                        {['loading', 'unloading', 'storage', 'charging', 'obstacle'].map(zType => (
                            <button key={zType} className="tool-btn" onClick={() => addNewZone(zType)}>{t('add_zone')} {t(zType)}</button>
                        ))}
                        <hr />
                        <button className="tool-btn" onClick={addNewDock} style={{ borderColor: '#00d4ff' }}>{t('add_dock')}</button>
                        <hr />
                        <button className="tool-btn" onClick={fitMap}>🔍 {t('reset_view')}</button>
                    </div>
                    <div className="canvas-container" ref={containerRef}>
                        <canvas ref={canvasRef} onMouseDown={handleMouseDown} onMouseMove={handleMouseMove} onMouseUp={handleMouseUp} onMouseLeave={handleMouseUp} onWheel={e => setScale(s => Math.min(200, Math.max(10, s + (e.deltaY > 0 ? -2 : 2))))} />
                    </div>
                    <div className="properties-panel">
                        {selectedZoneId ? (
                            <div className="props">
                                <h4>{t('zone')}: {t(localZones.find(z => z.id === selectedZoneId)?.type)}</h4>
                                <label>{t('label')}</label>
                                <input value={localZones.find(z => z.id === selectedZoneId)?.label || ''} onChange={e => setLocalZones(lzs => lzs.map(z => z.id === selectedZoneId ? { ...z, label: e.target.value } : z))} />
                                <button className="btn btn-danger btn-sm" onClick={() => { setLocalZones(lzs => lzs.filter(z => z.id !== selectedZoneId)); setSelectedZoneId(null); }}>{t('delete')}</button>
                            </div>
                        ) : selectedDockId ? (
                            <div className="props">
                                <h4>{t('robot_dock')}</h4>
                                <label>{t('label')}</label>
                                <input value={localDocks.find(d => d.id === selectedDockId)?.label || ''} onChange={e => setLocalDocks(lds => lds.map(d => d.id === selectedDockId ? { ...d, label: e.target.value } : d))} />
                                <label>{t('angle')}</label>
                                <input type="number" value={localDocks.find(d => d.id === selectedDockId)?.theta || 0} onChange={e => setLocalDocks(lds => lds.map(d => d.id === selectedDockId ? { ...d, theta: parseInt(e.target.value) } : d))} />
                                <label>{t('robot_id')}</label>
                                <input value={localDocks.find(d => d.id === selectedDockId)?.robotId || ''} onChange={e => setLocalDocks(lds => lds.map(d => d.id === selectedDockId ? { ...d, robotId: e.target.value } : d))} />
                                <button className="btn btn-danger btn-sm" onClick={() => { setLocalDocks(lds => lds.filter(d => d.id !== selectedDockId)); setSelectedDockId(null); }}>{t('delete')}</button>
                            </div>
                        ) : (
                            <div className="hint">{t('hint_select_item')}</div>
                        )}
                        <div className="global-props" style={{ marginTop: 'auto' }}>
                            <hr />
                            <label>{t('map_width')}</label>
                            <input type="number" value={mapWidth} onChange={e => setDimensions(parseFloat(e.target.value), mapHeight)} />
                            <label>{t('map_height')}</label>
                            <input type="number" value={mapHeight} onChange={e => setDimensions(mapWidth, parseFloat(e.target.value))} />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default MapEditorModal;
