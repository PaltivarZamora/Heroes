export const TRANSPORT_BOAT_FILE = 'Transport_Boat.png';
export const TRANSPORT_WORLD_FILE = 'Transport_World.png';
/** `Transport_{TownTypeName}.png` from catalog `town.name` of the departure town. */
export function transportSpriteForTownType(catalog, townTypeId) {
    const row = catalog.town.find((entry) => entry.id === townTypeId);
    const name = row?.name?.trim().replace(/\s+/g, '_') ?? 'World';
    return `Transport_${name}.png`;
}
export function transportSpriteForDeparture(catalog, _session, originTown, fromWorldHanger) {
    if (fromWorldHanger) {
        return TRANSPORT_WORLD_FILE;
    }
    if (originTown) {
        return transportSpriteForTownType(catalog, originTown.town_type_id);
    }
    return TRANSPORT_WORLD_FILE;
}
/** Old saves may lack `transport_sprite` on in-flight heroes. */
export function flightTransportSpriteFile(flight) {
    const file = flight?.transport_sprite?.trim();
    return file ? file : TRANSPORT_WORLD_FILE;
}
