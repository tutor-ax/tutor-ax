package com.tutorax.backend;

import java.util.List;
import java.util.stream.Collectors;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 상담 준비 카드용 읽기 전용 API. 계산은 하지 않고 행을 그대로 돌려준다 — 카드 계산은 프런트 src/counsel.ts 한 곳에만 둔다.
 * 연락처·PIN 컬럼은 조회하지 않는다.
 */
@RestController
public class CounselController {
    private static final int MAX_WEEKS = 24;
    private final JdbcTemplate jdbc;

    public CounselController(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    @GetMapping("/api/health")
    public String health() {
        return "ok";
    }

    @GetMapping("/api/admin/classes")
    public ResponseEntity<String> classes() {
        return json("select id, name, grade from classes order by id");
    }

    @GetMapping("/api/admin/classes/{classId}/students")
    public ResponseEntity<String> students(@PathVariable int classId) {
        return json("select id, name, created_at from students where class_id = ? and is_active order by name", classId);
    }

    @GetMapping("/api/admin/classes/{classId}/weeks")
    public ResponseEntity<String> weeks(@PathVariable int classId) {
        return json("select id, label, test_date, item_config, created_at from weeks where class_id = ?", classId);
    }

    /** 고른 주차들의 반 전체 점수 행(반 평균 계산용). */
    @GetMapping("/api/admin/scores")
    public ResponseEntity<String> scores(@RequestParam List<Integer> weekIds) {
        if (weekIds.isEmpty() || weekIds.size() > MAX_WEEKS || weekIds.stream().anyMatch(id -> id == null || id <= 0)) {
            return ResponseEntity.badRequest().contentType(MediaType.APPLICATION_JSON).body("{\"error\":\"invalid_week_ids\"}");
        }
        String ids = weekIds.stream().map(String::valueOf).collect(Collectors.joining(",", "{", "}"));
        return json("select student_id, week_id, word_score, reading_score, mc_score, item4_score, item_scores, total_score,"
                + " retest_pass, attendance, homework_rate, no_homework, clinic_memo, clinic_target, clinic_attend"
                + " from scores where week_id = any(?::int[])", ids);
    }

    // JSON 직렬화는 Postgres(json_agg)에 맡긴다 — jsonb 컬럼(item_config 등)을 그대로 넘기려고.
    private ResponseEntity<String> json(String sql, Object... args) {
        String body = jdbc.queryForObject(
                "select coalesce(json_agg(t), '[]'::json)::text from (" + sql + ") t", String.class, args);
        return ResponseEntity.ok().contentType(MediaType.APPLICATION_JSON).body(body);
    }
}
