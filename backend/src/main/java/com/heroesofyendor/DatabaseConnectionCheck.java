package com.heroesofyendor;

import java.sql.Connection;
import javax.sql.DataSource;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationRunner;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
class DatabaseConnectionCheck {

    private static final Logger log = LoggerFactory.getLogger(DatabaseConnectionCheck.class);

    @Bean
    ApplicationRunner logDatabaseConnection(DataSource dataSource) {
        return args -> {
            try (Connection connection = dataSource.getConnection()) {
                var meta = connection.getMetaData();
                log.info(
                        "Database connection OK — {} {}",
                        meta.getDatabaseProductName(),
                        meta.getDatabaseProductVersion());
            } catch (Exception e) {
                log.error("Database connection FAILED — {}", e.getMessage());
                throw e;
            }
        };
    }
}
