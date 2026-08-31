// 연계기관·취업처 관리 — 상담사 워크스페이스 전용 (2026-08-30 사용자 요구).
// 외부기관 연계 시 참조하는 공유 등록부: 기관명·연락처·담당자·사업명·비고.
import { useState, type FormEvent } from "react";
import {
  loadAgencies,
  addAgency,
  updateAgency,
  removeAgency,
  AGENCY_TYPE_LABELS,
  type Agency,
  type AgencyType,
} from "./agencies";

const EMPTY = { type: "AGENCY" as AgencyType, name: "", contact: "", manager: "", program: "", note: "" };

export default function AgencyManager() {
  const [agencies, setAgencies] = useState<Agency[]>(loadAgencies);
  const [form, setForm] = useState(EMPTY);
  const [editId, setEditId] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState<"" | AgencyType>("");

  const visible = agencies.filter((a) => !typeFilter || a.type === typeFilter);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    if (editId) {
      setAgencies(updateAgency(editId, form));
      setEditId(null);
    } else {
      setAgencies(addAgency(form));
    }
    setForm(EMPTY);
  };

  const startEdit = (a: Agency) => {
    setEditId(a.id);
    setForm({ type: a.type, name: a.name, contact: a.contact, manager: a.manager, program: a.program, note: a.note });
  };

  return (
    <>
      <h1 className="admin__title">연계기관·취업처 관리</h1>
      <p className="muted">
        외부기관 연계와 취업처 기록에서 참조하는 공유 등록부입니다. 학생을 어느 기관에 보냈는지
        추적하려면 기관명·연락처·담당자·사업명을 등록해 두세요. (상담사 전용 — 담당자 화면에는 없음)
      </p>

      {/* 등록·수정 폼 */}
      <form className="card agency-form" onSubmit={submit}>
        <strong>{editId ? "기관 정보 수정" : "새 기관 등록"}</strong>
        <div className="agency-form__grid">
          <label className="adv-filter__field">
            <span>구분</span>
            <select className="input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as AgencyType })}>
              <option value="AGENCY">연계기관 (정부사업·유관기관)</option>
              <option value="EMPLOYER">취업처 (기업·채용처)</option>
            </select>
          </label>
          <label className="adv-filter__field">
            <span>기관명 (필수)</span>
            <input className="input" placeholder="예: 서대문고용복지플러스센터" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label className="adv-filter__field">
            <span>기관 연락처</span>
            <input className="input" placeholder="예: 02-123-4567" value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} />
          </label>
          <label className="adv-filter__field">
            <span>기관 담당자</span>
            <input className="input" placeholder="예: 김주무관" value={form.manager} onChange={(e) => setForm({ ...form, manager: e.target.value })} />
          </label>
          <label className="adv-filter__field">
            <span>사업명 / 채용분야</span>
            <input className="input" placeholder="예: 국민취업지원제도 1유형" value={form.program} onChange={(e) => setForm({ ...form, program: e.target.value })} />
          </label>
          <label className="adv-filter__field">
            <span>비고</span>
            <input className="input" placeholder="예: 청년 대상, 재학생 신청 가능" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          </label>
        </div>
        <div className="adv-filter__actions">
          {editId && (
            <button type="button" className="btn btn--ghost" onClick={() => { setEditId(null); setForm(EMPTY); }}>
              수정 취소
            </button>
          )}
          <button className="btn btn--primary" disabled={!form.name.trim()}>
            {editId ? "수정 저장" : "+ 기관 등록"}
          </button>
        </div>
      </form>

      {/* 목록 */}
      <div className="filter-bar">
        {(["", "AGENCY", "EMPLOYER"] as const).map((t) => (
          <button
            key={t || "all"}
            className={`chip ${typeFilter === t ? "chip--on" : ""}`}
            onClick={() => setTypeFilter(t)}
          >
            {t === "" ? `전체 (${agencies.length})` : `${AGENCY_TYPE_LABELS[t]} (${agencies.filter((a) => a.type === t).length})`}
          </button>
        ))}
      </div>
      <div className="table-wrap card">
        <table className="admin-table">
          <thead>
            <tr>
              <th>구분</th><th>기관명</th><th>연락처</th><th>담당자</th><th>사업명/분야</th><th>비고</th><th>처리</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr><td colSpan={7} className="muted">등록된 기관이 아직 없습니다. 위에서 첫 기관을 등록해 보세요.</td></tr>
            )}
            {visible.map((a) => (
              <tr key={a.id}>
                <td><span className={`sum-badge ${a.type === "AGENCY" ? "sum-badge--hot" : "sum-badge--plain"}`}>{AGENCY_TYPE_LABELS[a.type]}</span></td>
                <td><strong>{a.name}</strong></td>
                <td>{a.contact || "—"}</td>
                <td>{a.manager || "—"}</td>
                <td>{a.program || "—"}</td>
                <td className="small cell-wrap">{a.note || "—"}</td>
                <td>
                  <div className="acct-actions">
                    <button className="btn btn--ghost btn--sm" onClick={() => startEdit(a)}>수정</button>
                    <button
                      className="btn btn--ghost btn--sm"
                      onClick={() => {
                        if (window.confirm(`'${a.name}'을(를) 삭제할까요? 학생 기록의 연계 표시는 "미상 기관"으로 남습니다.`))
                          setAgencies(removeAgency(a.id));
                      }}
                    >
                      삭제
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
