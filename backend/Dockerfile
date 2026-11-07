# 빌드와 실행을 나눈다. 비밀값(DB_*, ADMIN_*, GEMINI_API_KEY)은 이미지에 넣지 않고 실행 환경변수로만 준다.
FROM eclipse-temurin:21-jdk AS build
WORKDIR /app
COPY .mvn .mvn
COPY mvnw pom.xml ./
RUN ./mvnw -q dependency:go-offline
COPY src src
RUN ./mvnw -q package -DskipTests

FROM eclipse-temurin:21-jre
WORKDIR /app
RUN useradd --system --uid 10001 app
COPY --from=build /app/target/backend-*.jar app.jar
USER app
EXPOSE 8080
# 헬스체크는 배포 플랫폼의 HTTP 점검으로 /api/health 를 본다(실행 이미지에 curl이 있다고 가정하지 않음)
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
