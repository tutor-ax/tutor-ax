package com.tutorax.backend;

import static org.junit.jupiter.api.Assertions.*;

import java.util.HashMap;
import java.util.Map;
import org.junit.jupiter.api.Test;

class SecretLoadingTest {
    @Test
    void appliesNonEmptyValuesAsSystemPropertiesAndSkipsEmptyOnes() {
        System.clearProperty("TUTORAX_T_SET");
        System.clearProperty("TUTORAX_T_EMPTY");
        Map<String, Object> m = new HashMap<>();
        m.put("TUTORAX_T_SET", "v");
        m.put("TUTORAX_T_EMPTY", "");
        BackendApplication.apply(m);
        assertEquals("v", System.getProperty("TUTORAX_T_SET"));
        assertNull(System.getProperty("TUTORAX_T_EMPTY"));
    }

    @Test
    void doesNothingWithoutSecretId() {
        BackendApplication.loadSecret(null); // AWS 호출 없이 끝나야 한다(로컬 실행 경로)
        BackendApplication.loadSecret(" ");
    }
}
