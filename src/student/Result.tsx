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
  recommendationMaster,
  resultTemplates,
  domainLabels,
  diagItems,
} from "../lib/dataLoader";
import { getProfile, getSurvey, getDiag, clearAll } from "../lib/sessionState";
import { todayStr } from "../lib/dates";

const rules = levelRules as unknown as {
  jas_cutoff_level3: number;
  weak_area: { threshold: number; max_count: number };
};
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
  const profile = getProfile();
  const survey = getSurvey();
  const diag = getDiag();

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

  // 보완영역·추천활동 — 결과 표시와 제출 스냅샷(추천 코드)이 같은 계산을 공유
  const analysis = useMemo(() => {
    if (!evalResult) return null;
    const weak = findWeakAreas(evalResult.domainScores, diagnosticBank, rules.weak_area);
    const recs = resolveRecommendations(evalResult.level, weak, recommendationMaster, { today: todayStr() });
    return { weak, recs };
  }, [evalResult]);

  const payload = useMemo<ResponsePayload | null>(() => {
    if (!hasData || !evalResult || !analysis || !profile) return null;
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
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasData, evalResult, analysis]);
  const serialized = useMemo(() => (payload ? JSON.stringify(payload) : ""), [payload]);
  const [submitState, setSubmitState] = useState<"OFF" | "SAVING" | "DONE" | "FAIL" | "NO_PROFILE">(
    CLOUD_ENABLED ? "SAVING" : "OFF"
  );
  const [retryTick, setRetryTick] = useState(0);
  useEffect(() => {
    if (!CLOUD_ENABLED) return;
    if (!payload) {
      // 학생 정보(profile)가 유실된 채 결과만 남은 경우 — "제출 중…" 영구 표시 방지 (감사 S2-11)
      if (hasData) setSubmitState("NO_PROFILE");
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
        setSubmitState(outcome === "OFF" ? "OFF" : "FAIL");
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serialized, retryTick]);

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

  const r = evalResult;
  const isNonEmployment = r.routeTag === "FURTHER_STUDY_STARTUP";
  const tpl = isNonEmployment
    ? templates.route_overrides.FURTHER_STUDY_STARTUP
    : templates.levels[String(r.level)];

  const { weak, recs } = analysis!; // hasData·evalResult 보장 구간

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
          <h1 className="level-card__title">{tpl.title}</h1>
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
          {survey.counsel_wish === "YES" && (
            <p className="cta-card__note">
              상담을 희망하셨어요 — 잡카페 {tpl.consultant.replace("잡카페 ", "")}가 입력하신 연락처로
              <strong> 먼저 연락드립니다.</strong> 따로 신청하지 않아도 괜찮아요.
            </p>
          )}
          <button
            className="btn btn--primary btn--block"
            onClick={() =>
              window.alert(
                "시범운영: 잡카페(본관 1층)에 바로 방문하셔도 되고, 상담 희망으로 응답하신 경우 컨설턴트가 먼저 연락드립니다."
              )
            }
          >
            잡카페 상담 신청하기
          </button>
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
        {submitState === "NO_PROFILE" && (
          <section className="card submit-fail">
            <strong>⚠ 학생 정보가 없어 제출할 수 없습니다</strong>
            <p>기본 정보(학번·성명)가 유실되었습니다. "다시 진단하기"로 처음부터 진행해 주세요.</p>
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

        <footer className="legal">
          {submitState === "DONE" && <>응답이 안전하게 제출되었습니다. </>}
          {submitState === "SAVING" && <>응답 제출 중… </>}
          {templates.legal_footer}
        </footer>
      </main>
    </div>
  );
}
