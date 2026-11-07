package com.tutorax.backend;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Clock;
import java.util.Base64;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/** 관리자 세션 토큰: base64url(만료 epoch초) + "." + base64url(HMAC-SHA256). parent_session과 같은 꼴. */
public final class AdminSession {
    static final String COOKIE = "admin_session";
    static final long TTL_SECONDS = 12 * 3600;
    private static final Base64.Encoder ENC = Base64.getUrlEncoder().withoutPadding();
    private final byte[] secret;
    private final Clock clock;

    public AdminSession(String secret, Clock clock) {
        this.secret = secret.getBytes(StandardCharsets.UTF_8);
        this.clock = clock;
    }

    public boolean configured() {
        return secret.length >= 32; // 너무 짧은 비밀값은 설정 안 된 것으로 본다
    }

    public String issue() {
        String body = ENC.encodeToString(String.valueOf(clock.instant().getEpochSecond() + TTL_SECONDS)
                .getBytes(StandardCharsets.UTF_8));
        return body + "." + sign(body);
    }

    public boolean valid(String token) {
        if (token == null) return false;
        int dot = token.indexOf('.');
        if (dot <= 0) return false;
        String body = token.substring(0, dot);
        if (!MessageDigest.isEqual(sign(body).getBytes(StandardCharsets.UTF_8),
                token.substring(dot + 1).getBytes(StandardCharsets.UTF_8))) return false;
        try {
            long exp = Long.parseLong(new String(Base64.getUrlDecoder().decode(body), StandardCharsets.UTF_8));
            return clock.instant().getEpochSecond() < exp;
        } catch (IllegalArgumentException e) {
            return false;
        }
    }

    private String sign(String body) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec(secret, "HmacSHA256"));
            return ENC.encodeToString(mac.doFinal(body.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }
}
