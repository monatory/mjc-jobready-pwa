// 공통 헤더 + STEP 인디케이터 — MJC-CAT 패밀리룩
interface Props {
  step?: 1 | 2 | 3;
  stepName?: string;
  resultMode?: boolean;
}

const STEP_NAMES: Record<number, string> = {
  1: "검사 소개",
  2: "기본 정보·설문",
  3: "진로준비 진단",
};

export default function AppHeader({ step, stepName, resultMode }: Props) {
  return (
    <header className="app-header">
      <div className="app-header__inner">
        <div className="app-header__brand">
          <span className="app-header__logo">MJC</span>
          <div className="app-header__titles">
            <strong>명지전문대학</strong>
            <span>학생지원처 취·창업팀</span>
          </div>
        </div>
        {resultMode ? (
          <div className="step-indicator step-indicator--done">진단 완료 · 결과지</div>
        ) : step ? (
          <div className="step-indicator">
            STEP {step} / 3 · {stepName ?? STEP_NAMES[step]}
          </div>
        ) : null}
      </div>
      {step && !resultMode && (
        <div className="step-bar">
          <div className="step-bar__fill" style={{ width: `${(step / 3) * 100}%` }} />
        </div>
      )}
    </header>
  );
}
