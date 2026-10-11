import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { formatAmount, RESOURCES, } from '../hex/resources';
import { resolveResourceIconUrl } from './resourceIconCache';
import { subscribeCatalog } from '../town/catalog';
function ResourceIcon({ resource }) {
    const [src, setSrc] = useState(null);
    useEffect(() => {
        let cancelled = false;
        const resolve = () => {
            void resolveResourceIconUrl(resource).then((url) => {
                if (!cancelled) {
                    setSrc(url);
                }
            });
        };
        resolve();
        const unsub = subscribeCatalog(resolve);
        return () => {
            cancelled = true;
            unsub();
        };
    }, [resource.id, resource.name]);
    if (!src) {
        return (_jsx("span", { className: "resource-bar-fallback", "aria-hidden": true, title: resource.name, children: resource.marker }));
    }
    return (_jsx("img", { className: "resource-bar-icon", src: src, alt: "", title: resource.name, draggable: false, onError: () => setSrc(null) }));
}
function resourceCounts(entry) {
    const weekly = entry?.weeklyIncome ?? 0;
    const stockpile = entry?.stockpile ?? 0;
    return `(${formatAmount(weekly)}/wk) ${formatAmount(stockpile)}`;
}
/** Top / town resource strip: icon + (weekly income/wk) stockpile. */
export function ResourceBar({ wallet, className }) {
    const [, bump] = useState(0);
    useEffect(() => subscribeCatalog(() => bump((n) => n + 1)), []);
    return (_jsx("p", { className: className ?? 'resource-debug', children: RESOURCES.map((resource) => (_jsxs("span", { className: "resource-bar-item", children: [_jsx(ResourceIcon, { resource: resource }), _jsx("span", { className: "resource-bar-counts", children: resourceCounts(wallet[resource.id]) })] }, resource.id))) }));
}
