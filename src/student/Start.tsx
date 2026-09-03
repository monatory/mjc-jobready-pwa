// STEP 1 — 검사 소개 + 정보열람 동의 (Consent는 점수화 제외, 계획서 §3-2·§7)
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppHeader from "../components/AppHeader";
import { getResumeState, setConsent, getConsent, clearAll } from "../lib/sessionState";
import { diagItems, scoredItemEntries } from "../lib/dataLoader";
import { CLOUD_ENABLED } from "../lib/firebase";

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
    // 브라우저 저장소가 막힌 환경(시크릿 모드·사이트 데이터 차단)에서는 동의가 저장되지 않아 설문 화면의
    // 가드가 아무 안내 없이 시작 화면으로 되돌렸다 (2026-09-02 점검 S5) — 저장 자가진단 후 안내
    if (!getConsent()) {
      window.alert(
        "브라우저 저장 공간을 사용할 수 없어 진행할 수 없습니다. 시크릿(비공개) 창을 닫고 일반 창에서 열거나, 사이트 데이터 차단을 해제한 뒤 다시 시도해 주세요."
      );
      return;
    }
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
              <strong>{scoredItemEntries.length}</strong>
              <span>기본 설문</span>
            </div>
            <div className="stat">
              <strong>{diagItems.length}</strong>
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
              <strong>STEP 3 · 진로준비 진단</strong> — {diagItems.length}문항으로 지금 나의 준비 영역 확인
            </li>
            <li>
              <strong>결과지</strong> — 현재 단계(Level)·보완영역·추천 활동·상담 연결 안내
            </li>
          </ol>
        </section>

        <section className="card">
          <h2 className="card__title">응답 전 안내</h2>
          <ul className="notice-list">
            <li>정답은 없습니다. 지금 상태 그대로 답해 주세요.</li>
            <li>결과는 취업지원을 위한 참고자료이며, 학생의 선택을 제한하지 않습니다.</li>
            <li>
              <strong>따로 찾아가지 않아도 돼요</strong> — 상담을 희망하면 잡카페 컨설턴트가 먼저 연락드립니다.
            </li>
          </ul>
          {/* 개인정보 수집·이용 고지 4요소(항목·목적·기간·거부권) + 익명 통계 연구 활용 고지 — 2026-08-28 확정 */}
          <dl className="consent-terms">
            <div>
              <dt>수집 항목</dt>
              <dd>학번, 성명, 학과·학년, 휴대전화, 설문 응답, 자격증 정보</dd>
            </div>
            <div>
              <dt>이용 목적</dt>
              <dd>진로·취업 진단과 맞춤형 상담·프로그램 연계, 취업지원 개선</dd>
            </div>
            <div>
              <dt>보유 기간</dt>
              <dd>졸업 후 3년까지</dd>
            </div>
            <div>
              <dt>제공·활용</dt>
              <dd>
                응답 내용은 외부에 제공되지 않으며, 개인을 알아볼 수 없게 처리한 통계는 교내
                연구·정책 자료로 활용될 수 있습니다.
              </dd>
            </div>
            {/* 수집·이용·관리 주체 명시 — 개인정보 고지의 처리자 표기 (2026-09-03 사용자 요청) */}
            <div>
              <dt>관리 부서</dt>
              <dd>학생지원처 취·창업팀</dd>
            </div>
          </dl>
          <label className="agree">
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
            <span>
              안내 내용을 확인했으며, 위 목적의 개인정보 수집·이용에 동의합니다.{" "}
              <em>(동의하지 않으셔도 불이익은 없으나, 진단 서비스는 이용하실 수 없습니다)</em>
            </span>
          </label>
          <button className="btn btn--primary btn--block" disabled={!agreed} onClick={goNext}>
            다음: 기본 정보 입력 →
          </button>
          {/* 클라우드 모드에서는 실제로 제출되므로 문구를 상태에 맞게 분기 (2026-08-31 — 구 문구는 고지 모순) */}
          <p className="pilot-note">
            {CLOUD_ENABLED
              ? "시범운영 중 — 응답은 결과 확인 시 학교 시스템에 안전하게 제출되며, 승인된 교직원만 열람할 수 있습니다."
              : "시범운영 프로토타입 — 입력 정보는 이 브라우저에만 저장되며 서버로 전송되지 않습니다."}
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
