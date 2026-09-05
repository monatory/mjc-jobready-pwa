// 통합 상담 카드 — 학생 상세 모달(상담사 워크스페이스 전용)에서 상담의 전 과정을 한눈에.
//  ① 요약 스트립: 상담희망·정부지원 연계희망(설문) + 연락상태·외부연계·취업상태(기록) + 최근 메모
//  ② 연락 기록: 연락 상태 + 간단 메모
//  ③ 상담 회차 기록: 1회차, 2회차… 누적 + 최종 요약
//  ④ 외부기관 연계: 희망 → 연계 완료 → 사후관리 → 종결 (등록부에서 기관 선택)
//  ⑤ 취업상태 등록: 구직 중/취업(취업처)/진학/창업…
// 담당자(행정)에게는 이 컴포넌트 전체가 렌더되지 않는다 (§6.4).
import { useEffect, useRef, useState } from "react";
import type { StudentRecord } from "./mockStudents";
import { surveyAnswerLabel, wantsCounsel } from "./mockStudents";
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
  type OutreachSaveResult,
} from "./outreach";
import { AGENCY_TYPE_LABELS, agencyName, type Agency } from "./agencies";
import { todayStr, localDateTimeStr } from "../lib/dates";

const today = () => todayStr(); // 로컬(KST) 기준 — UTC 사용 시 새벽에 전날로 찍힘 (감사 ENG-05)

export default function CounselRecord({
  student,
  entry,
  by,
  agencies,
  onSave,
  onDirtyChange,
}: {
  student: StudentRecord;
  entry: OutreachEntry | undefined;
  by: string;
  agencies: Agency[];
  onSave: (next: Record<string, OutreachEntry>) => void;
  /** 저장하지 않은 입력이 있는지 — 부모 모달이 닫기 전에 확인하는 데 쓴다 (점검 C11) */
  onDirtyChange?: (dirty: boolean) => void;
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

  // 저장하지 않은 입력 감지 — 모달 바깥 클릭으로 메모·요약이 조용히 사라지던 문제 (점검 C11).
  // 저장 후에는 entry가 갱신되어 화면 값과 같아지므로 자연히 false가 된다.
  const dirty =
    status !== (entry?.status ?? "NONE") ||
    memo !== (entry?.memo ?? "") ||
    sessContent.trim() !== "" ||
    finalSummary !== (entry?.final_summary ?? "") ||
    refStage !== (entry?.referral?.stage ?? "NONE") ||
    refAgency !== (entry?.referral?.agency_id ?? "") ||
    refDate !== (entry?.referral?.referred_at ?? "") ||
    refNote !== (entry?.referral?.note ?? "") ||
    empStatus !== (entry?.employment?.status ?? "NONE") ||
    employer !== (entry?.employment?.employer ?? "") ||
    empDate !== (entry?.employment?.date ?? "") ||
    empNote !== (entry?.employment?.note ?? "");
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]); // 언마운트 시 초기화

  const [savedMsg, setSavedMsg] = useState<{ text: string; error: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  // 이전 성공 토스트(1.5초)의 타이머가 뒤이어 온 실패 경고(5초)를 조기에 지우던 문제 — 타이머 교체 (점검 C3)
  const flashTimer = useRef<number | undefined>(undefined);
  const flash = (text: string, error = false) => {
    setSavedMsg({ text, error });
    window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setSavedMsg(null), error ? 5000 : 1500);
  };

  // 공유 저장 공통 경로 — 트랜잭션 병합 저장 + 실패를 반드시 표시 (감사 C4-02: "저장됨 ✓" 위장 금지)
  const doSave = async (
    patch: Partial<Omit<OutreachEntry, "updated_at">>,
    ops: { add?: Omit<CounselSession, "seq">; removeSeq?: number } | undefined,
    okMsg: string
  ): Promise<OutreachSaveResult> => {
    setSaving(true);
    const { all, result } = await saveOutreachEntry(studentId, patch, by, ops);
    setSaving(false);
    onSave(all);
    if (result === "FAIL")
      flash("⚠ 공유 저장소 반영 실패 — 이 브라우저에는 보관됐지만 다른 상담사에게 공유되지 않았습니다. 네트워크 확인 후 같은 내용을 다시 저장해 주세요.", true);
    else flash(`${okMsg} ✓`);
    return result;
  };

  const refAgencies = agencies.filter((a) => a.type === "AGENCY");
  const employers = agencies.filter((a) => a.type === "EMPLOYER");
  const selectedAgency = agencies.find((a) => a.id === refAgency);
  // 기록이 참조하는 기관이 등록부에서 **삭제**됐으면 select가 빈칸처럼 보이면서 옛 id가 그대로 저장되던
  // 문제 (점검 C9) — 명시적으로 보여 주고, 연계 완료 이후 단계 저장은 재선택을 요구한다.
  // 구분만 바뀐 기관(연계기관→취업처)은 삭제가 아니다 — 예전엔 삭제로 오판해 저장을 막았다 (점검 N10).
  // 그 경우 선택지에 그대로 두고 표시만 붙인다.
  const refAgencyStale = Boolean(refAgency) && !agencies.some((a) => a.id === refAgency);
  const refAgencyRetyped = Boolean(selectedAgency) && selectedAgency!.type !== "AGENCY";
  // 다음 회차 번호는 "가장 큰 회차 + 1" — 중간 회차를 삭제하면 배열 길이+1과 달라진다 (점검 낮음)
  const nextSeq = sessions.reduce((m, s) => (Number.isFinite(s.seq) ? Math.max(m, s.seq) : m), 0) + 1;

  const saveContact = () => void doSave({ status, memo }, undefined, "연락 기록 저장됨");
  const addSession = () => {
    if (!sessContent.trim() || saving) return; // Enter 키가 버튼 잠금(saving)을 우회하던 것 (점검 낮음)
    // 회차 번호는 저장 시점의 "원격 최신 배열" 기준으로 부여(cloudStore 병합) — 동시 편집 시 중복·소실 방지
    void doSave({}, { add: { date: sessDate, content: sessContent.trim(), by } }, "회차 기록 저장됨");
    setSessContent("");
  };
  const removeSession = (seq: number) => {
    if (!window.confirm(`${seq}회차 기록을 삭제할까요?`)) return;
    void doSave({}, { removeSeq: seq }, "회차 기록 삭제됨");
  };
  const saveSummary = () => void doSave({ final_summary: finalSummary }, undefined, "최종 요약 저장됨");
  const saveReferral = () => {
    // 연계 완료 이후 단계는 기관 없이 저장하면 "기관 미상 연계"가 됨 — 등록부 선택 필수 (감사 C4-15)
    if (["REFERRED", "FOLLOWUP", "CLOSED"].includes(refStage) && (!refAgency || refAgencyStale))
      return flash(
        refAgencyStale
          ? "⚠ 기록된 연계 기관이 등록부에서 삭제됐습니다 — 기관을 다시 선택한 뒤 저장해 주세요."
          : "⚠ 연계 기관을 선택해 주세요 — 연계 완료 이후 단계는 기관 기록이 필요합니다.",
        true
      );
    // "해당 없음"으로 되돌리면 기관·연계일·메모는 함께 비운다 — 칸이 숨겨진 채 옛 값이 저장돼
    // CSV 연계기관 열에 잔여 값이 남던 문제 (점검 CNS-10)
    if (refStage === "NONE") {
      setRefAgency("");
      setRefDate("");
      setRefNote("");
    }
    void doSave(
      {
        referral:
          refStage === "NONE"
            ? { stage: "NONE" }
            : {
                stage: refStage,
                agency_id: refAgency || undefined,
                referred_at: refDate || undefined,
                note: refNote || undefined,
              },
      },
      undefined,
      "외부 연계 저장됨"
    );
  };
  const saveEmployment = () => {
    if (empStatus === "NONE") {
      setEmployer("");
      setEmpDate("");
      setEmpNote("");
    }
    void doSave(
      {
        employment:
          empStatus === "NONE"
            ? { status: "NONE" }
            : {
                status: empStatus,
                employer: employer || undefined,
                date: empDate || undefined,
                note: empNote || undefined,
              },
      },
      undefined,
      "취업상태 저장됨"
    );
  };

  return (
    <div className="counsel-record">
      {/* ① 요약 스트립 — 한눈에 */}
      <div className="counsel-summary">
        {/* 설문 상담희망 또는 결과지 상담 신청 버튼 — 둘 중 하나면 희망 (2026-09-05 이중장치) */}
        <span
          className={`sum-badge ${wantsCounsel(student) ? "sum-badge--hot" : ""}`}
          title={student.counsel_requested_at ? `결과지에서 상담 신청: ${localDateTimeStr(student.counsel_requested_at)}` : undefined}
        >
          상담 {student.survey.counsel_wish === "YES" ? "희망" : student.counsel_requested_at ? "신청(결과지)" : "미희망"}
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
      {savedMsg && (
        <p className={`outreach-editor__saved counsel-record__flash ${savedMsg.error ? "counsel-record__flash--err" : ""}`}>
          {savedMsg.text}
        </p>
      )}

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
              ? `마지막 기록: ${localDateTimeStr(entry.updated_at)} · ${entry.by}`
              : "아직 기록이 없습니다."}
          </span>
          <button className="btn btn--primary btn--sm" disabled={saving} onClick={saveContact}>연락 기록 저장</button>
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
            placeholder={`${nextSeq}회차 상담 내용`}
            value={sessContent}
            onChange={(e) => setSessContent(e.target.value)}
            // 한글 IME 조합 중 Enter는 무시 — 조합 확정 Enter가 회차를 이중 등록할 수 있다 (점검 C6)
            onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) addSession(); }}
          />
          <button className="btn btn--primary btn--sm" disabled={!sessContent.trim() || saving} onClick={addSession}>
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
          <button className="btn btn--ghost btn--sm" disabled={saving} onClick={saveSummary}>최종 요약 저장</button>
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
                {refAgencyStale && <option value={refAgency}>(삭제된 기관 — 다시 선택해 주세요)</option>}
                {refAgencyRetyped && selectedAgency && (
                  <option value={selectedAgency.id}>{selectedAgency.name} (취업처로 구분 변경됨)</option>
                )}
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
          <button className="btn btn--primary btn--sm" disabled={saving} onClick={saveReferral}>외부 연계 저장</button>
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
          <button className="btn btn--primary btn--sm" disabled={saving} onClick={saveEmployment}>취업상태 저장</button>
        </div>
      </div>
    </div>
  );
}
