// 중복 등록 의심 탐지 (2026-09-05 사용자 요구).
//
// 같은 학기에 같은 학번으로 다시 응시하면 문서 키("{학기}_{학번}")가 같아 최신 응답으로 덮어써지므로
// 학번이 정확한 한 중복은 생기지 않는다(§7.1). 문제는 **학번을 잘못 입력한 재응시** — 서로 다른 학번의
// 두 응답이 사실은 한 학생인 경우다. 학생 화면은 다른 응답을 읽을 권한이 없어(규칙) 제출 시점에 막을 수
// 없으므로, 관리자·상담사 명단에서 다음 단서로 "중복 의심"을 표시한다:
//   ① 휴대전화(숫자만 비교)가 같은데 학번이 다름 — 가장 강한 단서 (휴대전화는 필수 수집)
//   ② 성명+학과가 같은데 학번이 다름 — 보조 단서 (동명이인 가능, 확인 필요)
// 같은 학번이 여러 학기에 걸쳐 있는 것은 정상(학기별 누적)이므로 중복으로 보지 않는다.
// 표시만 하고 자동 병합·삭제는 하지 않는다 — 어느 응답이 진짜인지는 사람이 판단해 "정보 수정"(학번 교정)
// 또는 마스터의 "응답 삭제"로 정리한다.
import type { StudentRecord } from "./mockStudents";

export interface DupInfo {
  /** 어떤 단서로 묶였는지 */
  reasons: Array<"PHONE" | "NAME_DEPT">;
  /** 같은 사람으로 의심되는 다른 응답들 (본인 학번 제외, 학번 기준 중복 제거) */
  others: StudentRecord[];
}

const phoneKey = (s: StudentRecord): string => {
  const digits = (s.phone ?? "").replace(/\D/g, "");
  return digits.length >= 10 ? digits : "";
};
const nameDeptKey = (s: StudentRecord): string => {
  const name = (s.name ?? "").replace(/\s+/g, "");
  const dept = (s.dept ?? "").replace(/\s+/g, "");
  return name && dept ? `${name}|${dept}` : "";
};

/** 학번 → 중복 의심 정보. 의심이 없는 학번은 키가 없다.
 *  그룹 크기 m에 대해 선형 — 같은 값이 수백 명에 몰린 자료(임시 번호 오입력 등)에서 O(m³)로 멈추던 것 (점검 낮음) */
export function findDuplicates(students: StudentRecord[]): Map<string, DupInfo> {
  const out = new Map<string, DupInfo>();
  const groupBy = (keyOf: (s: StudentRecord) => string, reason: DupInfo["reasons"][number]) => {
    const groups = new Map<string, StudentRecord[]>();
    for (const s of students) {
      const k = keyOf(s);
      if (!k) continue;
      const g = groups.get(k);
      if (g) g.push(s);
      else groups.set(k, [s]);
    }
    for (const members of groups.values()) {
      // 학번별 대표 1건(첫 등장) — 다학기 같은 학번은 한 사람이므로 하나로 묶는다
      const byId = new Map<string, StudentRecord>();
      for (const m of members) if (!byId.has(m.student_id)) byId.set(m.student_id, m);
      if (byId.size < 2) continue; // 같은 학번(다학기)만 있으면 정상
      const reps = [...byId.values()];
      for (const rep of reps) {
        const info = out.get(rep.student_id) ?? { reasons: [], others: [] };
        if (!info.reasons.includes(reason)) info.reasons.push(reason);
        const seen = new Set(info.others.map((o) => o.student_id));
        for (const o of reps) {
          if (o.student_id === rep.student_id || seen.has(o.student_id)) continue;
          info.others.push(o);
          seen.add(o.student_id);
        }
        out.set(rep.student_id, info);
      }
    }
  };
  groupBy(phoneKey, "PHONE");
  groupBy(nameDeptKey, "NAME_DEPT");
  return out;
}

export const DUP_REASON_LABELS: Record<DupInfo["reasons"][number], string> = {
  PHONE: "휴대전화 동일",
  NAME_DEPT: "성명·학과 동일",
};
