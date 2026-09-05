// 결과지 — Level·JAS 게이지·영역점수·보완영역·추천활동·상담 연결 (계획서 §5-2)
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppHeader from "../components/AppHeader";
import { saveResponseToCloud, type ResponsePayload } from "../lib/saveResponse";
import { CLOUD_ENABLED } from "../lib/firebase";
import { getUnscored, getCerts, gradeLabel } from "../lib/sessionState";
import { evaluate } from "../../lib/level_engine.js";
import { findWeakAreas } from "../../lib/weak_area.js";
import { resolveRecommendations } from "../../lib/recommendation_resolver.js";
import {
  surveyItems,
  diagnosticBank,
  levelRules,
  resultTemplates,
  domainLabels,
  diagItems,
} from "../lib/dataLoader";
import { getMasterSync, pullRecoMasterForStudent, type RecoActivity } from "../lib/recoMaster";
import { getProfile, getSurvey, getDiag, clearAll, getCounselRequest, setCounselRequest } from "../lib/sessionState";
import { todayStr } from "../lib/dates";

const rules = levelRules as unknown as {
  jas_cutoff_level3: number;
  weak_area: { threshold: number; max_count: number };
};
/** 앱 내장(인앱) 브라우저 판별 — 카카오톡·네이버·인스타그램·페이스북·라인. 인쇄 안내 문구 표시용 */
const IN_APP_BROWSER =
  typeof navigator !== "undefined" && /KAKAOTALK|NAVER\(inapp|Instagram|FBAN|FBAV|Line\//i.test(navigator.userAgent);

const templates = resultTemplates as unknown as {
  legal_footer: string;
  levels: Record<string, { title: string; headline: string; body: string; consultant: string }>;
  route_overrides: Record<string, { title: string; headline: string; body: string; consultant: string }>;
};

function JasGauge({ score }: { score: number }) {
  const angle = (score / 100) * 180;
  const rad = ((180 - angle) * Math.PI) / 180;
  const x = 100 + 80 * Math.cos(rad);
  const y = 95 - 80 * Math.sin(rad);
  const large = angle > 180 ? 1 : 0;
  // 초록 기준은 L3 컷오프(level_rules) — 70 하드코딩 금지 (§4)
  const tone = score >= rules.jas_cutoff_level3 ? "#1a7f37" : score >= 40 ? "#b26a00" : "#8a8f98";
  return (
    <svg viewBox="0 0 200 110" className="gauge" role="img" aria-label={`구직활성도 ${score}점`}>
      <path d="M 20 95 A 80 80 0 0 1 180 95" fill="none" stroke="#e6e9f0" strokeWidth="14" strokeLinecap="round" />
      {score > 0 && (
        <path
          d={`M 20 95 A 80 80 0 ${large} 1 ${x} ${y}`}
          fill="none"
          stroke={tone}
          strokeWidth="14"
          strokeLinecap="round"
        />
      )}
      <text x="100" y="78" textAnchor="middle" className="gauge__num">
        {score}
      </text>
      <text x="100" y="98" textAnchor="middle" className="gauge__unit">
        / 100점 · 구직활성도
      </text>
    </svg>
  );
}

export default function Result() {
  const navigate = useNavigate();
  // 세션 읽기는 **마운트 시 1회로 고정**한다. getSurvey/getDiag는 호출마다 JSON.parse로 새 객체를
  // 돌려주므로, 렌더마다 새 참조가 되면 evalResult→analysis→제출 effect가 연쇄로 매 렌더 재실행된다.
  // 그 상태에서 제출이 실패하면 FAIL↔SAVING을 오가며 **무한 재제출 루프**가 돌았다
  // (2026-09-02 전면 점검 STU-01). 재방문 시 재제출은 컴포넌트가 다시 마운트되며 그대로 동작한다.
  const profile = useMemo(() => getProfile(), []);
  const survey = useMemo(() => getSurvey(), []);
  const diag = useMemo(() => getDiag(), []);

  // 진단은 "전 문항 완주"여야 결과 — 일부만 응답한 상태로 URL 직접 진입 시 불완전 판정이
  // 정식 결과처럼 표시·제출되던 문제 수정 (감사 S2-03·ENG-07)
  const diagDone = diagItems.every((it) => diag[it.id]);
  const hasData = Object.keys(survey).length > 0 && diagDone;
  useEffect(() => {
    // 진단이 진행 중(1개 이상 응답, 미완주)이면 결과 대신 진단 화면으로 복귀
    if (!diagDone && Object.keys(diag).length > 0) navigate("/diagnostic", { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [diagDone]);

  const evalResult = useMemo(() => {
    if (!hasData) return null;
    return evaluate(survey, diag, { surveyItems, diagnosticBank, levelRules });
  }, [hasData, survey, diag]);

  // 응답 클라우드 제출 (설정 전에는 no-op) — 결과지 도달 시 자동 + 실패 시 수동 재시도 (2026-08-31)
  // "제출 완료" 판단은 플래그가 아니라 제출 성공 당시의 응답 스냅샷(JSON) 비교 —
  // 응답을 수정하고 결과지에 다시 오면 자동으로 재제출된다. 키는 sessionState.KEYS.uploaded와 동일.
  const SUBMIT_KEY = "mjc_ready_uploaded";

  // 추천활동 Master — 관리자가 등록·수정한 최신본(Firestore)을 우선 사용 (§4: 운영 중엔 Firestore가 진실).
  // 조회 실패·미설정 시 시드+로컬 캐시 병합본으로 계산 — 결과 표시를 막지 않는다.
  // master가 확정된 뒤에 추천·제출 스냅샷을 계산해 "시드로 1차 제출 → 최신본으로 재제출" 이중 쓰기를 피한다.
  const [recoMaster, setRecoMaster] = useState<{ activities: RecoActivity[] } | null>(
    CLOUD_ENABLED ? null : getMasterSync()
  );
  // 최신 목록을 못 받아 시드·캐시로 계산한 경우 표시 (조용한 폴백 금지 §7.2.1-3, 점검 [중간-2])
  const [recoStale, setRecoStale] = useState(false);
  useEffect(() => {
    if (!CLOUD_ENABLED) return;
    let cancelled = false;
    void pullRecoMasterForStudent().then((m) => {
      if (cancelled) return;
      setRecoMaster({ activities: m.activities });
      setRecoStale(m.stale);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // 보완영역·추천활동 — 결과 표시와 제출 스냅샷(추천 코드)이 같은 계산을 공유
  const analysis = useMemo(() => {
    if (!evalResult || !recoMaster) return null;
    const weak = findWeakAreas(evalResult.domainScores, diagnosticBank, rules.weak_area);
    const recs = resolveRecommendations(evalResult.level, weak, recoMaster, { today: todayStr() });
    return { weak, recs };
  }, [evalResult, recoMaster]);

  // 서버 규칙(validResponse: 학번 영숫자 4~20자, 성명 1~30자, docId=="{학기}_{학번}")에 맞지 않는
  // 프로필은 영구 403이라 재시도가 절대 성공하지 못한다. 제출을 시도하지 말고 NO_PROFILE 안내로
  // 보낸다 (점검 STU-03). 조건은 규칙·설문 화면과 동일하게 — 결과지에서 뒤로 가 학번을 잘못 고친
  // 뒤 "다음" 검증을 거치지 않고 돌아온 경우가 "네트워크 확인"으로 오안내되던 문제 (점검 S1).
  const profileOk = Boolean(
    profile &&
      /^[A-Za-z0-9]{4,20}$/.test(profile.student_id.trim()) &&
      profile.name.trim().length >= 1 &&
      profile.name.trim().length <= 30
  );
  const analysisReady = analysis !== null;

  // "잡카페 상담 신청하기" 클릭 기록 — 설문에서 상담 미희망이었어도 여기서 누르면 상담 희망으로 집계되는
  // 이중장치 (2026-09-05 사용자 요구). 배점 항목인 survey.counsel_wish는 바꾸지 않고 별도 필드로 저장 →
  // payload가 바뀌므로 아래 제출 effect가 자동으로 재제출한다.
  const [counselReq, setCounselReq] = useState(() => getCounselRequest());
  const requestCounsel = () => {
    if (!counselReq) setCounselReq(setCounselRequest());
    window.alert(
      counselReq
        ? "이미 상담을 신청하셨어요. 잡카페 컨설턴트가 입력하신 연락처로 연락드립니다. 바로 방문(본관 1층)하셔도 됩니다."
        : "상담 신청이 기록되었습니다. 잡카페 컨설턴트가 입력하신 연락처로 먼저 연락드립니다. 바로 방문(본관 1층)하셔도 됩니다."
    );
  };

  const payload = useMemo<ResponsePayload | null>(() => {
    if (!hasData || !evalResult || !analysis || !profile || !profileOk) return null;
    return {
      profile,
      survey,
      unscored: getUnscored(),
      certs: getCerts(),
      diag,
      result: {
        jas: evalResult.jas,
        jrs: evalResult.jrs ?? null,
        cds: evalResult.cds ?? null,
        level: evalResult.level,
        route_tag: evalResult.routeTag,
      },
      // 결과 시점 추천 스냅샷 — 활성기간이 지나도 관리자 화면·CSV에서 유지 (감사 P3-11)
      recommendations: analysis.recs.map((a) => a.recommendation_code),
      ...(counselReq ? { counsel_request: counselReq } : {}),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasData, evalResult, analysis, profileOk, counselReq]);
  const serialized = useMemo(() => (payload ? JSON.stringify(payload) : ""), [payload]);
  const [submitState, setSubmitState] = useState<"OFF" | "SAVING" | "DONE" | "FAIL" | "DENIED" | "NO_PROFILE">(
    CLOUD_ENABLED ? "SAVING" : "OFF"
  );
  const [retryTick, setRetryTick] = useState(0);
  useEffect(() => {
    if (!CLOUD_ENABLED) return;
    if (!payload) {
      // Master 조회 대기 중(analysis 미확정)에는 판단 보류 — 조회 완료 후 이 효과가 다시 돈다.
      // 학생 정보(profile)가 유실된 채 결과만 남은 경우 — "제출 중…" 영구 표시 방지 (감사 S2-11)
      if (hasData && analysis) setSubmitState("NO_PROFILE");
      return;
    }
    if (sessionStorage.getItem(SUBMIT_KEY) === serialized) {
      setSubmitState("DONE"); // 동일 내용은 이미 제출됨 — 재전송 생략
      return;
    }
    let cancelled = false;
    setSubmitState("SAVING");
    void saveResponseToCloud(payload).then((outcome) => {
      if (cancelled) return;
      if (outcome === "OK") {
        try {
          sessionStorage.setItem(SUBMIT_KEY, serialized);
        } catch {
          /* 스냅샷 기록 실패 — 다음 방문 시 재제출될 뿐 데이터 유실은 없음 */
        }
        setSubmitState("DONE");
      } else {
        setSubmitState(outcome === "OFF" ? "OFF" : outcome === "DENIED" ? "DENIED" : "FAIL");
      }
    });
    return () => {
      cancelled = true;
    };
    // Master 조회 완료 여부만 dep로 둔다 — analysis 객체를 그대로 넣으면 참조가 흔들릴 때
    // 실패 상태에서 재제출이 무한 반복된다 (점검 STU-01). 불리언은 한 번만 바뀐다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serialized, retryTick, analysisReady]);

  if (!hasData || !evalResult) {
    return (
      <div className="page">
        <AppHeader />
        <main className="container">
          <section className="card empty-card">
            <h2>아직 진단 결과가 없습니다</h2>
            <p>진단을 먼저 진행하면 이 화면에서 결과를 확인할 수 있어요.</p>
            <button className="btn btn--primary" onClick={() => navigate("/")}>
              진단 시작하기
            </button>
          </section>
        </main>
      </div>
    );
  }

  // 추천활동 Master 조회 대기 (클라우드 모드 첫 진입 순간) — 최신 추천 확정 전에는 결과를 그리지 않는다
  if (!analysis) {
    return (
      <div className="page">
        <AppHeader resultMode />
        <main className="container">
          <section className="card empty-card">
            <h2>결과를 준비하고 있어요…</h2>
            <p>추천 활동 정보를 불러오는 중입니다. 잠시만 기다려 주세요.</p>
          </section>
        </main>
      </div>
    );
  }

  const r = evalResult;
  const isNonEmployment = r.routeTag === "FURTHER_STUDY_STARTUP";
  const tpl = isNonEmployment
    ? templates.route_overrides.FURTHER_STUDY_STARTUP
    : templates.levels[String(r.level)];

  const { weak, recs } = analysis; // hasData·evalResult·analysis 보장 구간

  return (
    <div className="page">
      <AppHeader resultMode />
      <main className="container">
        {/* 인쇄 전용 머리글 — 화면 헤더는 인쇄에서 숨겨지므로 기관명·발급일을 별도 표기 */}
        <p className="print-head">
          명지전문대학 학생지원처 취·창업팀 · MJC-READY 진로·취업 상태진단 결과지 (발급일 {todayStr()})
        </p>
        <section className={`card level-card level-card--l${r.level}`}>
          <p className="level-card__route">{isNonEmployment ? "진학·창업 Route" : "취업준비 Route"}</p>
          {/* Level은 Route와 무관하게 항상 표기한다 — 진학·창업 Route는 Route 제목만 보여 "레벨이 안 나온다"고
              보였다 (2026-09-05 사용자 보고). Route 제목은 부제로 내려 함께 보여 준다. */}
          <h1 className="level-card__title">{templates.levels[String(r.level)].title}</h1>
          {isNonEmployment && <p className="level-card__subtitle">{tpl.title}</p>}
          <p className="level-card__headline">{tpl.headline}</p>
          <p className="level-card__body">{tpl.body}</p>
          {profile && (
            <p className="level-card__who">
              {profile.name} ({profile.dept} {gradeLabel(profile.grade)})
            </p>
          )}
        </section>

        <section className="card">
          <h2 className="card__title">구직활성도 (JAS)</h2>
          <JasGauge score={r.jas} />
          <div className="indices">
            <div className="index">
              <span>취업준비도 JRS</span>
              <strong>{r.jrs ?? "—"}</strong>
            </div>
            <div className="index">
              <span>진로발달도 CDS</span>
              <strong>{r.cds ?? "—"}</strong>
            </div>
          </div>
        </section>

        <section className="card">
          <h2 className="card__title">영역별 준비 상태</h2>
          <div className="domain-bars">
            {Object.entries(r.domainScores).map(([d, v]) => (
              <div className="domain-bar" key={d}>
                <span className="domain-bar__label">{domainLabels[d]}</span>
                <div className="domain-bar__track">
                  <div
                    className={`domain-bar__fill ${v != null && v < rules.weak_area.threshold ? "domain-bar__fill--low" : ""}`}
                    style={{ width: `${((v ?? 0) / 5) * 100}%` }}
                  />
                </div>
                <span className="domain-bar__val">{v?.toFixed(1) ?? "—"}</span>
              </div>
            ))}
          </div>
          {weak.length > 0 && (
            <p className="weak-note">
              보완영역: {weak.map((w) => `${w.label}(${w.score.toFixed(1)})`).join(" · ")}
            </p>
          )}
        </section>

        <section className="card">
          <h2 className="card__title">지금 추천하는 행동</h2>
          {recoStale && (
            <p className="muted small">
              ※ 추천 목록을 최신으로 불러오지 못해 기본 목록으로 안내하고 있어요. 상담 시 담당 컨설턴트가 현재
              운영 중인 프로그램을 다시 안내해 드립니다.
            </p>
          )}
          {recs.length === 0 && <p className="muted">현재 학기에 등록된 추천활동이 없습니다. 상담을 통해 안내받으세요.</p>}
          <ol className="rec-list">
            {recs.map((a) => (
              <li key={a.recommendation_code} className="rec">
                <div className="rec__head">
                  <strong>{a.name}</strong>
                  <span className={`owner-badge owner-badge--${a.owner.toLowerCase()}`}>
                    {a.owner === "CAREER" ? "진로컨설턴트" : "취업컨설턴트"}
                  </span>
                </div>
                <p>{a.student_desc}</p>
              </li>
            ))}
          </ol>
        </section>

        <section className={`card cta-card ${r.consultant === "EMPLOYMENT" ? "cta-card--emp" : ""}`}>
          <h2>{tpl.consultant} 상담 연결</h2>
          <p>
            {isNonEmployment
              ? "진학·창업 준비 계획을 진로컨설턴트와 함께 세워보세요."
              : r.level >= 3
                ? "취업 의지가 확인된 학생에게는 취업컨설턴트가 우선 연결됩니다."
                : "진로 방향 정리는 진로컨설턴트와의 상담이 가장 빠릅니다."}
          </p>
          {(survey.counsel_wish === "YES" || counselReq) && (
            <p className="cta-card__note">
              {counselReq && survey.counsel_wish !== "YES" ? "상담을 신청하셨어요" : "상담을 희망하셨어요"} — 잡카페{" "}
              {tpl.consultant.replace("잡카페 ", "")}가 입력하신 연락처로
              <strong> 먼저 연락드립니다.</strong> 따로 신청하지 않아도 괜찮아요.
            </p>
          )}
          {/* 설문에서 "지금은 괜찮다"고 했어도 이 버튼을 누르면 상담 희망으로 기록·제출된다 (이중장치, 2026-09-05) */}
          <button className="btn btn--primary btn--block" onClick={requestCounsel}>
            {counselReq ? "✓ 상담 신청됨 — 컨설턴트가 연락드려요" : "잡카페 상담 신청하기"}
          </button>
          {!counselReq && survey.counsel_wish !== "YES" && (
            <p className="muted small cta-card__hint">
              설문에서 상담이 급하지 않다고 답했더라도, 이 버튼을 누르면 상담 희망으로 기록되어 컨설턴트가 연락드립니다.
            </p>
          )}
        </section>

        {submitState === "FAIL" && (
          <section className="card submit-fail">
            <strong>⚠ 응답 제출에 실패했습니다</strong>
            <p>
              네트워크 상태를 확인한 뒤 다시 시도해 주세요. 제출이 완료되기 전에는 응답이 이 기기에만
              저장되어 있어, 이 화면을 닫으면 학교에 전달되지 않습니다.
            </p>
            <button className="btn btn--primary" onClick={() => setRetryTick((t) => t + 1)}>
              다시 제출하기
            </button>
          </section>
        )}
        {submitState === "DENIED" && (
          <section className="card submit-fail">
            <strong>⚠ 학교 시스템이 제출을 받지 않았습니다</strong>
            <p>
              네트워크 문제가 아니라 입력 내용이 제출 조건에 맞지 않을 때 나타납니다. 설문으로 돌아가
              학번(영문·숫자 4~20자)과 성명을 확인한 뒤 다시 결과를 확인해 주세요. 반복되면 잡카페(본관 1층)에
              문의해 주세요.
            </p>
            <div className="actions">
              <button className="btn btn--primary" onClick={() => navigate("/survey")}>
                설문으로 돌아가 확인하기
              </button>
              <button className="btn btn--ghost" onClick={() => setRetryTick((t) => t + 1)}>
                다시 제출하기
              </button>
            </div>
          </section>
        )}
        {submitState === "NO_PROFILE" && (
          <section className="card submit-fail">
            <strong>⚠ 학생 정보가 없거나 형식이 맞지 않아 제출할 수 없습니다</strong>
            <p>
              학번은 영문·숫자 4~20자, 성명은 1~30자여야 합니다. 설문으로 돌아가 기본 정보를 확인해 주세요.
              기본 정보가 아예 없다면 "다시 진단하기"로 처음부터 진행해 주세요.
            </p>
            <button className="btn btn--primary" onClick={() => navigate("/survey")}>
              설문으로 돌아가 확인하기
            </button>
          </section>
        )}

        <div className="actions">
          <button
            className="btn btn--ghost"
            onClick={() => {
              if (window.confirm("처음부터 다시 진단할까요? 지금 결과는 사라집니다.")) {
                clearAll();
                navigate("/");
              }
            }}
          >
            다시 진단하기
          </button>
          <button className="btn btn--ghost" onClick={() => window.print()}>
            결과지 인쇄·PDF 저장
          </button>
        </div>
        {/* 카카오톡·인스타그램 등 앱 내장 브라우저는 window.print()가 동작하지 않는 경우가 많다 (점검 S11) */}
        {IN_APP_BROWSER && (
          <p className="muted small cta-card__hint">
            ※ 카카오톡 등 앱 안에서 열었다면 인쇄·PDF 저장이 되지 않을 수 있어요. 화면 오른쪽 위 메뉴에서
            "다른 브라우저로 열기"를 눌러 크롬·사파리에서 저장해 주세요.
          </p>
        )}

        <footer className="legal">
          {submitState === "DONE" && <>응답이 안전하게 제출되었습니다. </>}
          {submitState === "SAVING" && <>응답 제출 중… </>}
          {/* 인쇄 CSS가 실패 배너를 숨기므로 푸터에도 남긴다 — PDF에 미제출 흔적이 없던 문제 (점검 S6) */}
          {(submitState === "FAIL" || submitState === "DENIED" || submitState === "NO_PROFILE") && (
            <strong>⚠ 이 응답은 아직 학교에 제출되지 않았습니다 — 화면에서 다시 제출해 주세요. </strong>
          )}
          {templates.legal_footer}
        </footer>
      </main>
    </div>
  );
}
