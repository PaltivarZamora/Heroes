function formatDataLoadSection(dataStatus) {
    if (dataStatus == null) {
        return ['Data Load Errors: …'];
    }
    if (dataStatus.fetchError) {
        return [
            'Data Load Errors:',
            `  status endpoint — ${dataStatus.fetchError}`,
        ];
    }
    const failures = dataStatus.tables.filter((table) => !table.ok);
    if (failures.length === 0) {
        return [];
    }
    return [
        'Data Load Errors:',
        ...failures.map((table) => {
            const detail = table.error?.trim() || 'load failed';
            return `  ${table.table} — ${detail}`;
        }),
    ];
}
export function formatDebugSections(snapshot) {
    const hero = snapshot.heroQ === null || snapshot.heroR === null
        ? `Hero: ${snapshot.heroName}`
        : `Hero: ${snapshot.heroName} q=${snapshot.heroQ}, r=${snapshot.heroR}`;
    return {
        gameSetup: [
            `Map Size: ${snapshot.mapSize}`,
            `Hex Size: ${snapshot.hexSize}`,
            `Seed Number: ${snapshot.seed}`,
            hero,
            `Steps: ${snapshot.steps}`,
            ...snapshot.resources,
            ...(snapshot.extraLines ?? []),
        ].join('\n'),
        rest: [
            ...(snapshot.traceLines ?? []),
            ...formatDataLoadSection(snapshot.dataStatus),
        ].join('\n'),
    };
}
/** One labeled line per field — add lines here as more testable state exists. */
export function formatDebugText(snapshot) {
    const { gameSetup, rest } = formatDebugSections(snapshot);
    return rest.trim() ? `${gameSetup}\n${rest}` : gameSetup;
}
