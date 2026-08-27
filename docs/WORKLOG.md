# MJC-READY 작업 일지 (WORKLOG)

> 세션 단위 작업 기록. 최신이 위. 상세 명세는 루트 `CLAUDE.md`(살아있는 명세)가 진실 기준이며,
> 이 파일은 "언제 무엇을 왜 했는지"의 시간순 이력만 담는다.

---

## 2026-08-27 — 프로젝트 발족 → 첫 커밋 (52d73a6)

하루에 기획부터 실동 프로토타입까지. 선행 프로젝트 MJC-CAT(자유전공 학과추천 PWA)의
형식·검증 자산을 재사용하되, **별개의 신규 독립 시스템**으로 구축(기존 시스템 무변경).

### 1) 기획·공식 문서

| 산출물 | 내용 |
|---|---|
| `CLAUDE.md` | 개발 기획서 v0.2 = 살아있는 명세. Read-Only 영역, 배점표, Level 규칙, Firestore 모델, 확정 체크리스트 13건 |
| `docs/MJC_..._개발제안서_v0.2.docx` | 계획안 v0.1 검토 → 수정·보완 12건 제안(명칭·버전 2 / 인증·보안 3 / 데이터·기능 4 / 개발 방식 3). 센터 표준 서식 |
| `docs/MJC_..._개발계획서_v0.2.docx` | v0.1 + 제안 반영 통합 계획서 10개 섹션(결재·공유용). 센터 표준 서식 |
| `docs/source/..._v0.1.docx` | 사용자 최초 계획안 원본 보존 |

### 2) STEP 1 설계 확정 산출물 (데이터 소스 6종, `data/`)

- `survey_items.json` — 기본 설문 6항목 배점표(JAS 만점 100) + 비점수 항목 + 자격증 입력 구조
- `level_rules.json` — Level 1~4 규칙: JAS 컷오프 70, 취업/희망시기 Gate, L4 실전신호, Route Tag, 상담 연계
- `diagnostic_bank.json` — 보조 진단문항 **27개 초안**(6영역 × DNA 속성). 전문가 검토 대기
- `recommendation_master.json` — 추천활동 10종 시드 (활동명·기간 센터 확정 대기)
- `result_templates.json` — Level 1~4 + 진학·창업 Route 결과 문구 템플릿
- `excel_columns.json` — Excel 5개 Sheet 컬럼 정의 (자격증 Long Format)

### 3) 판정 엔진 + 품질 게이트

- `lib/level_engine.js` — JAS·JRS·CDS 산출 + Gate 평가 + Level 판정 + 판정근거. **결정론**(동일 입력=동일 출력)
- `lib/weak_area.js` · `lib/recommendation_resolver.js` — 보완영역 추출 · Master 조회(취약 매칭 우선 정렬)
- `scripts/validate-data.mjs` — 데이터 무결성 **53건** (배점 합계·참조 무결성·템플릿·Excel 정의)
- `tests/test_level_engine.js` — 회귀 **15건** (96점 예시→L3, 실전신호→L4, 경계값 68/73, timing Gate, 비취업 Route 승급 금지, 결정론)

### 4) 학생 화면 (Vite + React + TS, MJC-CAT 패밀리룩, dev 포트 5174)

```
STEP 1 소개·동의(이어서 진행 모달) → STEP 2 기본정보·설문 → STEP 3 진단 27문항(자동 진행)
→ 결과지(Level 카드·JAS 게이지·영역바·보완영역·추천활동·상담 CTA·인쇄)
```
브라우저 실동 검증: L4 시나리오 클릭 통과, 콘솔 에러 0, `npm run build`(strict tsc) 통과.

### 5) 관리자 대시보드 (`#/admin`, 미리보기 모드)

- 가상 학생 40명을 **실제 엔진으로 판정**(시드 고정)한 mock 데이터
- 4개 섹션: 종합 현황(KPI·Level 분포·학과별) / 대상자 필터·명단(프리셋 6종 + 학생 상세 모달) /
  추천활동 관리(ON/OFF) / 데이터 다운로드(Sheet 5종 CSV, UTF-8 BOM)
- Firestore 연동 시 데이터 소스만 교체하는 구조

### 6) 발견·결정 사항

- **level1_fallback 도달 불가**: 취업 선택 시 JAS 최소 33이라 "JAS<30 → L1" 미발동.
  취업 방향 학생의 최저 Level=2가 의도인지 확인 필요 → 체크리스트 13번 등록
- 추천활동 시드 활성기간을 9/1 → 8/1로 앞당김(오늘 기준 기간 필터에 전부 걸리는 문제)
- 시범 단계는 **서버 전송 없음**(sessionStorage만). Firestore·인증은 체크리스트 10·11 확정 후

### 다음 할 일

- [ ] 센터 검토: 설문·진단 문항 문구, Level 컷오프 체감, 추천활동 목록, Excel 컬럼 (→ 수정 목록화)
- [ ] 확정 체크리스트 §12 (00~13) 순차 확정
- [ ] STEP 3: Firebase 프로젝트 + Firestore 저장 + Security Rules (인증 방식 확정 후)
- [ ] PWA manifest + service worker (본격 배포 전)
- [ ] GitHub 원격 저장소 연결 + CI(validate:data → test → build) 게이트
