package com.tutorax.backend;

import java.time.Duration;
import java.util.List;
import java.util.Map;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseEntity;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.client.RestClient;

/**
 * 상담 카드 요약 줄 → Gemini → "상담 때 물어볼 질문" 2~3개.
 * 받는 것은 카드의 요약 줄(주차·항목명·숫자)뿐이다. 학생·반 이름과 클리닉 메모 원문은 받지도 보내지도 않는다.
 */
@RestController
public class QuestionsController {
    static final int MAX_LINES = 20;
    static final int MAX_LINE = 200;
    private static final String URL =
            "https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent";
    private final String apiKey;
    private final RestClient http;

    public QuestionsController(@Value("${tutorax.gemini-api-key:}") String apiKey) {
        this.apiKey = apiKey;
        var factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(Duration.ofSeconds(5));
        factory.setReadTimeout(Duration.ofSeconds(25));
        this.http = RestClient.builder().requestFactory(factory).build();
    }

    record Request(List<String> lines, Integer weekCount) {}

    @PostMapping("/api/admin/counsel/questions")
    public ResponseEntity<Map<String, String>> questions(@RequestBody Request body) {
        if (body == null || body.lines() == null || body.lines().size() > MAX_LINES || body.weekCount() == null
                || body.weekCount() < 1 || body.weekCount() > 12
                || body.lines().stream().anyMatch(l -> l == null || l.length() > MAX_LINE)) {
            return ResponseEntity.badRequest().body(Map.of("error", "invalid_request"));
        }
        if (apiKey.isEmpty()) return ResponseEntity.status(503).body(Map.of("error", "ai_not_configured"));
        try {
            Map<?, ?> res = http.post().uri(URL).header("X-goog-api-key", apiKey)
                    .header(HttpHeaders.CONTENT_TYPE, "application/json")
                    .body(Map.of("contents", List.of(Map.of("parts", List.of(Map.of("text", prompt(body.lines(), body.weekCount())))))))
                    .retrieve().body(Map.class);
            String text = textOf(res);
            if (text.isBlank()) return ResponseEntity.status(502).body(Map.of("error", "ai_empty"));
            return ResponseEntity.ok(Map.of("questions", text.strip()));
        } catch (Exception e) {
            // 응답 본문에 기록이 섞일 수 있어 로그에는 예외 종류만 남긴다
            org.slf4j.LoggerFactory.getLogger(getClass()).warn("gemini call failed: {}", e.getClass().getSimpleName());
            return ResponseEntity.status(502).body(Map.of("error", "ai_failed"));
        }
    }

    static String prompt(List<String> lines, int weekCount) {
        String summary = lines.isEmpty() ? "(특이 기록 없음)" : "- " + String.join("\n- ", lines);
        return """
                한 학생의 최근 %d주차 학원 기록 요약이다.

                %s

                학원 선생님이 이 학생과 대면 상담하기 전에 볼 참고 자료다. 상담 때 학생에게 물어볼 질문을 2~3개 써줘.
                - 각 질문 끝에 근거가 된 기록을 괄호로 짧게 붙일 것 (예: "(최근 2주 과제 완료율 하락)")
                - 원인을 단정하지 말고 학생에게 묻는 형태로만 쓸 것
                - 기록에 없는 숫자는 만들어내지 말 것
                - 특이한 기록이 없으면 근황과 수업 난이도를 묻는 질문을 쓸 것
                - 번호 목록만 출력 (머리말·꼬리말·설명 없이)""".formatted(weekCount, summary);
    }

    @SuppressWarnings("unchecked")
    static String textOf(Map<?, ?> res) {
        if (res == null || !(res.get("candidates") instanceof List<?> c) || c.isEmpty()) return "";
        if (!(c.get(0) instanceof Map<?, ?> cand) || !(cand.get("content") instanceof Map<?, ?> content)
                || !(content.get("parts") instanceof List<?> parts)) return "";
        StringBuilder sb = new StringBuilder();
        for (Object p : parts) if (p instanceof Map<?, ?> m && m.get("text") instanceof String t) sb.append(t);
        return sb.toString();
    }
}
