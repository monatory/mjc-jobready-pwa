// 결과지 — Level·JAS 게이지·영역점수·보완영역·추천활동·상담 연결 (계획서 §5-2)
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import AppHeader from "../components/AppHeader";
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
} from "../lib/dataLoader";
import { getProfile, getSurvey, getDiag, clearAll } from "../lib/sessionState";

const rules = levelRules as unknown as {
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
  const tone = score >= 70 ? "#1a7f37" : score >= 40 ? "#b26a00" : "#8a8f98";
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

  const hasData = Object.keys(survey).length > 0 && Object.keys(diag).length > 0;

  const evalResult = useMemo(() => {
    if (!hasData) return null;
    return evaluate(survey, diag, { surveyItems, diagnosticBank, levelRules });
  }, [hasData, survey, diag]);

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

  const weak = findWeakAreas(r.domainScores, diagnosticBank, rules.weak_area);
  const recs = resolveRecommendations(r.level, weak, recommendationMaster, {
    today: new Date().toISOString().slice(0, 10),
  });

  return (
    <div className="page">
      <AppHeader resultMode />
      <main className="container">
        <section className={`card level-card level-card--l${r.level}`}>
          <p className="level-card__route">{isNonEmployment ? "진학·창업 Route" : "취업준비 Route"}</p>
          <h1 className="level-card__title">{tpl.title}</h1>
          <p className="level-card__headline">{tpl.headline}</p>
          <p className="level-card__body">{tpl.body}</p>
          {profile && (
            <p className="level-card__who">
              {profile.name} ({profile.dept} {profile.grade}학년)
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
          <button
            className="btn btn--primary btn--block"
            onClick={() => window.alert("시범운영: 상담 신청은 잡카페 방문 또는 센터 연락처로 접수해 주세요.")}
          >
            잡카페 상담 신청하기
          </button>
        </section>

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

        <footer className="legal">{templates.legal_footer}</footer>
      </main>
    </div>
  );
}
