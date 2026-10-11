/** Fallback rows only when the catalog `keybind` table omits an action (warn first). */
export const FALLBACK_KEYBIND_ROWS = [
    { action: 'end_turn', label: 'End Turn', key: 'e', alt_key: 'enter', scope: 'world', rebindable: true, sort_order: 10 },
    { action: 'hero_screen', label: 'Hero Screen', key: 'h', alt_key: null, scope: 'world', rebindable: true, sort_order: 20 },
    { action: 'town_screen', label: 'Town Screen', key: 't', alt_key: null, scope: 'world', rebindable: true, sort_order: 30 },
    { action: 'next_actionable', label: 'Next Actionable', key: 'tab', alt_key: null, scope: 'world', rebindable: true, sort_order: 40 },
    { action: 'map_view', label: 'Map View', key: 'm', alt_key: null, scope: 'world', rebindable: true, sort_order: 50 },
    { action: 'quest_log', label: 'Quest Log', key: 'q', alt_key: null, scope: 'global', rebindable: true, sort_order: 60 },
    { action: 'log', label: 'Log', key: 'l', alt_key: null, scope: 'global', rebindable: true, sort_order: 70 },
    { action: 'keybinds', label: 'Keybinds', key: 'k', alt_key: null, scope: 'global', rebindable: true, sort_order: 80 },
    { action: 'dev', label: 'Dev', key: 'd', alt_key: null, scope: 'global', rebindable: true, sort_order: 90 },
    { action: 'skip_turn', label: 'Skip Turn', key: ' ', alt_key: null, scope: 'battle', rebindable: true, sort_order: 100 },
    { action: 'menu', label: 'Menu', key: 'escape', alt_key: null, scope: 'global', rebindable: false, sort_order: 110 },
    { action: 'popup_confirm', label: 'Confirm', key: 'enter', alt_key: null, scope: 'popup', rebindable: false, sort_order: 120 },
    { action: 'upgrade_all', label: 'Upgrade All', key: 'u', alt_key: null, scope: 'town', rebindable: true, sort_order: 130 },
];
