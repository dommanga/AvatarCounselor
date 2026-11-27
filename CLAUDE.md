# Rules for Claude Code in this repository

## Destructive operations (study1)
- 데이터 파기, DB 리셋, 슬롯 생성은 연구자만 실행한다. Claude Code는 plan 생성(`--plan`)과 dry-run(`--dry-run`)까지만 한다.
  - 대상: `npm run purge-withdrawn`, `npm run purge-audio`, `npm run db:reset`, `npm run gen-slots`, 그리고 `--execute` 또는 `--prod`가 붙은 모든 명령.
  - `.claude/settings.json`의 `permissions.deny`가 이를 막는다. 우회하지 않는다 (`node -e`로 lib 함수를 직접 호출하는 것 포함).
- Neon branch: `dev`는 연구자 리허설 전용이다. 자동 테스트(`npm run test:*`)는 `test` branch(`study1/.env.test`)에서만 돈다.
  테스트 스크립트는 그 외 DB에서 스스로 실행을 거부한다. 거부되면 `--host`나 환경변수로 돌파하지 말고 연구자에게 알린다.
- 테스트는 자기가 만든 세션만 건드린다. 공유 DB의 다른 세션을 지우거나 바꾸지 않는다.
