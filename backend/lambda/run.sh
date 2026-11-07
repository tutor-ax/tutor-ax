#!/bin/sh
# Lambda Web Adapter가 실행하는 시작 스크립트. 어댑터가 8080의 /api/health가 200이 될 때까지 기다린 뒤 요청을 넘긴다.
# TieredStopAtLevel=1: 짧게 사는 Lambda에서 JIT 최적화보다 빠른 기동이 낫다.
exec java -XX:+TieredCompilation -XX:TieredStopAtLevel=1 -jar "$LAMBDA_TASK_ROOT/app.jar"
