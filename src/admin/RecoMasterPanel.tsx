// 추천활동 관리 (Recommendation Master) — 등록·수정·삭제·ON/OFF (계획서 §3.1-⑤, §6.1)
// 저장소는 src/lib/recoMaster.ts: 시드(data/recommendation_master.json) + Firestore 오버라이드 병합.
// 변경은 학생 결과지(추천활동)·관리자 명단·워크스페이스에 공통 반영된다.
import { useEffect, useMemo, useState } from "react";
import {
  listForAdmin,
  pullRecoMaster,
  saveRecoActivity,
  deleteRecoActivity,
  onRecoMasterChanged,
  isSeedCode,
  type RecoActivity,
  type RecoPullState,
} from "../lib/recoMaster";
import { domainLabels } from "../lib/dataLoader";
import { todayStr } from "../lib/dates";

const OWNER_LABELS: Record<RecoActivity["owner"], string> = {
  CAREER: "진로컨설턴트",
  EMPLOYMENT: "취업컨설턴트",
};

const CODE_PATTERN = /^[A-Z][A-Z0-9_]{2,39}$/;

interface FormState {
  code: string;
  name: string;
  owner: RecoActivity["owner"];
  levels: number[];
  weak_domains: string[];
  priority: number;
  student_desc: string;
  active_from: string;
  active_to: string;
  active: boolean;
}

function emptyForm(): FormState {
  return {
    code: "",
    name: "",
    owner: "CAREER",
    levels: [],
    weak_domains: [],
    priority: 3,
    student_desc: "",
    active_from: todayStr(),
    active_to: "",
    active: true,
  };
}

function toForm(a: RecoActivity): FormState {
  return {
    code: a.recommendation_code,
    name: a.name,
    owner: a.owner,
    levels: [...a.levels],
    weak_domains: [...a.weak_domains],
    priority: a.priority,
    student_desc: a.student_desc,
    active_from: a.active_from,
    active_to: a.active_to,
    active: a.active,
  };
}

export default function RecoMasterPanel({ editor }: { editor: string }) {
  const [list, setList] = useState<RecoActivity[]>(listForAdmin);
  const [cloudState, setCloudState] = useState<RecoPullState | "LOADING">("LOADING");
  // editing: null=폼 닫힘 / "NEW"=신규 등록 / 코드=해당 활동 수정
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [formError, setFormError] = useState("");
  const [saveFail, setSaveFail] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const unsub = onRecoMasterChanged(() => setList(listForAdmin()));
    void pullRecoMaster().then((s) => {
      setCloudState(s);
      setList(listForAdmin());
    });
    return unsub;
  }, []);

  const domainOptions = useMemo(
    () => [...Object.entries(domainLabels), ["ANY", "전체(범용)"] as [string, string]],
    []
  );

  const openNew = () => {
    setForm(emptyForm());
    setEditing("NEW");
    setFormError("");
  };
  const openEdit = (a: RecoActivity) => {
    setForm(toForm(a));
    setEditing(a.recommendation_code);
    setFormError("");
  };
  const closeForm = () => {
    setEditing(null);
    setFormError("");
  };

  const validate = (f: FormState): string => {
    const code = f.code.trim().toUpperCase();
    if (!CODE_PATTERN.test(code)) return "코드는 영대문자로 시작하는 대문자·숫자·언더스코어 3~40자여야 합니다. (예: NEW_PROGRAM_2026)";
    if (editing === "NEW" && list.some((a) => a.recommendation_code === code))
      return `이미 등록된 코드입니다: ${code}`;
    if (!f.name.trim()) return "활동명을 입력해 주세요.";
    if (f.levels.length === 0) return "적용 Level을 1개 이상 선택해 주세요.";
    if (f.weak_domains.length === 0) return "취약영역을 1개 이상 선택해 주세요. (특정 영역과 무관하면 '전체(범용)')";
    if (!(f.priority >= 1 && f.priority <= 5)) return "우선순위는 1(높음)~5(낮음) 사이여야 합니다.";
    if (!f.active_from || !f.active_to) return "활성기간(시작·종료일)을 모두 입력해 주세요.";
    if (f.active_from > f.active_to) return "활성 종료일이 시작일보다 빠릅니다.";
    if (!f.student_desc.trim()) return "학생 노출 설명을 입력해 주세요. (결과지에 그대로 표시됩니다)";
    return "";
  };

  const submit = async () => {
    const err = validate(form);
    setFormError(err); // 통과 시 이전 오류 문구 제거
    if (err) return;
    const activity: RecoActivity = {
      recommendation_code: form.code.trim().toUpperCase(),
      name: form.name.trim(),
      owner: form.owner,
      levels: [...form.levels].sort(),
      weak_domains: [...form.weak_domains],
      priority: form.priority,
      student_desc: form.student_desc.trim(),
      active_from: form.active_from,
      active_to: form.active_to,
      active: form.active,
    };
    setBusy(true);
    const result = await saveRecoActivity(activity, editor);
    setBusy(false);
    if (result === "FAIL") {
      setSaveFail(`저장 실패 — ${activity.name}. 네트워크·로그인·규칙 게시 상태를 확인한 뒤 다시 시도해 주세요.`);
      return;
    }
    setSaveFail("");
    setList(listForAdmin());
    closeForm();
  };

  const toggleActive = async (a: RecoActivity) => {
    const result = await saveRecoActivity({ ...a, active: !a.active }, editor);
    if (result === "FAIL") setSaveFail(`ON/OFF 저장 실패 — ${a.name}. 다시 시도해 주세요.`);
    else {
      setSaveFail("");
      setList(listForAdmin());
    }
  };

  const remove = async (a: RecoActivity) => {
    const seedNote = isSeedCode(a.recommendation_code)
      ? "\n(기본 시드 활동입니다 — 삭제하면 학생 추천에서 완전히 제외됩니다. 잠시 내리려면 OFF를 권장합니다)"
      : "";
    if (!window.confirm(`"${a.name}" 활동을 삭제할까요? 학생 결과지 추천에서 즉시 제외됩니다.${seedNote}`)) return;
    const result = await deleteRecoActivity(a.recommendation_code, editor);
    if (result === "FAIL") setSaveFail(`삭제 실패 — ${a.name}. 다시 시도해 주세요.`);
    else {
      setSaveFail("");
      setList(listForAdmin());
      if (editing === a.recommendation_code) closeForm();
    }
  };

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }));
  const toggleIn = (arr: (string | number)[], v: string | number) =>
    arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];

  return (
    <>
      <p className="muted">
        {cloudState === "CLOUD" && "☁ 공유 저장소 연결됨 — 등록·수정·ON/OFF가 학생 결과지 추천과 모든 관리자 화면에 반영됩니다."}
        {cloudState === "LOCAL" && "로컬 미리보기 — 변경이 이 브라우저에만 저장됩니다. Firebase 설정 시 공유 저장소로 전환됩니다."}
        {cloudState === "LOADING" && "공유 저장소에서 활동 목록을 불러오는 중…"}
        {cloudState === "FAIL" && "⚠ 공유 저장소 조회 실패 — 아래 목록은 시드 기준일 수 있습니다. 네트워크·규칙 게시 상태 확인 후 새로고침해 주세요."}
      </p>
      {saveFail && <div className="alert">{saveFail}</div>}

      <div className="reco-toolbar">
        <button className="btn btn--primary" onClick={openNew}>＋ 활동 등록</button>
        <span className="muted small">
          부서에서 실제 운영하는 활동만 등록하세요 — 등록된 활동만 학생에게 추천됩니다 (계획서 §3.7).
        </span>
      </div>

      {editing !== null && (
        <section className="card reco-form">
          <h2 className="card__title">{editing === "NEW" ? "새 활동 등록" : `활동 수정 — ${editing}`}</h2>
          {formError && <div className="alert">{formError}</div>}
          <div className="grid-2">
            <div className="field">
              <label className="field__label" htmlFor="reco-code">추천 코드 {editing !== "NEW" && <span className="muted small">(수정 불가 — 판정·이력의 키)</span>}</label>
              <input
                id="reco-code"
                className="input code"
                value={form.code}
                disabled={editing !== "NEW"}
                placeholder="예: NEW_PROGRAM_2026"
                onChange={(e) => set("code", e.target.value.toUpperCase())}
              />
            </div>
            <div className="field">
              <label className="field__label" htmlFor="reco-name">활동명</label>
              <input id="reco-name" className="input" value={form.name} placeholder="예: 잡카페 이력서 클리닉"
                onChange={(e) => set("name", e.target.value)} />
            </div>
            <div className="field">
              <label className="field__label">담당</label>
              <div className="chip-row">
                {(Object.keys(OWNER_LABELS) as RecoActivity["owner"][]).map((o) => (
                  <button key={o} type="button" className={`chip ${form.owner === o ? "chip--on" : ""}`}
                    onClick={() => set("owner", o)}>
                    {OWNER_LABELS[o]}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <label className="field__label">우선순위 (1=가장 먼저 추천)</label>
              <div className="chip-row">
                {[1, 2, 3, 4, 5].map((p) => (
                  <button key={p} type="button" className={`chip ${form.priority === p ? "chip--on" : ""}`}
                    onClick={() => set("priority", p)}>
                    {p}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <label className="field__label">적용 Level</label>
              <div className="chip-row">
                {[1, 2, 3, 4].map((l) => (
                  <button key={l} type="button" className={`chip ${form.levels.includes(l) ? "chip--on" : ""}`}
                    onClick={() => set("levels", toggleIn(form.levels, l) as number[])}>
                    L{l}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <label className="field__label">적용 취약영역 (복수 선택)</label>
              <div className="chip-row">
                {domainOptions.map(([code, label]) => (
                  <button key={code} type="button" className={`chip ${form.weak_domains.includes(code) ? "chip--on" : ""}`}
                    onClick={() => set("weak_domains", toggleIn(form.weak_domains, code) as string[])}>
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <label className="field__label" htmlFor="reco-from">활성 시작일</label>
              <input id="reco-from" type="date" className="input" value={form.active_from}
                max={form.active_to || undefined} onChange={(e) => set("active_from", e.target.value)} />
            </div>
            <div className="field">
              <label className="field__label" htmlFor="reco-to">활성 종료일</label>
              <input id="reco-to" type="date" className="input" value={form.active_to}
                min={form.active_from || undefined} onChange={(e) => set("active_to", e.target.value)} />
            </div>
            <div className="field field--full">
              <label className="field__label" htmlFor="reco-desc">학생 노출 설명 (결과지에 그대로 표시)</label>
              <textarea id="reco-desc" className="input" rows={2} value={form.student_desc}
                placeholder='예: "희망직무를 1~2개로 구체화하고 준비계획을 세워보세요."'
                onChange={(e) => set("student_desc", e.target.value)} />
            </div>
          </div>
          <div className="reco-form__actions">
            <label className="reco-form__active">
              <input type="checkbox" checked={form.active} onChange={(e) => set("active", e.target.checked)} />
              활성 (학생 추천에 노출)
            </label>
            <button className="btn btn--primary" disabled={busy} onClick={() => void submit()}>
              {busy ? "저장 중…" : editing === "NEW" ? "등록" : "저장"}
            </button>
            <button className="btn btn--ghost" disabled={busy} onClick={closeForm}>취소</button>
          </div>
        </section>
      )}

      <div className="table-wrap card">
        <table className="admin-table">
          <thead>
            <tr>
              <th>코드</th><th>활동명</th><th>담당</th><th>적용 LEVEL</th><th>취약영역</th>
              <th>우선순위</th><th>활성기간</th><th>활성</th><th>관리</th>
            </tr>
          </thead>
          <tbody>
            {list.map((a) => (
              <tr key={a.recommendation_code} className={a.active ? "" : "row-off"}>
                <td className="code">
                  {a.recommendation_code}
                  {!isSeedCode(a.recommendation_code) && <span className="reco-badge">등록</span>}
                </td>
                <td className="cell-wrap"><strong>{a.name}</strong><br /><span className="muted small">{a.student_desc}</span></td>
                <td>{OWNER_LABELS[a.owner]}</td>
                <td>{a.levels.map((l) => `L${l}`).join(" ")}</td>
                <td>{a.weak_domains.map((d) => (d === "ANY" ? "전체" : domainLabels[d] ?? d)).join(" · ")}</td>
                <td className="num">{a.priority}</td>
                <td className="small">{a.active_from} ~ {a.active_to}</td>
                <td>
                  <button className={`toggle ${a.active ? "toggle--on" : ""}`} onClick={() => void toggleActive(a)}>
                    {a.active ? "ON" : "OFF"}
                  </button>
                </td>
                <td className="reco-actions">
                  <button className="btn btn--ghost btn--sm" onClick={() => openEdit(a)}>✏ 수정</button>
                  <button className="btn btn--ghost btn--sm btn--danger" onClick={() => void remove(a)}>삭제</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
