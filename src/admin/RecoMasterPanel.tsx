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
  updatedAtOf,
  getDroppedCodes,
  type RecoActivity,
  type RecoPullState,
} from "../lib/recoMaster";
import { invalidateStudentsCache } from "./responsesSource";
import { domainLabels } from "../lib/dataLoader";
import { todayStr } from "../lib/dates";

const OWNER_LABELS: Record<RecoActivity["owner"], string> = {
  CAREER: "진로컨설턴트",
  EMPLOYMENT: "취업컨설턴트",
};

const CODE_PATTERN = /^[A-Z][A-Z0-9_]{2,39}$/;
/** UTF-8 바이트 수 — Firestore 규칙의 string.size()와 같은 단위 (한글 1자 = 3바이트, 점검 N13) */
const utf8Bytes = (s: string): number => new TextEncoder().encode(s).length;

/** YYYY-MM-DD 두 날짜의 일수 차 (만료 임박 판정용, 로컬 기준 문자열 비교와 함께 사용) */
function daysBetween(from: string, to: string): number {
  const ms = new Date(`${to}T00:00:00`).getTime() - new Date(`${from}T00:00:00`).getTime();
  return Math.round(ms / 86400000);
}

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

  // 활성기간 만료 감시 — 시드 10건이 모두 2026-12-31 종료라 방치하면 어느 날 추천이 전부 사라진다
  // (점검 [높음-4]: 날짜가 지나야 증상이 보이므로 미리 화면에 경고한다)
  const today = todayStr();
  const expiry = useMemo(() => {
    const live = list.filter((a) => a.active);
    const expired = live.filter((a) => a.active_to < today);
    const soon = live.filter((a) => a.active_to >= today && daysBetween(today, a.active_to) <= 60);
    const soonestDate = soon.map((a) => a.active_to).sort()[0] ?? "";
    return { expired: expired.length, soon: soon.length, soonestDate };
  }, [list, today]);
  const dropped = useMemo(() => getDroppedCodes(), [list]);

  // 편집 시작 시점의 원격 갱신 시각 — 저장 때 비교해 남의 수정을 덮어쓰지 않는다 (점검 [높음-2])
  const [baseUpdatedAt, setBaseUpdatedAt] = useState<string | undefined>(undefined);

  const openNew = () => {
    setForm(emptyForm());
    setEditing("NEW");
    setBaseUpdatedAt(undefined);
    setFormError("");
    setSaveFail(""); // 이전 실패 경고가 새 폼에 남지 않게 (점검 L-5)
  };
  const openEdit = (a: RecoActivity) => {
    setForm(toForm(a));
    setEditing(a.recommendation_code);
    setBaseUpdatedAt(updatedAtOf(a.recommendation_code));
    setFormError("");
    setSaveFail("");
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
    // 길이 상한은 서버 규칙(validReco: name.size() ≤100, student_desc.size() ≤500)과 동일 기준 — 규칙의
    // size()는 UTF-8 **바이트** 수라 한글은 글자당 3바이트다. 문자 수로 검사하면 한글 34자부터 규칙에 거부돼
    // "저장 실패(네트워크 확인)"로 오안내됐다 (점검 N13). 화면도 바이트로 검사하고 한글 기준 글자 수를 안내한다.
    if (utf8Bytes(f.name.trim()) > 100) return "활동명이 너무 깁니다 — 한글 기준 약 33자(100바이트) 이내로 줄여 주세요.";
    if (f.levels.length === 0) return "적용 Level을 1개 이상 선택해 주세요.";
    if (f.weak_domains.length === 0) return "취약영역을 1개 이상 선택해 주세요. (특정 영역과 무관하면 '전체(범용)')";
    if (!(f.priority >= 1 && f.priority <= 5)) return "우선순위는 1(높음)~5(낮음) 사이여야 합니다.";
    if (!f.active_from || !f.active_to) return "활성기간(시작·종료일)을 모두 입력해 주세요.";
    if (f.active_from > f.active_to) return "활성 종료일이 시작일보다 빠릅니다.";
    // 이미 지난 종료일로 등록하면 학생에게 한 번도 노출되지 않는다 (점검 L-4)
    if (f.active && f.active_to < todayStr())
      return `활성 종료일(${f.active_to})이 이미 지났습니다. 기간을 연장하거나 "활성" 체크를 해제해 주세요.`;
    if (!f.student_desc.trim()) return "학생 노출 설명을 입력해 주세요. (결과지에 그대로 표시됩니다)";
    if (utf8Bytes(f.student_desc.trim()) > 500) return "학생 노출 설명이 너무 깁니다 — 한글 기준 약 166자(500바이트) 이내로 줄여 주세요.";
    return "";
  };

  /** 저장 성공 후 공통 처리 — 명단·CSV가 쓰는 학생 캐시를 무효화해야 추천 변경이 즉시 반영된다
   *  (점검 [높음-1]: 캐시를 비우지 않으면 관리자가 "저장했는데 명단에 안 보인다"를 겪는다) */
  const afterSaved = () => {
    setSaveFail("");
    setList(listForAdmin());
    invalidateStudentsCache();
  };

  const conflictMsg = (name: string) =>
    `저장하지 않았습니다 — "${name}"을(를) 다른 관리자가 방금 수정했습니다. 아래 "최신 내용 불러오기"를 눌러 확인한 뒤 다시 편집해 주세요. (덮어쓰기를 막았습니다)`;

  /** 충돌·오류 뒤 최신 목록 다시 받기 — 화면을 떠나지 않고 해소할 수단 (점검 RECO-03) */
  const [conflicted, setConflicted] = useState(false);
  const reload = async () => {
    setBusy(true);
    const s = await pullRecoMaster();
    setBusy(false);
    setCloudState(s);
    setList(listForAdmin());
    invalidateStudentsCache();
    if (s === "CLOUD") {
      setSaveFail("");
      setConflicted(false);
      if (editing && editing !== "NEW") {
        const fresh = listForAdmin().find((a) => a.recommendation_code === editing);
        if (fresh) {
          setForm(toForm(fresh)); // 최신 내용으로 폼 갱신 — 편집을 이어갈 수 있게
          setBaseUpdatedAt(updatedAtOf(editing));
        } else {
          closeForm(); // 그 사이 삭제됨
          setSaveFail(`"${editing}" 활동은 다른 관리자가 삭제했습니다.`);
        }
      }
    } else {
      setSaveFail("최신 내용을 불러오지 못했습니다. 네트워크·로그인 상태를 확인해 주세요.");
    }
  };

  const submit = async () => {
    const err = validate(form);
    setFormError(err); // 통과 시 이전 오류 문구 제거
    if (err) return;
    const activity: RecoActivity = {
      recommendation_code: form.code.trim().toUpperCase(),
      name: form.name.trim(),
      owner: form.owner,
      levels: [...form.levels].sort((a, b) => a - b), // 숫자 정렬 — 문자열 비교 금지 (점검 L-2)
      weak_domains: [...form.weak_domains],
      priority: form.priority,
      student_desc: form.student_desc.trim(),
      active_from: form.active_from,
      active_to: form.active_to,
      active: form.active,
    };
    setBusy(true);
    // 신규 여부를 명시 — 삭제된 코드의 되살리기는 신규 등록 폼에서만 허용 (점검 CON-07),
    // updated_at 없는 오버라이드의 수정이 신규로 오인되지 않게 (점검 A9)
    const { result } = await saveRecoActivity(activity, editor, { isNew: editing === "NEW", baseUpdatedAt });
    setBusy(false);
    if (result === "FAIL") {
      setSaveFail(`저장 실패 — ${activity.name}. 네트워크·로그인·규칙 게시 상태를 확인한 뒤 다시 시도해 주세요.`);
      return;
    }
    if (result === "CONFLICT") {
      setConflicted(true);
      setSaveFail(
        editing === "NEW"
          ? `저장하지 않았습니다 — 코드 ${activity.recommendation_code}는 이미 공유 저장소에 존재합니다(삭제된 활동일 수 있음). "최신 내용 불러오기" 후 기존 활동을 수정해 주세요.`
          : conflictMsg(activity.name)
      );
      return;
    }
    afterSaved();
    closeForm();
  };

  const toggleActive = async (a: RecoActivity) => {
    if (busy) return; // 연타 시 stale 값으로 두 번 쓰는 것 방지 (점검 L-1)
    setBusy(true);
    const { result } = await saveRecoActivity({ ...a, active: !a.active }, editor, {
      isNew: false,
      baseUpdatedAt: updatedAtOf(a.recommendation_code),
    });
    setBusy(false);
    if (result === "FAIL") setSaveFail(`ON/OFF 저장 실패 — ${a.name}. 다시 시도해 주세요.`);
    else if (result === "CONFLICT") { setConflicted(true); setSaveFail(conflictMsg(a.name)); }
    else afterSaved();
  };

  const remove = async (a: RecoActivity) => {
    if (busy) return;
    const seedNote = isSeedCode(a.recommendation_code)
      ? "\n(기본 시드 활동입니다 — 삭제하면 학생 추천에서 완전히 제외됩니다. 잠시 내리려면 OFF를 권장합니다)"
      : "";
    if (!window.confirm(`"${a.name}" 활동을 삭제할까요? 학생 결과지 추천에서 즉시 제외됩니다.${seedNote}`)) return;
    setBusy(true);
    const result = await deleteRecoActivity(a.recommendation_code, editor, updatedAtOf(a.recommendation_code));
    setBusy(false);
    if (result === "FAIL") setSaveFail(`삭제 실패 — ${a.name}. 다시 시도해 주세요.`);
    else if (result === "CONFLICT") { setConflicted(true); setSaveFail(conflictMsg(a.name)); }
    else {
      afterSaved();
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
      {saveFail && (
        <div className="alert">
          {saveFail}
          {conflicted && (
            <button className="btn btn--ghost btn--sm" style={{ marginLeft: 8 }} disabled={busy} onClick={() => void reload()}>
              ↻ 최신 내용 불러오기
            </button>
          )}
        </div>
      )}
      {expiry.expired > 0 && (
        <div className="alert">
          ⚠ 활성 상태인데 <strong>기간이 이미 지난 활동 {expiry.expired}건</strong> — 학생에게 추천되지 않습니다.
          해당 활동의 활성 종료일을 연장해 주세요.
        </div>
      )}
      {expiry.expired === 0 && expiry.soon > 0 && (
        <div className="admin__banner">
          활성 활동 {expiry.soon}건이 <strong>{expiry.soonestDate}</strong>에 종료됩니다. 종료일이 지나면 그 활동은
          학생 추천에서 자동으로 빠지므로, 다음 학기 운영 계획에 맞춰 기간을 연장해 주세요.
        </div>
      )}
      {dropped.length > 0 && (
        <div className="alert">
          ⚠ 형식이 맞지 않아 무시한 활동 {dropped.length}건: {dropped.join(", ")} — 공유 저장소에서 직접 편집된
          문서일 수 있습니다. 해당 활동을 다시 등록하거나 마스터에게 문의해 주세요.
        </div>
      )}

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
              <input id="reco-name" className="input" value={form.name} placeholder="예: 잡카페 이력서 클리닉" maxLength={100}
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
              <textarea id="reco-desc" className="input" rows={2} value={form.student_desc} maxLength={500}
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
                <td className="small">
                  {a.active_from} ~ {a.active_to}
                  {a.active && a.active_to < today && <span className="reco-badge reco-badge--warn">기간 만료</span>}
                </td>
                <td>
                  <button
                    className={`toggle ${a.active ? "toggle--on" : ""}`}
                    role="switch"
                    aria-checked={a.active}
                    aria-label={`${a.name} 활성 여부`}
                    onClick={() => void toggleActive(a)}
                  >
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
