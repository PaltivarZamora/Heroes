package com.heroesofyendor;

import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Timestamp;
import java.util.List;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class GameSaveController {

    private static final Logger log = LoggerFactory.getLogger(GameSaveController.class);

    private final JdbcTemplate jdbc;
    private final ObjectMapper objectMapper;

    public GameSaveController(JdbcTemplate jdbc, ObjectMapper objectMapper) {
        this.jdbc = jdbc;
        this.objectMapper = objectMapper;
    }

    @GetMapping("/api/saves")
    public ResponseEntity<?> listSaves() {
        try {
            List<GameSaveSummary> rows =
                    jdbc.query(
                            """
                            select id, name, seed, created_at, updated_at
                            from game_save
                            order by updated_at desc nulls last, created_at desc
                            """,
                            this::mapSummary);
            return ResponseEntity.ok(rows);
        } catch (Exception e) {
            log.error("Failed to list game saves: {}", e.getMessage());
            return error(HttpStatus.INTERNAL_SERVER_ERROR, "Could not load saved games: " + detail(e));
        }
    }

    @GetMapping("/api/saves/{id}")
    public ResponseEntity<?> getSave(@PathVariable long id) {
        try {
            List<GameSaveDetail> rows =
                    jdbc.query(
                            """
                            select id, name, seed, game_state, created_at, updated_at
                            from game_save
                            where id = ?
                            """,
                            this::mapDetail,
                            id);
            if (rows.isEmpty()) {
                return error(HttpStatus.NOT_FOUND, "That save was not found.");
            }
            return ResponseEntity.ok(rows.get(0));
        } catch (Exception e) {
            log.error("Failed to load game save {}: {}", id, e.getMessage());
            return error(HttpStatus.INTERNAL_SERVER_ERROR, "Could not load that save: " + detail(e));
        }
    }

    @PostMapping("/api/saves")
    public ResponseEntity<?> createSave(@RequestBody CreateGameSaveRequest body) {
        String name = body.name() == null ? "" : body.name().trim();
        if (name.isEmpty()) {
            return error(HttpStatus.BAD_REQUEST, "A game name is required.");
        }
        if (body.gameState() == null) {
            return error(HttpStatus.BAD_REQUEST, "Game state is required.");
        }
        int seed = body.seed() == null ? 0 : body.seed();
        try {
            String json = objectMapper.writeValueAsString(body.gameState());
            Long existingId = existingSaveId(name);
            List<GameSaveSummary> rows =
                    existingId == null
                            ? insertSave(name, seed, json)
                            : updateSave(existingId, seed, json);
            if (rows.isEmpty()) {
                return error(HttpStatus.INTERNAL_SERVER_ERROR, "Save did not return a row.");
            }
            return ResponseEntity.ok(rows.get(0));
        } catch (JsonProcessingException e) {
            log.error("Failed to serialize game save: {}", e.getMessage());
            return error(HttpStatus.BAD_REQUEST, "Could not serialize the game to save.");
        } catch (Exception e) {
            log.error("Failed to save game: {}", e.getMessage());
            return error(HttpStatus.INTERNAL_SERVER_ERROR, "Could not save the game: " + detail(e));
        }
    }

    @DeleteMapping("/api/saves/{id}")
    public ResponseEntity<?> deleteSave(@PathVariable long id) {
        try {
            int removed = jdbc.update("delete from game_save where id = ?", id);
            if (removed == 0) {
                return error(HttpStatus.NOT_FOUND, "That save was not found.");
            }
            return ResponseEntity.ok().build();
        } catch (Exception e) {
            log.error("Failed to delete game save {}: {}", id, e.getMessage());
            return error(HttpStatus.INTERNAL_SERVER_ERROR, "Could not delete that save: " + detail(e));
        }
    }

    private Long existingSaveId(String name) {
        List<Long> ids =
                jdbc.query(
                        """
                        select id
                        from game_save
                        where name = ?
                        order by updated_at desc nulls last, id desc
                        limit 1
                        """,
                        (rs, rowNum) -> rs.getLong("id"),
                        name);
        return ids.isEmpty() ? null : ids.get(0);
    }

    private List<GameSaveSummary> insertSave(String name, int seed, String json) {
        return jdbc.query(
                """
                insert into game_save (name, seed, game_state, created_at, updated_at)
                values (?, ?, cast(? as jsonb), now(), now())
                returning id, name, seed, created_at, updated_at
                """,
                this::mapSummary,
                name,
                seed,
                json);
    }

    private List<GameSaveSummary> updateSave(long id, int seed, String json) {
        return jdbc.query(
                """
                update game_save
                set seed = ?, game_state = cast(? as jsonb), updated_at = now()
                where id = ?
                returning id, name, seed, created_at, updated_at
                """,
                this::mapSummary,
                seed,
                json,
                id);
    }

    private GameSaveSummary mapSummary(ResultSet rs, int rowNum) throws SQLException {
        return new GameSaveSummary(
                rs.getLong("id"),
                rs.getString("name"),
                rs.getInt("seed"),
                isoTime(rs.getTimestamp("created_at")),
                isoTime(rs.getTimestamp("updated_at")));
    }

    private GameSaveDetail mapDetail(ResultSet rs, int rowNum) throws SQLException {
        try {
            return new GameSaveDetail(
                    rs.getLong("id"),
                    rs.getString("name"),
                    rs.getInt("seed"),
                    readJson(rs.getObject("game_state")),
                    isoTime(rs.getTimestamp("created_at")),
                    isoTime(rs.getTimestamp("updated_at")));
        } catch (JsonProcessingException e) {
            throw new SQLException("Corrupt game_state JSON", e);
        }
    }

    private Object readJson(Object raw) throws JsonProcessingException {
        if (raw == null) {
            return null;
        }
        if (raw instanceof String text) {
            String trimmed = text.trim();
            if (trimmed.isEmpty()) {
                return null;
            }
            return objectMapper.readValue(trimmed, Object.class);
        }
        String fromDriver = jsonbText(raw);
        if (fromDriver != null) {
            return objectMapper.readValue(fromDriver, Object.class);
        }
        return raw;
    }

    /** JSONB arrives as PGobject (runtime-only driver) or a JSON string. */
    private static String jsonbText(Object value) {
        try {
            Object raw = value.getClass().getMethod("getValue").invoke(value);
            if (raw instanceof String text && !text.isBlank()) {
                return text;
            }
        } catch (ReflectiveOperationException ignored) {
            // Not a driver JSON object.
        }
        return null;
    }

    private static String isoTime(Timestamp timestamp) {
        return timestamp == null ? null : timestamp.toInstant().toString();
    }

    private static String detail(Exception e) {
        String message = e.getMessage();
        return message == null || message.isBlank() ? e.getClass().getSimpleName() : message;
    }

    private static ResponseEntity<ErrorMessage> error(HttpStatus status, String message) {
        return ResponseEntity.status(status).body(new ErrorMessage(message));
    }

    public record CreateGameSaveRequest(String name, Integer seed, Object gameState) {}

    public record GameSaveSummary(
            long id, String name, int seed, String createdAt, String updatedAt) {}

    public record GameSaveDetail(
            long id, String name, int seed, Object gameState, String createdAt, String updatedAt) {}

    public record ErrorMessage(String error) {}
}
