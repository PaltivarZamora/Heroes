package com.heroesofyendor;

import java.sql.Connection;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import javax.sql.DataSource;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationRunner;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.annotation.Order;

@Configuration
class DatabaseConnectionCheck {

    private static final Logger log = LoggerFactory.getLogger(DatabaseConnectionCheck.class);

    @Bean
    @Order(1)
    ApplicationRunner logDatabaseConnection(
            DataSource dataSource,
            @Value("${spring.datasource.username}") String jdbcUsername,
            @Value("${spring.datasource.url}") String jdbcUrl) {
        return args -> {
            try (Connection connection = dataSource.getConnection()) {
                var meta = connection.getMetaData();
                log.info(
                        "Database connection OK — {} {} — JDBC user={} url={}",
                        meta.getDatabaseProductName(),
                        meta.getDatabaseProductVersion(),
                        jdbcUsername,
                        jdbcUrl);
                logSessionRole(connection);
            } catch (Exception e) {
                log.error("Database connection FAILED — {}", e.getMessage());
                throw e;
            }
        };
    }

    private static void logSessionRole(Connection connection) throws Exception {
        String sql =
                """
                select current_user,
                       session_user,
                       current_role,
                       current_setting('row_security'),
                       r.rolsuper,
                       r.rolbypassrls
                from pg_roles r
                where r.rolname = current_user
                """;
        try (PreparedStatement statement = connection.prepareStatement(sql);
                ResultSet rs = statement.executeQuery()) {
            if (rs.next()) {
                log.info(
                        "Postgres session role={} session_user={} current_role={} row_security={} super={} bypassrls={}",
                        rs.getString(1),
                        rs.getString(2),
                        rs.getString(3),
                        rs.getString(4),
                        rs.getBoolean(5),
                        rs.getBoolean(6));
            }
        }
    }
}
