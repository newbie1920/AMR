import React, { useState, useEffect } from 'react';
import { reservationService } from '../../lib/reservationService';
import { useFleetStore } from '../../stores/fleetStore';
import translations from '../../translations';

const ReservationStatus = () => {
    const { settings } = useFleetStore();
    const lang = settings.language || 'en';
    const t = (key) => translations[lang][key] || key;

    const [locks, setLocks] = useState({});

    useEffect(() => {
        const unsub = reservationService.onUpdate((currentLocks) => {
            setLocks(currentLocks);
        });
        return () => unsub();
    }, []);

    const lockEntries = Object.entries(locks);

    return (
        <div className="reservation-status-panel">
            <h4 style={{ margin: '8px 0', fontSize: '0.9rem', color: '#666' }}>
                {t('reservation_status').toUpperCase()}
            </h4>
            <div className="lock-list">
                {lockEntries.length === 0 ? (
                    <div style={{ padding: '8px', fontSize: '0.8rem', color: '#999', fontStyle: 'italic' }}>
                        {t('no_active_reservations')}
                    </div>
                ) : (
                    lockEntries.map(([resId, lock]) => (
                        <div key={resId} className="lock-item" style={styles.item}>
                            <span style={styles.resId}>{resId}</span>
                            <span style={styles.badges}>
                                <span style={styles.robotBadge}>{lock.robotId}</span>
                                <span style={styles.prioBadge}>P{lock.priority}</span>
                            </span>
                        </div>
                    ))
                )}
            </div>
        </div>
    );
};

const styles = {
    item: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '6px 8px',
        margin: '4px 0',
        backgroundColor: 'rgba(0,0,0,0.03)',
        borderRadius: '4px',
        borderLeft: '3px solid #f39c12'
    },
    resId: {
        fontSize: '0.85rem',
        fontWeight: '500',
        color: '#444'
    },
    badges: {
        display: 'flex',
        gap: '4px'
    },
    robotBadge: {
        fontSize: '0.7rem',
        backgroundColor: '#2c3e50',
        color: '#fff',
        padding: '2px 4px',
        borderRadius: '3px'
    },
    prioBadge: {
        fontSize: '0.7rem',
        backgroundColor: '#e67e22',
        color: '#fff',
        padding: '2px 4px',
        borderRadius: '3px'
    }
};

export default ReservationStatus;
