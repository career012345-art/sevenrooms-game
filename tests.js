/* ============================================================
   세븐 룸즈 — 자동 테스트
   실행 방법 ① test.html 을 브라우저로 열기 (추천)
   실행 방법 ② 터미널에서: node tests.js
   ============================================================ */
(function () {
  "use strict";

  var isNode = (typeof window === "undefined");
  var Engine, CONTENT;

  if (isNode) {
    globalThis.window = globalThis;           // content.js 가 window 를 쓰므로
    require("./content.js");
    Engine = require("./engine.js");
    CONTENT = globalThis.GAME_CONTENT;
  } else {
    Engine = window.GameEngine;
    CONTENT = window.GAME_CONTENT;
  }

  var results = [];
  function test(name, fn) {
    try { fn(); results.push({ name: name, pass: true }); }
    catch (e) { results.push({ name: name, pass: false, error: e.message }); }
  }
  function assert(cond, msg) { if (!cond) throw new Error(msg || "검증 실패"); }
  function assertEqual(actual, expected, msg) {
    if (actual !== expected)
      throw new Error((msg || "값 불일치") + " — 기대값: " + expected + ", 실제값: " + actual);
  }

  /* ---------- 테스트용 표준 설정 ---------- */
  var S = {
    badgeThresholdPercent: 60,
    truthRoomMinBadges: 3,
    minHangulSyllables: 5,
    liteMinHangul: 2,
    minLatinChars: 10,
    sincereBonusChars: 50,
    shortSincereChars: 15,
    scores: { base: 10, sincereBonus: 5, resultBonus: 5, episodeBonus: 10 },
    resultKeywords: ["%", "완성", "수상"]
  };

  // 지정한 길이의 "의미 있는 한글 텍스트" 생성 (도배 판정에 안 걸리는 다양한 음절)
  var POOL = "가나다라마바사아자차카타파하거너더러머버서어저처커터퍼허고노도로모보소오조초코토포호구누두루무부주추쿠투푸후기니디리미비시이지치키티피히";
  function ktext(n) {
    var s = "";
    for (var i = 0; i < n; i++) s += POOL[i % POOL.length];
    return s;
  }

  /* ============================================================
     1. 콘텐츠 검증 테스트 — content.js 를 수정해도 실수를 잡아줌
     ============================================================ */
  test("실제 콘텐츠(content.js)에 오류가 없다", function () {
    var errors = Engine.validateContent(CONTENT);
    assert(errors.length === 0, "콘텐츠 오류:\n" + errors.join("\n"));
  });

  test("문항 id 가 중복되면 오류를 찾아낸다", function () {
    var bad = JSON.parse(JSON.stringify(CONTENT));
    bad.rooms[1].questions[0].id = bad.rooms[0].questions[0].id;
    var errors = Engine.validateContent(bad);
    assert(errors.some(function (e) { return e.indexOf("중복") !== -1; }), "중복 id를 잡지 못함");
  });

  test("문항이 없는 방은 오류를 찾아낸다", function () {
    var bad = JSON.parse(JSON.stringify(CONTENT));
    bad.rooms[0].questions = [];
    var errors = Engine.validateContent(bad);
    assert(errors.length > 0, "빈 문항 방을 잡지 못함");
  });

  test("type 오타(예: epsode)를 찾아낸다", function () {
    var bad = JSON.parse(JSON.stringify(CONTENT));
    bad.rooms[0].questions[0].type = "epsode";
    var errors = Engine.validateContent(bad);
    assert(errors.some(function (e) { return e.indexOf("type") !== -1; }), "type 오타를 잡지 못함");
  });

  /* ============================================================
     2. 한글 인식·낙서 차단 테스트
     ============================================================ */
  var TQ = { id: "tq1", type: "text", text: "질문" };
  var EQ = { id: "eq1", type: "episode", text: "에피소드 질문" };

  test("★ 영문 낙서(dfdfdf) → 무응답 0점", function () {
    var r = Engine.scoreAnswer(TQ, { text: "dfdfdf" }, S);
    assertEqual(r.points, 0);
    assertEqual(r.answered, false);
  });

  test("★ 자음 낙서(ㅇㄹㅇㄹㅇㄹ) → 무응답 0점", function () {
    var r = Engine.scoreAnswer(TQ, { text: "ㅇㄹㅇㄹㅇㄹ" }, S);
    assertEqual(r.points, 0);
    assertEqual(r.answered, false);
  });

  test("★ 같은 글자 도배(가가가가가가가가) → 무응답 0점", function () {
    var r = Engine.scoreAnswer(TQ, { text: "가가가가가가가가" }, S);
    assertEqual(r.answered, false);
  });

  test("★ 패턴 도배(아무말아무말아무말) → 무응답 0점", function () {
    var r = Engine.scoreAnswer(TQ, { text: "아무말아무말아무말" }, S);
    assertEqual(r.answered, false);
  });

  test("★ 키보드 두드리기(asdfasdfasdf) → 무응답 0점", function () {
    var r = Engine.scoreAnswer(TQ, { text: "asdfasdfasdf" }, S);
    assertEqual(r.answered, false);
  });

  test("★ 신고 사례(;ljlkjlkjkjh) → 무응답 0점", function () {
    var r = Engine.scoreAnswer(TQ, { text: ";ljlkjlkjkjh" }, S);
    assertEqual(r.points, 0);
    assertEqual(r.answered, false);
  });

  test("★ 신고 사례를 에피소드로 써도 → 무응답 0점", function () {
    var r = Engine.scoreAnswer(EQ,
      { text: "", episode: { mode: "new", id: "ex", title: ";ljlkjlkjkjh", text: ";ljlkjlkjkjh" } }, S);
    assertEqual(r.points, 0);
    assertEqual(r.answered, false);
  });

  test("★ 모음이 있어도 영단어 1개뿐이면(iuytrewqas) → 무응답", function () {
    var r = Engine.scoreAnswer(TQ, { text: "iuytrewqas" }, S);
    assertEqual(r.answered, false);
  });

  test("정상 한글 문장 → 정상 채점", function () {
    var r = Engine.scoreAnswer(TQ, { text: "저는 방학마다 편의점에서 일했습니다" }, S);
    assertEqual(r.answered, true);
    assertEqual(r.breakdown.base, 10);
  });

  test("정당한 영문 답변(자격증·프로그램명)은 인정", function () {
    var r = Engine.scoreAnswer(TQ, { text: "Excel, Photoshop, AutoCAD" }, S);
    assertEqual(r.answered, true, "영문 도구명 나열이 무응답 처리됨");
  });

  test("★ ㅋㅋㅋ 도배로 글자 수를 채워도 성실 보너스 없음", function () {
    var pad = "";
    for (var i = 0; i < 60; i++) pad += "ㅋ";
    var r = Engine.scoreAnswer(TQ, { text: "재미있었습니다 " + pad }, S);
    assertEqual(r.answered, true);
    assertEqual(r.breakdown.sincere, 0, "도배 글자가 성실 보너스에 포함됨");
  });

  test("★ 낙서로 쓴 새 에피소드 → 에피소드 보너스 없음", function () {
    var r = Engine.scoreAnswer(EQ,
      { text: ktext(20), episode: { mode: "new", id: "ep9", title: "ㅁㄴㅇㄹ", text: "ㅁㄴㅇㄹㅁㄴㅇㄹ" } }, S);
    assertEqual(r.breakdown.episode, 0, "낙서 에피소드에 보너스가 붙음");
  });

  test("★ 답변·에피소드 모두 낙서 → 무응답 0점", function () {
    var r = Engine.scoreAnswer(EQ,
      { text: "ㅋㅋㅋㅋ", episode: { mode: "new", id: "ep9", title: "ㅋ", text: "dfdfdf" } }, S);
    assertEqual(r.answered, false);
  });

  /* ============================================================
     2-1. 새 문항 유형 테스트 (list: 여러 칸 / short: 단답)
     ============================================================ */
  var LQ = { id: "lq1", type: "list", count: 3, text: "과목 3가지?" };
  var SQ = { id: "sq1", type: "short", text: "한 문장으로?" };

  test("★ list: 3칸 모두 채우면 기본+성실 보너스", function () {
    var r = Engine.scoreAnswer(LQ, { entries: ["회계원리", "마케팅", "경영정보"] }, S);
    assertEqual(r.points, 15);
  });

  test("★ list: 1칸만 채우면 기본점만", function () {
    var r = Engine.scoreAnswer(LQ, { entries: ["회계원리", "", ""] }, S);
    assertEqual(r.points, 10);
  });

  test("★ list: 낙서 칸(ㅋㅋ, dfd)은 무시되어 무응답", function () {
    var r = Engine.scoreAnswer(LQ, { entries: ["ㅋㅋ", "dfd", ""] }, S);
    assertEqual(r.answered, false);
  });

  test("★ list: 숫자 포함 항목 → 결과 보너스", function () {
    var r = Engine.scoreAnswer(LQ, { entries: ["토익 850점", "", ""] }, S);
    assertEqual(r.breakdown.result, 5);
  });

  test("★ short: 짧은 단어 답변(회계원리)도 인정", function () {
    var r = Engine.scoreAnswer(SQ, { text: "회계원리" }, S);
    assertEqual(r.answered, true);
    assertEqual(r.points, 10);
  });

  test("★ short: 자음 낙서(ㅋㅋ)는 무응답", function () {
    var r = Engine.scoreAnswer(SQ, { text: "ㅋㅋ" }, S);
    assertEqual(r.answered, false);
  });

  test("★ short: 15자 이상이면 성실 보너스", function () {
    var r = Engine.scoreAnswer(SQ, { text: "끝까지 파고드는 성격이라는 말을 자주 들었다" }, S);
    assertEqual(r.breakdown.sincere, 5);
  });

  test("★ ncs 문항: 담은 직무는 list처럼 채점된다 (3개=기본+성실)", function () {
    var NQ = { id: "nq1", type: "ncs", count: 3, text: "희망 직무?" };
    var r = Engine.scoreAnswer(NQ, { entries: ["회계·감사", "세무", "구매"] }, S);
    assertEqual(r.points, 15);
    var r2 = Engine.scoreAnswer(NQ, { entries: ["회계·감사"] }, S);
    assertEqual(r2.points, 10);
  });

  test("★ univ 문항: 담은 과목은 list처럼 채점된다 (3개=기본+성실)", function () {
    var UQ = { id: "uq1", type: "univ", count: 3, text: "재미있던 과목?" };
    var r = Engine.scoreAnswer(UQ, { entries: ["회계원리", "마케팅원론", "경영통계"] }, S);
    assertEqual(r.points, 15);
    var r2 = Engine.scoreAnswer(UQ, { entries: [] }, S);
    assertEqual(r2.answered, false);
  });

  test("★ pick 문항: 고른 항목은 list처럼 채점된다", function () {
    var PQ = { id: "pq1", type: "pick", count: 3, options: ["동아리", "봉사활동", "공모전"], text: "?" };
    var r = Engine.scoreAnswer(PQ, { entries: ["동아리", "봉사활동", "공모전"] }, S);
    assertEqual(r.points, 15);
    var r2 = Engine.scoreAnswer(PQ, { entries: ["동아리"] }, S);
    assertEqual(r2.points, 10);
  });

  test("★ pick 문항에 options가 없으면 콘텐츠 오류로 잡힌다", function () {
    var bad = { settings: S, rooms: [{ id: "r", title: "t", badge: { icon: "⭐", name: "b" },
      questions: [{ id: "q1", type: "pick", count: 3, text: "?" }] }] };
    var errors = Engine.validateContent(bad);
    assert(errors.some(function (e) { return e.indexOf("options") !== -1; }), "options 누락을 잡지 못함");
  });

  test("★ 에피소드 유사도: 단어를 살짝 바꾼 같은 이야기 감지", function () {
    var a = "자작차 프로젝트 — 동아리에서 자작차를 만들어 대회에 나감";
    var b = "자작자동차 제작 프로젝트 — 동아리에서 만들어서 대회 출전";
    assert(Engine.isSimilarText(a, b, S) === true, "같은 이야기 변형을 못 잡음");
  });

  test("★ 에피소드 유사도: 전혀 다른 이야기는 그냥 통과", function () {
    var a = "자작차 프로젝트 — 동아리에서 자작차를 만들어 대회에 나감";
    var b = "편의점 야간 알바에서 진상 손님을 응대하며 배운 침착함";
    assert(Engine.isSimilarText(a, b, S) === false, "다른 이야기를 같다고 판정함");
  });

  test("★ list 문항에 count가 없으면 콘텐츠 오류로 잡힌다", function () {
    var bad = { settings: S, rooms: [{ id: "r", title: "t", badge: { icon: "⭐", name: "b" },
      questions: [{ id: "q1", type: "list", text: "?" }] }] };
    var errors = Engine.validateContent(bad);
    assert(errors.some(function (e) { return e.indexOf("count") !== -1; }), "count 누락을 잡지 못함");
  });

  /* ============================================================
     3. 점수 계산 단위 테스트
     ============================================================ */
  test("일반 답변 → 기본 10점", function () {
    var r = Engine.scoreAnswer(TQ, { text: ktext(20) }, S);
    assertEqual(r.points, 10);
  });

  test("무응답(빈 답변) → 0점, answered=false", function () {
    var r = Engine.scoreAnswer(TQ, { text: "" }, S);
    assertEqual(r.points, 0);
    assertEqual(r.answered, false);
  });

  test("한글 5자 미만(넷글자) → 무응답 처리", function () {
    var r = Engine.scoreAnswer(TQ, { text: "넷글자" }, S);
    assertEqual(r.answered, false);
  });

  test("성실 보너스 경계값: 의미 있는 글자 정확히 50자 → +5점", function () {
    var r = Engine.scoreAnswer(TQ, { text: ktext(50) }, S);
    assertEqual(r.points, 15);
  });

  test("성실 보너스 경계값: 49자 → 보너스 없음", function () {
    var r = Engine.scoreAnswer(TQ, { text: ktext(49) }, S);
    assertEqual(r.points, 10);
  });

  test("숫자가 포함되면 결과 보너스 +5점", function () {
    var r = Engine.scoreAnswer(TQ, { text: "토익 850점을 받았다" }, S);
    assertEqual(r.breakdown.result, 5);
  });

  test("결과 키워드(완성)가 포함되면 보너스 +5점", function () {
    var r = Engine.scoreAnswer(TQ, { text: "포트폴리오를 완성했다" }, S);
    assertEqual(r.breakdown.result, 5);
  });

  test("새 에피소드 작성 → +10점 보너스", function () {
    var r = Engine.scoreAnswer(EQ,
      { text: ktext(20), episode: { mode: "new", id: "ep1", title: "자작차", text: "동아리에서 자작차를 만들었다" } }, S);
    assertEqual(r.breakdown.episode, 10);
    assertEqual(r.reused, false);
  });

  test("★ 에피소드 재사용 → 보너스 0점 + reused 표시", function () {
    var r = Engine.scoreAnswer(EQ,
      { text: ktext(20), episode: { mode: "reuse", id: "ep1", title: "자작차", text: "동아리에서 자작차를 만들었다" } }, S);
    assertEqual(r.breakdown.episode, 0, "재사용인데 보너스가 붙음");
    assertEqual(r.reused, true);
  });

  test("에피소드 글자 수도 성실 보너스에 합산된다", function () {
    var r = Engine.scoreAnswer(EQ,
      { text: ktext(10), episode: { mode: "new", id: "ep1", title: "제목", text: ktext(40) } }, S);
    assertEqual(r.breakdown.sincere, 5, "답변+에피소드 합산 50자인데 보너스 없음");
  });

  /* ============================================================
     4. 방 점수·배지 경계값 테스트
     ============================================================ */
  test("배지 경계값: 정확히 60% → 배지 획득", function () {
    // 만점 20점 문항 1개, 12점 획득 = 정확히 60%
    var s2 = JSON.parse(JSON.stringify(S));
    s2.scores = { base: 12, sincereBonus: 4, resultBonus: 4, episodeBonus: 0 };
    var room = { id: "r", title: "t", questions: [{ id: "q1", type: "text", text: "?" }] };
    var r = Engine.scoreRoom(room, { q1: { text: ktext(20) } }, s2); // base 12점만 획득
    assertEqual(r.percent, 60);
    assertEqual(r.badge, true, "60%인데 배지를 못 받음");
  });

  test("배지 경계값: 60% 미만 → 배지 없음", function () {
    var s2 = JSON.parse(JSON.stringify(S));
    s2.scores = { base: 11, sincereBonus: 5, resultBonus: 4, episodeBonus: 0 };
    var room = { id: "r", title: "t", questions: [{ id: "q1", type: "text", text: "?" }] };
    var r = Engine.scoreRoom(room, { q1: { text: ktext(20) } }, s2); // 11/20 = 55%
    assertEqual(r.badge, false, "55%인데 배지를 받음");
  });

  /* ============================================================
     5. 진실의 방 판정 테스트 (경계값 포함)
     ============================================================ */
  function makeSimpleContent(roomCount) {
    var rooms = [];
    for (var i = 1; i <= roomCount; i++) {
      rooms.push({
        id: "sr" + i, title: "방" + i, badge: { icon: "⭐", name: "배지" + i },
        questions: [{ id: "sq" + i, type: "text", text: "질문?" }]
      });
    }
    return { settings: S, rooms: rooms };
  }
  // 앞에서부터 badgeRooms개 방만 만점 답변으로 채움
  function answersWithBadges(content, badgeRooms) {
    var answers = {};
    content.rooms.forEach(function (room, i) {
      if (i < badgeRooms) answers["sq" + (i + 1)] = { text: ktext(60) + " 3회 완성" };
    });
    return answers;
  }

  test("★ 배지 2개(3개 미만) → 진실의 방 대상", function () {
    var c = makeSimpleContent(7);
    var result = Engine.evaluateGame(c, answersWithBadges(c, 2));
    assertEqual(result.badgeCount, 2);
    assertEqual(result.truthRoom, true, "배지 2개인데 진실의 방이 아님");
  });

  test("★ 배지 정확히 3개 → 진실의 방 아님", function () {
    var c = makeSimpleContent(7);
    var result = Engine.evaluateGame(c, answersWithBadges(c, 3));
    assertEqual(result.badgeCount, 3);
    assertEqual(result.truthRoom, false, "배지 3개인데 진실의 방 대상이 됨");
  });

  test("배지 7개 → 퍼펙트 클리어", function () {
    var c = makeSimpleContent(7);
    var result = Engine.evaluateGame(c, answersWithBadges(c, 7));
    assertEqual(result.badgeCount, 7);
    assertEqual(result.truthRoom, false);
  });

  test("부실 답변 목록에 무응답·재사용이 정리된다", function () {
    var c = makeSimpleContent(3);
    c.rooms[0].questions.push({ id: "sqx", type: "episode", text: "에피소드?" });
    var answers = answersWithBadges(c, 3);
    answers["sqx"] = { text: ktext(20), episode: { mode: "reuse", id: "e1", title: "t", text: "x" } };
    var result = Engine.evaluateGame(c, answers);
    var reasons = result.weakQuestions.map(function (w) { return w.reason; });
    assert(reasons.indexOf("에피소드 재사용") !== -1, "재사용이 부실 목록에 없음");
  });

  /* ============================================================
     6. 유연성 테스트 — 문항·방 개수를 바꿔도 그대로 동작하는지
     ============================================================ */
  test("★ 방을 8개로 늘려도 정상 동작한다", function () {
    var c = makeSimpleContent(8);
    assertEqual(Engine.validateContent(c).length, 0);
    var result = Engine.evaluateGame(c, answersWithBadges(c, 8));
    assertEqual(result.totalRooms, 8);
    assertEqual(result.badgeCount, 8);
  });

  test("★ 방마다 문항 수가 달라도(1개/10개) 정상 계산된다", function () {
    var c = makeSimpleContent(2);
    for (var i = 2; i <= 10; i++)
      c.rooms[1].questions.push({ id: "extra" + i, type: "text", text: "추가 질문 " + i });
    assertEqual(Engine.validateContent(c).length, 0);
    var result = Engine.evaluateGame(c, {});
    assertEqual(result.rooms[1].max, 10 * 20, "문항 10개 방의 만점 계산이 틀림");
  });

  test("★ 실제 콘텐츠: 방 개수·배지 수가 자동으로 집계된다", function () {
    var result = Engine.evaluateGame(CONTENT, {});
    assertEqual(result.totalRooms, CONTENT.rooms.length);
    assertEqual(result.badgeCount, 0);
    assertEqual(result.truthRoom, true); // 전부 무응답이면 당연히 진실의 방
  });

  /* ============================================================
     결과 출력
     ============================================================ */
  var passed = results.filter(function (r) { return r.pass; }).length;
  var failed = results.length - passed;

  if (isNode) {
    results.forEach(function (r) {
      console.log((r.pass ? "  ✅ " : "  ❌ ") + r.name + (r.error ? "\n     → " + r.error : ""));
    });
    console.log("\n" + (failed === 0
      ? "🎉 모든 테스트 통과 (" + passed + "개)"
      : "⚠️ 실패 " + failed + "개 / 전체 " + results.length + "개"));
    if (failed > 0) process.exit(1);
  } else {
    window.TEST_RESULTS = { results: results, passed: passed, failed: failed };
  }
})();
