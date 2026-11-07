package com.tutorax.backend;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * /api/admin/** 는 관리자 비밀번호(X-Admin-Password)를 확인한다. score-system admin-api와 같은 방식.
 * shortcut: 요청마다 비밀번호를 보내는 방식, 쓰기 경로(운영 전환 4단계) 전에 세션 토큰으로 바꿀 것.
 */
@Component
public class AdminAuthFilter extends OncePerRequestFilter {
    static final String HEADER = "X-Admin-Password";
    private final byte[] expected;

    public AdminAuthFilter(@Value("${tutorax.admin-password:}") String password) {
        this.expected = password.getBytes(StandardCharsets.UTF_8);
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return !request.getRequestURI().startsWith("/api/admin/");
    }

    @Override
    protected void doFilterInternal(HttpServletRequest req, HttpServletResponse res, FilterChain chain)
            throws ServletException, IOException {
        if (expected.length == 0) {
            reject(res, 503, "admin_password_not_set");
            return;
        }
        String given = req.getHeader(HEADER);
        if (given == null || !MessageDigest.isEqual(expected, given.getBytes(StandardCharsets.UTF_8))) {
            reject(res, 401, "unauthorized");
            return;
        }
        chain.doFilter(req, res);
    }

    private static void reject(HttpServletResponse res, int status, String error) throws IOException {
        res.setStatus(status);
        res.setContentType("application/json");
        res.getWriter().write("{\"error\":\"" + error + "\"}");
    }
}
