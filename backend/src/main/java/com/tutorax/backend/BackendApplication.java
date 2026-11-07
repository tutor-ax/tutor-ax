package com.tutorax.backend;

import java.util.Map;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.json.JsonParserFactory;
import software.amazon.awssdk.http.urlconnection.UrlConnectionHttpClient;
import software.amazon.awssdk.services.secretsmanager.SecretsManagerClient;

@SpringBootApplication
public class BackendApplication {

	public static void main(String[] args) {
		loadSecret(System.getenv("APP_SECRET_ID"));
		SpringApplication.run(BackendApplication.class, args);
	}

	/**
	 * Lambda: APP_SECRET_ID(Secrets Manager JSON)의 키를 시스템 속성으로 올린다 → ${DB_URL} 같은 자리표시자가 그대로 읽는다.
	 * 로컬: APP_SECRET_ID가 없으면 아무것도 안 하고 .env.local 환경변수를 쓴다.
	 * SnapStart는 초기화가 끝난 뒤 스냅샷을 찍으므로 비밀값을 읽는 건 함수 버전을 게시할 때 한 번이다.
	 */
	static void loadSecret(String secretId) {
		if (secretId == null || secretId.isBlank()) return;
		try (var client = SecretsManagerClient.builder().httpClient(UrlConnectionHttpClient.create()).build()) {
			String json = client.getSecretValue(r -> r.secretId(secretId)).secretString();
			apply(JsonParserFactory.getJsonParser().parseMap(json));
		}
	}

	static void apply(Map<String, Object> values) {
		values.forEach((k, v) -> {
			if (v != null && !String.valueOf(v).isEmpty()) System.setProperty(k, String.valueOf(v));
		});
	}
}
