// STEP 3 — 보조 진단 27문항 (5점 척도, 화면당 1문항 자동 진행)
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppHeader from "../components/AppHeader";
import { diagItems, diagScale, domainLabels } from "../lib/dataLoader";
import { getSurvey, getDiag, setDiag } from "../lib/sessionState";

export default function Diagnostic() {
  const navigate = useNavigate();
  if (Object.keys(getSurvey()).length === 0) {
    navigate("/survey", { replace: true }); // 설문 없이 진입 시 STEP 2로 (진입 가드)
  }

  const [answers, setAnswers] = useState<Record<string, number>>(getDiag());
  const firstUnanswered = useMemo(
    () => diagItems.findIndex((q) => !answers[q.id]),
    [answers]
  );
  const [cursor, setCursor] = useState(firstUnanswered === -1 ? diagItems.length - 1 : firstUnanswered);

  const q = diagItems[cursor];
  const answeredCount = diagItems.filter((it) => answers[it.id]).length;
  const allDone = answeredCount === diagItems.length;

  const pick = (value: number) => {
    const next = { ...answers, [q.id]: value };
    setAnswers(next);
    setDiag(next);
    // 500ms 후 다음 미응답 문항으로 자동 진행 (MJC-CAT 패턴)
    window.setTimeout(() => {
      const nextIdx = diagItems.findIndex((it, i) => i > cursor && !next[it.id]);
      const fallback = diagItems.findIndex((it) => !next[it.id]);
      if (nextIdx !== -1) setCursor(nextIdx);
      else if (fallback !== -1) setCursor(fallback);
    }, 350);
  };

  const submit = () => {
    setDiag(answers);
    navigate("/result");
  };

  return (
    <div className="page">
      <AppHeader step={3} />
      <main className="container">
        <div className="diag-progress">
          <div className="diag-progress__bar">
            <div
              className="diag-progress__fill"
              style={{ width: `${(answeredCount / diagItems.length) * 100}%` }}
            />
          </div>
          <span className="diag-progress__text">
            응답 {answeredCount} / {diagItems.length}
          </span>
        </div>

        <section className="card q-card">
          <span className="domain-badge">{domainLabels[q.domain]}</span>
          <p className="q-card__text">
            <span className="q-num">{cursor + 1}</span> {q.text}
          </p>
          <div className="scale-row">
            {diagScale.map((s) => (
              <button
                key={s.value}
                type="button"
                className={`scale ${answers[q.id] === s.value ? "scale--on" : ""}`}
                onClick={() => pick(s.value)}
              >
                <strong>{s.value}</strong>
                <span>{s.label}</span>
              </button>
            ))}
          </div>
        </section>

        <div className="actions">
          <button
            className="btn btn--ghost"
            disabled={cursor === 0}
            onClick={() => setCursor((c) => Math.max(0, c - 1))}
          >
            ← 이전 문항
          </button>
          {allDone ? (
            <button className="btn btn--primary btn--glow" onClick={submit}>
              진단 완료 · 결과 보기 →
            </button>
          ) : (
            <button
              className="btn btn--ghost"
              disabled={cursor >= diagItems.length - 1}
              onClick={() => setCursor((c) => Math.min(diagItems.length - 1, c + 1))}
            >
              다음 문항 →
            </button>
          )}
        </div>
      </main>
    </div>
  );
}
