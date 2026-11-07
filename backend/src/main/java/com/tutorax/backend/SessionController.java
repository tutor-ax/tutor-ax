package com.tutorax.backend;

import jakarta.servlet.http.HttpServletRequest;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Clock;
import java.time.Duration;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpHeaders;
import org.springframework.http.ResponseCookie;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/** 관리자 로그인/로그아웃. 비밀번호는 로그인 때 한 번만 받고, 이후는 HttpOnly 쿠키로 확인한다. */
@RestController
public class SessionController {
    static final int MAX_FAILURES = 5;
    static final Duration LOCK = Duration.ofMinutes(10);
    private final byte[] password;
    private final AdminSession session;
    private final Clock clock;
    // shortcut: 실패 횟수를 작업(컨테이너)마다 메모리에 센다 — ECS 작업 2개면 잠금까지 최대 2배 시도 가능. 필요해지면 DynamoDB로.
    // Vercel rewrite를 거치면 IP가 Vercel 출구 주소로 보여 여러 사용자가 같은 잠금을 공유할 수 있다.
    private final Map<String, long[]> failures = new ConcurrentHashMap<>(); // ip → [횟수, 잠금 해제 epoch초]

    @Autowired
    public SessionController(@Value("${tutorax.admin-password:}") String password,
                             @Value("${tutorax.session-secret:}") String secret) {
        this(password, new AdminSession(secret, Clock.systemUTC()), Clock.systemUTC());
    }

    SessionController(String password, AdminSession session, Clock clock) {
        this.password = password.getBytes(StandardCharsets.UTF_8);
        this.session = session;
        this.clock = clock;
    }

    record Login(String password) {}

    @PostMapping("/api/admin/session")
    public ResponseEntity<String> login(@RequestBody Login body, HttpServletRequest req) {
        String ip = req.getRemoteAddr();
        long now = clock.instant().getEpochSecond();
        long[] f = failures.get(ip);
        if (f != null && f[1] > now) return error(429, "too_many_attempts");
        String given = body == null || body.password() == null ? "" : body.password();
        if (!MessageDigest.isEqual(password, given.getBytes(StandardCharsets.UTF_8))) {
            failures.compute(ip, (k, v) -> {
                long n = (v == null || v[1] > 0 && v[1] <= now ? 0 : v[0]) + 1;
                return new long[] {n, n >= MAX_FAILURES ? now + LOCK.toSeconds() : 0};
            });
            return error(401, "unauthorized");
        }
        failures.remove(ip);
        return ResponseEntity.noContent().header(HttpHeaders.SET_COOKIE, cookie(session.issue(), AdminSession.TTL_SECONDS)).build();
    }

    @DeleteMapping("/api/admin/session")
    public ResponseEntity<Void> logout() {
        return ResponseEntity.noContent().header(HttpHeaders.SET_COOKIE, cookie("", 0)).build();
    }

    private static String cookie(String value, long maxAge) {
        // Secure: 브라우저는 127.0.0.1/localhost를 보안 출처로 봐서 개발 중에도 동작한다
        return ResponseCookie.from(AdminSession.COOKIE, value).httpOnly(true).secure(true).sameSite("Strict")
                .path("/api/admin").maxAge(maxAge).build().toString();
    }

    private static ResponseEntity<String> error(int status, String code) {
        return ResponseEntity.status(status).header(HttpHeaders.CONTENT_TYPE, "application/json")
                .body("{\"error\":\"" + code + "\"}");
    }
}
