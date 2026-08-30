// 통합 상담 카드 — 학생 상세 모달(상담사 워크스페이스 전용)에서 상담의 전 과정을 한눈에.
//  ① 요약 스트립: 상담희망·정부지원 연계희망(설문) + 연락상태·외부연계·취업상태(기록) + 최근 메모
//  ② 연락 기록: 연락 상태 + 간단 메모
//  ③ 상담 회차 기록: 1회차, 2회차… 누적 + 최종 요약
//  ④ 외부기관 연계: 희망 → 연계 완료 → 사후관리 → 종결 (등록부에서 기관 선택)
//  ⑤ 취업상태 등록: 구직 중/취업(취업처)/진학/창업…
// 담당자(행정)에게는 이 컴포넌트 전체가 렌더되지 않는다 (§6.4).
import { useState } from "react";
import type { StudentRecord } from "./mockStudents";
import { surveyAnswerLabel } from "./mockStudents";
import {
  saveOutreachEntry,
  OUTREACH_LABELS,
  OUTREACH_ORDER,
  REFERRAL_LABELS,
  REFERRAL_ORDER,
  EMPLOYMENT_LABELS,
  EMPLOYMENT_ORDER,
  type OutreachEntry,
  type OutreachStatus,
  type ReferralStage,
  type EmploymentStatus,
  type CounselSession,
} from "./outreach";
import { AGENCY_TYPE_LABELS, agencyName, type Agency } from "./agencies";

const today = () => new Date().toISOString().slice(0, 10);

export default function CounselRecord({
  student,
  entry,
  by,
  agencies,
  onSave,
}: {
  student: StudentRecord;
  entry: OutreachEntry | undefined;
  by: string;
  agencies: Agency[];
  onSave: (next: Record<string, OutreachEntry>) => void;
}) {
  const studentId = student.student_id;
  // ── 연락 기록 ──
  const [status, setStatus] = useState<OutreachStatus>(entry?.status ?? "NONE");
  const [memo, setMemo] = useState(entry?.memo ?? "");
  // ── 회차 기록 ──
  const sessions = entry?.sessions ?? [];
  const [sessDate, setSessDate] = useState(today());
  const [sessContent, setSessContent] = useState("");
  const [finalSummary, setFinalSummary] = useState(entry?.final_summary ?? "");
  // ── 외부 연계 ──
  const [refStage, setRefStage] = useState<ReferralStage>(entry?.referral?.stage ?? "NONE");
  const [refAgency, setRefAgency] = useState(entry?.referral?.agency_id ?? "");
  const [refDate, setRefDate] = useState(entry?.referral?.referred_at ?? "");
  const [refNote, setRefNote] = useState(entry?.referral?.note ?? "");
  // ── 취업상태 ──
  const [empStatus, setEmpStatus] = useState<EmploymentStatus>(entry?.employment?.status ?? "NONE");
  const [employer, setEmployer] = useState(entry?.employment?.employer ?? "");
  const [empDate, setEmpDate] = useState(entry?.employment?.date ?? "");
  const [empNote, setEmpNote] = useState(entry?.employment?.note ?? "");

  const [savedMsg, setSavedMsg] = useState("");
  const flash = (msg: string) => {
    setSavedMsg(msg);
    window.setTimeout(() => setSavedMsg(""), 1500);
  };

  const refAgencies = agencies.filter((a) => a.type === "AGENCY");
  const employers = agencies.filter((a) => a.type === "EMPLOYER");
  const selectedAgency = agencies.find((a) => a.id === refAgency);

  const saveContact = () => {
    onSave(saveOutreachEntry(studentId, { status, memo }, by));
    flash("연락 기록 저장됨 ✓");
  };
  const addSession = () => {
    if (!sessContent.trim()) return;
    const next: CounselSession = { seq: sessions.length + 1, date: sessDate, content: sessContent.trim(), by };
    onSave(saveOutreachEntry(studentId, { sessions: [...sessions, next] }, by));
    setSessContent("");
    flash(`${next.seq}회차 기록 저장됨 ✓`);
  };
  const removeSession = (seq: number) => {
    if (!window.confirm(`${seq}회차 기록을 삭제할까요?`)) return;
    const next = sessions.filter((s) => s.seq !== seq).map((s, i) => ({ ...s, seq: i + 1 }));
    onSave(saveOutreachEntry(studentId, { sessions: next }, by));
  };
  const saveSummary = () => {
    onSave(saveOutreachEntry(studentId, { final_summary: finalSummary }, by));
    flash("최종 요약 저장됨 ✓");
  };
  const saveReferral = () => {
    onSave(
      saveOutreachEntry(
        studentId,
        {
          referral: {
            stage: refStage,
            agency_id: refAgency || undefined,
            referred_at: refDate || undefined,
            note: refNote || undefined,
          },
        },
        by
      )
    );
    flash("외부 연계 저장됨 ✓");
  };
  const saveEmployment = () => {
    onSave(
      saveOutreachEntry(
        studentId,
        {
          employment: {
            status: empStatus,
            employer: employer || undefined,
            date: empDate || undefined,
            note: empNote || undefined,
          },
        },
        by
      )
    );
    flash("취업상태 저장됨 ✓");
  };

  return (
    <div className="counsel-record">
      {/* ① 요약 스트립 — 한눈에 */}
      <div className="counsel-summary">
        <span className={`sum-badge ${student.survey.counsel_wish === "YES" ? "sum-badge--hot" : ""}`}>
          상담 {student.survey.counsel_wish === "YES" ? "희망" : "미희망"}
        </span>
        <span className={`sum-badge ${student.survey.gov_link === "USE" ? "sum-badge--hot" : ""}`}>
          정부지원 {surveyAnswerLabel("gov_link", student.survey.gov_link)}
        </span>
        <span className={`outreach-badge outreach-badge--${(entry?.status ?? "NONE").toLowerCase()}`}>
          {OUTREACH_LABELS[entry?.status ?? "NONE"]}
        </span>
        <span className={`ref-badge ref-badge--${(entry?.referral?.stage ?? "NONE").toLowerCase()}`}>
          연계: {REFERRAL_LABELS[entry?.referral?.stage ?? "NONE"]}
          {entry?.referral?.agency_id ? ` (${agencyName(agencies, entry.referral.agency_id)})` : ""}
        </span>
        <span className={`emp-badge emp-badge--${(entry?.employment?.status ?? "NONE").toLowerCase()}`}>
          취업: {EMPLOYMENT_LABELS[entry?.employment?.status ?? "NONE"]}
          {entry?.employment?.employer ? ` (${entry.employment.employer})` : ""}
        </span>
        <span className="sum-badge sum-badge--plain">상담 {sessions.length}회</span>
        {entry?.memo && <span className="counsel-summary__memo">📝 {entry.memo}</span>}
      </div>
      {savedMsg && <p className="outreach-editor__saved counsel-record__flash">{savedMsg}</p>}

      {/* ② 연락 기록 */}
      <div className="outreach-editor">
        <div className="outreach-editor__row">
          <strong>연락 기록</strong>
          <div className="outreach-editor__chips">
            {OUTREACH_ORDER.map((st) => (
              <button
                key={st}
                type="button"
                className={`chip chip--sm ${status === st ? "chip--on" : ""}`}
                onClick={() => setStatus(st)}
              >
                {OUTREACH_LABELS[st]}
              </button>
            ))}
          </div>
        </div>
        <textarea
          className="input outreach-editor__memo"
          rows={2}
          placeholder="간단 메모 (예: 8/30 문자 발송, 9/2 상담 예약)"
          value={memo}
          onChange={(e) => setMemo(e.target.value)}
        />
        <div className="outreach-editor__foot">
          <span className="muted small">
            {entry
              ? `마지막 기록: ${entry.updated_at.slice(0, 16).replace("T", " ")} · ${entry.by}`
              : "아직 기록이 없습니다."}
          </span>
          <button className="btn btn--primary btn--sm" onClick={saveContact}>연락 기록 저장</button>
        </div>
      </div>

      {/* ③ 상담 회차 기록 + 최종 요약 */}
      <div className="outreach-editor">
        <div className="outreach-editor__row">
          <strong>상담 회차 기록</strong>
          <span className="muted small">{sessions.length}회 진행</span>
        </div>
        {sessions.length > 0 && (
          <ol className="session-list">
            {sessions.map((s) => (
              <li key={s.seq}>
                <span className="session-list__seq">{s.seq}회차</span>
                <span className="session-list__date">{s.date}</span>
                <span className="session-list__content">{s.content}</span>
                <span className="muted small">{s.by}</span>
                <button className="session-list__del" onClick={() => removeSession(s.seq)} title="삭제">✕</button>
              </li>
            ))}
          </ol>
        )}
        <div className="session-add">
          <input className="input session-add__date" type="date" value={sessDate} onChange={(e) => setSessDate(e.target.value)} />
          <input
            className="input session-add__content"
            placeholder={`${sessions.length + 1}회차 상담 내용`}
            value={sessContent}
            onChange={(e) => setSessContent(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") addSession(); }}
          />
          <button className="btn btn--primary btn--sm" disabled={!sessContent.trim()} onClick={addSession}>
            회차 추가
          </button>
        </div>
        <textarea
          className="input outreach-editor__memo"
          rows={2}
          placeholder="최종 요약 (상담 종결 시 핵심 정리)"
          value={finalSummary}
          onChange={(e) => setFinalSummary(e.target.value)}
        />
        <div className="outreach-editor__foot">
          <span className="muted small">최종 요약은 명단·인수인계에서 이 학생의 결론으로 쓰입니다.</span>
          <button className="btn btn--ghost btn--sm" onClick={saveSummary}>최종 요약 저장</button>
        </div>
      </div>

      {/* ④ 외부기관 연계 — 희망 → 연계 완료 → 사후관리 → 종결 */}
      <div className="outreach-editor">
        <div className="outreach-editor__row">
          <strong>외부기관 연계</strong>
          <div className="outreach-editor__chips">
            {REFERRAL_ORDER.map((st) => (
              <button
                key={st}
                type="button"
                className={`chip chip--sm ${refStage === st ? "chip--on" : ""}`}
                onClick={() => setRefStage(st)}
              >
                {REFERRAL_LABELS[st]}
              </button>
            ))}
          </div>
        </div>
        {refStage !== "NONE" && (
          <div className="ref-grid">
            <label className="adv-filter__field">
              <span>연계 기관 (등록부에서 선택)</span>
              <select className="input" value={refAgency} onChange={(e) => setRefAgency(e.target.value)}>
                <option value="">— 기관 선택 —</option>
                {refAgencies.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}{a.program ? ` · ${a.program}` : ""}</option>
                ))}
              </select>
            </label>
            <label className="adv-filter__field">
              <span>연계일</span>
              <input className="input" type="date" value={refDate} onChange={(e) => setRefDate(e.target.value)} />
            </label>
            <label className="adv-filter__field ref-grid__note">
              <span>연계 메모 (진행 상황)</span>
              <input
                className="input"
                placeholder="예: 국취제 1유형 신청 완료, 9월 중 결과 통보 예정"
                value={refNote}
                onChange={(e) => setRefNote(e.target.value)}
              />
            </label>
          </div>
        )}
        {selectedAgency && (
          <p className="muted small ref-agency-info">
            🏢 {AGENCY_TYPE_LABELS[selectedAgency.type]} · {selectedAgency.name}
            {selectedAgency.program && ` · ${selectedAgency.program}`}
            {selectedAgency.manager && ` · 담당 ${selectedAgency.manager}`}
            {selectedAgency.contact && ` · ${selectedAgency.contact}`}
          </p>
        )}
        {refStage !== "NONE" && refAgencies.length === 0 && (
          <p className="muted small">등록된 연계기관이 없습니다 — "연계기관·취업처 관리"에서 먼저 등록하세요.</p>
        )}
        <div className="outreach-editor__foot">
          <span className="muted small">연계 완료·사후관리 학생은 명단의 🔗 사후관리 필터로 모아볼 수 있어요.</span>
          <button className="btn btn--primary btn--sm" onClick={saveReferral}>외부 연계 저장</button>
        </div>
      </div>

      {/* ⑤ 취업상태 등록 */}
      <div className="outreach-editor">
        <div className="outreach-editor__row">
          <strong>취업상태</strong>
          <div className="outreach-editor__chips">
            {EMPLOYMENT_ORDER.map((st) => (
              <button
                key={st}
                type="button"
                className={`chip chip--sm ${empStatus === st ? "chip--on" : ""}`}
                onClick={() => setEmpStatus(st)}
              >
                {EMPLOYMENT_LABELS[st]}
              </button>
            ))}
          </div>
        </div>
        {empStatus !== "NONE" && (
          <div className="ref-grid">
            <label className="adv-filter__field">
              <span>{empStatus === "EMPLOYED" ? "취업처명" : "관련 기관·학교명 (선택)"}</span>
              <input
                className="input"
                list="employer-list"
                placeholder="예: (주)OO시스템"
                value={employer}
                onChange={(e) => setEmployer(e.target.value)}
              />
              <datalist id="employer-list">
                {employers.map((a) => (
                  <option key={a.id} value={a.name} />
                ))}
              </datalist>
            </label>
            <label className="adv-filter__field">
              <span>확정일</span>
              <input className="input" type="date" value={empDate} onChange={(e) => setEmpDate(e.target.value)} />
            </label>
            <label className="adv-filter__field ref-grid__note">
              <span>메모</span>
              <input
                className="input"
                placeholder="예: 사무직 정규직, 잡카페 알선"
                value={empNote}
                onChange={(e) => setEmpNote(e.target.value)}
              />
            </label>
          </div>
        )}
        <div className="outreach-editor__foot">
          <span className="muted small">취업 확정 학생은 성과관리·사후 연락 대상에서 자동 제외 판단에 활용됩니다.</span>
          <button className="btn btn--primary btn--sm" onClick={saveEmployment}>취업상태 저장</button>
        </div>
      </div>
    </div>
  );
}
