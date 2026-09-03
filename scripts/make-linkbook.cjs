// MJC-READY 링크북 (docx) — public/ 에 생성해 링크북 페이지에서 내려받게 한다.
//
// 주소가 바뀌거나 링크가 추가되면 이 스크립트의 entry()를 고치고 다시 생성한다.
// `docx`는 문서 생성 전용이라 프로젝트 의존성(package.json)에 넣지 않았다 — CI 설치 시간을
// 늘리지 않기 위해서다. 실행 시에만 임시로 설치한다:
//
//   npm i --no-save docx
//   node scripts/make-linkbook.cjs public/MJC-READY-linkbook.docx
//
// 파일명은 ASCII 유지(한글 파일명 URL 인코딩 문제 회피). 사용자에게는 links.html의
// download 속성이 "MJC-READY_링크북.docx"로 저장되게 한다 — 파일명을 바꾸려면 links.html도 같이 고칠 것.
// 생성 후 반드시 내용 확인: unzip 후 word/document.xml의 <w:t> 텍스트를 읽어 링크·문구를 대조한다.
const fs = require("fs");
const path = require("path");
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, ShadingType, BorderStyle,
} = require("docx");

const NAVY = "1F3A66";
const MUTED = "64708A";
const AMBER = "9A5B00";
const LINE = "DFE3EC";

const OUT = process.argv[2];
const TODAY = "2026-09-03";

// A4(11906) - 좌우 여백(1440*2) = 9026 DXA
const FULL = 9026;
const COL = [2100, 6926];

const t = (text, o = {}) => new TextRun({ text, font: "맑은 고딕", ...o });
const p = (text, o = {}) =>
  new Paragraph({ children: [t(text, o)], spacing: { after: o.after ?? 120 }, ...(o.align ? { alignment: o.align } : {}) });

/** 항목 표 한 줄 — 라벨/값 */
const row = (label, value, opts = {}) =>
  new TableRow({
    children: [
      new TableCell({
        width: { size: COL[0], type: WidthType.DXA },
        shading: { type: ShadingType.CLEAR, fill: "F4F6FB" },
        margins: { top: 80, bottom: 80, left: 120, right: 120 },
        children: [new Paragraph({ children: [t(label, { bold: true, color: NAVY, size: 19 })] })],
      }),
      new TableCell({
        width: { size: COL[1], type: WidthType.DXA },
        margins: { top: 80, bottom: 80, left: 120, right: 120 },
        children: [
          new Paragraph({
            children: [
              t(value, {
                size: opts.url ? 18 : 19,
                font: opts.url ? "Consolas" : "맑은 고딕",
                color: opts.url ? NAVY : "1C2436",
                bold: !!opts.url,
              }),
            ],
          }),
        ],
      }),
    ],
  });

const linkTable = (rows) =>
  new Table({
    columnWidths: COL,
    width: { size: FULL, type: WidthType.DXA },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: LINE },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: LINE },
      left: { style: BorderStyle.SINGLE, size: 4, color: LINE },
      right: { style: BorderStyle.SINGLE, size: 4, color: LINE },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: LINE },
      insideVertical: { style: BorderStyle.SINGLE, size: 4, color: LINE },
    },
    rows,
  });

/** 링크 한 건 = 제목 + 표 */
function entry({ title, badge, target, url, note }) {
  const out = [
    new Paragraph({
      children: [
        t(title, { bold: true, size: 24, color: NAVY }),
        ...(badge ? [t("   " + badge, { size: 17, color: MUTED })] : []),
      ],
      spacing: { before: 240, after: 100 },
    }),
  ];
  const rows = [row("대상 · 용도", target)];
  if (url) rows.push(row("주소", url, { url: true }));
  if (note) rows.push(row("유의", note));
  out.push(linkTable(rows));
  return out;
}

const doc = new Document({
  creator: "명지전문대학 학생지원처 취·창업팀",
  title: "MJC-READY 링크북",
  description: "MJC-READY 진로·취업 상태진단 시스템 접속 주소 모음",
  sections: [
    {
      properties: { page: { margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } },
      children: [
        // ── 표지 머리 ──
        new Paragraph({
          children: [t("MJC-READY · 진로·취업 상태진단", { size: 18, color: AMBER, bold: true })],
          spacing: { after: 80 },
        }),
        new Paragraph({
          children: [t("MJC-READY 링크북", { size: 40, bold: true, color: NAVY })],
          spacing: { after: 120 },
          border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: NAVY, space: 8 } },
        }),
        new Paragraph({
          children: [
            t("명지전문대학 진로·취업 상태진단 시스템의 접속 주소 모음입니다.", { size: 19, color: MUTED }),
          ],
          spacing: { before: 160, after: 60 },
        }),
        new Paragraph({
          children: [
            t(`관리 부서: 학생지원처 취·창업팀    |    기준일: ${TODAY}`, { size: 18, color: MUTED }),
          ],
          spacing: { after: 320 },
        }),

        // ── 서비스 화면 ──
        new Paragraph({
          children: [t("서비스 화면", { bold: true, size: 26, color: NAVY })],
          heading: HeadingLevel.HEADING_1,
          spacing: { before: 200, after: 120 },
        }),
        ...entry({
          title: "학생 검사 페이지",
          badge: "학생 배포용",
          target: "진단 시작 화면(STEP 1). 학생에게 배포하는 유일한 링크로, 포스터·카톡 안내에는 이 주소만 사용합니다.",
          url: "https://monatory.github.io/mjc-jobready-pwa/",
        }),
        ...entry({
          title: "관리자 페이지",
          badge: "내부 전용",
          target: "담당자(행정)·담당자 관리자·마스터용 — 종합 현황, 대상자 필터·명단, 추천활동 관리, 데이터 다운로드.",
          url: "https://monatory.github.io/mjc-jobready-pwa/#/admin",
        }),
        ...entry({
          title: "잡카페 워크스페이스 (상담사)",
          badge: "내부 전용",
          target: "상담사·상담사 관리자용 — 연락 우선 큐, 통합 상담 카드, 외부기관 연계, 취업상태 관리.",
          url: "https://monatory.github.io/mjc-jobready-pwa/#/counsel",
          note: "상담사 계열 계정으로 로그인해야 열립니다. 학생·외부에 배포하지 마세요.",
        }),

        // ── 개발·운영 ──
        new Paragraph({
          children: [t("개발 · 운영", { bold: true, size: 26, color: NAVY })],
          heading: HeadingLevel.HEADING_1,
          spacing: { before: 400, after: 120 },
        }),
        ...entry({
          title: "GitHub 저장소",
          badge: "개발자",
          target: "소스 코드 저장소. main 브랜치에 push하면 Actions가 검증·테스트·빌드 후 자동 배포합니다.",
          url: "https://github.com/monatory/mjc-jobready-pwa",
        }),
        ...entry({
          title: "Firebase 콘솔 (mjc-ready-pwa)",
          badge: "개발자",
          target: "Firestore 데이터·보안 규칙·인증 관리. 규칙(firestore.rules) 게시도 여기서 합니다.",
          url: "https://console.firebase.google.com/project/mjc-ready-pwa",
        }),

        // ── 유의사항 ──
        new Paragraph({
          children: [t("배포 시 유의사항", { bold: true, size: 26, color: NAVY })],
          heading: HeadingLevel.HEADING_1,
          spacing: { before: 400, after: 120 },
        }),
        new Paragraph({
          children: [t("· 학생에게 배포하는 주소는 ", { size: 19 }), t("학생 검사 페이지 1종", { size: 19, bold: true, color: NAVY }), t("만 사용합니다.", { size: 19 })],
          spacing: { after: 80 },
        }),
        new Paragraph({
          children: [t("· 관리자 페이지·잡카페 워크스페이스는 내부 운영용입니다. 로그인 계정이 있어야 열리며, 주소를 외부에 배포하지 마세요.", { size: 19 })],
          spacing: { after: 80 },
        }),
        new Paragraph({
          children: [t("· 이 시스템은 학번·성명을 수집하는 실명 시스템입니다. 내려받은 명단·CSV는 개인정보 파일이므로 접근이 제한된 폴더에만 보관해 주세요.", { size: 19 })],
          spacing: { after: 80 },
        }),
        new Paragraph({
          children: [t(`· 주소가 바뀌면 이 문서도 다시 내려받아 주세요. (기준일 ${TODAY})`, { size: 19 })],
          spacing: { after: 240 },
        }),
        new Paragraph({
          children: [t("명지전문대학 학생지원처 취·창업팀 · AI융합진로지원센터", { size: 17, color: MUTED })],
          alignment: AlignmentType.CENTER,
          spacing: { before: 400 },
        }),
      ],
    },
  ],
});

Packer.toBuffer(doc).then((buf) => {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, buf);
  console.log("written:", OUT, buf.length, "bytes");
});
