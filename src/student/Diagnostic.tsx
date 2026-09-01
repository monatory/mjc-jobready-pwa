// STEP 3 — 보조 진단 27문항 (5점 척도, 화면당 1문항 자동 진행)
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppHeader from "../components/AppHeader";
import { diagItems, diagScale, domainLabels } from "../lib/dataLoader";
import { getSurvey, getDiag, setDiag } from "../lib/sessionState";

export default function Diagnostic() {
  const navigate = useNavigate();
  const hasSurvey = Object.keys(getSurvey()).length > 0;
  useEffect(() => {
    // 설문 없이 진입 시 STEP 2로 (진입 가드) — 렌더 중 navigate 호출 금지(React 경고 방지)
    if (!hasSurvey) navigate("/survey", { replace: true });
  }, [hasSurvey, navigate]);

  const [answers, setAnswers] = useState<Record<string, number>>(getDiag());
  const firstUnanswered = useMemo(
    () => diagItems.findIndex((q) => !answers[q.id]),
    [answers]
  );
  const [cursor, setCursor] = useState(firstUnanswered === -1 ? diagItems.length - 1 : firstUnanswered);

  const q = diagItems[cursor];
  const answeredCount = diagItems.filter((it) => answers[it.id]).length;
  const allDone = answeredCount === diagItems.length;

  // 자동 진행 타이머 — 학생이 "이전/다음"을 눌러 이동하면 취소한다.
  // 취소 없이는 검토하러 돌아간 화면을 350ms 뒤 타이머가 강제로 앞으로 밀었다 (감사 S2-08)
  const autoTimer = useRef<number | null>(null);
  const cancelAuto = () => {
    if (autoTimer.current != null) {
      window.clearTimeout(autoTimer.current);
      autoTimer.current = null;
    }
  };
  useEffect(() => cancelAuto, []); // 언마운트 시 잔여 타이머 정리
  const goto = (i: number) => {
    cancelAuto();
    setCursor(i);
  };

  const pick = (value: number) => {
    const next = { ...answers, [q.id]: value };
    setAnswers(next);
    setDiag(next);
    // 350ms 후 다음 미응답 문항으로 자동 진행 (MJC-CAT 패턴)
    cancelAuto();
    autoTimer.current = window.setTimeout(() => {
      autoTimer.current = null;
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
          <button className="btn btn--ghost" disabled={cursor === 0} onClick={() => goto(Math.max(0, cursor - 1))}>
            ← 이전 문항
          </button>
          {/* 완료 후에도 마지막 문항이 아니면 앞으로 이동 가능 — 검토하러 돌아갔다가 갇히던 문제 수정 (감사 S2-07) */}
          {cursor < diagItems.length - 1 && (
            <button className="btn btn--ghost" onClick={() => goto(Math.min(diagItems.length - 1, cursor + 1))}>
              다음 문항 →
            </button>
          )}
          {allDone && (
            <button className="btn btn--primary btn--glow" onClick={submit}>
              진단 완료 · 결과 보기 →
            </button>
          )}
        </div>
      </main>
    </div>
  );
}
