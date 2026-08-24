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
 * Loads static reference tables once at startup and holds them in memory.
 * Gameplay must read from here — these tables are never queried again.
 */
@Service
public class ReferenceData {

    static final List<String> TABLE_NAMES = List.of(
            "resource",
            "magic_type",
            "attack_type",
            "move_type",
            "town",
            "hero_type",
            "skill",
            "spell",
            "building",
            "unit",
            "town_name_pool",
            "hero_pool");

    private static final Logger log = LoggerFactory.getLogger(ReferenceData.class);

    private final JdbcTemplate jdbc;
    private final Map<String, List<Map<String, Object>>> rowsByTable = new LinkedHashMap<>();
    private final List<TableLoadStatus> statuses = new ArrayList<>();

    public ReferenceData(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @PostConstruct
    void loadAll() {
        log.info(
                "Loading reference data as current_user={} row_security={}",
                jdbc.queryForObject("select current_user", String.class),
                jdbc.queryForObject("select current_setting('row_security')", String.class));
        for (String table : TABLE_NAMES) {
            List<Map<String, Object>> rows = loadTable(table, new ColumnMapRowMapper());
            rowsByTable.put(table, rows);
        }
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

    public List<Map<String, Object>> rows(String table) {
        List<Map<String, Object>> rows = rowsByTable.get(table);
        if (rows == null) {
            return List.of();
        }
        return rows;
    }

    public DataStatusResponse status() {
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
