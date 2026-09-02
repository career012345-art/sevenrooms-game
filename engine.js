/* ============================================================
   세븐 룸즈 — 게임 엔진 (점수 계산·판정 로직)
   ※ 이 파일은 수정하지 마세요. 문항 수정은 content.js 에서!
   ------------------------------------------------------------
   방 개수·문항 수를 content.js 에서 어떻게 바꾸든
   이 엔진은 자동으로 그 구성에 맞춰 계산합니다.
   ============================================================ */
(function (global) {
  "use strict";

  /* ---------- 콘텐츠 검증 ----------
     content.js 를 수정했을 때 실수(필드 누락, id 중복 등)를
     자동으로 찾아냅니다. 오류 메시지 배열을 돌려줍니다. */
  function validateContent(content) {
    var errors = [];
    if (!content || typeof content !== "object") {
      errors.push("GAME_CONTENT 가 없습니다. content.js 파일을 확인하세요.");
      return errors;
    }
    var s = content.settings;
    if (!s) {
      errors.push("settings 항목이 없습니다.");
      return errors;
    }
    ["badgeThresholdPercent", "truthRoomMinBadges", "minHangulSyllables", "sincereBonusChars"]
      .forEach(function (k) {
        if (typeof s[k] !== "number") errors.push("settings." + k + " 가 없거나 숫자가 아닙니다.");
      });
    var sc = s.scores || {};
    ["base", "sincereBonus", "resultBonus", "episodeBonus"].forEach(function (k) {
      if (typeof sc[k] !== "number") errors.push("settings.scores." + k + " 가 없거나 숫자가 아닙니다.");
    });
    if (!Array.isArray(content.rooms) || content.rooms.length === 0) {
      errors.push("rooms(방 목록)가 비어 있습니다. 방이 최소 1개는 있어야 합니다.");
      return errors;
    }
    var roomIds = {};
    var questionIds = {};
    content.rooms.forEach(function (room, i) {
      var label = "방 " + (i + 1) + (room.id ? " (" + room.id + ")" : "");
      if (!room.id) errors.push(label + ": id 가 없습니다.");
      else if (roomIds[room.id]) errors.push("방 id 중복: " + room.id);
      else roomIds[room.id] = true;
      if (!room.title) errors.push(label + ": title(방 이름)이 없습니다.");
      if (!room.badge || !room.badge.name || !room.badge.icon)
        errors.push(label + ": badge 의 icon/name 이 없습니다.");
      if (!Array.isArray(room.questions) || room.questions.length === 0) {
        errors.push(label + ": 문항(questions)이 하나도 없습니다.");
        return;
      }
      room.questions.forEach(function (q, j) {
        var qLabel = label + " " + (j + 1) + "번 문항" + (q.id ? " (" + q.id + ")" : "");
        if (!q.id) errors.push(qLabel + ": id 가 없습니다.");
        else if (questionIds[q.id]) errors.push("문항 id 중복: " + q.id);
        else questionIds[q.id] = true;
        if (!q.text) errors.push(qLabel + ": 질문 내용(text)이 없습니다.");
        var validTypes = { text: 1, episode: 1, short: 1, list: 1, ncs: 1, univ: 1, pick: 1 };
        if (!validTypes[q.type])
          errors.push(qLabel + ': type 은 "text" / "short" / "list" / "pick" / "ncs" / "univ" / "episode" 중 하나여야 합니다. (현재: ' + q.type + ")");
        if (q.type === "list" && !(typeof q.count === "number" && q.count >= 1 && q.count <= 10))
          errors.push(qLabel + ": list 문항은 count(칸 수, 1~10)가 필요합니다.");
        if ((q.type === "ncs" || q.type === "univ" || q.type === "pick") && q.count != null && !(typeof q.count === "number" && q.count >= 1 && q.count <= 10))
          errors.push(qLabel + ": " + q.type + " 문항의 count 는 1~10 숫자여야 합니다.");
        if (q.type === "pick" && !q.optionsFrom && !(Array.isArray(q.options) && q.options.length > 0))
          errors.push(qLabel + ": pick 문항은 options(보기 목록) 또는 optionsFrom 이 필요합니다.");
      });
    });
    return errors;
  }

  /* ---------- 한글 답변 인식 (낙서·도배 걸러내기) ----------
     "dfdfdf", "ㅇㄹㅇㄹ", "가가가가", "아무말아무말" 같은
     낙서는 답변으로 인정하지 않습니다. */

  // 같은 글자가 3번 이상 연달아 나오면 2개로 압축 ("ㅋㅋㅋㅋㅋ" → "ㅋㅋ")
  function collapseRepeats(text) {
    return String(text == null ? "" : text).replace(/(.)\1{2,}/g, "$1$1");
  }

  // 의미 있는 글자 수: 완성된 한글 음절 + 영문 + 숫자만 계산
  // (자음·모음 낙서, 특수문자, 공백, 도배 글자는 제외)
  function countMeaningfulChars(text) {
    var m = collapseRepeats(text).match(/[가-힣A-Za-z0-9]/g);
    return m ? m.length : 0;
  }

  // 공통 판정 로직 (기준값만 바꿔서 서술형/단답형에 함께 사용)
  function isMeaningfulCore(text, minHangul, minLatinChars, minLatinWords) {
    var t = collapseRepeats(String(text == null ? "" : text).trim());
    if (!t) return false;
    var compact = t.replace(/\s+/g, "");

    // 짧은 단위(1~4글자)가 계속 반복되는 도배 감지 ("가나가나가나", "asdfasdf")
    for (var u = 1; u <= 4; u++) {
      if (compact.length >= u * 3) {
        var unit = compact.slice(0, u);
        var repeated = "";
        while (repeated.length < compact.length) repeated += unit;
        if (repeated.slice(0, compact.length) === compact) return false;
      }
    }

    // 글자 다양성이 극단적으로 낮으면 도배로 판정
    if (compact.length >= 8) {
      var uniq = {};
      for (var i = 0; i < compact.length; i++) uniq[compact[i]] = 1;
      if (Object.keys(uniq).length / compact.length < 0.15) return false;
    }

    // ① 완성된 한글 음절(가~힣)이 기준 이상이면 인정
    var hangul = compact.match(/[가-힣]/g);
    if ((hangul ? hangul.length : 0) >= minHangul) return true;

    // ② 한글이 없어도 정당한 영문 답변(자격증·프로그램명 등)은 인정
    //    모음이 들어간 3글자 이상 "단어" 기준 (자판 두드리기는 단어로 인정 안 됨)
    var latin = compact.match(/[A-Za-z]/g);
    var latinWords = t.split(/[^A-Za-z]+/).filter(function (w) {
      return w.length >= 3 && /[aeiouAEIOU]/.test(w);
    });
    if ((latin ? latin.length : 0) >= minLatinChars && latinWords.length >= minLatinWords) return true;

    return false;
  }

  // 서술형 답변 판정 (text, episode 문항)
  function isMeaningfulText(text, settings) {
    var minH = (typeof settings.minHangulSyllables === "number") ? settings.minHangulSyllables : 5;
    var minL = (typeof settings.minLatinChars === "number") ? settings.minLatinChars : 10;
    return isMeaningfulCore(text, minH, minL, 2);
  }

  // 단답형 판정 (short, list 문항 — 과목명·단어 답변은 짧아도 인정)
  function isMeaningfulLite(text, settings) {
    var minH = (typeof settings.liteMinHangul === "number") ? settings.liteMinHangul : 2;
    return isMeaningfulCore(text, minH, 3, 1);
  }

  /* ---------- 에피소드 유사도 검사 (중복 의심 감지) ----------
     두 글을 2글자 조각(bigram)으로 쪼개 겹침률을 계산합니다.
     "자작차 프로젝트" vs "자작자동차 프로젝트 제작"처럼
     단어를 살짝 바꿔 쓴 경우도 잡아냅니다.
     겹침률 기준은 settings.episodeSimilarity (기본 0.45) */
  function bigramsOf(text) {
    var compact = String(text == null ? "" : text)
      .replace(/[^가-힣A-Za-z0-9]/g, "").toLowerCase();
    var set = {};
    for (var i = 0; i < compact.length - 1; i++) set[compact.substr(i, 2)] = 1;
    return set;
  }
  function isSimilarText(textA, textB, settings) {
    var a = bigramsOf(textA), b = bigramsOf(textB);
    var keysA = Object.keys(a), keysB = Object.keys(b);
    if (keysA.length < 4 || keysB.length < 4) return false; // 너무 짧으면 판정 안 함
    var common = 0;
    keysA.forEach(function (k) { if (b[k]) common++; });
    var ratio = common / Math.min(keysA.length, keysB.length);
    var threshold = (typeof settings.episodeSimilarity === "number") ? settings.episodeSimilarity : 0.45;
    return ratio >= threshold;
  }

  /* ---------- 결과·수치 표현 감지 ---------- */
  function hasResultExpression(text, settings) {
    if (!text) return false;
    if (/\d/.test(text)) return true;
    var keywords = settings.resultKeywords || [];
    for (var i = 0; i < keywords.length; i++) {
      if (text.indexOf(keywords[i]) !== -1) return true;
    }
    return false;
  }

  /* ---------- 문항별 만점 ---------- */
  function questionMaxScore(question, settings) {
    var sc = settings.scores;
    return sc.base + sc.sincereBonus + sc.resultBonus +
      (question.type === "episode" ? sc.episodeBonus : 0);
  }

  /* ---------- 답변 1개 채점 ----------
     answer 형식: { text: "...", episode: { mode:"new"|"reuse", id, title, text } | null } */
  function scoreAnswer(question, answer, settings) {
    var sc = settings.scores;
    var result = {
      points: 0,
      breakdown: { base: 0, sincere: 0, result: 0, episode: 0 },
      reused: false,
      answered: false
    };
    if (!answer) return result;

    /* --- list / ncs / univ / pick 문항: 여러 항목 담기·고르기 --- */
    if (question.type === "list" || question.type === "ncs" ||
        question.type === "univ" || question.type === "pick") {
      var entries = (answer.entries || []).map(function (e) {
        return String(e == null ? "" : e).trim();
      });
      var valid = entries.filter(function (e) { return isMeaningfulLite(e, settings); });
      if (valid.length === 0) return result;
      result.answered = true;
      result.breakdown.base = sc.base;
      var need = (typeof question.count === "number") ? question.count : 3;
      if (valid.length >= need) result.breakdown.sincere = sc.sincereBonus;  // 칸을 다 채우면 성실
      if (valid.some(function (e) { return hasResultExpression(e, settings); }))
        result.breakdown.result = sc.resultBonus;
      result.points = result.breakdown.base + result.breakdown.sincere + result.breakdown.result;
      return result;
    }

    var text = (answer.text || "").trim();

    /* --- short 문항: 단어·한 문장 속답 --- */
    if (question.type === "short") {
      if (!isMeaningfulLite(text, settings)) return result;
      result.answered = true;
      result.breakdown.base = sc.base;
      var shortChars = (typeof settings.shortSincereChars === "number") ? settings.shortSincereChars : 15;
      if (countMeaningfulChars(text) >= shortChars) result.breakdown.sincere = sc.sincereBonus;
      if (hasResultExpression(text, settings)) result.breakdown.result = sc.resultBonus;
      result.points = result.breakdown.base + result.breakdown.sincere + result.breakdown.result;
      return result;
    }

    var episodeText = (answer.episode && answer.episode.text) ? answer.episode.text : "";
    var epMode = answer.episode ? answer.episode.mode : null;

    // 답변 인정 조건: ① 제대로 된 한글(또는 영문) 답변이거나
    //                ② 제대로 작성한 새 에피소드가 있거나
    //                ③ 가방에서 꺼낸(재사용) 에피소드가 붙어 있을 때
    var textOk = isMeaningfulText(text, settings);
    var epNewOk = (epMode === "new") && isMeaningfulText(episodeText, settings);
    var epReuse = (epMode === "reuse");
    if (!textOk && !epNewOk && !epReuse) return result;

    result.answered = true;
    result.breakdown.base = sc.base;

    // 성실 보너스: 의미 있는 글자만 계산 (ㅋㅋㅋ 도배·자음 낙서는 제외)
    if (countMeaningfulChars(text + " " + episodeText) >= settings.sincereBonusChars)
      result.breakdown.sincere = sc.sincereBonus;

    if (hasResultExpression(text, settings) || hasResultExpression(episodeText, settings))
      result.breakdown.result = sc.resultBonus;

    if (question.type === "episode") {
      if (epNewOk) {
        result.breakdown.episode = sc.episodeBonus;   // 제대로 쓴 새 에피소드 → 보너스
      } else if (epReuse) {
        result.reused = true;                          // 재사용 → 보너스 0점
      }
    }

    result.points = result.breakdown.base + result.breakdown.sincere +
      result.breakdown.result + result.breakdown.episode;
    return result;
  }

  /* ---------- 방 1개 채점 ---------- */
  function scoreRoom(room, answersById, settings) {
    var earned = 0, max = 0;
    var perQuestion = [];
    room.questions.forEach(function (q) {
      var m = questionMaxScore(q, settings);
      max += m;
      var s = scoreAnswer(q, answersById[q.id], settings);
      earned += s.points;
      perQuestion.push({
        questionId: q.id, max: m, points: s.points,
        breakdown: s.breakdown, reused: s.reused, answered: s.answered
      });
    });
    var percent = max > 0 ? Math.round((earned / max) * 1000) / 10 : 0;
    return {
      roomId: room.id,
      earned: earned,
      max: max,
      percent: percent,
      badge: percent >= settings.badgeThresholdPercent,
      perQuestion: perQuestion
    };
  }

  /* ---------- 게임 전체 판정 ----------
     방 개수와 무관하게 동작. 배지 수 < truthRoomMinBadges → 진실의 방 */
  function evaluateGame(content, answersById) {
    var settings = content.settings;
    var roomResults = content.rooms.map(function (room) {
      return scoreRoom(room, answersById, settings);
    });
    var badgeCount = roomResults.filter(function (r) { return r.badge; }).length;
    var truthRoom = badgeCount < settings.truthRoomMinBadges;

    // 상담사용: 부실 답변 목록 (무응답 / 재사용 / 문항 만점의 50% 미만)
    var weakQuestions = [];
    content.rooms.forEach(function (room, i) {
      roomResults[i].perQuestion.forEach(function (pq) {
        var isWeak = !pq.answered || pq.reused || pq.points < pq.max * 0.5;
        if (!isWeak) return;
        var q = room.questions.filter(function (x) { return x.id === pq.questionId; })[0];
        weakQuestions.push({
          roomTitle: room.title,
          questionId: pq.questionId,
          question: q ? q.text : "",
          reason: !pq.answered ? "무응답" : (pq.reused ? "에피소드 재사용" : "답변 부실")
        });
      });
    });

    var totalEarned = roomResults.reduce(function (a, r) { return a + r.earned; }, 0);
    var totalMax = roomResults.reduce(function (a, r) { return a + r.max; }, 0);

    return {
      rooms: roomResults,
      badgeCount: badgeCount,
      totalRooms: content.rooms.length,
      totalEarned: totalEarned,
      totalMax: totalMax,
      truthRoom: truthRoom,
      weakQuestions: weakQuestions
    };
  }

  var Engine = {
    validateContent: validateContent,
    isMeaningfulText: isMeaningfulText,
    isMeaningfulLite: isMeaningfulLite,
    isSimilarText: isSimilarText,
    countMeaningfulChars: countMeaningfulChars,
    hasResultExpression: hasResultExpression,
    questionMaxScore: questionMaxScore,
    scoreAnswer: scoreAnswer,
    scoreRoom: scoreRoom,
    evaluateGame: evaluateGame
  };

  // 브라우저와 Node.js 양쪽에서 사용 가능 (테스트용)
  if (typeof module !== "undefined" && module.exports) module.exports = Engine;
  global.GameEngine = Engine;
})(typeof window !== "undefined" ? window : globalThis);
