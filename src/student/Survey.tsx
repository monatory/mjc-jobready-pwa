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
    getProfile() ?? { student_id: "", name: "", dept: "", grade: "" }
  );
  const [answers, setAnswers] = useState<Record<string, string>>(getSurvey());
  const [unscored, setUnscoredState] = useState<Record<string, string>>(getUnscored());
  const [certs, setCertsState] = useState<CertEntry[]>(getCerts());
  const [showErrors, setShowErrors] = useState(false);

  const requiredDone = useMemo(() => {
    const profileOk = profile.student_id.trim() && profile.name.trim() && profile.dept.trim() && profile.grade;
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
    setProfile(profile);
    setSurvey(answers);
    setUnscored(unscored);
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
          <div className="alert">필수 항목(기본 정보 4개, 설문 {scoredItemEntries.length}개)을 모두 입력해 주세요.</div>
        )}

        <section className="card">
          <h2 className="card__title">A. 기본 정보 <span className="required-mark">필수</span></h2>
          <div className="grid-2">
            <div className="field">
              <label className="field__label">학번</label>
              <input
                className="input"
                value={profile.student_id}
                inputMode="numeric"
                placeholder="예: 20261234"
                onChange={(e) => setProfileState({ ...profile, student_id: e.target.value })}
              />
            </div>
            <div className="field">
              <label className="field__label">성명</label>
              <input
                className="input"
                value={profile.name}
                placeholder="이름"
                onChange={(e) => setProfileState({ ...profile, name: e.target.value })}
              />
            </div>
            <div className="field">
              <label className="field__label">학과</label>
              <input
                className="input"
                value={profile.dept}
                placeholder="예: 컴퓨터공학과"
                onChange={(e) => setProfileState({ ...profile, dept: e.target.value })}
              />
            </div>
            <div className="field">
              <label className="field__label">학년</label>
              <div className="option-row">
                {["1", "2", "3"].map((g) => (
                  <button
                    key={g}
                    type="button"
                    className={`chip ${profile.grade === g ? "chip--on" : ""}`}
                    onClick={() => setProfileState({ ...profile, grade: g })}
                  >
                    {g}학년
                  </button>
                ))}
              </div>
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
