// All participant-facing wording lives here, so the text can be changed without touching the flow.
// Static page text is bound with data-copy="key" (plain text) / data-copy-html="key" (markup) in
// index.html; strings built at runtime are read straight from COPY. Server error messages shown to
// participants come from here too. Survey items and the consent form text live elsewhere
// (survey_items.json / the consent text, still a placeholder).

export const PAYMENT_FORM_URL =
  "https://docs.google.com/forms/d/e/1FAIpQLSctcCGdfGRbwjpHhO0kD006nMBaia8M9pEwwUUAe1RvtuXoVg/viewform?usp=pp_url&entry.57221388=";
export const paymentFormLink = (participantId) => PAYMENT_FORM_URL + encodeURIComponent(participantId);

export const COPY = {
  // ---------- loading / ended / blocked ----------
  loading: "불러오는 중…",
  loadingTitle: "잠시만 기다려 주세요",
  noToken: "받으신 참여 링크로 접속해 주세요.",
  connectFail: (msg) => `서버에 연결하지 못했습니다 (${msg}). 잠시 후 다시 시도해 주세요.`,
  retryBtn: "다시 시도",
  blocked: {
    unsupported: ["브라우저를 확인해 주세요",
      "이 실험은 PC의 Chrome 브라우저에서만 참여할 수 있습니다. Chrome으로 같은 링크를 열어 주세요."],
    expired: ["기간이 지났습니다", "기간이 지났습니다. 연구자에게 문의해 주세요."],
    locked: ["진행할 수 없습니다", "더 이상 진행할 수 없습니다. 연구자에게 문의해 주세요."],
    abandoned: ["진행할 수 없습니다", "더 이상 진행할 수 없습니다. 연구자에게 문의해 주세요."],
    locked_error: ["문제가 생겼습니다", "진행 중 문제가 생겼습니다. 연구자에게 문의해 주세요."],
    other_window: ["다른 창에서 진행 중입니다",
      "이 연구는 다른 창(탭)에서 이미 진행 중입니다. 원래 창에서 계속해 주세요. 원래 창을 이미 닫았다면 1–2분 뒤 이 페이지를 새로고침해 주세요."],
    invalid: ["링크를 확인해 주세요", "유효하지 않은 링크입니다. 받으신 링크를 다시 확인하시거나 연구자에게 문의해 주세요."],
  },

  // ---------- consent ----------
  consentTitle: "연구 참여 동의",
  consentBody: "[자리표시] 동의서 본문이 여기에 들어갑니다.",
  consentWithdrawQ: "연구 참여를 중간에 그만두는 경우, 그때까지 수집된 자료를",
  consentWithdrawUse: "연구에 사용하는 것에 동의합니다.",
  consentWithdrawDestroy: "파기해 주시기 바랍니다.",
  consentNotifyQ: "연구와 관련하여 새로운 정보가 생기면 통보받기를",
  consentNotifyYes: "원합니다.",
  consentNotifyNo: "원하지 않습니다.",
  consentAgree: "위 내용을 읽고 연구 참여에 동의합니다.",
  consentPaymentNote: "사례비 지급에 필요한 정보는 실험이 끝난 뒤 별도 양식으로 받습니다.",
  consentStart: "참여 시작하기",
  consentChoicesMissing: "동의 확인과 두 가지 선택 항목에 모두 응답해 주세요.",
  consentFail: (msg) => `처리하지 못했습니다 (${msg}). 다시 눌러주세요.`,
  slotsExhausted: "배정할 조건이 남아 있지 않습니다. 연구자에게 문의해 주세요.",
  consentRequired: "동의가 필요합니다.",
  consentChoicesRequired: "필수 선택 항목에 모두 응답해 주세요.",

  // ---------- device test ----------
  deviceTitle: "장치 테스트",
  speakerTitle: "1. 스피커",
  speakerGuide: "소리가 들리면 편하게 들리는 크기로 볼륨을 조절한 뒤 다음으로 넘어가 주세요. 소리가 들리지 않으면 스피커나 이어폰 연결과 볼륨을 확인해 주세요.",
  speakerPlay: "재생",
  speakerReplay: "다시 재생",
  speakerNext: "다음",
  micTitle: "2. 마이크",
  micGuide: "아래 문장을 소리 내어 읽어 주세요.",
  micSentence: "오늘은 하늘이 맑고 바람이 시원하게 붑니다.",
  micNote: "실제 면접 답변에서는 인식 결과가 화면에 표시되지 않습니다.",
  micAllow: "마이크 사용 허용",
  micDenied: "마이크 사용이 차단되어 있습니다. 주소창 왼쪽의 자물쇠(또는 설정) 아이콘을 눌러 [마이크]를 [허용]으로 바꾼 뒤 아래 버튼을 눌러 주세요.",
  micUnavailable: "마이크를 찾을 수 없습니다. 마이크 연결을 확인한 뒤 다시 시도해 주세요.",
  micStart: "읽기 시작",
  micStop: "읽기 완료",
  micRetry: "다시 시도",
  micListening: "듣고 있습니다… 문장을 읽은 뒤 [읽기 완료]를 눌러 주세요.",
  micResult: "인식 결과",
  micEmpty: "인식된 내용이 없습니다. 마이크 상태를 확인한 뒤 다시 시도해 주세요.",
  micNext: "다음",
  micSttError: (code) => `인식 오류: ${code}`,
  micStuck: "계속 인식되지 않으면 연구자에게 문의해 주세요.",

  // ---------- surveys ----------
  surveyProgress: { pre: "사전 설문", mid: "자기 평가", post: "사후 설문" },
  surveyOf: (phase, i, n) => (n > 1 ? `${COPY.surveyProgress[phase]} ${i} / ${n}` : COPY.surveyProgress[phase]),
  surveyNext: "다음",
  surveySubmit: "제출",
  surveyMissing: (n) => `응답하지 않은 문항이 ${n}개 있습니다. 모든 문항에 응답해주세요.`,
  surveySaveFail: (msg) => `저장하지 못했습니다 (${msg}). 다시 눌러주세요. 계속되면 연구자에게 알려주세요.`,
  surveyFill: "테스트 응답 채우기",

  // ---------- scenario ----------
  scenarioTitle: "안내",
  scenarioBody: [
    "당신은 꼭 가고 싶었던 회사의 서류 전형에 합격해, 일주일 뒤 면접을 앞두고 있습니다.",
    "면접을 준비하기 위해 AI 코치와 면접 연습을 해보기로 했습니다.",
    "면접 질문에 답변하면 AI 코치가 답변에 대한 피드백을 줍니다.",
    "질문에는 본인의 실제 경험을 바탕으로 답변해 주세요.",
  ].join("\n"),
  scenarioStart: "면접 연습 시작",

  // ---------- question / answering ----------
  coachLabel: "AI 코치",
  questionTitle: "면접 질문",
  questionGuide: "질문을 읽고 생각할 시간 40초가 주어집니다. 준비가 되면 먼저 답변을 시작해도 됩니다. 답변은 최대 2분이며, 답변하는 동안 인식 결과는 화면에 표시되지 않습니다.",
  thinkLabel: "남은 생각 시간",
  answerStart: "답변 시작",
  answerStarting: "마이크를 준비하는 중…",
  answeringStatus: "듣고 있습니다… 답변이 끝나면 [답변 완료]를 눌러주세요.",
  answerElapsed: "경과 시간",
  answerLimit: "최대 2분",
  answerDone: "답변 완료",
  answerFinishing: "답변을 정리하는 중…",
  micFail: "마이크를 시작하지 못했습니다. 마이크 권한과 연결을 확인한 뒤 다시 시도해 주세요.",
  sttFail: (code) => `음성 인식 오류: ${code}`,
  answerReanswer: "이전 답변이 저장되지 않았습니다. 한 번 더 답변해 주세요.",
  answerAskAgain: "답변이 거의 인식되지 않았습니다. 마이크를 확인한 뒤 한 번 더 답변해 주세요.",
  answerSubmitFail: (msg) => `답변을 전송하지 못했습니다 (${msg}). 다시 눌러주세요.`,

  // ---------- feedback ----------
  loadingFeedback: "AI 코치가 피드백을 준비하고 있습니다.",
  feedbackTitle: "AI 코치 피드백",
  feedbackError: "문제가 발생했습니다. [다시 시도]를 눌러주세요. 계속되면 연구자에게 알려주세요.",
  toSurvey: "설문으로 넘어가기",

  // ---------- debrief / end ----------
  debriefTitle: "연구 안내",
  debriefBody: [
    "참여해 주셔서 감사합니다.",
    "이 연구는 AI 코치가 피드백을 전달하는 방식에 따라 사람들이 피드백을 어떻게 경험하는지 알아보기 위한 연구입니다.",
    "참여자마다 서로 다른 방식으로 표현된 피드백을 받았으며, 오늘 받은 피드백은 연구를 위해 설계된 것으로 실제 면접 역량을 평가한 결과가 아닙니다.",
    "연구가 진행 중이므로, 실험 내용을 다른 분께 공유하지 말아 주시기를 부탁드립니다.",
  ].join("\n"),
  debriefConfirm: "확인",
  debriefFail: (msg) => `처리하지 못했습니다 (${msg}). 다시 눌러주세요.`,
  completeFail: (msg) => `제출하지 못했습니다 (${msg}). 다시 눌러주세요.`,
  endTitle: "실험이 모두 끝났습니다",
  endBody: "실험이 모두 끝났습니다. 감사합니다.\n사례비 지급을 위해 아래 양식을 작성해 주세요. 참가자 번호는 자동으로 입력되어 있습니다.",
  endPaymentBtn: "사례비 지급 정보 입력",
  endClose: "이제 이 창을 닫으셔도 됩니다.",

  // ---------- dev mode ----------
  devInject: "— 테스트 대본 주입 —",
};
