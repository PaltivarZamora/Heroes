import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { formatAmount } from '../hex/resources';
import { unitPortraitUrl } from './slotArt';
export function stackView(session, stackId, catalog) {
    if (!stackId) {
        return { empty: true, filename: null, qty: 0 };
    }
    const stack = session.units.find((row) => row.id === stackId);
    if (!stack) {
        return { empty: true, filename: null, qty: 0 };
    }
    const unit = catalog?.unit.find((row) => row.id === stack.unit_id);
    const filename = unit?.image_path?.trim() || null;
    return { empty: false, filename, qty: stack.qty };
}
export function UnitStackFace({ filename, qty, empty, }) {
    const [missing, setMissing] = useState(false);
    useEffect(() => {
        setMissing(false);
    }, [filename]);
    if (empty) {
        return _jsx("span", { children: "Empty" });
    }
    return (_jsxs("span", { className: "unit-stack-face", children: [filename && !missing ? (_jsx("img", { src: unitPortraitUrl(filename), alt: "", onError: () => setMissing(true) })) : (_jsx("span", { className: "town-building-slot-filename", children: filename || 'Unknown' })), _jsx("span", { className: "unit-qty-badge", children: formatAmount(qty) })] }));
}
