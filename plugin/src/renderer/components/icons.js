// Minimal line icons (24×24 grid, stroke-based), drawn from scratch.

const PATHS = {
    refresh: ['M20 11a8 8 0 1 0-2.3 5.7', 'M20 5v6h-6'],
    pin: ['M9 4h6l-1 5 3 3v2H7v-2l3-3z', 'M12 14v6'],
    gear: ['M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z', 'M19.4 13.5l1.6 1.2-2 3.4-1.9-.7a7 7 0 0 1-2 1.2L14.8 21h-4l-.3-2.4a7 7 0 0 1-2-1.2l-1.9.7-2-3.4 1.6-1.2a7 7 0 0 1 0-2.3L4.6 10l2-3.4 1.9.7a7 7 0 0 1 2-1.2L10.8 3.6h4l.3 2.4a7 7 0 0 1 2 1.2l1.9-.7 2 3.4-1.6 1.2a7 7 0 0 1 0 2.4z'],
    external: ['M14 5h5v5', 'M19 5l-8 8', 'M17 14v5H5V7h5'],
    more: ['M6 12h.01', 'M12 12h.01', 'M18 12h.01'],
    back: ['M15 5l-7 7 7 7'],
    search: ['M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z', 'M20 20l-4-4'],
    link: ['M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1', 'M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1'],
    unlink: ['M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1', 'M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1', 'M4 4l16 16'],
    swap: ['M7 7h11l-3-3', 'M17 17H6l3 3'],
    x: ['M6 6l12 12', 'M18 6L6 18'],
    dockRight: ['M4 5h16v14H4z', 'M14 5v14'],
    dockLeft: ['M4 5h16v14H4z', 'M10 5v14'],
    alert: ['M12 4l9 16H3z', 'M12 10v4', 'M12 17h.01'],
    page: ['M6 3h8l4 4v14H6z', 'M14 3v4h4'],
    db: ['M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3z', 'M4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6', 'M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3'],
    file: ['M6 3h8l4 4v14H6z', 'M9 13h6', 'M9 17h6'],
    check: ['M5 12l5 5 9-10'],
    cloudOff: ['M4 4l16 16', 'M8 8a5 5 0 0 0-2 9.6h11', 'M13.5 6.2A5 5 0 0 1 19 11a3.5 3.5 0 0 1 1.3 6.2'],
};

export function icon(name, cls = '') {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', `icon ${cls}`.trim());
    svg.setAttribute('aria-hidden', 'true');
    for (const d of PATHS[name] || []) {
        const p = document.createElementNS(NS, 'path');
        p.setAttribute('d', d);
        svg.appendChild(p);
    }
    return svg;
}

// Notion page icon (emoji or https image) or a neutral fallback.
export function pageIcon(ic, cls = '') {
    const span = document.createElement('span');
    span.className = `page-icon ${cls}`.trim();
    if (ic && ic.type === 'emoji') {
        span.textContent = ic.emoji;
    } else if (ic && ic.type === 'image' && typeof ic.url === 'string' && ic.url.startsWith('https://')) {
        const img = document.createElement('img');
        img.src = ic.url;
        img.alt = '';
        img.referrerPolicy = 'no-referrer';
        img.addEventListener('error', () => { span.textContent = ''; span.appendChild(icon('page')); });
        span.appendChild(img);
    } else {
        span.appendChild(icon('page'));
    }
    return span;
}
