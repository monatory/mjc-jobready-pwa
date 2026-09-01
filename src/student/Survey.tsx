// STEP 2 — 기본 정보 + 기본 설문(배점표 6문항, 계획서 §3-1) + 비점수 항목(§3-2)
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import AppHeader from "../components/AppHeader";
import { scoredItemEntries, surveyItems } from "../lib/dataLoader";
import {
  getConsent,
  getProfile,
  getSurvey,
  getUnscored,
  getCerts,
  setProfile,
  setSurvey,
  setUnscored,
  setCerts,
  GRADE_PATTERN,
  type CertEntry,
} from "../lib/sessionState";

const CERT_STATUS = (surveyItems.certification_entry.status_values as Array<{ value: string; label: string }>);
const CERT_CATEGORY = (surveyItems.certification_entry as { category_values?: Array<{ value: string; label: string }> })
  .category_values ?? [];

export default function Survey() {
  const navigate = useNavigate();
  const consented = getConsent();
  useEffect(() => {
    // 동의 없이 직접 진입 시 STEP 1로 (진입 가드) — 렌더 중 navigate 호출 금지(React 경고 방지)
    if (!consented) navigate("/", { replace: true });
  }, [consented, navigate]);

  const [profile, setProfileState] = useState(
    // 기존 저장 프로필에 phone이 없을 수 있으므로(항목 추가 이전 응답) 기본값과 병합
    { student_id: "", name: "", dept: "", grade: "", phone: "", ...(getProfile() ?? {}) }
  );
  const [answers, setAnswers] = useState<Record<string, string>>(getSurvey());
  const [unscored, setUnscoredState] = useState<Record<string, string>>(getUnscored());
  const [certs, setCertsState] = useState<CertEntry[]>(getCerts());
  const [showErrors, setShowErrors] = useState(false);

  // 입력 즉시 세션 저장 — 새로고침·뒤로가기·"← 이전"으로 입력 전체가 소실되던 문제 수정 (감사 S2-05).
  // 조건부 문항 정리·트림은 제출 시(submit) 최종본으로 한 번 더 저장한다.
  useEffect(() => { setProfile(profile); }, [profile]);
  useEffect(() => { setSurvey(answers); }, [answers]);
  useEffect(() => { setUnscored(unscored); }, [unscored]);
  useEffect(() => { setCerts(certs); }, [certs]);

  const requiredDone = useMemo(() => {
    // 휴대전화는 상담사가 먼저 연락하는 시스템의 핵심 채널 — 필수 (숫자 10~11자리)
    const phoneOk = /^01[0-9]-?\d{3,4}-?\d{4}$/.test(profile.phone.trim());
    // 학번: 영숫자 4~20자 — 서버 규칙(firestore.rules validResponse)과 동일 조건.
    // 불일치하면 전 과정을 마치고 제출만 영구 실패했다 (감사 S2-02·F12)
    const idOk = /^[A-Za-z0-9]{4,20}$/.test(profile.student_id.trim());
    const nameOk = profile.name.trim().length >= 1 && profile.name.trim().length <= 30;
    // 학년: 본과정 1~3 / 전공심화 1~2 / 졸업(연도 4자리) — 졸업 연도는 현실 범위만 (감사 S2-10)
    const gradYearOk = !profile.grade.startsWith("졸업") ||
      (() => {
        const y = Number(profile.grade.slice(2));
        return y >= 2000 && y <= new Date().getFullYear() + 1;
      })();
    const gradeOk = GRADE_PATTERN.test(profile.grade) && gradYearOk;
    const profileOk = idOk && nameOk && profile.dept.trim() && gradeOk && phoneOk;
    const surveyOk = scoredItemEntries.every(([key]) => answers[key]);
    return Boolean(profileOk && surveyOk);
  }, [profile, answers]);

  const answeredCount = scoredItemEntries.filter(([key]) => answers[key]).length;

  const pick = (key: string, value: string) => setAnswers((prev) => ({ ...prev, [key]: value }));
  const pickUnscored = (key: string, value: string) =>
    setUnscoredState((prev) => ({ ...prev, [key]: value }));

  const addCert = () => setCertsState((prev) => [...prev, { cert_name: "", status: "PREPARING" }]);
  const updateCert = (i: number, patch: Partial<CertEntry>) =>
    setCertsState((prev) => prev.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const removeCert = (i: number) => setCertsState((prev) => prev.filter((_, j) => j !== i));

  const submit = () => {
    if (!requiredDone) {
      setShowErrors(true);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    // 최종 저장본은 트림·전화 정규화 적용 — 문서키(트림 학번)와 payload의 불일치 방지 (감사 S2-04)
    // 전화는 하이픈 형식으로 통일 — Excel에서 숫자로 읽혀 앞 0이 사라지는 손상 방지 (감사 P5-11)
    const digits = profile.phone.replace(/\D/g, "");
    const formattedPhone =
      digits.length >= 10 ? `${digits.slice(0, 3)}-${digits.slice(3, -4)}-${digits.slice(-4)}` : profile.phone.trim();
    setProfile({
      ...profile,
      student_id: profile.student_id.trim(),
      name: profile.name.trim(),
      dept: profile.dept.trim(),
      phone: formattedPhone,
    });
    setSurvey(answers);
    // 조건부 문항(visible_if)은 상위 응답 변경으로 노출 조건이 깨지면 저장에서 제외 — 원자료 오염 방지
    const cleanedUnscored = Object.fromEntries(
      Object.entries(unscored).filter(([key]) => {
        const item = (surveyItems.unscored_items as Record<string, { visible_if?: { item: string; value: string } }>)[key];
        if (!item?.visible_if) return true;
        const v = answers[item.visible_if.item] ?? unscored[item.visible_if.item];
        return v === item.visible_if.value;
      })
    );
    setUnscored(cleanedUnscored);
    setCerts(certs.filter((c) => c.cert_name.trim()));
    navigate("/diagnostic");
  };

  // 비점수 선택형 항목 공통 렌더러 — visible_if는 설문 응답·비점수 응답 어느 쪽이든 참조 가능.
  // multi:true 항목은 복수 선택(토글) — 값은 콤마 결합 문자열로 저장(예: "SEOUL,GYEONGGI")
  const unscoredRadio = (key: string) => {
    const item = (surveyItems.unscored_items as Record<string, {
      label: string;
      multi?: boolean;
      options?: Array<{ value: string; label: string }>;
      visible_if?: { item: string; value: string };
    }>)[key];
    if (!item?.options) return null;
    if (item.visible_if) {
      const v = answers[item.visible_if.item] ?? unscored[item.visible_if.item];
      if (v !== item.visible_if.value) return null;
    }
    const selected = item.multi ? (unscored[key] ?? "").split(",").filter(Boolean) : [];
    const toggle = (value: string) => {
      if (!item.multi) {
        pickUnscored(key, value);
        return;
      }
      const next = selected.includes(value)
        ? selected.filter((v) => v !== value)
        : [...selected, value];
      pickUnscored(key, next.join(","));
    };
    const isOn = (value: string) => (item.multi ? selected.includes(value) : unscored[key] === value);
    return (
      <div className="field">
        <label className="field__label">
          {item.label} <span className="optional">{item.multi ? "(선택 · 복수 가능)" : "(선택)"}</span>
        </label>
        <div className="option-row">
          {item.options.map((o) => (
            <button
              key={o.value}
              type="button"
              className={`chip ${isOn(o.value) ? "chip--on" : ""}`}
              onClick={() => toggle(o.value)}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="page">
      <AppHeader step={2} />
      <main className="container">
        {showErrors && !requiredDone && (
          <div className="alert">필수 항목(기본 정보 5개, 설문 {scoredItemEntries.length}개)을 모두 입력해 주세요. 학번은 공백 없이 숫자·영문 4~20자, 휴대전화는 010-0000-0000 형식으로, 졸업생은 졸업 연도 4자리를 입력해 주세요.</div>
        )}

        <section className="card">
          <h2 className="card__title">A. 기본 정보 <span className="required-mark">필수</span></h2>
          <div className="grid-2">
            <div className="field">
              <label className="field__label" htmlFor="profile-student-id">학번</label>
              <input
                id="profile-student-id"
                className="input"
                value={profile.student_id}
                inputMode="numeric"
                placeholder="예: 20261234"
                onChange={(e) => setProfileState({ ...profile, student_id: e.target.value })}
              />
            </div>
            <div className="field">
              <label className="field__label" htmlFor="profile-name">성명</label>
              <input
                id="profile-name"
                className="input"
                value={profile.name}
                placeholder="이름"
                onChange={(e) => setProfileState({ ...profile, name: e.target.value })}
              />
            </div>
            <div className="field">
              <label className="field__label" htmlFor="profile-dept">학과</label>
              <input
                id="profile-dept"
                className="input"
                value={profile.dept}
                placeholder="예: 컴퓨터공학과"
                onChange={(e) => setProfileState({ ...profile, dept: e.target.value })}
              />
            </div>
            <div className="field">
              <label className="field__label">학년 (과정 구분)</label>
              {/* 본과정 1~3 / 전공심화과정 1~2 / 졸업생(연도 입력) — 코드값은 "본과N"·"심화N"·"졸업YYYY" 유지 */}
              <div className="grade-picker">
                <div className="grade-picker__row">
                  <span className="grade-picker__track">본과정</span>
                  {["1", "2", "3"].map((n) => (
                    <button
                      key={n}
                      type="button"
                      className={`chip ${profile.grade === `본과${n}` ? "chip--on" : ""}`}
                      onClick={() => setProfileState({ ...profile, grade: `본과${n}` })}
                    >
                      {n}학년
                    </button>
                  ))}
                </div>
                <div className="grade-picker__row">
                  <span className="grade-picker__track">전공심화과정</span>
                  {["1", "2"].map((n) => (
                    <button
                      key={n}
                      type="button"
                      className={`chip ${profile.grade === `심화${n}` ? "chip--on" : ""}`}
                      onClick={() => setProfileState({ ...profile, grade: `심화${n}` })}
                    >
                      {n}학년
                    </button>
                  ))}
                </div>
                <div className="grade-picker__row">
                  <span className="grade-picker__track">졸업</span>
                  <button
                    type="button"
                    className={`chip ${profile.grade.startsWith("졸업") ? "chip--on" : ""}`}
                    onClick={() => setProfileState({ ...profile, grade: "졸업" })}
                  >
                    졸업생
                  </button>
                  {profile.grade.startsWith("졸업") && (
                    <input
                      className="input grade-picker__year"
                      inputMode="numeric"
                      maxLength={4}
                      placeholder="졸업 연도 (예: 2025)"
                      value={profile.grade.slice(2)}
                      onChange={(e) =>
                        setProfileState({ ...profile, grade: `졸업${e.target.value.replace(/\D/g, "")}` })
                      }
                    />
                  )}
                </div>
              </div>
            </div>
            <div className="field">
              <label className="field__label" htmlFor="profile-phone">휴대전화</label>
              <input
                id="profile-phone"
                className="input"
                type="tel"
                value={profile.phone}
                inputMode="numeric"
                placeholder="예: 010-1234-5678"
                onChange={(e) => setProfileState({ ...profile, phone: e.target.value })}
              />
              <p className="field__hint">상담·프로그램 연계 시 잡카페 컨설턴트가 연락드리는 번호예요.</p>
            </div>
          </div>
        </section>

        <section className="card">
          <h2 className="card__title">
            B. 진로·취업 설문 <span className="required-mark">필수</span>
            <span className="progress-text">{answeredCount} / {scoredItemEntries.length}</span>
          </h2>
          {scoredItemEntries.map(([key, item], idx) => {
            // 문항 부가 안내(info) — 제도 설명 펼치기 + 컨설턴트 연계 고지 (데이터 주도, §4 하드코딩 금지)
            const info = (item as unknown as {
              info?: { summary: string; programs: Array<{ name: string; desc: string }>; notice: string };
            }).info;
            return (
              <div className={`q-block ${showErrors && !answers[key] ? "q-block--error" : ""}`} key={key}>
                <p className="q-block__label">
                  <span className="q-num">{idx + 1}</span> {item.question}
                </p>
                {info && (
                  <details className="q-info">
                    <summary>ⓘ {info.summary}</summary>
                    <ul>
                      {info.programs.map((p) => (
                        <li key={p.name}>
                          <strong>{p.name}</strong> — {p.desc}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
                <div className="option-col">
                  {item.options.map((o) => (
                    <button
                      key={o.value}
                      type="button"
                      className={`opt ${answers[key] === o.value ? "opt--on" : ""}`}
                      onClick={() => pick(key, o.value)}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
                {info && <p className="q-info__notice">{info.notice}</p>}
              </div>
            );
          })}
        </section>

        <section className="card">
          <h2 className="card__title">C. 추가 정보 <span className="optional">(선택 — 상담·매칭에 활용)</span></h2>
          {unscoredRadio("home_region")}
          {unscoredRadio("region")}
          {unscoredRadio("major_link")}
          {/* 연구 연계 문항(비점수) — 방향전환형(N) 선택 시에만 전환 시기·계기 노출 */}
          {unscoredRadio("career_shift_timing")}
          {unscoredRadio("career_shift_reason")}
          {unscoredRadio("desired_job_group")}
          <div className="field">
            <label className="field__label">희망직무 <span className="optional">(선택)</span></label>
            <input
              className="input"
              value={unscored.desired_job ?? ""}
              placeholder="예: 웹 개발자, 사회복지사, 사무행정"
              onChange={(e) => pickUnscored("desired_job", e.target.value)}
            />
          </div>
          {unscoredRadio("non_employment_type")}
          {unscoredRadio("prep_difficulty")}
          {unscoredRadio("roadmap_demand")}
          <div className="field">
            <label className="field__label">자격증 <span className="optional">(선택 — 보유/준비/목표 상태 그대로)</span></label>
            {certs.map((c, i) => (
              <div className="cert-row" key={i}>
                <input
                  className="input cert-row__name"
                  value={c.cert_name}
                  placeholder="자격증명"
                  onChange={(e) => updateCert(i, { cert_name: e.target.value })}
                />
                <select
                  className="input cert-row__status"
                  value={c.category ?? ""}
                  onChange={(e) => updateCert(i, { category: e.target.value })}
                >
                  <option value="">분류 선택</option>
                  {CERT_CATEGORY.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
                <select
                  className="input cert-row__status"
                  value={c.status}
                  onChange={(e) => updateCert(i, { status: e.target.value as CertEntry["status"] })}
                >
                  {CERT_STATUS.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
                <button type="button" className="btn btn--ghost cert-row__del" onClick={() => removeCert(i)}>
                  ✕
                </button>
              </div>
            ))}
            <button type="button" className="btn btn--ghost" onClick={addCert}>
              + 자격증 추가
            </button>
          </div>
        </section>

        <div className="actions">
          <button className="btn btn--ghost" onClick={() => navigate("/")}>
            ← 이전
          </button>
          <button className={`btn btn--primary ${requiredDone ? "btn--glow" : ""}`} onClick={submit}>
            다음: 진로준비 진단 →
          </button>
        </div>
      </main>
    </div>
  );
}
