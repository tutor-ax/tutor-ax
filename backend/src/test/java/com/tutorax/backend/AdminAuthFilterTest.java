package com.tutorax.backend;

import static org.junit.jupiter.api.Assertions.*;

import jakarta.servlet.http.Cookie;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

class AdminAuthFilterTest {
    static final String SECRET = "0123456789abcdef0123456789abcdef";
    static Clock at(long epoch) { return Clock.fixed(Instant.ofEpochSecond(epoch), ZoneOffset.UTC); }

    private int run(AdminAuthFilter f, String uri, String token) throws Exception {
        var req = new MockHttpServletRequest("GET", uri);
        if (token != null) req.setCookies(new Cookie(AdminSession.COOKIE, token));
        var res = new MockHttpServletResponse();
        var chain = new MockFilterChain();
        f.doFilter(req, res, chain);
        return chain.getRequest() != null ? 200 : res.getStatus();
    }

    @Test
    void failsClosedWithoutPasswordOrStrongSecret() throws Exception {
        assertEquals(503, run(new AdminAuthFilter("", new AdminSession(SECRET, at(0))), "/api/admin/classes", null));
        assertEquals(503, run(new AdminAuthFilter("pw", new AdminSession("short", at(0))), "/api/admin/classes", null));
    }

    @Test
    void requiresValidUnexpiredSessionExceptForLogin() throws Exception {
        var s = new AdminSession(SECRET, at(1000));
        var f = new AdminAuthFilter("pw", s);
        String token = s.issue();
        assertEquals(401, run(f, "/api/admin/classes", null));
        assertEquals(200, run(f, "/api/admin/classes", token));
        assertEquals(401, run(f, "/api/admin/classes", token + "x"));
        assertEquals(401, run(f, "/api/admin/classes", new AdminSession(SECRET.replace('0', '1'), at(1000)).issue()));
        assertEquals(200, run(f, "/api/admin/session", null));
        assertEquals(200, run(f, "/api/health", null));
        var later = new AdminAuthFilter("pw", new AdminSession(SECRET, at(1000 + AdminSession.TTL_SECONDS + 1)));
        assertEquals(401, run(later, "/api/admin/classes", token));
    }

    @Test
    void loginSetsHttpOnlyCookieAndLocksAfterRepeatedFailures() {
        var clock = at(5000);
        var c = new SessionController("pw", new AdminSession(SECRET, clock), clock);
        var req = new MockHttpServletRequest();
        var ok = c.login(new SessionController.Login("pw"), req);
        assertEquals(204, ok.getStatusCode().value());
        String cookie = ok.getHeaders().getFirst("Set-Cookie");
        assertTrue(cookie.contains("HttpOnly") && cookie.contains("SameSite=Strict") && cookie.contains("Secure"));
        for (int i = 0; i < SessionController.MAX_FAILURES; i++)
            assertEquals(401, c.login(new SessionController.Login("no"), req).getStatusCode().value());
        assertEquals(429, c.login(new SessionController.Login("pw"), req).getStatusCode().value());
    }

    @Test
    void questionPromptCarriesOnlySummaryLines() {
        String p = QuestionsController.prompt(List.of("과제 완료율: 90% → 40% (최근 2주 급락)"), 4);
        assertTrue(p.contains("최근 4주차") && p.contains("- 과제 완료율: 90% → 40% (최근 2주 급락)"));
        assertEquals("1. 질문", QuestionsController.textOf(Map.of("candidates",
                List.of(Map.of("content", Map.of("parts", List.of(Map.of("text", "1. 질문")))))))) ;
        assertEquals("", QuestionsController.textOf(Map.of()));
        var noKey = new QuestionsController("").questions(new QuestionsController.Request(List.of(), 4));
        assertEquals(503, noKey.getStatusCode().value());
        var tooLong = new QuestionsController("k").questions(new QuestionsController.Request(List.of("x".repeat(201)), 4));
        assertEquals(400, tooLong.getStatusCode().value());
    }
}
