// 대상자 필터·명단 패널 — 관리자(#/admin)와 상담사 워크스페이스(#/counsel) 공용.
// showOutreach=true(상담사 전용)일 때만 연락 우선 큐·연락상태·상담 메모가 나타난다.
// 담당자(행정)에게는 연락 기록이 화면·CSV 어디에도 노출되지 않는다 (2026-08-30 사용자 확정).
import { useEffect, useMemo, useRef, useState } from "react";
import { surveyAnswerLabel, wantsCounsel, type StudentRecord } from "./mockStudents";
import { useStudents, inPeriod, updateStudentProfile, deleteStudentResponses } from "./responsesSource";
import { exportSheet, exportSheetForResearch, CERT_CATEGORIES, certCategoryLabel } from "./csvExport";
import { domainLabels, levelRules, surveyItems } from "../lib/dataLoader";
import { localDateStr, localDateTimeStr } from "../lib/dates";
import { findDuplicates, DUP_REASON_LABELS } from "./duplicates";
import type { AdminSession } from "./auth";
import {
  loadOutreach,
  onOutreachChange,
  statusOf,
  referralStageOf,
  employmentStatusOf,
  OUTREACH_LABELS,
  OUTREACH_ORDER,
  REFERRAL_LABELS,
  REFERRAL_ORDER,
  EMPLOYMENT_LABELS,
  EMPLOYMENT_ORDER,
  type OutreachEntry,
} from "./outreach";
import CounselRecord from "./CounselRecord";
import { loadAgencies } from "./agencies";
import { gradeLabel, GRADE_PATTERN, normalizePhone } from "../lib/sessionState";
import { isCounselSide } from "./auth";

// 학생 정보 수정 폼의 학년 선택지 (졸업은 연도 입력 동반)
const GRADE_OPTIONS: Array<[string, string]> = [
  ["본과1", "본과정 1학년"], ["본과2", "본과정 2학년"], ["본과3", "본과정 3학년"],
  ["심화1", "전공심화 1학년"], ["심화2", "전공심화 2학년"], ["졸업", "졸업생"],
];

// ── 정렬 (2026-08-31 상담사 요구 — JAS 고정 정렬 → 선택형) ──
type SortKey = "RECENT" | "JAS" | "TIMING" | "CONTACT" | "REFERRAL";
// 미연락 우선: 아직 손대지 않은 학생(미연락→무응답)이 위로
const CONTACT_PRIORITY = ["NONE", "NO_RESPONSE", "CONTACTED", "RESERVED", "DONE"];
// 외부연계: 처리 필요한 단계(연계 희망)부터 진행 순으로, 해당 없음은 아래로
const REFERRAL_PRIORITY = ["WANTED", "REFERRED", "FOLLOWUP", "CLOSED", "NONE"];

export const LEVEL_NAMES: Record<number, string> = { 1: "진로탐색", 2: "진로설정", 3: "취업준비", 4: "실전취업" };
const rules = levelRules as unknown as {
  jas_cutoff_level3: number;
  gates: { timing_gate: { values: string[] } };
};

// 설문 정의에서 선택지 목록을 가져오는 헬퍼 (코드 하드코딩 금지 — §4)
type Opt = { value: string; label: string };
const optionsOf = (key: string): Opt[] => {
  const all = {
    ...(surveyItems.scored_items as Record<string, { options?: Opt[] }>),
    ...(surveyItems.unscored_items as Record<string, { options?: Opt[] }>),
  };
  return all[key]?.options ?? [];
};

/** 설문 항목 키 → 항목명 (학생 상세 모달에서 "항목명: 응답" 표기용) */
const labelOf = (key: string): string => {
  const all = {
    ...(surveyItems.scored_items as Record<string, { label?: string }>),
    ...(surveyItems.unscored_items as Record<string, { label?: string }>),
  };
  return all[key]?.label ?? key;
};

// ── 상세 필터 (2026-08-28 취·창업팀 요구 — 상담사가 대상자를 정밀 추출) ──
interface AdvFilter {
  contact: string;     // 연락 상태 — 상담사 전용(showOutreach)
  referral: string;    // 외부연계 단계 — 상담사 전용
  employment: string;  // 취업상태 — 상담사 전용
  direction: string;   // 진로방향 (취업/진학·창업/미정)
  counsel: string;     // 상담 희망 (YES/NO)
  majorLink: string;   // 전공진출형/방향전환형
  homeRegion: string;  // 본가(거주지) 지역
  region: string;      // 희망 취업 지역 (복수값 포함 매칭)
  jobGroup: string;    // 희망직무 분야 (복수값 포함 매칭)
  cert: string;        // OWNED=보유 있음 / PREPARING=준비·목표만 / NONE=미입력
  certCat: string;     // 자격 분류 (OA/전공/어학/운전면허/기타)
  timing: string;      // 취업 희망시기
  gov: string;         // 정부지원 연계의향
  dateFrom: string;    // 검사 실시일 기간 시작 (YYYY-MM-DD) — 기간별 취합 (2026-08-31)
  dateTo: string;      // 검사 실시일 기간 끝
  grade: string;       // 학년 (본과1~3·심화1~2·졸업) — 점검 ADM-04 (2026-09-05)
  jasMin: string;      // JAS 범위 — 컷오프 주변(예: 60~69) 대상 추출용
  jasMax: string;
}
const EMPTY_ADV: AdvFilter = {
  contact: "", referral: "", employment: "", direction: "", counsel: "", majorLink: "",
  homeRegion: "", region: "", jobGroup: "", cert: "", certCat: "", timing: "", gov: "",
  dateFrom: "", dateTo: "", grade: "", jasMin: "", jasMax: "",
};
// 학년 필터 선택지 — 졸업은 연도와 무관하게 접두 일치, 구버전 "1"~"3"은 본과 N학년으로 간주
const GRADE_FILTER: Opt[] = [
  { value: "본과1", label: "본과정 1학년" }, { value: "본과2", label: "본과정 2학년" }, { value: "본과3", label: "본과정 3학년" },
  { value: "심화1", label: "전공심화 1학년" }, { value: "심화2", label: "전공심화 2학년" }, { value: "졸업", label: "졸업생" },
];
const gradeMatches = (grade: string, want: string): boolean => {
  if (want === "졸업") return grade.startsWith("졸업");
  if (grade === want) return true;
  return /^[1-3]$/.test(grade) && want === `본과${grade}`;
};

const matchesAdv = (s: StudentRecord, f: AdvFilter, outreach: Record<string, OutreachEntry>): boolean => {
  if ((f.dateFrom || f.dateTo) && !inPeriod(s, f.dateFrom, f.dateTo)) return false;
  if (f.grade && !gradeMatches(s.grade, f.grade)) return false;
  if (f.jasMin !== "" && s.result.jas < Number(f.jasMin)) return false;
  if (f.jasMax !== "" && s.result.jas > Number(f.jasMax)) return false;
  if (f.contact && statusOf(outreach, s.student_id) !== f.contact) return false;
  if (f.referral && referralStageOf(outreach, s.student_id) !== f.referral) return false;
  if (f.employment && employmentStatusOf(outreach, s.student_id) !== f.employment) return false;
  if (f.direction && s.survey.career_direction !== f.direction) return false;
  // 상담 희망 = 설문 희망 또는 결과지 상담 신청 (2026-09-05 이중장치)
  if (f.counsel === "YES" && !wantsCounsel(s)) return false;
  if (f.counsel === "NO" && wantsCounsel(s)) return false;
  if (f.majorLink && s.unscored.major_link !== f.majorLink) return false;
  if (f.homeRegion && s.unscored.home_region !== f.homeRegion) return false;
  if (f.region && !(s.unscored.region ?? "").split(",").includes(f.region)) return false;
  if (f.jobGroup && !(s.unscored.desired_job_group ?? "").split(",").includes(f.jobGroup)) return false;
  if (f.cert === "OWNED" && !s.certs.some((c) => c.status === "OWNED")) return false;
  if (f.cert === "PREPARING" && !(s.certs.length > 0 && !s.certs.some((c) => c.status === "OWNED"))) return false;
  if (f.cert === "NONE" && s.certs.length > 0) return false;
  if (f.certCat && !s.certs.some((c) => (c as { category?: string }).category === f.certCat)) return false;
  if (f.timing && s.survey.employment_timing !== f.timing) return false;
  if (f.gov && s.survey.gov_link !== f.gov) return false;
  return true;
};

// ── 빠른 필터 프리셋 (계획서 §6-2) — 여러 개 동시 선택 시 AND 결합 (2026-08-30) ──
const PRESETS: Array<{ key: string; label: string; fn: (s: StudentRecord) => boolean }> = [
  {
    key: "priority",
    label: "취업지원 우선대상",
    fn: (s) =>
      s.survey.career_direction === "EMPLOYMENT" &&
      s.result.jas >= rules.jas_cutoff_level3 &&
      rules.gates.timing_gate.values.includes(s.survey.employment_timing), // level_rules 주입 (§4)
  },
  { key: "employment", label: "취업희망", fn: (s) => s.survey.career_direction === "EMPLOYMENT" },
  { key: "counsel", label: "상담희망", fn: wantsCounsel }, // 설문 희망 + 결과지 상담 신청 (2026-09-05)
  { key: "gov", label: "정부지원 연계희망", fn: (s) => s.survey.gov_link === "USE" },
  { key: "l3", label: "Level 3", fn: (s) => s.result.level === 3 },
  { key: "l4", label: "Level 4", fn: (s) => s.result.level === 4 },
  { key: "route", label: "진학·창업 Route", fn: (s) => s.result.routeTag === "FURTHER_STUDY_STARTUP" },
];

/** "오늘 연락할 학생" 판정 — 상담희망(설문 또는 결과지 신청) 또는 [L3+ 이면서 취업 Route] 이면서 미연락·무응답.
 *  진학·창업 Route 제외는 L3+ 자동 발굴에만 적용한다 — 예전엔 상담을 직접 신청한 진학·창업 학생까지
 *  큐에서 빠졌다 (점검 N4). 학생이 명시적으로 상담을 원하면 Route와 무관하게 연락 대상이다. */
export const needsOutreachWith =
  (outreach: Record<string, OutreachEntry>) =>
  (s: StudentRecord): boolean =>
    (wantsCounsel(s) || (s.result.level >= 3 && s.result.routeTag !== "FURTHER_STUDY_STARTUP")) &&
    ["NONE", "NO_RESPONSE"].includes(statusOf(outreach, s.student_id));

export default function StudentsPanel({
  session,
  showOutreach,
}: {
  session: AdminSession;
  showOutreach: boolean;
}) {
  const { students, source } = useStudents(); // 실측(Firestore) 우선, 없으면 mock 미리보기
  const dataReady = source === "CLOUD" || source === "MOCK"; // LOADING·ERROR면 다운로드 잠금
  const [presets, setPresets] = useState<Set<string>>(new Set());
  const [queueOnly, setQueueOnly] = useState(false);
  const [followupOnly, setFollowupOnly] = useState(false); // 🔗 외부연계 사후관리 큐
  const [outreach, setOutreach] = useState<Record<string, OutreachEntry>>(loadOutreach);
  // 클라우드 동기화·다른 화면의 저장 후 최신 기록 반영 — 리마운트 없이 (감사 C4-07)
  useEffect(() => onOutreachChange(() => setOutreach(loadOutreach())), []);
  const [levelFilter, setLevelFilter] = useState<number | null>(null);
  const [deptFilter, setDeptFilter] = useState<string>("");
  const [search, setSearch] = useState("");
  const [adv, setAdv] = useState<AdvFilter>(EMPTY_ADV);
  const [sortKey, setSortKey] = useState<SortKey>("RECENT"); // 기본: 최근 검사한 학생이 위로
  const [detail, setDetail] = useState<StudentRecord | null>(null);

  // ── 학생 정보 수정 (2026-08-31 사용자 요구 — 오기입 교정) ──
  const [editing, setEditing] = useState(false);
  const [editBusy, setEditBusy] = useState(false);
  const [editMsg, setEditMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [editForm, setEditForm] = useState({ student_id: "", name: "", dept: "", gradeSel: "", gradeYear: "", phone: "" });
  // 학번 변경은 상담 기록(ready_outreach)을 새 학번으로 함께 옮겨야 하는데, 그 컬렉션은 상담사 계열만
  // 쓸 수 있다. 담당자(행정)가 학번을 바꾸면 응답만 옮겨지고 상담 기록은 옛 학번에 고아로 남았다
  // (2026-09-02 점검 A1). 담당자는 학번 칸을 잠그고 성명·학과·학년·연락처만 교정한다.
  const canMoveId = isCounselSide(session.role);
  // 상담 카드에 저장하지 않은 입력이 있으면 모달을 닫기 전에 확인한다 (점검 C11)
  const [counselDirty, setCounselDirty] = useState(false);
  const closeDetail = () => {
    if ((editing || counselDirty) && !window.confirm("저장하지 않은 입력이 있습니다. 닫을까요?")) return;
    setDetail(null);
    setEditing(false);
    setCounselDirty(false);
  };
  // Esc로 상세 모달 닫기 (점검 A14) — 미저장 확인은 closeDetail이 처리
  useEffect(() => {
    if (!detail) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeDetail();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail, editing, counselDirty]);

  const openEdit = (s: StudentRecord) => {
    const grade = s.grade ?? ""; // 결측 방어 (점검 A15)
    const isGrad = grade.startsWith("졸업");
    setEditForm({
      student_id: s.student_id,
      name: s.name,
      dept: s.dept ?? "",
      gradeSel: isGrad ? "졸업" : grade,
      gradeYear: isGrad ? grade.slice(2) : "",
      phone: s.phone,
    });
    setEditMsg(null);
    setEditing(true);
  };

  // ── 응답 삭제 — 마스터 전용 (2026-09-05 사용자 요구: 시범 운영(9/7) 전 테스트 응답 정리) ──
  const isMaster = session.role === "MASTER";
  const [delBusy, setDelBusy] = useState(false);
  const [delMsg, setDelMsg] = useState<{ text: string; ok: boolean } | null>(null);
  /** 삭제 대상 응답들과 함께 지울 상담 기록 학번 — 그 학번의 응답이 **전부** 삭제 대상일 때만 (다학기 보호) */
  const outreachIdsFor = (targets: StudentRecord[]): string[] => {
    // 실제 문서키(doc_id) 기준 — semester 결측 문서 두 건이 같은 키로 뭉쳐 다학기 보호가 풀리던 것 (점검 N6)
    const targetKeys = new Set(targets.map((t) => t.doc_id));
    const ids = new Set(targets.map((t) => t.student_id));
    return [...ids].filter((id) => students.filter((s) => s.student_id === id).every((s) => targetKeys.has(s.doc_id)));
  };
  const runDelete = async (targets: StudentRecord[]) => {
    setDelBusy(true);
    setDelMsg(null);
    const r = await deleteStudentResponses(targets, outreachIdsFor(targets));
    setDelBusy(false);
    setDelMsg({ text: r.message, ok: r.ok });
    return r.ok;
  };
  const deleteOne = async (s: StudentRecord) => {
    if (!window.confirm(`'${s.name}(${s.student_id})' 학생의 ${s.semester || "이번 학기"} 응답을 삭제할까요?\n상담 기록도 함께 삭제되며(다른 학기 응답이 없을 때) 되돌릴 수 없습니다.`)) return;
    const ok = await runDelete([s]);
    // 진행 중 모달을 닫고 다른 학생을 열었을 수 있다 — 지금 열린 모달이 같은 학생일 때만 닫는다 (점검 M9)
    if (ok && detailRef.current?.doc_id === s.doc_id) {
      setDetail(null);
      setEditing(false);
      setCounselDirty(false);
    }
  };
  const deleteFiltered = async (targets: StudentRecord[]) => {
    if (targets.length === 0) return;
    const typed = window.prompt(
      `현재 필터 결과 ${targets.length}건의 응답을 모두 삭제합니다 (상담 기록 포함, 복구 불가).\n계속하려면 "삭제"라고 입력하세요.`
    );
    if (typed !== "삭제") return;
    await runDelete(targets);
  };

  // ── 중복 의심 — 같은 휴대전화(또는 성명+학과)로 서로 다른 학번의 응답 (2026-09-05) ──
  const duplicates = useMemo(() => findDuplicates(students), [students]);
  const [dupOnly, setDupOnly] = useState(false);
  // 중복을 전부 정리하면 칩을 자동으로 끈다 — 켠 채 0건이 되면 잠긴 칩 + 0명 화면에 갇혔다 (점검 M7)
  useEffect(() => {
    if (dupOnly && duplicates.size === 0) setDupOnly(false);
  }, [dupOnly, duplicates]);
  // 비동기 완료 콜백이 "지금 열린 모달"을 확인하는 데 쓰는 최신 detail 참조 (점검 M9)
  const detailRef = useRef<StudentRecord | null>(null);
  detailRef.current = detail;

  const saveEdit = async (s: StudentRecord) => {
    const grade = editForm.gradeSel === "졸업" ? `졸업${editForm.gradeYear.trim()}` : editForm.gradeSel;
    const id = editForm.student_id.trim();
    // 검증 — Rules(validResponse)와 학생 화면의 조건에 맞춤. 구버전 학년 값은 무변경 시 허용
    if (id !== s.student_id && !canMoveId)
      return setEditMsg({ text: "학번 변경은 상담사 계정(잡카페 워크스페이스)에서만 할 수 있습니다 — 상담 기록이 함께 이동해야 하기 때문입니다.", ok: false });
    if (!/^[A-Za-z0-9]{4,20}$/.test(id))
      return setEditMsg({ text: "학번은 영문·숫자 4~20자로 입력해 주세요 (공백·기호 불가).", ok: false });
    if (!editForm.name.trim() || editForm.name.trim().length > 30)
      return setEditMsg({ text: "성명을 확인해 주세요 (1~30자).", ok: false });
    if (!editForm.dept.trim()) return setEditMsg({ text: "학과를 입력해 주세요.", ok: false });
    if (!(GRADE_PATTERN.test(grade) || grade === s.grade))
      return setEditMsg({ text: "학년을 확인해 주세요. 졸업생은 졸업 연도 4자리가 필요합니다.", ok: false });
    // 구버전 무연락처 응답은 전화 없이도 이름·학과 교정 가능 (감사 P3-09) — 새로 입력할 때만 형식 검사
    const phoneInput = editForm.phone.trim();
    if (phoneInput === "" && s.phone !== "") return setEditMsg({ text: "휴대전화를 비울 수 없습니다.", ok: false });
    if (phoneInput !== "" && !/^01[0-9]-?\d{3,4}-?\d{4}$/.test(phoneInput))
      return setEditMsg({ text: "휴대전화는 010-0000-0000 형식으로 입력해 주세요.", ok: false });

    setEditBusy(true);
    // 연락처는 학생 제출과 같은 하이픈 형식으로 통일 (점검 A4 — 형식 혼재·Excel 앞 0 손실 방지)
    const patch = { student_id: id, name: editForm.name.trim(), dept: editForm.dept.trim(), grade, phone: normalizePhone(editForm.phone) };
    const r = await updateStudentProfile(s, patch, { canMoveId });
    setEditBusy(false);
    // 저장 중 모달을 닫고 다른 학생을 열었으면 그 모달을 건드리지 않는다 (점검 M9)
    if (detailRef.current?.doc_id !== s.doc_id) return;
    setEditMsg({ text: r.message, ok: r.ok });
    if (r.ok) {
      // 학번이 바뀌면 문서키도 바뀐다 — 목록 재조회 전까지 모달이 새 키를 쓰게 맞춘다
      const sem = s.doc_id.endsWith(`_${s.student_id}`) ? s.doc_id.slice(0, s.doc_id.length - s.student_id.length - 1) : s.semester;
      setDetail({ ...s, ...patch, doc_id: `${sem}_${patch.student_id}` }); // 모달 즉시 반영 — 목록은 캐시 무효화로 자동 재조회
      setEditing(false);
    }
  };

  const depts = useMemo(() => [...new Set(students.map((s) => s.dept))].sort(), [students]);
  const needsOutreach = needsOutreachWith(outreach);
  // 외부연계 사후관리 대상: 연계 완료·사후관리 중 (종결 전까지 상담사가 챙겨야 하는 학생)
  const inFollowup = (s: StudentRecord) =>
    ["REFERRED", "FOLLOWUP"].includes(referralStageOf(outreach, s.student_id));

  // 취업 희망시기 순위 — survey_items의 선택지 순서(임박한 순) 그대로 사용 (하드코딩 금지 §4)
  const timingRank = (s: StudentRecord) => {
    const i = optionsOf("employment_timing").findIndex((o) => o.value === s.survey.employment_timing);
    return i < 0 ? 99 : i;
  };
  const compareBy: Record<SortKey, (a: StudentRecord, b: StudentRecord) => number> = {
    RECENT: (a, b) => (b.completed_at || "").localeCompare(a.completed_at || ""),
    JAS: (a, b) => b.result.jas - a.result.jas,
    TIMING: (a, b) => timingRank(a) - timingRank(b) || b.result.jas - a.result.jas,
    CONTACT: (a, b) =>
      CONTACT_PRIORITY.indexOf(statusOf(outreach, a.student_id)) -
        CONTACT_PRIORITY.indexOf(statusOf(outreach, b.student_id)) || b.result.jas - a.result.jas,
    REFERRAL: (a, b) =>
      REFERRAL_PRIORITY.indexOf(referralStageOf(outreach, a.student_id)) -
        REFERRAL_PRIORITY.indexOf(referralStageOf(outreach, b.student_id)) || b.result.jas - a.result.jas,
  };

  const filtered = useMemo(() => {
    let list = students;
    if (showOutreach && queueOnly) list = list.filter(needsOutreach);
    if (showOutreach && followupOnly) list = list.filter(inFollowup);
    if (dupOnly) list = list.filter((s) => duplicates.has(s.student_id));
    for (const p of PRESETS) if (presets.has(p.key)) list = list.filter(p.fn);
    if (levelFilter) list = list.filter((s) => s.result.level === levelFilter);
    if (deptFilter) list = list.filter((s) => s.dept === deptFilter);
    list = list.filter((s) => matchesAdv(s, adv, outreach));
    if (search.trim())
      list = list.filter((s) => s.name.includes(search.trim()) || s.student_id.includes(search.trim()));
    return [...list].sort(compareBy[sortKey]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [students, presets, queueOnly, followupOnly, dupOnly, duplicates, levelFilter, deptFilter, adv, search, outreach, showOutreach, sortKey]);

  // 정렬 선택지 — 연락상태·외부연계 기준은 상담사 워크스페이스에서만
  const sortOptions: Array<[SortKey, string]> = [
    ["RECENT", "최근 검사순"],
    ["JAS", "JAS 높은 순"],
    ["TIMING", "취업 희망시기 빠른 순"],
    ...(showOutreach
      ? ([
          ["CONTACT", "미연락 우선"],
          ["REFERRAL", "외부연계 단계순"],
        ] as Array<[SortKey, string]>)
      : []),
  ];

  // 상담사 전용 요소를 제외한 상세 필터 구성
  const advFields = (
    [
      ...(showOutreach
        ? ([
            ["contact", "연락 상태", OUTREACH_ORDER.map((st) => ({ value: st, label: OUTREACH_LABELS[st] }))],
            ["referral", "외부연계 단계", REFERRAL_ORDER.map((st) => ({ value: st, label: REFERRAL_LABELS[st] }))],
            ["employment", "취업상태", EMPLOYMENT_ORDER.map((st) => ({ value: st, label: EMPLOYMENT_LABELS[st] }))],
          ] as Array<[keyof AdvFilter, string, Opt[]]>)
        : []),
      ["grade", "학년", GRADE_FILTER], // 점검 ADM-04 (2026-09-05)
      ["direction", "진로방향", optionsOf("career_direction")],
      ["counsel", "상담 희망", optionsOf("counsel_wish")],
      ["majorLink", "전공연계", optionsOf("major_link")],
      ["homeRegion", "본가지역", optionsOf("home_region")],
      ["region", "희망 취업 지역", optionsOf("region")],
      ["jobGroup", "희망직무 분야", optionsOf("desired_job_group")],
      ["timing", "취업 희망시기", optionsOf("employment_timing")],
      ["gov", "정부지원 의향", optionsOf("gov_link")],
      [
        "cert",
        "자격증",
        [
          { value: "OWNED", label: "보유 있음" },
          { value: "PREPARING", label: "준비·목표만" },
          { value: "NONE", label: "미입력" },
        ],
      ],
      ["certCat", "자격 분류", CERT_CATEGORIES],
    ] as Array<[keyof AdvFilter, string, Opt[]]>
  );

  return (
    <>
      {showOutreach && (
        <div className="filter-bar">
          <button
            className={`chip chip--queue ${queueOnly ? "chip--on" : ""}`}
            onClick={() => setQueueOnly((v) => !v)}
            title="상담희망 또는 Level 3 이상 + 미연락·무응답 학생만"
          >
            📞 연락 우선 큐 ({students.filter(needsOutreach).length})
          </button>
          <button
            className={`chip chip--queue ${followupOnly ? "chip--on" : ""}`}
            onClick={() => setFollowupOnly((v) => !v)}
            title="외부기관 연계 완료·사후관리 중인 학생만"
          >
            🔗 연계 사후관리 ({students.filter(inFollowup).length})
          </button>
        </div>
      )}
      <div className="filter-bar">
        {PRESETS.map((p) => (
          <button
            key={p.key}
            className={`chip ${presets.has(p.key) ? "chip--on" : ""}`}
            onClick={() =>
              setPresets((prev) => {
                const next = new Set(prev);
                if (next.has(p.key)) next.delete(p.key);
                else next.add(p.key);
                return next;
              })
            }
          >
            {p.label}
          </button>
        ))}
        {/* 중복 의심 — 같은 휴대전화(또는 성명+학과)로 학번이 다른 응답. 표시만 하고 정리는 사람이 (2026-09-05) */}
        <button
          className={`chip ${dupOnly ? "chip--on" : ""}`}
          disabled={duplicates.size === 0 && !dupOnly}
          onClick={() => setDupOnly((v) => !v)}
          title="같은 휴대전화 또는 같은 성명·학과로 서로 다른 학번의 응답이 있는 학생 — 학번 오기입 재응시 의심"
        >
          ⚠ 중복 의심 ({duplicates.size})
        </button>
        {presets.size > 1 && <span className="muted small filter-bar__hint">선택한 조건 모두 충족(AND)</span>}
      </div>
      <div className="filter-bar">
        {[1, 2, 3, 4].map((l) => (
          <button
            key={l}
            className={`chip ${levelFilter === l ? "chip--on" : ""}`}
            onClick={() => setLevelFilter(levelFilter === l ? null : l)}
          >
            Level {l}
          </button>
        ))}
        <select className="input filter-bar__select" value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)}>
          <option value="">전체 학과</option>
          {depts.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
        <input
          className="input filter-bar__search"
          placeholder="이름·학번 검색"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* 상세 필터 — 대상자 정밀 추출 (전공연계·지역·직무분야·자격증 등) */}
      <details className="card adv-filter" open>
        <summary>상세 필터 {Object.values(adv).some(Boolean) && <span className="adv-filter__on">적용 중</span>}</summary>
        <div className="adv-filter__grid">
          {/* 검사 실시일 기간 — 기간별 대상자 취합·CSV 추출 (2026-08-31) */}
          <label className="adv-filter__field adv-filter__field--range">
            <span>실시일 기간</span>
            <div className="adv-filter__range">
              <input
                type="date"
                className="input"
                value={adv.dateFrom}
                max={adv.dateTo || undefined}
                onChange={(e) => setAdv((prev) => ({ ...prev, dateFrom: e.target.value }))}
              />
              <span className="muted">~</span>
              <input
                type="date"
                className="input"
                value={adv.dateTo}
                min={adv.dateFrom || undefined}
                onChange={(e) => setAdv((prev) => ({ ...prev, dateTo: e.target.value }))}
              />
            </div>
          </label>
          {/* JAS 범위 — 컷오프 직전(예: 60~69) 학생을 따로 모아 연락하는 용도 (점검 ADM-04, 2026-09-05) */}
          <label className="adv-filter__field adv-filter__field--range">
            <span>JAS 범위 (0~100)</span>
            <div className="adv-filter__range">
              <input
                type="number"
                className="input"
                min={0}
                max={100}
                placeholder="최소"
                value={adv.jasMin}
                onChange={(e) => setAdv((prev) => ({ ...prev, jasMin: e.target.value }))}
              />
              <span className="muted">~</span>
              <input
                type="number"
                className="input"
                min={0}
                max={100}
                placeholder="최대"
                value={adv.jasMax}
                onChange={(e) => setAdv((prev) => ({ ...prev, jasMax: e.target.value }))}
              />
            </div>
            {adv.jasMin !== "" && adv.jasMax !== "" && Number(adv.jasMin) > Number(adv.jasMax) && (
              <span className="muted small" style={{ color: "#b42318" }}>⚠ 최소가 최대보다 큽니다 — 결과가 0명이 됩니다</span>
            )}
          </label>
          {advFields.map(([field, label, opts]) => (
            <label className="adv-filter__field" key={field}>
              <span>{label}</span>
              <select
                className="input"
                value={adv[field]}
                onChange={(e) => setAdv((prev) => ({ ...prev, [field]: e.target.value }))}
              >
                <option value="">전체</option>
                {opts.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </label>
          ))}
        </div>
        <div className="adv-filter__actions">
          <button className="btn btn--ghost" onClick={() => setAdv(EMPTY_ADV)}>필터 초기화</button>
        </div>
      </details>

      <div className="filter-result-bar">
        <p className="muted filter-count">
          {filtered.length}명
          <select
            className="input filter-bar__select filter-count__sort"
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            title="명단 정렬 기준"
          >
            {sortOptions.map(([key, label]) => (
              <option key={key} value={key}>정렬: {label}</option>
            ))}
          </select>
        </p>
        <div className="filter-result-bar__dl">
          {/* 조회 중·실패 상태에서는 헤더만 있는 CSV가 나간다 — 버튼을 잠근다 (점검 A12) */}
          <button
            className="btn btn--primary btn--sm"
            disabled={!dataReady}
            title={dataReady ? undefined : "학생 응답을 불러온 뒤 내려받을 수 있습니다"}
            onClick={() => exportSheet("01_학생상태", filtered, { includeOutreach: showOutreach })}
          >
            필터 결과 CSV (운영용)
          </button>
          <button className="btn btn--ghost btn--sm" disabled={!dataReady} onClick={() => exportSheetForResearch("01_학생상태", filtered)}>
            필터 결과 CSV (익명)
          </button>
        </div>
      </div>
      {/* 마스터 전용 — 필터 결과 일괄 삭제 (테스트 응답 정리). 실시일 기간 필터로 범위를 좁힌 뒤 사용 (2026-09-05) */}
      {isMaster && source === "CLOUD" && (
        <div className="danger-bar">
          <button
            className="btn btn--danger btn--sm"
            disabled={delBusy || filtered.length === 0}
            title="현재 필터에 보이는 응답을 모두 삭제합니다 — 실시일 기간 필터로 범위를 먼저 좁히세요"
            onClick={() => void deleteFiltered(filtered)}
          >
            {delBusy ? "삭제 중…" : `🗑 필터 결과 ${filtered.length}건 삭제 (마스터)`}
          </button>
          <span className="muted">예: 시범 운영 시작일 전 테스트 응답 → 위 "실시일 기간"을 그날 전까지로 두고 삭제</span>
        </div>
      )}
      {delMsg && <p className={`profile-edit__msg ${delMsg.ok ? "profile-edit__msg--ok" : "profile-edit__msg--err"}`}>{delMsg.text}</p>}
      <div className="table-wrap table-wrap--list card">
        {/* --list: 15열 명단이 가로 스크롤 없이 한 화면에 들어가는 밀도 (글자 축약 없음, 2026-09-02) */}
        <table className="admin-table admin-table--hover admin-table--list">
          <thead>
            <tr>
              <th>실시일</th><th>학번</th><th>성명</th><th>연락처</th><th>학과</th><th>학년</th><th>진로방향</th>
              <th>전공연계</th><th>JAS</th><th>Level</th><th>희망시기</th><th>상담</th>
              {showOutreach && <><th>연락상태</th><th>외부연계</th><th>취업</th></>}
            </tr>
          </thead>
          <tbody>
            {filtered.map((s) => {
              const st = statusOf(outreach, s.student_id);
              return (
                <tr
                  key={`${s.semester || "s"}_${s.student_id}`}
                  tabIndex={0}
                  role="button"
                  aria-label={`${s.name} 상세 보기`}
                  onClick={() => { setDetail(s); setEditing(false); setEditMsg(null); }}
                  // 키보드로도 상세를 열 수 있게 (점검 A14 — 명단 행이 마우스 전용이었다)
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setDetail(s);
                      setEditing(false);
                      setEditMsg(null);
                    }
                  }}
                >
                  <td className="small" title={s.completed_at}>{localDateStr(s.completed_at) || "—"}</td>
                  <td>{s.student_id}</td>
                  <td>
                    <strong>{s.name}</strong>
                    {duplicates.has(s.student_id) && (
                      <span className="dup-badge" title={duplicates.get(s.student_id)!.reasons.map((r) => DUP_REASON_LABELS[r]).join(" · ")}>
                        중복?
                      </span>
                    )}
                  </td>
                  <td className="num">
                    {/* 행 클릭(모달)과 분리 — 전화 걸기/복사용. 구버전 무연락처 응답은 "—" */}
                    {s.phone ? (
                      <a href={`tel:${s.phone.replace(/-/g, "")}`} onClick={(e) => e.stopPropagation()}>
                        {s.phone}
                      </a>
                    ) : (
                      <span className="muted small">—</span>
                    )}
                  </td>
                  <td>{s.dept}</td>
                  <td>{gradeLabel(s.grade)}</td>
                  <td>{surveyAnswerLabel("career_direction", s.survey.career_direction)}</td>
                  <td>{s.unscored.major_link === "Y" ? "전공진출" : s.unscored.major_link === "N" ? "방향전환" : "—"}</td>
                  <td className="num">{s.result.jas}</td>
                  <td><span className={`lv-badge lv-badge--l${s.result.level}`}>L{s.result.level} {LEVEL_NAMES[s.result.level]}</span></td>
                  <td>{surveyAnswerLabel("employment_timing", s.survey.employment_timing)}</td>
                  {/* 설문 희망 / 결과지에서 상담 신청 버튼(이중장치) / 없음 (2026-09-05) */}
                  <td title={s.counsel_requested_at ? `결과지 상담 신청 ${localDateTimeStr(s.counsel_requested_at)}` : undefined}>
                    {s.survey.counsel_wish === "YES" ? "희망" : s.counsel_requested_at ? "신청" : "—"}
                  </td>
                  {showOutreach && (
                    <>
                      <td><span className={`outreach-badge outreach-badge--${st.toLowerCase()}`}>{OUTREACH_LABELS[st]}</span></td>
                      <td>
                        {(() => {
                          const rf = referralStageOf(outreach, s.student_id);
                          return rf === "NONE" ? (
                            <span className="muted small">—</span>
                          ) : (
                            <span className={`ref-badge ref-badge--${rf.toLowerCase()}`}>{REFERRAL_LABELS[rf]}</span>
                          );
                        })()}
                      </td>
                      <td>
                        {(() => {
                          const em = employmentStatusOf(outreach, s.student_id);
                          return em === "NONE" ? (
                            <span className="muted small">—</span>
                          ) : (
                            <span className={`emp-badge emp-badge--${em.toLowerCase()}`}>{EMPLOYMENT_LABELS[em]}</span>
                          );
                        })()}
                      </td>
                    </>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {detail && (
        <div className="modal-backdrop" onClick={closeDetail}>
          <div
            className="modal card admin-detail"
            role="dialog"
            aria-modal="true"
            aria-label={`${detail.name} 학생 상세`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="admin-detail__head">
              <div>
                <h3>{detail.name} <span className="muted">({detail.student_id} · {detail.dept} {gradeLabel(detail.grade)})</span></h3>
                <p className="admin-detail__phone">
                  📞 {detail.phone ? <a href={`tel:${detail.phone.replace(/-/g, "")}`}>{detail.phone}</a> : <span className="muted">연락처 없음</span>}
                  {!editing && (
                    <button
                      className="btn btn--ghost btn--sm profile-edit__open"
                      disabled={source !== "CLOUD"}
                      title={source !== "CLOUD" ? "실측 데이터(Firebase 연결) 상태에서만 수정할 수 있습니다" : "학생이 잘못 입력한 기본 정보를 교정합니다"}
                      onClick={() => openEdit(detail)}
                    >
                      ✏ 정보 수정
                    </button>
                  )}
                  {/* 응답 삭제 — 마스터만, 실측 모드만 (2026-09-05) */}
                  {isMaster && !editing && (
                    <button
                      className="btn btn--danger btn--sm profile-edit__open"
                      disabled={source !== "CLOUD" || delBusy}
                      title="이 학생의 이번 학기 응답과 상담 기록을 삭제합니다 (복구 불가)"
                      onClick={() => void deleteOne(detail)}
                    >
                      {delBusy ? "삭제 중…" : "🗑 응답 삭제"}
                    </button>
                  )}
                </p>
                <span className={`lv-badge lv-badge--l${detail.result.level}`}>
                  Level {detail.result.level} · {LEVEL_NAMES[detail.result.level]}
                </span>
                {detail.result.routeTag === "FURTHER_STUDY_STARTUP" && <span className="lv-badge">진학·창업 Route</span>}
              </div>
              <button className="btn btn--ghost" onClick={closeDetail}>✕ 닫기</button>
            </div>

            {/* 학생 기본 정보 교정 — 학번·성명·학과·학년·연락처 (설문 응답·판정·실시일은 무변경) */}
            {editing && (
              <section className="card profile-edit">
                <h4>학생 정보 수정 <span className="muted small">— 잘못 입력된 기본 정보만 교정합니다. 응답·판정 결과는 바뀌지 않습니다.</span></h4>
                <div className="profile-edit__grid">
                  <label className="adv-filter__field">
                    <span>학번{!canMoveId && <span className="muted small"> (상담사 계정에서만 변경)</span>}</span>
                    <input className="input" value={editForm.student_id} readOnly={!canMoveId}
                      title={canMoveId ? undefined : "학번 변경은 상담 기록이 함께 이동해야 하므로 상담사 계정에서만 가능합니다"}
                      onChange={(e) => setEditForm((f) => ({ ...f, student_id: e.target.value }))} />
                  </label>
                  <label className="adv-filter__field">
                    <span>성명</span>
                    <input className="input" value={editForm.name}
                      onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))} />
                  </label>
                  <label className="adv-filter__field">
                    <span>학과</span>
                    <input className="input" value={editForm.dept}
                      onChange={(e) => setEditForm((f) => ({ ...f, dept: e.target.value }))} />
                  </label>
                  <label className="adv-filter__field">
                    <span>학년</span>
                    <div className="adv-filter__range">
                      <select className="input" value={editForm.gradeSel}
                        onChange={(e) => setEditForm((f) => ({ ...f, gradeSel: e.target.value }))}>
                        {/* 구버전 값("1"~"3" 등)은 그대로 두는 선택지를 함께 노출 */}
                        {!GRADE_OPTIONS.some(([v]) => v === editForm.gradeSel) && editForm.gradeSel !== "졸업" && (
                          <option value={editForm.gradeSel}>{gradeLabel(editForm.gradeSel)} (기존값)</option>
                        )}
                        {GRADE_OPTIONS.map(([v, l]) => (
                          <option key={v} value={v}>{l}</option>
                        ))}
                      </select>
                      {editForm.gradeSel === "졸업" && (
                        <input className="input" inputMode="numeric" maxLength={4} placeholder="졸업 연도"
                          value={editForm.gradeYear}
                          onChange={(e) => setEditForm((f) => ({ ...f, gradeYear: e.target.value.replace(/\D/g, "") }))} />
                      )}
                    </div>
                  </label>
                  <label className="adv-filter__field">
                    <span>휴대전화</span>
                    <input className="input" inputMode="numeric" value={editForm.phone}
                      onChange={(e) => setEditForm((f) => ({ ...f, phone: e.target.value }))} />
                  </label>
                </div>
                {editForm.student_id.trim() !== detail.student_id && (
                  <p className="muted small">⚠ 학번을 바꾸면 응답 기록이 새 학번으로 이동합니다. 학번이 정확한지 다시 확인해 주세요.</p>
                )}
                <div className="profile-edit__actions">
                  <button className="btn btn--primary btn--sm" disabled={editBusy} onClick={() => void saveEdit(detail)}>
                    {editBusy ? "저장 중…" : "저장"}
                  </button>
                  <button className="btn btn--ghost btn--sm" disabled={editBusy}
                    onClick={() => { setEditing(false); setEditMsg(null); }}>
                    취소
                  </button>
                </div>
              </section>
            )}
            {editMsg && <p className={`profile-edit__msg ${editMsg.ok ? "profile-edit__msg--ok" : "profile-edit__msg--err"}`}>{editMsg.text}</p>}

            {/* 중복 의심 안내 — 같은 사람으로 보이는 다른 학번의 응답 목록 (2026-09-05) */}
            {duplicates.has(detail.student_id) && (
              <div className="dup-note">
                ⚠ <strong>중복 등록 의심</strong> ({duplicates.get(detail.student_id)!.reasons.map((r) => DUP_REASON_LABELS[r]).join(" · ")}) —
                같은 학생이 학번을 다르게 입력해 두 번 응시했을 수 있습니다. 확인 후 잘못된 쪽을
                {canMoveId ? " \"정보 수정\"으로 학번을 바로잡거나" : ""} {isMaster ? "\"응답 삭제\"로 정리해 주세요." : "마스터에게 삭제를 요청해 주세요."}
                <ul>
                  {duplicates.get(detail.student_id)!.others.map((o) => (
                    <li key={`${o.semester}_${o.student_id}`}>
                      학번 <strong>{o.student_id}</strong> · {o.name} · {o.dept} {gradeLabel(o.grade)} · {o.phone || "연락처 없음"} ·
                      실시일 {localDateStr(o.completed_at) || "—"} · JAS {o.result.jas} · L{o.result.level}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* 통합 상담 카드 — 상담사 워크스페이스에서만 노출·수정 (담당자 화면에는 없음) */}
            {showOutreach && (
              <CounselRecord
                key={detail.student_id}
                student={detail}
                entry={outreach[detail.student_id]}
                by={session.name}
                agencies={loadAgencies()}
                onSave={(next) => setOutreach(next)}
                onDirtyChange={setCounselDirty}
              />
            )}

            <div className="admin-detail__grid">
              <section>
                <h4>지표</h4>
                <p>JAS <strong>{detail.result.jas}</strong> · JRS <strong>{detail.result.jrs ?? "—"}</strong> · CDS <strong>{detail.result.cds ?? "—"}</strong></p>
                <h4>판정 근거</h4>
                <ul className="reason-list">
                  {detail.result.reasons.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
                <h4>영역 점수</h4>
                <ul className="reason-list">
                  {Object.entries(detail.result.domainScores).map(([d, v]) => (
                    <li key={d}>
                      {domainLabels[d]}: {v?.toFixed(1) ?? "—"}
                      {detail.weak.some((w) => w.domain === d) ? " ← 보완영역" : ""}
                    </li>
                  ))}
                </ul>
              </section>
              <section>
                <h4>설문 원응답</h4>
                <ul className="reason-list">
                  {Object.entries(detail.survey).map(([k, v]) => (
                    <li key={k}>{labelOf(k)}: {surveyAnswerLabel(k, v)}</li>
                  ))}
                  {detail.counsel_requested_at && (
                    <li>
                      <strong>결과지에서 상담 신청</strong>: {localDateTimeStr(detail.counsel_requested_at)}
                      {detail.survey.counsel_wish !== "YES" && <span className="muted"> (설문에서는 미희망 — 버튼으로 신청)</span>}
                    </li>
                  )}
                  <li>전공연계: {surveyAnswerLabel("major_link", detail.unscored.major_link)}</li>
                  <li>
                    본가 {surveyAnswerLabel("home_region", detail.unscored.home_region)} → 희망{" "}
                    {surveyAnswerLabel("region", detail.unscored.region)}
                  </li>
                  <li>희망직무 분야: {surveyAnswerLabel("desired_job_group", detail.unscored.desired_job_group)}</li>
                  <li>희망직무: {detail.unscored.desired_job || "—"}</li>
                  {/* 연구 연계·조건부 문항 — 응답이 있을 때만 표시 (상담 참고용) */}
                  {["non_employment_type", "career_shift_timing", "career_shift_reason", "prep_difficulty", "roadmap_demand"].map(
                    (k) =>
                      detail.unscored[k] ? (
                        <li key={k}>{labelOf(k)}: {surveyAnswerLabel(k, detail.unscored[k])}</li>
                      ) : null
                  )}
                  <li>
                    자격증:{" "}
                    {detail.certs
                      .map((c) => {
                        const cat = (c as { category?: string }).category;
                        const status = c.status === "OWNED" ? "보유" : c.status === "PREPARING" ? "준비 중" : "목표";
                        return `${c.cert_name}${cat ? ` [${certCategoryLabel(cat)}]` : ""} · ${status}`;
                      })
                      .join(", ") || "—"}
                  </li>
                </ul>
                <h4>추천활동 ({detail.recs.length})</h4>
                <ul className="reason-list">
                  {detail.recs.map((a) => (
                    <li key={a.recommendation_code}>
                      {a.name} <span className="muted">({a.owner === "CAREER" ? "진로" : "취업"}컨설턴트)</span>
                    </li>
                  ))}
                </ul>
              </section>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
