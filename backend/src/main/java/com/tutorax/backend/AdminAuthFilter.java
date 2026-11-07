package com.tutorax.backend;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.time.Clock;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/** /api/admin/** 는 admin_session 쿠키를 확인한다. 로그인(/api/admin/session)만 예외. 설정이 비면 전부 503(fail closed). */
@Component
public class AdminAuthFilter extends OncePerRequestFilter {
    private final AdminSession session;
    private final boolean passwordSet;

    public AdminAuthFilter(@Value("${tutorax.admin-password:}") String password,
                           @Value("${tutorax.session-secret:}") String secret) {
        this(password, new AdminSession(secret, Clock.systemUTC()));
    }

    AdminAuthFilter(String password, AdminSession session) {
        this.passwordSet = !password.isEmpty();
        this.session = session;
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return !request.getRequestURI().startsWith("/api/admin/");
    }

    @Override
    protected void doFilterInternal(HttpServletRequest req, HttpServletResponse res, FilterChain chain)
            throws ServletException, IOException {
        if (!passwordSet || !session.configured()) {
            reject(res, 503, "admin_auth_not_configured");
            return;
        }
        if (req.getRequestURI().equals("/api/admin/session") || session.valid(cookie(req))) {
            chain.doFilter(req, res);
            return;
        }
        reject(res, 401, "unauthorized");
    }

    private static String cookie(HttpServletRequest req) {
        if (req.getCookies() == null) return null;
        for (Cookie c : req.getCookies()) if (AdminSession.COOKIE.equals(c.getName())) return c.getValue();
        return null;
    }

    static void reject(HttpServletResponse res, int status, String error) throws IOException {
        res.setStatus(status);
        res.setContentType("application/json");
        res.getWriter().write("{\"error\":\"" + error + "\"}");
    }
}
