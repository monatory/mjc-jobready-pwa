// STEP 1 — 검사 소개 + 정보열람 동의 (Consent는 점수화 제외, 계획서 §3-2·§7)
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppHeader from "../components/AppHeader";
import { getResumeState, setConsent, getConsent, clearAll } from "../lib/sessionState";

export default function Start() {
  const navigate = useNavigate();
  const [agreed, setAgreed] = useState(getConsent());
  const [resume, setResume] = useState<"SURVEY" | "DIAG" | "RESULT" | null>(null);

  useEffect(() => {
    const state = getResumeState();
    if (state !== "NONE") setResume(state);
  }, []);

  const goNext = () => {
    setConsent(true);
    navigate("/survey");
  };

  const continueTo = () => {
    if (resume === "SURVEY") navigate("/survey");
    else if (resume === "DIAG") navigate("/diagnostic");
    else navigate("/result");
  };

  return (
    <div className="page">
      <AppHeader step={1} />
      <main className="container">
        <section className="hero card">
          <p className="hero__eyebrow">진로·취업 상태진단</p>
          <h1 className="hero__title">
            MJC-<span className="accent">READY</span>
          </h1>
          <p className="hero__sub">
            나의 진로·취업 준비 상태를 확인하고,
            <br />
            지금 필요한 지원을 바로 연결받는 진단 서비스
          </p>
          <div className="stat-row">
            <div className="stat">
              <strong>6</strong>
              <span>기본 설문</span>
            </div>
            <div className="stat">
              <strong>27</strong>
              <span>진단 문항</span>
            </div>
            <div className="stat">
              <strong>4</strong>
              <span>준비 단계</span>
            </div>
            <div className="stat">
              <strong>5분</strong>
              <span>소요 시간</span>
            </div>
          </div>
        </section>

        <section className="card">
          <h2 className="card__title">이렇게 진행돼요</h2>
          <ol className="flow-list">
            <li>
              <strong>STEP 2 · 기본 정보와 설문</strong> — 진로 방향·취업 준비 상태를 묻는 짧은 설문
            </li>
            <li>
              <strong>STEP 3 · 진로준비 진단</strong> — 27문항으로 지금 나의 준비 영역 확인
            </li>
            <li>
              <strong>결과지</strong> — 현재 단계(Level)·보완영역·추천 활동·상담 연결 안내
            </li>
          </ol>
        </section>

        <section className="card">
          <h2 className="card__title">안내사항</h2>
          <ul className="notice-list">
            <li>정답은 없습니다. 지금 상태 그대로 답해 주세요.</li>
            <li>결과는 취업지원을 위한 참고자료이며, 학생의 선택을 제한하지 않습니다.</li>
            <li>입력한 정보는 진로·취업 상담과 맞춤형 프로그램 안내에만 사용됩니다.</li>
          </ul>
          <label className="agree">
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
            <span>
              안내사항을 확인했으며, 진단 결과와 입력 정보를 진로·취업 상담 목적으로 열람하는 것에
              동의합니다. <em>(동의 여부는 진단 점수에 영향을 주지 않습니다)</em>
            </span>
          </label>
          <button className="btn btn--primary btn--block" disabled={!agreed} onClick={goNext}>
            다음: 기본 정보 입력 →
          </button>
          <p className="pilot-note">
            시범운영 프로토타입 — 입력 정보는 이 브라우저에만 저장되며 서버로 전송되지 않습니다.
          </p>
        </section>
        <p className="footer-admin">
          <a href="#/admin">관리자</a>
        </p>
      </main>

      {resume && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal card">
            <h3>진행 중이던 진단이 있습니다</h3>
            <p>이어서 진행할까요, 처음부터 다시 시작할까요?</p>
            <div className="modal__actions">
              <button className="btn btn--primary" onClick={continueTo}>
                이어서 진행
              </button>
              <button
                className="btn btn--ghost"
                onClick={() => {
                  clearAll();
                  setAgreed(false);
                  setResume(null);
                }}
              >
                처음부터 다시
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
