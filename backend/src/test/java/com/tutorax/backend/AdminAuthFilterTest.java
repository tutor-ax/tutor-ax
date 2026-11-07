package com.tutorax.backend;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

class AdminAuthFilterTest {
    private MockFilterChain run(String configured, String uri, String header, MockHttpServletResponse res) throws Exception {
        var req = new MockHttpServletRequest("GET", uri);
        if (header != null) req.addHeader(AdminAuthFilter.HEADER, header);
        var chain = new MockFilterChain();
        new AdminAuthFilter(configured).doFilter(req, res, chain);
        return chain;
    }

    @Test
    void closesAdminApiWhenPasswordIsNotConfigured() throws Exception {
        var res = new MockHttpServletResponse();
        assertNull(run("", "/api/admin/classes", "anything", res).getRequest());
        assertEquals(503, res.getStatus());
    }

    @Test
    void rejectsMissingOrWrongPassword() throws Exception {
        var res = new MockHttpServletResponse();
        assertNull(run("secret", "/api/admin/classes", null, res).getRequest());
        assertEquals(401, res.getStatus());
        res = new MockHttpServletResponse();
        assertNull(run("secret", "/api/admin/classes", "secreT", res).getRequest());
        assertEquals(401, res.getStatus());
    }

    @Test
    void passesCorrectPasswordAndLeavesNonAdminPathsOpen() throws Exception {
        assertNotNull(run("secret", "/api/admin/classes", "secret", new MockHttpServletResponse()).getRequest());
        assertNotNull(run("", "/api/health", null, new MockHttpServletResponse()).getRequest());
    }
}
