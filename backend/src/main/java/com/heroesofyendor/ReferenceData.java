package com.heroesofyendor;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.ColumnMapRowMapper;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;
import org.springframework.stereotype.Service;

/**
 * Loads static reference tables into memory at startup. Gameplay reads from
 * this cache. {@link #reload()} re-runs the same load against the database
 * without restarting the process.
 */
@Service
public class ReferenceData {

    static final List<String> TABLE_NAMES = List.of(
            "resource",
            "move_type",
            "town",
            "hero_type",
            "building",
            "unit",
            "unit_tag",
            "condition",
            "town_name_pool",
            "hero_pool",
            "town_layout",
            "market",
            "ability",
            "ability_resource",
            "ability_cooldown",
            "ability_target",
            "ability_type",
            "discipline",
            "ability_level",
            "hero_discipline",
            "difficulty",
            "player_color",
            "terrain_type",
            "app_config",
            "ai_arch",
            "ai_arch_weight",
            "levels",
            "hero_levels");

    private static final Logger log = LoggerFactory.getLogger(ReferenceData.class);

    private final JdbcTemplate jdbc;
    private final Map<String, List<Map<String, Object>>> rowsByTable = new LinkedHashMap<>();
    private final List<TableLoadStatus> statuses = new ArrayList<>();

    public ReferenceData(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @PostConstruct
    void loadOnStartup() {
        loadAll();
    }

    /** Re-query every reference table and replace the in-memory cache. */
    public synchronized DataStatusResponse reload() {
        loadAll();
        return status();
    }

    private synchronized void loadAll() {
        log.info(
                "Loading reference data as current_user={} row_security={}",
                jdbc.queryForObject("select current_user", String.class),
                jdbc.queryForObject("select current_setting('row_security')", String.class));
        statuses.clear();
        Map<String, List<Map<String, Object>>> next = new LinkedHashMap<>();
        for (String table : TABLE_NAMES) {
            next.put(table, loadTable(table, new ColumnMapRowMapper()));
        }
        rowsByTable.clear();
        rowsByTable.putAll(next);
    }

    /**
     * Generic load: query the table, map each row, reject empty results, catch
     * every failure. Callers supply the row mapper; error handling is shared.
     */
    <T> List<T> loadTable(String table, RowMapper<T> mapper) {
        try {
            List<T> rows = jdbc.query(selectAll(table), mapper);
            if (rows.isEmpty()) {
                recordFailure(table, 0, "0 rows returned");
                return List.of();
            }
            recordSuccess(table, rows.size());
            return List.copyOf(rows);
        } catch (Exception e) {
            String detail = e.getMessage() == null ? e.getClass().getSimpleName() : e.getMessage();
            recordFailure(table, 0, detail);
            return List.of();
        }
    }

    public synchronized List<Map<String, Object>> rows(String table) {
        List<Map<String, Object>> rows = rowsByTable.get(table);
        if (rows == null) {
            return List.of();
        }
        return rows;
    }

    public synchronized DataStatusResponse status() {
        boolean ok = statuses.stream().allMatch(TableLoadStatus::ok);
        return new DataStatusResponse(ok, List.copyOf(statuses));
    }

    private static String selectAll(String table) {
        if (!TABLE_NAMES.contains(table)) {
            throw new IllegalArgumentException("Unknown reference table: " + table);
        }
        return "SELECT * FROM \"" + table + "\"";
    }

    private void recordSuccess(String table, int rowCount) {
        statuses.add(new TableLoadStatus(table, true, rowCount, null));
        log.info("Reference data loaded: {} — {} rows", table, rowCount);
    }

    private void recordFailure(String table, int rowCount, String error) {
        statuses.add(new TableLoadStatus(table, false, rowCount, error));
        log.error("Reference data FAILED: {} — {}", table, error);
    }
}
