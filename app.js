/* ============================================================
   세븐 룸즈 — 게임 화면 (UI)
   ※ 이 파일은 수정하지 마세요. 문항 수정은 content.js 에서!
   ------------------------------------------------------------
   방·문항·아이템은 content.js 의 내용을 읽어 자동으로 그려지므로
   방 개수, 문항 수를 바꿔도 이 파일은 그대로 동작합니다.
   ============================================================ */
(function () {
  "use strict";

  var C = window.GAME_CONTENT;
  var E = window.GameEngine;
  var app = document.getElementById("app");
  var fader = document.getElementById("fader");
  var STORAGE_KEY = "sevenrooms_save_v4"; // 문항 구조가 바뀌면 번호를 올려 옛 기록과 충돌 방지

  /* ---------- 콘텐츠 오류 시 게임 대신 오류 표시 ---------- */
  var contentErrors = E.validateContent(C);
  if (contentErrors.length > 0) {
    app.innerHTML = '<div class="card"><h2>⚠️ 게임 설정 오류</h2><p class="desc">' +
      'content.js 파일에 문제가 있어요. 관리자에게 알려주세요.\n\n' +
      contentErrors.map(escText).join("\n") + "</p></div>";
    return;
  }

  /* ---------- 방 안 아이템 배치 좌표 (% 단위, 자동 순환) ---------- */
  var SPOTS = [
    { x: 18, y: 42 }, { x: 82, y: 38 }, { x: 30, y: 62 }, { x: 70, y: 60 },
    { x: 13, y: 24 }, { x: 87, y: 22 }, { x: 50, y: 48 }, { x: 38, y: 78 },
    { x: 62, y: 26 }, { x: 24, y: 80 }
  ];
  var FALLBACK_ITEMS = ["📦", "🎁", "🗄️", "🕰️", "🧸"];
  function itemOf(q, idx) {
    if (q.item && q.item.icon) return { icon: q.item.icon, label: q.item.label || "아이템" };
    return { icon: FALLBACK_ITEMS[idx % FALLBACK_ITEMS.length], label: "미스터리 상자" };
  }

  /* ---------- 상태 ---------- */
  var state = null;
  var busy = false; // 연출(애니메이션) 중 중복 클릭 방지

  function newState() {
    return {
      sessionId: "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
      nickname: "",
      avatar: (C.settings.avatars && C.settings.avatars[0]) || "🧑‍🎓",
      counselorCode: new URLSearchParams(location.search).get("c") || "",
      screen: "intro",          // intro | hallway | room | roomResult | final | review
      introStep: 1,             // 인트로 단계: 1 이름 → 2 학교·학과 → 3 희망 직무 → 4 희망 기업
      profile: {
        school: null,           // { i, s, dept } — univ-index 기준
        jobs: [],               // [{ c, n }] — NCS 직무 (최대 3개)
        jobsUnknown: false,     // "아직 모르겠어요" 선택
        companies: []           // [{ c(코드), n(이름), card, custom }] — 희망 기업 (최대 2개)
      },
      roomIndex: 0,
      answers: {},              // questionId -> {text, episode}
      episodes: [],             // 에피소드 가방 [{id,title,text}]
      episodeSeq: 0,
      clearedRooms: {},         // roomId -> 방 결과
      introSeen: {},            // roomId -> true (방 안내문 표시 여부)
      skipped: {},              // questionId -> true (건너뛴 문항: 다음 아이템 잠금 해제용)
      finished: false,
      pendingUploads: []
    };
  }

  function saveState() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { }
  }
  function loadState() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      var s = JSON.parse(raw);
      return (s && s.sessionId) ? s : null;
    } catch (e) { return null; }
  }
  function clearSaved() {
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) { }
  }

  /* ---------- 유틸 ---------- */
  function escText(str) {
    return String(str == null ? "" : str)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  function esc(str) { return escText(str).replace(/\n/g, "<br>"); }
  function el(id) { return document.getElementById(id); }
  function currentRoom() { return C.rooms[state.roomIndex]; }
  function getAnswer(qid) {
    if (!state.answers[qid]) state.answers[qid] = { text: "", episode: null };
    return state.answers[qid];
  }
  function isAnswered(q) {
    return E.scoreAnswer(q, state.answers[q.id], C.settings).answered;
  }
  function fadeTo(cb) {
    fader.classList.add("on");
    setTimeout(function () {
      cb();
      setTimeout(function () { fader.classList.remove("on"); }, 60);
    }, 380);
  }

  /* ---------- 게임 내 안내창 (alert/confirm 대체) ---------- */
  function closeModal() {
    var old = el("srModal");
    if (old) old.remove();
  }
  function showDialog(message, buttons) {
    closeModal();
    var overlay = document.createElement("div");
    overlay.id = "srModal";
    overlay.className = "modal-overlay";
    var box = document.createElement("div");
    box.className = "modal-box";
    var p = document.createElement("p");
    p.textContent = message;
    box.appendChild(p);
    var btns = document.createElement("div");
    btns.className = "modal-btns";
    buttons.forEach(function (b) {
      var btn = document.createElement("button");
      btn.className = b.primary ? "ok" : "cancel";
      btn.textContent = b.label;
      btn.onclick = function () {
        closeModal();
        if (b.onClick) b.onClick();
      };
      btns.appendChild(btn);
    });
    box.appendChild(btns);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
  }
  function showAlert(message, onOk) {
    showDialog(message, [{ label: "확인", primary: true, onClick: onOk }]);
  }
  function showConfirm(message, onOk, okLabel, cancelLabel) {
    showDialog(message, [
      { label: cancelLabel || "취소", primary: false },
      { label: okLabel || "확인", primary: true, onClick: onOk }
    ]);
  }

  /* 새 에피소드가 기존 에피소드와 비슷한지 검사 (확인용)
     엔진의 2글자 조각(bigram) 겹침률 판정을 사용 — 단어를 살짝 바꿔도 잡아냄.
     민감도는 content.js 의 settings.episodeSimilarity 로 조절 */
  function findSimilarEpisode(episode) {
    var newText = episode.title + " " + episode.text;
    for (var i = 0; i < state.episodes.length; i++) {
      var ep = state.episodes[i];
      if (ep.id === episode.id) continue;
      if (E.isSimilarText(newText, ep.title + " " + ep.text, C.settings)) return ep;
    }
    return null;
  }

  /* ---------- 구글시트 전송 ---------- */
  function sendToSheet(payload) {
    var url = C.settings.sheetEndpoint;
    if (!url) return;
    try {
      fetch(url, { method: "POST", mode: "no-cors", body: JSON.stringify(payload) })
        .catch(function () { queueUpload(payload); });
    } catch (e) { queueUpload(payload); }
  }
  function queueUpload(payload) {
    state.pendingUploads.push(payload);
    saveState();
  }
  function retryPending() {
    if (!C.settings.sheetEndpoint || state.pendingUploads.length === 0) return;
    var pending = state.pendingUploads;
    state.pendingUploads = [];
    pending.forEach(sendToSheet);
    saveState();
  }

  /* 답변을 사람이 읽는 한 줄 텍스트로 변환 (시트 전송·기록 보기 공용) */
  function formatAnswerText(q, a) {
    var answerText;
    if (q.type === "list" || q.type === "ncs" || q.type === "univ" || q.type === "pick") {
      answerText = (a.entries || []).map(function (e, i) {
        var name = String(e == null ? "" : e).trim();
        if (!name) return "";
        var code = (q.type === "ncs" && a.ncsCodes && a.ncsCodes[i]) ? " [NCS " + a.ncsCodes[i] + "]" : "";
        return name + code;
      }).filter(Boolean).join(" / ");
      if (q.type === "univ" && a.univ && a.univ.s)
        answerText = "[" + a.univ.s + (a.univ.dept ? " · " + a.univ.dept : "") + "] " + answerText;
    } else {
      answerText = a.text || "";
    }
    return answerText;
  }

  /* 답변 전체를 한 칸에 담는 문장으로 합침 (시트 "응답" 열용 — 기록 보기 화면과 동일 내용) */
  function buildFullAnswer(q, a) {
    var parts = [];
    var base = formatAnswerText(q, a);
    if (base) parts.push(base);
    if (a && a.episode) {
      var ep = a.episode;
      var tag = ep.mode === "reuse" ? "🎒(재사용) " : "🆕 ";
      parts.push(tag + "「" + (ep.title || "제목 없음") + "」" +
        (ep.mode === "new" && ep.text ? " — " + ep.text : ""));
    }
    return parts.length ? parts.join("  ┃  ") : "(무응답)";
  }

  function profileJobsText() {
    var p = state.profile;
    if (!p) return "";
    if (p.jobsUnknown) return "미정 (아직 모르겠어요)";
    return p.jobs.map(function (j) { return j.n + " [NCS " + j.c + "]"; }).join(", ");
  }

  function profileCompaniesText() {
    var p = state.profile;
    if (!p || !p.companies || !p.companies.length) return "";
    return p.companies.map(function (co) {
      if (!co.card) return co.n + (co.custom ? " (직접입력)" : "");
      var g = growthPct(co.card);
      var bits = [];
      if (co.card.revenue != null)
        bits.push("매출 " + fmtEok(co.card.revenue) + (g != null ? " " + (g >= 0 ? "+" : "") + g + "%" : ""));
      if (co.card.tenure) bits.push("근속 " + co.card.tenure + "년");
      if (co.card.employees) bits.push(co.card.employees.toLocaleString() + "명");
      return co.n + (bits.length ? " (" + bits.join(", ") + ")" : "");
    }).join(" / ");
  }

  function buildRoomPayload(room, roomResult, statusText) {
    return {
      kind: "room",
      sessionId: state.sessionId,
      nickname: state.nickname,
      counselorCode: state.counselorCode,
      sentAt: new Date().toISOString(),
      statusText: statusText || "",
      roomId: room.id,
      roomTitle: room.title,
      earned: roomResult.earned,
      max: roomResult.max,
      percent: roomResult.percent,
      badge: roomResult.badge,
      profileSchool: (state.profile && state.profile.school) ? state.profile.school.s : "",
      profileDept: (state.profile && state.profile.school) ? (state.profile.school.dept || "") : "",
      profileJobs: profileJobsText(),
      profileCompanies: profileCompaniesText(),
      answers: room.questions.map(function (q, qi) {
        var a = state.answers[q.id] || { text: "", episode: null };
        var scored = E.scoreAnswer(q, a, C.settings);
        var note = [];
        if (scored.reused) note.push("⚠️에피소드 재사용");
        if (!scored.answered && state.skipped[q.id]) note.push("건너뜀");
        return {
          questionId: q.id,
          qNo: qi + 1,
          question: q.text,
          intent: q.intent || "",
          answerFull: buildFullAnswer(q, a),
          points: scored.points,
          maxPoints: E.questionMaxScore(q, C.settings),
          note: note.join(", "),
          answerText: formatAnswerText(q, a),
          episodeMode: a.episode ? a.episode.mode : "",
          episodeTitle: a.episode ? a.episode.title : "",
          episodeText: a.episode ? a.episode.text : ""
        };
      })
    };
  }

  function buildFinalPayload(result) {
    return {
      kind: "final",
      sessionId: state.sessionId,
      nickname: state.nickname,
      counselorCode: state.counselorCode,
      sentAt: new Date().toISOString(),
      profileSchool: (state.profile && state.profile.school) ? state.profile.school.s : "",
      profileDept: (state.profile && state.profile.school) ? (state.profile.school.dept || "") : "",
      profileJobs: profileJobsText(),
      profileCompanies: profileCompaniesText(),
      badgeCount: result.badgeCount,
      totalRooms: result.totalRooms,
      totalEarned: result.totalEarned,
      totalMax: result.totalMax,
      truthRoom: result.truthRoom,
      badges: C.rooms.filter(function (r, i) { return result.rooms[i].badge; })
        .map(function (r) { return r.badge.icon + " " + r.badge.name; }).join(", "),
      episodes: state.episodes.map(function (e) { return e.title; }).join(" / "),
      weakQuestions: result.weakQuestions.map(function (w) {
        return "[" + w.roomTitle + "] " + w.question + " (" + w.reason + ")";
      }).join("\n")
    };
  }

  /* ============================================================
     화면 렌더링
     ============================================================ */
  function render() {
    saveState();
    closeSheet();
    var screens = {
      intro: renderIntro, hallway: renderHallway, room: renderRoom,
      roomResult: renderRoomResult, final: renderFinal, review: renderReview,
      report: renderReport
    };
    (screens[state.screen] || renderIntro)();
    window.scrollTo(0, 0);
  }

  /* ---------- 1. 인트로 (프로필 만들기: 이름 → 학교·학과 → 희망 직무) ---------- */
  function renderIntro() {
    state.profile = state.profile || { school: null, jobs: [], jobsUnknown: false, companies: [] };
    state.profile.companies = state.profile.companies || [];
    var step = state.introStep || 1;
    var head =
      '<h1 class="logo">🗝️ ' + esc(C.meta.title) + '</h1>' +
      '<p class="subtitle">' + esc(C.meta.subtitle) + '</p>' +
      '<div class="door-dots">' + [1, 2, 3, 4].map(function (s) {
        return '<span class="dot ' + (s === step ? "cur" : (s < step ? "clear" : "")) + '"></span>';
      }).join("") + '</div>';

    if (step === 1) renderIntro1(head);
    else if (step === 2) renderIntro2(head);
    else if (step === 3) renderIntro3(head);
    else renderIntro4(head);
  }

  // 1단계: 캐릭터 + 이름
  function renderIntro1(head) {
    var avatars = C.settings.avatars || ["🧑‍🎓"];
    var avatarHtml = avatars.map(function (a) {
      return '<div class="avatar-pick' + (a === state.avatar ? " on" : "") + '" data-a="' + a + '">' + a + '</div>';
    }).join("");

    app.innerHTML =
      '<div class="screen">' + head +
      '<div class="card"><p class="desc">' + esc(C.texts.introDesc) + '</p>' +
      '<label>내 캐릭터 고르기</label>' +
      '<div class="avatar-grid">' + avatarHtml + '</div>' +
      '<label>닉네임 (또는 이름)</label>' +
      '<input type="text" id="nickname" maxlength="20" placeholder="예: 홍길동" value="' + escText(state.nickname) + '">' +
      '<div id="nickError"></div>' +
      '<button class="btn" id="nextBtn1">다음 →</button></div>' +
      '<p class="hint center">버전 v' + escText(C.meta.version) + '</p>' +
      '</div>';

    Array.prototype.forEach.call(document.querySelectorAll(".avatar-pick"), function (d) {
      d.onclick = function () {
        state.avatar = d.getAttribute("data-a");
        Array.prototype.forEach.call(document.querySelectorAll(".avatar-pick"), function (x) {
          x.classList.toggle("on", x === d);
        });
        saveState();
      };
    });
    el("nextBtn1").onclick = function () {
      var name = el("nickname").value.trim();
      if (!name) {
        el("nickError").innerHTML = '<div class="field-error">⚠️ 닉네임을 입력해 주세요!</div>';
        el("nickname").focus();
        return;
      }
      state.nickname = name;
      state.introStep = 2;
      render();
    };
  }

  // 2단계: 학교·학과
  function renderIntro2(head) {
    var p = state.profile;
    var body;
    if (p.school && p.school.dept) {
      body = '<div class="chips"><span class="chip" id="schoolReset">🏫 ' +
        escText(p.school.s) + ' · ' + escText(p.school.dept) + '</span></div>' +
        '<p class="hint">잘못 골랐으면 위를 터치해서 다시 고르세요.</p>' +
        '<button class="btn" id="nextBtn2">다음 →</button>';
    } else if (p.school) {
      body = '<div class="chips"><span class="chip" id="schoolReset">🏫 ' + escText(p.school.s) + '</span></div>' +
        '<label>학과 검색 (터치해서 선택)</label>' +
        '<input type="text" id="deptSearch" autocomplete="off" placeholder="학과 이름 일부를 입력하세요">' +
        '<div id="deptSug"><p class="hint">학과 목록 불러오는 중...</p></div>';
    } else {
      body = (window.UNIV_INDEX
        ? '<label>다녔던(다니는) 학교 검색</label>' +
          '<input type="text" id="univSearch" autocomplete="off" placeholder="학교 이름 일부를 입력하세요">' +
          '<div id="univSug"></div>'
        : '<p class="hint">⚠️ 학교 데이터를 불러오지 못했어요. 건너뛰기를 눌러주세요.</p>') +
        '<button class="btn ghost" id="skipSchool">🙅 대학을 안 다녔어요 / 건너뛰기</button>';
    }

    app.innerHTML =
      '<div class="screen">' + head +
      '<div class="card"><h2>🏫 학교와 학과를 알려주세요</h2>' +
      '<p class="desc">학과를 고르면 게임에서 그 학과의 실제 과목 목록이 나와요.</p>' + body + '</div>' +
      '</div>';

    if (el("schoolReset")) el("schoolReset").onclick = function () {
      if (p.school && p.school.dept) p.school.dept = null;
      else p.school = null;
      saveState(); render();
    };
    if (el("skipSchool")) el("skipSchool").onclick = function () {
      p.school = null;
      state.introStep = 3;
      saveState(); render();
    };
    if (el("nextBtn2")) el("nextBtn2").onclick = function () {
      state.introStep = 3;
      saveState(); render();
    };

    var us = el("univSearch");
    if (us) {
      us.addEventListener("input", function () {
        var qt = us.value.trim();
        var sug = el("univSug");
        if (!qt) { sug.innerHTML = ""; return; }
        var hits = [];
        for (var i = 0; i < window.UNIV_INDEX.length && hits.length < 8; i++) {
          if (window.UNIV_INDEX[i].indexOf(qt) !== -1) hits.push(i);
        }
        sug.innerHTML = hits.length
          ? '<div class="ncs-sug">' + hits.map(function (i) {
              return '<button type="button" data-i="' + i + '">' + escText(window.UNIV_INDEX[i]) + '</button>';
            }).join("") + '</div>'
          : '<p class="hint">검색 결과가 없어요. 학교 이름 일부만 입력해 보세요.</p>';
        Array.prototype.forEach.call(sug.querySelectorAll("button"), function (b) {
          b.onclick = function () {
            var i = parseInt(b.getAttribute("data-i"), 10);
            p.school = { i: i, s: window.UNIV_INDEX[i], dept: null };
            saveState(); render();
          };
        });
      });
    }

    var ds = el("deptSearch");
    if (ds && p.school) {
      loadSchoolData(p.school.i, function (data) {
        var sug = el("deptSug");
        if (!data) {
          sug.innerHTML = '<p class="hint">⚠️ 학과 정보를 불러오지 못했어요. 인터넷 연결을 확인해 주세요.</p>';
          return;
        }
        var renderDepts = function () {
          var qt = ds.value.trim();
          var hits = data.d.filter(function (d0) { return !qt || d0[0].indexOf(qt) !== -1; }).slice(0, 10);
          sug.innerHTML = hits.length
            ? '<div class="ncs-sug">' + hits.map(function (d0) {
                return '<button type="button" data-d="' + escText(d0[0]) + '">' + escText(d0[0]) + '</button>';
              }).join("") + '</div>'
            : '<p class="hint">검색 결과가 없어요.</p>';
          Array.prototype.forEach.call(sug.querySelectorAll("button"), function (b) {
            b.onclick = function () {
              p.school.dept = b.getAttribute("data-d");
              saveState(); render();
            };
          });
        };
        ds.addEventListener("input", renderDepts);
        renderDepts();
      });
    }
  }

  // 3단계: 희망 직무 (최대 3개)
  function renderIntro3(head) {
    var p = state.profile;
    var chips = p.jobs.map(function (j, i) {
      return '<span class="chip" data-i="' + i + '">🎯 ' + escText(j.n) + '</span>';
    }).join("");

    app.innerHTML =
      '<div class="screen">' + head +
      '<div class="card"><h2>🎯 일해보고 싶은 직무는?</h2>' +
      '<p class="desc">최대 3개까지! 골라두면 게임이 그 직무에 맞는 힌트를 줍니다.</p>' +
      (window.NCS_DATA
        ? '<label>직무 검색 (국가직무능력표준 ' + window.NCS_DATA.length + '개)</label>' +
          '<input type="text" id="jobSearch" autocomplete="off" placeholder="예: 회계, 조리, 용접, 사무">' +
          '<div id="jobSug"></div>'
        : '<p class="hint">⚠️ 직무 데이터를 불러오지 못했어요.</p>') +
      '<div class="chips" id="jobChips">' + chips + '</div>' +
      '<div id="jobInfo"></div>' +
      '<button class="btn ghost" id="jobUnknown">🤷 아직 잘 모르겠어요 (상담에서 같이 찾기)</button>' +
      '<button class="btn" id="nextBtn3">다음 →</button>' +
      '<button class="btn ghost" id="backBtn3">← 이전</button></div>' +
      '</div>';

    function renderJobChips() {
      var wrap = el("jobChips");
      wrap.innerHTML = p.jobs.map(function (j, i) {
        return '<span class="chip" data-i="' + i + '">🎯 ' + escText(j.n) + '</span>';
      }).join("");
      Array.prototype.forEach.call(wrap.querySelectorAll(".chip"), function (ch) {
        ch.onclick = function () {
          p.jobs.splice(parseInt(ch.getAttribute("data-i"), 10), 1);
          saveState(); renderJobChips();
        };
      });
      var info = el("jobInfo");
      if (p.jobs.length && window.NCS_DATA) {
        var last = p.jobs[p.jobs.length - 1];
        var job = window.NCS_DATA.filter(function (j) { return j.c === last.c; })[0];
        info.innerHTML = job
          ? '<div class="ncs-info"><b>' + escText(job.n) + '</b> · ' + escText(job.p) +
            '<br>이 직무가 하는 일: ' + job.u.slice(0, 6).map(escText).join(", ") +
            (job.u.length > 6 ? " 외 " + (job.u.length - 6) + "가지" : "") + '</div>'
          : "";
      } else info.innerHTML = "";
    }
    renderJobChips();

    var js = el("jobSearch");
    if (js) {
      js.addEventListener("input", function () {
        var qt = js.value.trim();
        var sug = el("jobSug");
        if (!qt) { sug.innerHTML = ""; return; }
        var nameHits = [], pathHits = [];
        window.NCS_DATA.forEach(function (j) {
          if (j.n.indexOf(qt) !== -1) nameHits.push(j);
          else if (j.p.indexOf(qt) !== -1) pathHits.push(j);
        });
        var matches = nameHits.concat(pathHits).slice(0, 8);
        sug.innerHTML = matches.length
          ? '<div class="ncs-sug">' + matches.map(function (j) {
              return '<button type="button" data-c="' + j.c + '">' + escText(j.n) +
                '<span class="path">' + escText(j.p) + '</span></button>';
            }).join("") + '</div>'
          : '<p class="hint">검색 결과가 없어요. 더 짧은 단어로 찾아보세요.</p>';
        Array.prototype.forEach.call(sug.querySelectorAll("button"), function (b) {
          b.onclick = function () {
            if (p.jobs.length >= 3) { showAlert("직무는 최대 3개까지 담을 수 있어요.\n담은 직무를 터치하면 뺄 수 있습니다."); return; }
            var job = window.NCS_DATA.filter(function (j) { return j.c === b.getAttribute("data-c"); })[0];
            js.value = ""; sug.innerHTML = "";
            if (!job || p.jobs.some(function (x) { return x.c === job.c; })) return;
            p.jobs.push({ c: job.c, n: job.n });
            p.jobsUnknown = false;
            saveState(); renderJobChips();
          };
        });
      });
    }

    el("jobUnknown").onclick = function () {
      p.jobs = [];
      p.jobsUnknown = true;
      state.introStep = 4;
      saveState(); render();
    };
    el("backBtn3").onclick = function () { state.introStep = 2; render(); };
    el("nextBtn3").onclick = function () {
      if (p.jobs.length === 0 && !p.jobsUnknown) {
        showConfirm("희망 직무를 고르지 않았어요.\n직무를 고르면 게임이 맞춤 힌트를 줍니다.\n그냥 넘어갈까요?", function () {
          state.introStep = 4; render();
        }, "그냥 넘어가기", "직무 고르기");
        return;
      }
      state.introStep = 4; render();
    };
  }

  // 4단계: 희망 기업 (상장사, 최대 2개)
  function renderIntro4(head) {
    var p = state.profile;
    p.companies = p.companies || [];

    app.innerHTML =
      '<div class="screen">' + head +
      '<div class="card"><h2>🏢 가고 싶은 회사가 있나요?</h2>' +
      '<p class="desc">상장사라면 실제 공시 숫자로 기업 카드를 보여드려요! (최대 2개, 없으면 건너뛰기)</p>' +
      (window.CORP_LIST
        ? '<label>회사 검색 (국내 상장사 ' + window.CORP_LIST.length.toLocaleString() + '개)</label>' +
          '<input type="text" id="corpSearch" autocomplete="off" placeholder="예: 삼성전자, 농심, 한샘">' +
          '<div id="corpSug"></div>'
        : "") +
      '<div class="chips" id="corpChips"></div>' +
      '<div id="corpInfo"></div>' +
      '<label>비상장·목록에 없는 회사는 직접 입력</label>' +
      '<input type="text" id="corpCustom" maxlength="30" placeholder="회사 이름">' +
      '<button class="btn ghost" id="corpCustomBtn">➕ 회사 이름만 추가</button>' +
      '<button class="btn" id="startBtn">모험 시작 🚀</button>' +
      '<button class="btn ghost" id="backBtn4">← 이전</button></div>' +
      '</div>';

    function renderCorpUi() {
      var wrap = el("corpChips");
      wrap.innerHTML = p.companies.map(function (co, i) {
        return '<span class="chip" data-i="' + i + '">🏢 ' + escText(co.n) + '</span>';
      }).join("");
      Array.prototype.forEach.call(wrap.querySelectorAll(".chip"), function (ch) {
        ch.onclick = function () {
          p.companies.splice(parseInt(ch.getAttribute("data-i"), 10), 1);
          saveState(); renderCorpUi();
        };
      });
      var last = p.companies[p.companies.length - 1];
      el("corpInfo").innerHTML = last ? companyCardHtml(last) : "";
    }
    renderCorpUi();

    var cs = el("corpSearch");
    if (cs) {
      cs.addEventListener("input", function () {
        var qt = cs.value.trim();
        var sug = el("corpSug");
        if (!qt) { sug.innerHTML = ""; return; }
        var hits = [];
        for (var i = 0; i < window.CORP_LIST.length && hits.length < 8; i++) {
          if (window.CORP_LIST[i][0].indexOf(qt) !== -1) hits.push(window.CORP_LIST[i]);
        }
        sug.innerHTML = hits.length
          ? '<div class="ncs-sug">' + hits.map(function (h) {
              return '<button type="button" data-c="' + h[1] + '" data-n="' + escText(h[0]) + '">' + escText(h[0]) + '</button>';
            }).join("") + '</div>'
          : '<p class="hint">상장사 목록에 없어요. 아래 직접 입력을 이용하세요.</p>';
        Array.prototype.forEach.call(sug.querySelectorAll("button"), function (b) {
          b.onclick = function () {
            if (p.companies.length >= 2) { showAlert("회사는 최대 2개까지! 담은 회사를 터치하면 뺄 수 있어요."); return; }
            var co = { c: b.getAttribute("data-c"), n: b.getAttribute("data-n"), card: null };
            cs.value = ""; sug.innerHTML = "";
            if (p.companies.some(function (x) { return x.c === co.c; })) return;
            p.companies.push(co);
            saveState(); renderCorpUi();
            // 기업 카드 조회 (서버 프록시 경유 — 키 노출 없음)
            fetchCompanyCard(co.c, function (card) {
              co.card = card;
              saveState();
              if (state.screen === "intro" && state.introStep === 4) renderCorpUi();
            });
          };
        });
      });
    }

    el("corpCustomBtn").onclick = function () {
      var v = el("corpCustom").value.trim();
      if (!v) return;
      if (p.companies.length >= 2) { showAlert("회사는 최대 2개까지 담을 수 있어요."); return; }
      p.companies.push({ n: v, custom: true, card: null });
      el("corpCustom").value = "";
      saveState(); renderCorpUi();
    };

    el("backBtn4").onclick = function () { state.introStep = 3; render(); };
    el("startBtn").onclick = function () {
      fadeTo(function () { state.screen = "hallway"; render(); });
    };
  }

  /* ---------- 기업 카드 (DART 공시 요약 — 내장 정적 파일) ---------- */
  function fetchCompanyCard(corpCode, cb) {
    if (!corpCode) { cb(null); return; }
    try {
      fetch("corp/" + corpCode + ".json")
        .then(function (r) { return r.ok ? r.json() : null; })
        .then(function (d) { cb(d && !d.error ? d : null); })
        .catch(function () { cb(null); });
    } catch (e) { cb(null); }
  }

  function fmtEok(v) {
    if (v == null) return null;
    var eok = v / 100000000;
    if (Math.abs(eok) >= 10000) return (Math.round(eok / 1000) / 10) + "조";
    if (Math.abs(eok) >= 1) return Math.round(eok).toLocaleString() + "억";
    return Math.round(v / 10000).toLocaleString() + "만";
  }
  function growthPct(card) {
    if (!card || card.revenue == null || !card.revenuePrev) return null;
    return Math.round((card.revenue - card.revenuePrev) / Math.abs(card.revenuePrev) * 1000) / 10;
  }

  function companyCardHtml(co) {
    if (!co) return "";
    if (!co.card) {
      return '<div class="ncs-info"><b>' + escText(co.n) + '</b><br>' +
        (co.custom ? "직접 입력한 회사예요. 이름만 기록됩니다."
          : "공시 정보를 불러오는 중... (잠시 후 자동 표시. 안 뜨면 공시가 없는 회사예요)") + '</div>';
    }
    var c = co.card;
    var g = growthPct(c);
    var bits = [];
    if (c.revenue != null) bits.push("매출 " + fmtEok(c.revenue) +
      (g != null ? " (" + (g >= 0 ? "▲+" : "▼") + g + "%)" : ""));
    if (c.op != null) bits.push("영업이익 " + fmtEok(c.op));
    if (c.employees) bits.push("직원 " + c.employees.toLocaleString() + "명");
    if (c.tenure) bits.push("평균 근속 " + c.tenure + "년");
    if (c.salary) bits.push("1인 평균 급여 " + Math.round(c.salary / 10000).toLocaleString() + "만원");
    return '<div class="ncs-info"><b>🏢 ' + escText(co.n) + '</b> · ' + c.year + '년 사업보고서 기준<br>' +
      bits.map(escText).join(" · ") + '</div>';
  }

  /* 기업 힌트 카드 (방별 문구 — content.js 의 companyHints) */
  function companyHintHtml(roomId) {
    var hints = C.texts.companyHints || {};
    var frame = hints.frames && hints.frames[roomId];
    var comp = ((state.profile && state.profile.companies) || []).filter(function (x) { return x.card; })[0];
    if (!frame || !comp) return "";
    var card = comp.card;
    var g = growthPct(card);
    var vals = {
      n: comp.n,
      tenure: card.tenure,
      emp: card.employees ? card.employees.toLocaleString() + "명" : null,
      growth: (g != null ? (g >= 0 ? "+" : "") + g + "% " + (g >= 0 ? "성장" : "감소") : null)
    };
    var ok = true;
    var text = frame.replace(/\{(n|tenure|growth|emp)\}/g, function (m, k) {
      if (vals[k] == null) { ok = false; return ""; }
      return String(vals[k]);
    });
    if (!ok) return "";
    return '<div class="hint-card"><b>' + escText(hints.title || "🏢 기업 힌트") + '</b><br>' +
      escText(text) + '</div>';
  }

  /* 기업 공시 숫자로 면접 질문 생성 (6-Lens 로직 이식) */
  function buildInterviewQuestions(co) {
    if (!co || !co.card) return [];
    var c = co.card, qs = [];
    var g = growthPct(c);
    if (g != null && g >= 10)
      qs.push("최근 매출이 " + g + "% 성장했는데, 이 성장을 이끈 사업은 무엇인가요?");
    else if (g != null && g <= -5)
      qs.push("최근 매출이 " + Math.abs(g) + "% 줄었는데, 회사는 어떤 대응을 준비하고 있나요?");
    if (c.op != null && c.revenue) {
      var m = Math.round(c.op / c.revenue * 1000) / 10;
      qs.push("영업이익률이 " + m + "% 수준인데, 제 직무에서 이 수치에 기여할 부분은 어디일까요?");
    }
    if (c.tenure) qs.push("평균 근속이 " + c.tenure + "년인데, 오래 다니시는 분들의 공통점은 무엇인가요?");
    if (c.employees) qs.push("직원이 " + c.employees.toLocaleString() + "명인데, 신입이 처음 배치되는 팀은 주로 어디인가요?");
    qs.push(co.n + "의 3년 뒤 모습에서 지금과 가장 크게 달라질 부분은 무엇일까요?");
    return qs;
  }

  /* 학교별 학과 데이터 로드 (공용) */
  function loadSchoolData(i, cb) {
    window.__univCache = window.__univCache || {};
    if (window.__univCache[i]) { cb(window.__univCache[i]); return; }
    try {
      fetch("univ/" + i + ".json")
        .then(function (r) { return r.json(); })
        .then(function (d) { window.__univCache[i] = d; cb(d); })
        .catch(function () { cb(null); });
    } catch (e) { cb(null); }
  }

  /* 직무 힌트 카드 (희망 직무의 NCS 능력단위 표시) */
  function jobHintHtml(roomId) {
    var p = state.profile;
    var hints = (C.texts.jobHints || {});
    var frame = hints.frames && hints.frames[roomId];
    if (!frame || !p || !p.jobs || p.jobs.length === 0 || !window.NCS_DATA) return "";
    var units = [];
    p.jobs.forEach(function (pj) {
      var job = window.NCS_DATA.filter(function (j) { return j.c === pj.c; })[0];
      if (job) job.u.forEach(function (u) {
        if (units.length < 5 && units.indexOf(u) === -1) units.push(u);
      });
    });
    if (units.length === 0) return "";
    return '<div class="hint-card"><b>' + escText(hints.title || "🎯 직무 힌트") + '</b> · ' +
      p.jobs.map(function (j) { return escText(j.n); }).join(", ") +
      '<br><span class="hint-keywords">' + units.map(escText).join(" · ") + '</span>' +
      '<br>' + escText(frame) + '</div>';
  }

  /* 직무 능력단위와 관련된 과목인지 검사 (⭐ 표시용) */
  function jobKeywordTokens() {
    var p = state.profile;
    if (!p || !p.jobs || p.jobs.length === 0 || !window.NCS_DATA) return [];
    var tokens = [];
    p.jobs.forEach(function (pj) {
      var job = window.NCS_DATA.filter(function (j) { return j.c === pj.c; })[0];
      if (job) job.u.forEach(function (u) {
        u.split(/[\s·]+/).forEach(function (t) {
          t = t.trim();
          if (t.length >= 2 && tokens.indexOf(t) === -1) tokens.push(t);
        });
      });
    });
    return tokens;
  }
  function isJobRelated(subjectName, tokens) {
    for (var i = 0; i < tokens.length; i++) {
      if (subjectName.indexOf(tokens[i]) !== -1) return true;
    }
    return false;
  }

  /* ---------- 2. 복도 (7개의 문) ---------- */
  function renderHallway() {
    var badgeCount = Object.keys(state.clearedRooms).filter(function (rid) {
      return state.clearedRooms[rid].badge;
    }).length;
    // 다음 도전할 방 = 첫 번째 미클리어 방
    var nextIndex = -1;
    for (var i = 0; i < C.rooms.length; i++) {
      if (!state.clearedRooms[C.rooms[i].id]) { nextIndex = i; break; }
    }
    state.roomIndex = nextIndex === -1 ? 0 : nextIndex;
    var allCleared = nextIndex === -1;

    var doorsHtml = C.rooms.map(function (room, i) {
      var cleared = state.clearedRooms[room.id];
      var cls = cleared ? "cleared" : (i === nextIndex ? "current" : "locked");
      var inside = cleared ? room.badge.icon : (i === nextIndex ? "✨" : "🔒");
      var stateText = cleared
        ? (cleared.badge ? room.badge.icon + " " + escText(room.badge.name) : "클리어 (배지 없음)")
        : (i === nextIndex ? "👆 터치해서 입장!" : "잠김");
      return '<div class="doorframe ' + cls + '" data-i="' + i + '">' +
        '<div class="plaque">' + (i + 1) + '. ' + escText(room.title) + '</div>' +
        '<div class="door-hole"><span class="door-inside">' + inside + '</span>' +
        '<div class="door-panel">' + (i + 1) + '</div></div>' +
        '<div class="door-state">' + stateText + '</div></div>';
    }).join("");

    app.innerHTML =
      '<div class="screen">' +
      '<div class="hud"><span class="who">' + state.avatar + ' ' + esc(state.nickname) + '</span>' +
      '<span class="badges">🏅 ' + badgeCount + '/' + C.rooms.length + '</span></div>' +
      '<div class="hall-view"><div class="doors-row" id="doorsRow">' + doorsHtml + '</div>' +
      '<span id="walker">' + state.avatar + '</span></div>' +
      '<div class="door-dots">' + C.rooms.map(function (room, i) {
        var dc = state.clearedRooms[room.id] ? "clear" : (i === nextIndex ? "cur" : "");
        return '<span class="dot ' + dc + '"></span>';
      }).join("") + '</div>' +
      '<p class="hall-hint">' + (allCleared
        ? "모든 방을 통과했습니다!"
        : "방은 모두 " + C.rooms.length + "개! 복도를 옆으로 밀면 나머지 문이 보여요.<br>빛나는 문을 터치하면 캐릭터가 들어갑니다.") + '</p>' +
      (allCleared ? '<button class="btn" id="finalBtn">최종 결과 보기 🎉</button>' : "") +
      '<button class="btn ghost" id="resetBtn">🔄 처음부터 다시 시작</button>' +
      '</div>';

    // 캐릭터를 복도 바닥 중앙에 배치
    var hall = document.querySelector(".hall-view");
    var walker = el("walker");
    function placeWalker() {
      var hr = hall.getBoundingClientRect();
      walker.style.left = (hr.width / 2 - 17) + "px";
      walker.style.top = (hr.height - 64) + "px";
    }
    placeWalker();

    // 현재 방 문이 보이도록 스크롤 + 옆으로 밀 수 있음을 알려주는 살짝 밀기 연출
    var row = el("doorsRow");
    var curDoor = document.querySelector(".doorframe.current");
    var target = curDoor ? Math.max(0, curDoor.offsetLeft - row.clientWidth / 2 + 54) : 0;
    row.scrollLeft = target;
    if (row.scrollWidth > row.clientWidth + 40) {
      setTimeout(function () { row.scrollLeft = target + 150; }, 500);
      setTimeout(function () { row.scrollLeft = target; }, 1300);
    }

    // 문 클릭
    Array.prototype.forEach.call(document.querySelectorAll(".doorframe"), function (d) {
      d.onclick = function () {
        if (busy) return;
        var i = parseInt(d.getAttribute("data-i"), 10);
        var room = C.rooms[i];
        if (state.clearedRooms[room.id]) {
          var r = state.clearedRooms[room.id];
          showAlert(room.title + " 방은 이미 클리어했어요!\n점수: " + r.percent + "점 " +
            (r.badge ? "(" + room.badge.icon + " " + room.badge.name + " 획득)" : "(배지 없음)"));
          return;
        }
        if (i !== nextIndex) {
          showAlert("🔒 이 문은 잠겨 있어요.\n이전 방을 먼저 통과해야 열립니다!");
          return;
        }
        // 입장 연출: 캐릭터 걷기 → 문 열림 → 안으로
        busy = true;
        var hr = hall.getBoundingClientRect();
        var dr = d.querySelector(".door-hole").getBoundingClientRect();
        walker.classList.add("walking");
        walker.style.left = (dr.left - hr.left + dr.width / 2 - 17) + "px";
        walker.style.top = (dr.bottom - hr.top - 52) + "px";
        setTimeout(function () {
          walker.classList.remove("walking");
          d.classList.add("open");
          setTimeout(function () {
            walker.style.opacity = "0";
            walker.style.transform = "scale(.4)";
            setTimeout(function () {
              busy = false;
              fadeTo(function () {
                state.roomIndex = i;
                state.screen = "room";
                render();
              });
            }, 320);
          }, 480);
        }, 820);
      };
    });

    if (allCleared) el("finalBtn").onclick = function () { showFinal(); };
    el("resetBtn").onclick = function () {
      showConfirm("지금까지의 모든 답변이 지워집니다.\n정말 처음부터 다시 시작할까요?", function () {
        clearSaved();
        state = newState();
        render();
      }, "다시 시작", "계속하기");
    };
  }

  /* ---------- 3. 방 내부 (아이템 조사) ---------- */
  function renderRoom() {
    var room = currentRoom();
    var total = room.questions.length;
    var doneCount = room.questions.filter(isAnswered).length;
    var allDone = doneCount === total;

    // 방마다 살짝 다른 벽 색 (테마 느낌)
    var hue = (state.roomIndex * 47) % 360;
    var wallStyle = "background: linear-gradient(180deg, hsl(" + hue + ",22%,20%), hsl(" + hue + ",26%,28%));";

    // 아이템 상태: 앞 아이템을 해결(답변 또는 건너뛰기)해야 다음이 열림
    var statuses = [];
    var unlocked = true;
    room.questions.forEach(function (q) {
      var done = isAnswered(q);
      var skipped = !done && !!state.skipped[q.id];
      var st = done ? "done" : (skipped ? "skip" : (unlocked ? "todo" : "locked"));
      if (!done && !skipped) unlocked = false;
      statuses.push(st);
    });
    var MARKS = { done: "✅", skip: "⚠️", todo: "❗", locked: "🔒" };

    var itemsHtml = room.questions.map(function (q, idx) {
      var it = itemOf(q, idx);
      var spot = SPOTS[idx % SPOTS.length];
      var st = statuses[idx];
      return '<div class="item ' + st + '" data-q="' + idx + '"' +
        ' style="left:' + spot.x + '%; top:' + spot.y + '%">' +
        '<span class="mark">' + MARKS[st] + '</span>' +
        '<span class="item-icon">' + it.icon + '</span>' +
        '<span class="item-label">' + escText(it.label) + '</span></div>';
    }).join("");

    app.innerHTML =
      '<div class="screen">' +
      '<div class="hud">' +
      '<button class="backlink" id="backHall">← 복도로</button>' +
      '<span class="who">' + (state.roomIndex + 1) + '번 방 · ' + esc(room.title) + '</span>' +
      '<span class="badges">' + room.badge.icon + '</span></div>' +
      '<div class="scene">' +
      '<div class="wall" style="' + wallStyle + '"></div><div class="floor"></div>' +
      '<div class="exitdoor' + (allDone ? " ready" : "") + '" id="exitDoor">' +
      '<div class="door-hole"><span class="door-inside">' + (allDone ? "🌟" : "🚪") + '</span>' +
      '<div class="door-panel">🔓</div></div>' +
      '<div class="exit-label">' + (allDone ? "탈출하기!" : "출구") + '</div></div>' +
      itemsHtml +
      '<span id="roomChar">' + state.avatar + '</span>' +
      '</div>' +
      '<p class="room-progress">조사한 아이템 <b>' + doneCount + '</b> / ' + total +
      ' — ❗ 표시된 아이템을 터치해 보세요</p>' +
      '</div>';

    // 방 첫 입장 시 안내문
    if (!state.introSeen[room.id]) {
      state.introSeen[room.id] = true;
      saveState();
      showAlert((state.roomIndex + 1) + "번 방 · " + room.title + "\n\n" + room.intro);
    }

    var roomChar = el("roomChar");

    // 아이템 클릭 → 캐릭터가 다가가서 질문 패널 열림 (잠긴 아이템은 안내만)
    Array.prototype.forEach.call(document.querySelectorAll(".item"), function (itemEl) {
      itemEl.onclick = function () {
        if (busy) return;
        var qIdx = parseInt(itemEl.getAttribute("data-q"), 10);
        if (statuses[qIdx] === "locked") {
          showAlert("🔒 아직 잠겨 있어요!\n❗ 표시된 아이템부터 순서대로 조사해 보세요.");
          return;
        }
        busy = true;
        var spot = SPOTS[qIdx % SPOTS.length];
        roomChar.classList.add("walking");
        roomChar.style.left = spot.x + "%";
        setTimeout(function () {
          roomChar.classList.remove("walking");
          busy = false;
          openSheet(qIdx);
        }, 520);
      };
    });

    // 출구 클릭
    el("exitDoor").onclick = function () {
      if (busy) return;
      var remain = total - room.questions.filter(isAnswered).length;
      if (remain > 0) {
        showConfirm("아직 조사하지 않은 아이템이 " + remain + "개 있어요.\n" +
          "그냥 나가면 그 문항은 0점이 됩니다.\n정말 나갈까요?", exitRoom, "그냥 나가기", "더 조사하기");
      } else {
        exitRoom();
      }
    };
    function exitRoom() {
      busy = true;
      var door = el("exitDoor");
      door.classList.add("open");
      roomChar.classList.add("walking");
      roomChar.style.left = "50%";
      roomChar.style.bottom = "52%";
      setTimeout(function () {
        busy = false;
        fadeTo(function () { clearRoom(); });
      }, 700);
    }

    el("backHall").onclick = function () {
      if (busy) return;
      fadeTo(function () { state.screen = "hallway"; render(); });
    };
  }

  /* ---------- 질문 패널 (바텀 시트) ---------- */
  function closeSheet() {
    var ov = el("sheetOverlay");
    var sh = el("sheetPanel");
    if (ov) ov.remove();
    if (sh) sh.remove();
  }

  function openSheet(qIdx) {
    closeSheet();
    var room = currentRoom();
    var q = room.questions[qIdx];
    var a = getAnswer(q.id);
    var it = itemOf(q, qIdx);

    // 인트로에서 고른 학교·학과를 univ 문항에 자동 반영 (검색 단계 생략)
    if (q.type === "univ" && !a.univ && !a.univManual && state.profile && state.profile.school) {
      a.univ = {
        i: state.profile.school.i,
        s: state.profile.school.s,
        dept: state.profile.school.dept || null
      };
    }

    var bodyHtml;
    if (q.type === "episode") {
      var mode = (a.episode && a.episode.mode === "reuse") ? "reuse" : "new";
      var bagEmpty = state.episodes.filter(function (e) { return !a.episode || e.id !== a.episode.id || a.episode.mode === "reuse"; }).length === 0 && state.episodes.length === 0;
      bodyHtml =
        '<div class="mode-tabs">' +
        '<button id="modeNew" class="' + (mode === "new" ? "on" : "") + '">' + escText(C.texts.episodeNewLabel) + '</button>' +
        '<button id="modeReuse" class="' + (mode === "reuse" ? "on" : "") + '" ' + (state.episodes.length === 0 ? "disabled" : "") + '>' +
        escText(C.texts.episodeReuseLabel) + (state.episodes.length === 0 ? " (비어있음)" : "") + '</button></div>';

      if (mode === "reuse") {
        var options = state.episodes.map(function (ep) {
          var sel = (a.episode && a.episode.id === ep.id) ? "selected" : "";
          return '<option value="' + escText(ep.id) + '" ' + sel + '>' + escText(ep.title) + '</option>';
        }).join("");
        bodyHtml +=
          '<label>가방에서 에피소드 선택</label><select id="epSelect">' + options + '</select>' +
          '<div class="reuse-warn">⚠️ ' + escText(C.texts.episodeReuseWarn) + '</div>' +
          '<label>이 경험에서 이 방 주제와 관련된 부분을 적어주세요</label>' +
          '<textarea id="answerText" placeholder="같은 경험이라도 이 방의 주제로 다시 설명해 보세요">' + escText(a.text) + '</textarea>';
      } else {
        var epTitle = (a.episode && a.episode.mode === "new") ? a.episode.title : "";
        var epText = (a.episode && a.episode.mode === "new") ? a.episode.text : "";
        bodyHtml +=
          '<label>에피소드 제목 (한 줄 요약)</label>' +
          '<input type="text" id="epTitle" maxlength="30" placeholder="예: 자작차 동아리 프로젝트" value="' + escText(epTitle) + '">' +
          '<label>에피소드 내용 (언제, 어디서, 무엇을, 어떻게, 결과는?)</label>' +
          '<textarea id="epText" placeholder="구체적으로 쓸수록 점수가 올라가요! 숫자나 결과를 넣으면 보너스!">' + escText(epText) + '</textarea>' +
          '<p class="hint">💡 여기 쓴 에피소드는 "가방"에 저장돼요. 같은 에피소드를 다른 방에서 또 쓰면 그때는 점수가 없어요!</p>';
      }
    } else if (q.type === "pick") {
      var pCount = (typeof q.count === "number") ? q.count : 3;
      bodyHtml =
        '<label>보기에서 골라 담으세요! (최대 ' + pCount + '개, 담은 것 ✓)</label>' +
        '<div class="subject-grid" id="pickGrid"></div>' +
        (q.allowCustom
          ? '<label>보기에 없으면 직접 쓰기</label>' +
            '<input type="text" id="pickAdd" maxlength="40" placeholder="직접 쓰고 아래 추가 버튼">' +
            '<button type="button" class="btn ghost" id="pickAddBtn">➕ 직접 쓴 항목 추가</button>'
          : "");
    } else if (q.type === "univ" && window.UNIV_INDEX) {
      var uCount = (typeof q.count === "number") ? q.count : 3;
      if (a.univManual) {
        var UNUM = ["①", "②", "③", "④", "⑤"];
        var uEntries = a.entries || [];
        var uInputs = "";
        for (var ui = 0; ui < uCount; ui++) {
          uInputs += '<label>' + (UNUM[ui] || (ui + 1) + ".") + ' 과목 이름</label>' +
            '<input type="text" class="listInput" maxlength="40"' +
            ' placeholder="' + escText(q.placeholder || "예: 회계원리") + '"' +
            ' value="' + escText(uEntries[ui] || "") + '">';
        }
        bodyHtml = '<p class="hint">✏️ 직접 입력 모드예요.</p>' + uInputs +
          '<button type="button" class="btn ghost" id="univBack">🔍 학교 검색으로 돌아가기</button>';
      } else if (!a.univ) {
        bodyHtml =
          '<label>다녔던 학교 검색 (전국 ' + window.UNIV_INDEX.length + '개교)</label>' +
          '<input type="text" id="univSearch" autocomplete="off" placeholder="학교 이름 일부를 입력하세요">' +
          '<div id="univSug"></div>' +
          '<button type="button" class="btn ghost" id="univManualBtn">🏫 목록에 없어요 / 과목을 직접 쓸래요</button>';
      } else if (!a.univ.dept) {
        bodyHtml =
          '<div class="chips"><span class="chip" id="univReset">🏫 ' + escText(a.univ.s) + '</span></div>' +
          '<label>학과 검색 (터치해서 선택)</label>' +
          '<input type="text" id="deptSearch" autocomplete="off" placeholder="학과 이름 일부를 입력하세요">' +
          '<div id="deptSug"><p class="hint">학과 목록 불러오는 중...</p></div>';
      } else {
        bodyHtml =
          '<div class="chips"><span class="chip" id="univReset">🏫 ' + escText(a.univ.s) + ' · ' + escText(a.univ.dept) + '</span></div>' +
          '<label>재미있게 들었던 과목을 최대 ' + uCount + '개 골라 담으세요! (담은 과목 ✓)</label>' +
          '<div class="subject-grid" id="subjGrid"><p class="hint">과목 목록 불러오는 중...</p></div>' +
          '<label>목록에 없는 과목 직접 추가</label>' +
          '<input type="text" id="subjAdd" maxlength="40" placeholder="과목 이름 쓰고 오른쪽 추가 버튼">' +
          '<button type="button" class="btn ghost" id="subjAddBtn">➕ 직접 쓴 과목 추가</button>';
      }
    } else if (q.type === "ncs" && window.NCS_DATA) {
      var ncsCount = (typeof q.count === "number") ? q.count : 3;
      bodyHtml =
        '<label>직무 검색 (국가직무능력표준 NCS · ' + window.NCS_DATA.length + '개 직무)</label>' +
        '<input type="text" id="ncsSearch" autocomplete="off"' +
        ' placeholder="' + escText(q.placeholder || "직무 이름을 검색하세요") + '">' +
        '<div id="ncsSug"></div>' +
        '<div id="ncsChips" class="chips"></div>' +
        '<div id="ncsInfo"></div>' +
        '<p class="hint">💡 검색해서 최대 ' + ncsCount + '개까지 담아보세요. 담으면 그 직무가 하는 일이 표시돼요!</p>';
    } else if (q.type === "list" || q.type === "ncs" || q.type === "univ") {
      // (ncs/univ 인데 데이터 파일이 없으면 일반 칸 채우기로 대체 동작)
      var count = (typeof q.count === "number") ? q.count : 3;
      var NUM = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩"];
      var entries = a.entries || [];
      var inputs = "";
      for (var li = 0; li < count; li++) {
        inputs += '<label>' + (NUM[li] || (li + 1) + ".") + '</label>' +
          '<input type="text" class="listInput" maxlength="40"' +
          ' placeholder="' + escText(q.placeholder || "짧게 적어주세요") + '"' +
          ' value="' + escText(entries[li] || "") + '">';
      }
      bodyHtml = inputs +
        '<p class="hint">💡 한 칸에 하나씩! 다 채우면 성실 보너스, 숫자가 들어가면 결과 보너스!</p>';
    } else if (q.type === "short") {
      bodyHtml =
        '<label>나의 답변 (단어나 한 문장이면 충분!)</label>' +
        '<input type="text" id="answerText" maxlength="80"' +
        ' placeholder="' + escText(q.placeholder || "짧고 구체적으로!") + '"' +
        ' value="' + escText(a.text) + '">' +
        '<p class="hint">💡 숫자·결과(점수, 횟수, 기간)가 들어가면 보너스 점수!</p>';
    } else {
      bodyHtml =
        '<label>나의 답변</label>' +
        '<textarea id="answerText" placeholder="' + escText(q.placeholder || "솔직하고 구체적으로! 숫자나 결과를 넣으면 보너스 점수!") + '">' + escText(a.text) + '</textarea>';
    }

    var overlay = document.createElement("div");
    overlay.id = "sheetOverlay";
    overlay.className = "sheet-overlay";
    var sheet = document.createElement("div");
    sheet.id = "sheetPanel";
    sheet.className = "sheet";
    sheet.innerHTML =
      '<div class="sheet-head"><span class="s-icon">' + it.icon + '</span>' +
      '<span class="s-label">' + escText(it.label) + '</span>' +
      '<button class="sheet-close" id="sheetClose">✕</button></div>' +
      '<p class="q-text">Q. ' + esc(q.text) + '</p>' +
      jobHintHtml(room.id) +
      companyHintHtml(room.id) +
      bodyHtml +
      '<button class="btn" id="sheetSave">기록하기 ✍️</button>';
    document.body.appendChild(overlay);
    document.body.appendChild(sheet);

    // --- pick 문항: 보기 칩에서 골라 담기 ---
    if (q.type === "pick") {
      a.entries = a.entries || [];
      var pMax = (typeof q.count === "number") ? q.count : 3;
      var pOptions;
      if (q.optionsFrom === "profileJobs" && state.profile && state.profile.jobs.length) {
        pOptions = state.profile.jobs.map(function (j) { return j.n; });
      } else if (q.optionsFrom === "companyQuestions") {
        var comp0 = ((state.profile && state.profile.companies) || []).filter(function (x) { return x.card; })[0];
        pOptions = buildInterviewQuestions(comp0);
        if (!pOptions.length) pOptions = q.options || [
          "이 직무의 신입이 1년차에 가장 많이 하는 일은 무엇인가요?",
          "이 팀에서 인정받는 분들의 공통점은 무엇인가요?",
          "입사 전에 미리 준비하면 좋은 것이 있을까요?"
        ];
      } else {
        pOptions = q.options || [];
      }

      var pickGrid = el("pickGrid");
      var renderPick = function () {
        // 보기 + 직접 추가한 항목(보기에 없는 entries)을 함께 표시
        var extra = a.entries.filter(function (e) { return pOptions.indexOf(e) === -1; });
        var all = pOptions.concat(extra);
        pickGrid.innerHTML = all.length
          ? all.map(function (opt) {
              var on = a.entries.indexOf(opt) !== -1;
              return '<button type="button" class="' + (on ? "on" : "") + '" data-o="' + escText(opt) + '">' +
                (on ? "✓ " : "") + escText(opt) + '</button>';
            }).join("")
          : '<p class="hint">보기가 없어요. 아래에서 직접 써주세요.</p>';
        Array.prototype.forEach.call(pickGrid.querySelectorAll("button"), function (b) {
          b.onclick = function () {
            var opt = b.getAttribute("data-o");
            var i = a.entries.indexOf(opt);
            if (i !== -1) a.entries.splice(i, 1);
            else if (a.entries.length < pMax) a.entries.push(opt);
            else { showAlert("최대 " + pMax + "개까지만 담을 수 있어요.\n담은 것(✓)을 다시 터치하면 뺄 수 있습니다."); return; }
            saveState(); renderPick();
          };
        });
      };
      renderPick();

      var pAddBtn = el("pickAddBtn");
      if (pAddBtn) pAddBtn.onclick = function () {
        var v = el("pickAdd").value.trim();
        if (!v) return;
        if (a.entries.length >= pMax) { showAlert("최대 " + pMax + "개까지만 담을 수 있어요."); return; }
        if (a.entries.indexOf(v) === -1) a.entries.push(v);
        el("pickAdd").value = "";
        saveState(); renderPick();
      };
    }

    // --- 대학 학과·과목 선택 (학교 검색 → 학과 선택 → 과목 담기) ---
    if (q.type === "univ" && window.UNIV_INDEX) {
      a.entries = a.entries || [];
      var uMax = (typeof q.count === "number") ? q.count : 3;
      window.__univCache = window.__univCache || {};
      var reopenU = function () { openSheet(qIdx); };

      var loadSchool = function (i, cb) {
        if (window.__univCache[i]) { cb(window.__univCache[i]); return; }
        try {
          fetch("univ/" + i + ".json")
            .then(function (r) { return r.json(); })
            .then(function (d) { window.__univCache[i] = d; cb(d); })
            .catch(function () { cb(null); });
        } catch (e) { cb(null); }
      };

      if (el("univManualBtn")) el("univManualBtn").onclick = function () {
        a.univManual = true; saveState(); reopenU();
      };
      if (el("univBack")) el("univBack").onclick = function () {
        a.univManual = false; saveState(); reopenU();
      };
      if (el("univReset")) el("univReset").onclick = function () {
        if (a.univ && a.univ.dept) a.univ.dept = null;  // 한 번 누르면 학과 변경
        else a.univ = null;                             // 학과 선택 전이면 학교 변경
        a.entries = [];
        saveState(); reopenU();
      };

      // 1단계: 학교 검색
      var us = el("univSearch");
      if (us) {
        us.addEventListener("input", function () {
          var qt = us.value.trim();
          var sug = el("univSug");
          if (!qt) { sug.innerHTML = ""; return; }
          var hits = [];
          for (var i = 0; i < window.UNIV_INDEX.length && hits.length < 8; i++) {
            if (window.UNIV_INDEX[i].indexOf(qt) !== -1) hits.push(i);
          }
          sug.innerHTML = hits.length
            ? '<div class="ncs-sug">' + hits.map(function (i) {
                return '<button type="button" data-i="' + i + '">' + escText(window.UNIV_INDEX[i]) + '</button>';
              }).join("") + '</div>'
            : '<p class="hint">검색 결과가 없어요. 학교 이름 일부만 입력해 보세요.</p>';
          Array.prototype.forEach.call(sug.querySelectorAll("button"), function (b) {
            b.onclick = function () {
              var i = parseInt(b.getAttribute("data-i"), 10);
              a.univ = { i: i, s: window.UNIV_INDEX[i], dept: null };
              a.entries = [];
              saveState(); reopenU();
            };
          });
        });
      }

      // 2단계: 학과 선택
      var ds = el("deptSearch");
      if (ds && a.univ) {
        loadSchool(a.univ.i, function (data) {
          var sug = el("deptSug");
          if (!data) {
            sug.innerHTML = '<p class="hint">⚠️ 학과 정보를 불러오지 못했어요. 인터넷 연결을 확인해 주세요.</p>';
            return;
          }
          var renderDepts = function () {
            var qt = ds.value.trim();
            var hits = data.d.filter(function (d0) { return !qt || d0[0].indexOf(qt) !== -1; }).slice(0, 10);
            sug.innerHTML = hits.length
              ? '<div class="ncs-sug">' + hits.map(function (d0) {
                  return '<button type="button" data-d="' + escText(d0[0]) + '">' + escText(d0[0]) +
                    '<span class="path">과목 ' + d0[1].length + '개 등록됨</span></button>';
                }).join("") + '</div>'
              : '<p class="hint">검색 결과가 없어요.</p>';
            Array.prototype.forEach.call(sug.querySelectorAll("button"), function (b) {
              b.onclick = function () {
                a.univ.dept = b.getAttribute("data-d");
                a.entries = [];
                saveState(); reopenU();
              };
            });
          };
          ds.addEventListener("input", renderDepts);
          renderDepts();
        });
      }

      // 3단계: 과목 골라 담기
      var grid = el("subjGrid");
      if (grid && a.univ && a.univ.dept) {
        loadSchool(a.univ.i, function (data) {
          var dept = data && data.d.filter(function (d0) { return d0[0] === a.univ.dept; })[0];
          var subjects = dept ? dept[1] : [];
          // 희망 직무와 관련된 과목은 ⭐ 표시 + 앞쪽에 배치 (회상 유도)
          var jobTokens = jobKeywordTokens();
          var starred = subjects.filter(function (s0) { return isJobRelated(s0, jobTokens); });
          var normal = subjects.filter(function (s0) { return starred.indexOf(s0) === -1; });
          var ordered = starred.concat(normal);
          var renderGrid = function () {
            grid.innerHTML = ordered.length
              ? ordered.map(function (s0) {
                  var on = a.entries.indexOf(s0) !== -1;
                  var star = starred.indexOf(s0) !== -1;
                  return '<button type="button" class="' + (on ? "on" : "") + '" data-s="' + escText(s0) + '">' +
                    (on ? "✓ " : "") + (star ? "⭐" : "") + escText(s0) + '</button>';
                }).join("")
              : '<p class="hint">이 학과는 등록된 과목이 없어요. 아래에서 직접 추가해 주세요.</p>';
            Array.prototype.forEach.call(grid.querySelectorAll("button"), function (b) {
              b.onclick = function () {
                var s0 = b.getAttribute("data-s");
                var idx2 = a.entries.indexOf(s0);
                if (idx2 !== -1) a.entries.splice(idx2, 1);
                else if (a.entries.length < uMax) a.entries.push(s0);
                else { showAlert("최대 " + uMax + "개까지만 담을 수 있어요.\n담은 과목(✓)을 다시 터치하면 뺄 수 있습니다."); return; }
                saveState(); renderGrid();
              };
            });
          };
          renderGrid();
        });
        var addBtn = el("subjAddBtn");
        if (addBtn) addBtn.onclick = function () {
          var v = el("subjAdd").value.trim();
          if (!v) return;
          if (a.entries.length >= uMax) {
            showAlert("최대 " + uMax + "개까지만 담을 수 있어요.");
            return;
          }
          if (a.entries.indexOf(v) === -1) a.entries.push(v);
          el("subjAdd").value = "";
          saveState(); reopenU();
        };
      }
    }

    // --- NCS 직무 검색 (자동완성 + 담기) ---
    if (q.type === "ncs" && window.NCS_DATA) {
      a.entries = a.entries || [];
      a.ncsCodes = a.ncsCodes || [];
      var ncsMax = (typeof q.count === "number") ? q.count : 3;
      var searchEl = el("ncsSearch"), sugEl = el("ncsSug");

      var renderChips = function () {
        var chipsEl = el("ncsChips"), infoEl = el("ncsInfo");
        chipsEl.innerHTML = a.entries.map(function (n, i) {
          return '<span class="chip" data-i="' + i + '">🎯 ' + escText(n) + '</span>';
        }).join("");
        Array.prototype.forEach.call(chipsEl.querySelectorAll(".chip"), function (ch) {
          ch.onclick = function () {
            var i = parseInt(ch.getAttribute("data-i"), 10);
            a.entries.splice(i, 1);
            a.ncsCodes.splice(i, 1);
            saveState();
            renderChips();
          };
        });
        if (a.entries.length > 0) {
          var lastCode = a.ncsCodes[a.ncsCodes.length - 1];
          var job = window.NCS_DATA.filter(function (j) { return j.c === lastCode; })[0];
          if (job) {
            var units = job.u.slice(0, 8).map(escText).join(", ");
            var more = job.u.length > 8 ? " 외 " + (job.u.length - 8) + "가지" : "";
            infoEl.innerHTML = '<div class="ncs-info"><b>' + escText(job.n) + '</b> · ' + escText(job.p) +
              '<br>이 직무가 하는 일: ' + units + more + '</div>';
          } else infoEl.innerHTML = "";
        } else infoEl.innerHTML = "";
      };

      searchEl.addEventListener("input", function () {
        var qtext = searchEl.value.trim();
        if (!qtext) { sugEl.innerHTML = ""; return; }
        // 직무명 일치를 먼저, 분류경로 일치는 그 다음에 보여줌
        var nameHits = [], pathHits = [];
        window.NCS_DATA.forEach(function (j) {
          if (j.n.indexOf(qtext) !== -1) nameHits.push(j);
          else if (j.p.indexOf(qtext) !== -1) pathHits.push(j);
        });
        var matches = nameHits.concat(pathHits).slice(0, 8);
        sugEl.innerHTML = matches.length
          ? '<div class="ncs-sug">' + matches.map(function (j) {
              return '<button type="button" data-c="' + j.c + '">' + escText(j.n) +
                '<span class="path">' + escText(j.p) + '</span></button>';
            }).join("") + '</div>'
          : '<p class="hint">검색 결과가 없어요. 더 짧은 단어로 찾아보세요. (예: 회계, 판매, 조리)</p>';
        Array.prototype.forEach.call(sugEl.querySelectorAll("button"), function (b) {
          b.onclick = function () {
            if (a.entries.length >= ncsMax) {
              showAlert("최대 " + ncsMax + "개까지만 담을 수 있어요.\n담은 직무를 터치하면 뺄 수 있습니다.");
              return;
            }
            var job = window.NCS_DATA.filter(function (j) { return j.c === b.getAttribute("data-c"); })[0];
            searchEl.value = "";
            sugEl.innerHTML = "";
            if (!job || a.ncsCodes.indexOf(job.c) !== -1) return;
            a.entries.push(job.n);
            a.ncsCodes.push(job.c);
            saveState();
            renderChips();
          };
        });
      });
      renderChips();
    }

    // --- 입력 실시간 저장 ---
    function collectInputs() {
      if (q.type === "pick") { saveState(); return; } // 담기 방식은 즉시 저장됨
      if (q.type === "ncs" && window.NCS_DATA) { saveState(); return; }
      if (q.type === "univ" && window.UNIV_INDEX && !a.univManual) { saveState(); return; }
      if (q.type === "list" || q.type === "ncs" || q.type === "univ") {
        a.entries = Array.prototype.map.call(sheet.querySelectorAll(".listInput"), function (inp) {
          return inp.value;
        });
        saveState();
        return;
      }
      if (q.type === "episode") {
        var isReuse = a.episode && a.episode.mode === "reuse";
        if (isReuse) {
          a.text = el("answerText") ? el("answerText").value : "";
        } else {
          var t = el("epTitle") ? el("epTitle").value.trim() : "";
          var x = el("epText") ? el("epText").value : "";
          if (t || x.trim()) {
            if (!a.episode || a.episode.mode !== "new") {
              state.episodeSeq++;
              a.episode = { mode: "new", id: "ep" + state.episodeSeq, title: "", text: "" };
            }
            a.episode.title = t || "제목 없는 에피소드";
            a.episode.text = x;
          } else {
            a.episode = null;
          }
          a.text = "";
        }
      } else {
        a.text = el("answerText") ? el("answerText").value : "";
      }
      saveState();
    }
    Array.prototype.forEach.call(sheet.querySelectorAll("input, textarea"), function (input) {
      input.addEventListener("input", collectInputs);
    });

    // --- 에피소드 모드 전환 ---
    if (q.type === "episode") {
      el("modeNew").onclick = function () {
        if (a.episode && a.episode.mode === "reuse") a.episode = null;
        a.text = "";
        saveState();
        openSheet(qIdx);
      };
      var reuseBtn = el("modeReuse");
      if (reuseBtn && !reuseBtn.disabled) {
        reuseBtn.onclick = function () {
          var first = state.episodes[0];
          a.episode = { mode: "reuse", id: first.id, title: first.title, text: first.text };
          a.text = "";
          saveState();
          openSheet(qIdx);
        };
      }
      var sel = el("epSelect");
      if (sel) {
        sel.onchange = function () {
          var ep = state.episodes.filter(function (e) { return e.id === sel.value; })[0];
          if (ep) a.episode = { mode: "reuse", id: ep.id, title: ep.title, text: ep.text };
          saveState();
        };
      }
    }

    // 새 에피소드를 가방에 등록 (id 기준으로 중복 없이)
    function registerEpisode() {
      if (q.type !== "episode" || !a.episode || a.episode.mode !== "new") return;
      var found = state.episodes.filter(function (e) { return e.id === a.episode.id; })[0];
      if (found) { found.title = a.episode.title; found.text = a.episode.text; }
      else state.episodes.push({ id: a.episode.id, title: a.episode.title, text: a.episode.text });
      saveState();
    }

    function finishSheet() {
      registerEpisode();
      if (E.scoreAnswer(q, a, C.settings).answered) delete state.skipped[q.id];
      saveState();
      // ★ 답변 저장 시 방의 최신 상태를 시트로 전송하되,
      //   동시 접속(단체 진행)에 대비해 1인당 일정 간격으로만 전송 (스로틀)
      //   — 매번 방 전체 답변을 다시 보내므로 건너뛴 전송분도 다음 전송이 만회함
      var throttleMs = (C.settings.sendThrottleSec || 45) * 1000;
      var now = Date.now();
      if (!state._lastSend || now - state._lastSend >= throttleMs) {
        state._lastSend = now;
        var room = currentRoom();
        var partial = E.scoreRoom(room, state.answers, C.settings);
        var doneCnt = room.questions.filter(isAnswered).length;
        sendToSheet(buildRoomPayload(room, partial,
          "진행 중 (" + room.title + " " + doneCnt + "/" + room.questions.length + ")"));
        retryPending();
      }
      saveState();
      closeSheet();
      renderRoom(); // 아이템 표시 갱신
    }

    // X 닫기: 입력은 저장된 채로 닫기만
    el("sheetClose").onclick = function () { collectInputs(); finishSheet(); };
    overlay.onclick = function () { collectInputs(); finishSheet(); };

    // 기록하기: 검사 후 닫기
    el("sheetSave").onclick = function () {
      collectInputs();
      var scored = E.scoreAnswer(q, a, C.settings);

      function step2() {
        if (q.type === "episode" && a.episode && a.episode.mode === "new" && !a.episode._confirmed) {
          var similar = findSimilarEpisode(a.episode);
          if (similar) {
            showConfirm('혹시 "' + similar.title + '" 에피소드와 같은 이야기인가요?\n\n' +
              '같은 이야기라면 [가방에서 꺼내기]로 정직하게 표시해 주세요.\n다른 이야기라면 계속 진행하세요.',
              function () { a.episode._confirmed = true; finishSheet(); },
              "다른 이야기예요", "다시 볼게요");
            return;
          }
          a.episode._confirmed = true;
        }
        finishSheet();
      }

      if (!scored.answered) {
        showConfirm("답변이 비어있거나 너무 짧거나,\n알아볼 수 있는 한글 문장이 아니에요.\n(자음만 입력하거나 같은 글자를 반복하면 인정되지 않아요)\n\n건너뛰면 이 문항은 0점이 되고, 다음 아이템이 열립니다.", function () {
          state.skipped[q.id] = true;    // 건너뛰기 → 다음 아이템 잠금 해제
          step2();
        }, "건너뛰기", "더 쓰기");
      } else {
        step2();
      }
    };
  }

  /* ---------- 4. 방 결과 ---------- */
  function clearRoom() {
    var room = currentRoom();
    var result = E.scoreRoom(room, state.answers, C.settings);
    state.clearedRooms[room.id] = result;
    state._lastSend = Date.now();   // 방 클리어는 스로틀과 무관하게 항상 전송
    sendToSheet(buildRoomPayload(room, result, "진행 중 (" + room.title + " 클리어)"));
    retryPending();
    state.screen = "roomResult";
    render();
  }

  // 모든 방 + 최종 결과를 한 번에 재전송 (전송 누락 복구용)
  function resendAll() {
    C.rooms.forEach(function (room) {
      var result = E.scoreRoom(room, state.answers, C.settings);
      var st = state.clearedRooms[room.id] ? "진행 중 (" + room.title + " 클리어)" : "";
      sendToSheet(buildRoomPayload(room, result, st));
    });
    var final = E.evaluateGame(C, state.answers);
    if (state.finished) sendToSheet(buildFinalPayload(final));
    retryPending();
  }

  function renderRoomResult() {
    var room = currentRoom();
    var result = state.clearedRooms[room.id];
    var isLast = C.rooms.every(function (r) { return state.clearedRooms[r.id]; });

    app.innerHTML =
      '<div class="screen"><div class="card center">' +
      '<h2>' + (state.roomIndex + 1) + '번 방 탈출 성공!</h2>' +
      '<div class="score-big">' + result.percent + '점</div>' +
      (result.badge
        ? '<div class="badge-pop">' + room.badge.icon + '</div>' +
          '<div class="badge-name">' + esc(C.texts.badgeGet) + ' ' + esc(room.badge.name) + '</div>'
        : '<div class="badge-pop">😢</div><p class="desc">' + esc(C.texts.badgeMiss) + '</p>') +
      '<button class="btn" id="goNext">' + (isLast ? "최종 결과 보기 🎉" : "복도로 나가기 →") + '</button>' +
      '</div></div>';

    el("goNext").onclick = function () {
      if (isLast) { showFinal(); return; }
      fadeTo(function () { state.screen = "hallway"; render(); });
    };
  }

  /* ---------- 5. 최종 결과 ---------- */
  function showFinal() {
    var result = E.evaluateGame(C, state.answers);
    if (!state.finished) {
      state.finished = true;
      sendToSheet(buildFinalPayload(result));
      retryPending();
    }
    fadeTo(function () { state.screen = "final"; render(); });
  }

  function renderFinal() {
    var result = E.evaluateGame(C, state.answers);
    var badges = C.rooms.map(function (room, i) {
      var got = result.rooms[i].badge;
      return '<div class="badge-slot' + (got ? "" : " empty") + '" title="' + escText(room.badge.name) + '">' +
        room.badge.icon + '</div>';
    }).join("");

    var message;
    if (result.badgeCount === C.rooms.length)
      message = '<p class="desc center" style="font-size:1.05rem">' + esc(C.texts.perfectClear) + '</p>';
    else if (result.truthRoom)
      message = '<div class="truth">' + esc(C.texts.truthRoom) + '</div>';
    else
      message = '<p class="desc center">' + esc(C.texts.normalClear) + '</p>';

    var sendNote = C.settings.sheetEndpoint
      ? (state.pendingUploads.length === 0 ? "📨 결과가 상담 선생님께 전송되었습니다." : "⚠️ 전송 대기 중 — 인터넷 연결 후 이 화면을 다시 열어주세요.")
      : "";

    app.innerHTML =
      '<div class="screen">' +
      '<h1 class="logo" style="font-size:1.5rem;margin-top:16px">🏁 탈출 완료!</h1>' +
      '<p class="subtitle">' + state.avatar + ' ' + esc(state.nickname) + '님의 결과</p>' +
      '<div class="card center">' +
      '<div class="score-big">🏅 ' + result.badgeCount + ' / ' + result.totalRooms + '</div>' +
      '<div class="badge-grid">' + badges + '</div>' +
      '<p class="hint">총점 ' + result.totalEarned + ' / ' + result.totalMax + '점 · 에피소드 ' + state.episodes.length + '개 수집</p>' +
      '</div>' +
      message +
      '<div class="send-status">' + sendNote + '</div>' +
      '<button class="btn" id="reviewBtn">📖 내가 쓴 기록 보기</button>' +
      '<button class="btn" id="pdfBtn">📄 리포트 저장 (PDF)</button>' +
      '<button class="btn ghost" id="homeBtn">🏠 처음 화면으로 (기록 유지)</button>' +
      (C.settings.sheetEndpoint
        ? '<button class="btn ghost" id="resendBtn">📨 결과 다시 전송하기</button>' : "") +
      '<button class="btn ghost" id="restartBtn">처음부터 다시 하기 (기록 삭제)</button>' +
      '<p class="hint center">버전 v' + escText(C.meta.version) + '</p>' +
      '</div>';

    if (state.pendingUploads.length > 0) retryPending();
    el("reviewBtn").onclick = function () {
      state.screen = "review";
      render();
    };
    el("pdfBtn").onclick = function () {
      state.screen = "report";
      render();
    };
    el("homeBtn").onclick = function () {
      state.introStep = 1;
      fadeTo(function () { state.screen = "intro"; render(); });
    };
    if (el("resendBtn")) el("resendBtn").onclick = function () {
      resendAll();
      showAlert("📨 모든 답변과 결과를 다시 전송했습니다.\n잠시 후 구글시트를 확인해 보세요.");
    };
    el("restartBtn").onclick = function () {
      showConfirm("모든 기록을 지우고 처음부터 다시 시작할까요?", function () {
        clearSaved();
        state = newState();
        render();
      }, "다시 시작", "취소");
    };
  }

  /* ---------- 6. 내 기록 보기 (작성자 확인용) ---------- */
  function renderReview() {
    var result = E.evaluateGame(C, state.answers);
    var p = state.profile || {};

    var profileHtml =
      '<div class="card"><h2>👤 ' + state.avatar + ' ' + esc(state.nickname) + '</h2>' +
      '<p class="desc">' +
      '🏫 ' + (p.school ? esc(p.school.s) + (p.school.dept ? " · " + esc(p.school.dept) : "") : "학교 정보 없음") + '\n' +
      '🎯 희망 직무: ' + (p.jobsUnknown ? "미정 (상담에서 함께 찾기)" :
        (p.jobs && p.jobs.length ? p.jobs.map(function (j) { return esc(j.n); }).join(", ") : "미선택")) + '\n' +
      '🏢 희망 기업: ' + (p.companies && p.companies.length
        ? p.companies.map(function (co) { return esc(co.n); }).join(", ") : "미선택") + '\n' +
      '🎒 수집한 에피소드: ' + (state.episodes.length
        ? state.episodes.map(function (e) { return esc(e.title); }).join(", ") : "없음") +
      '</p></div>';

    var roomsHtml = C.rooms.map(function (room, ri) {
      var rr = result.rooms[ri];
      var qHtml = room.questions.map(function (q) {
        var a = state.answers[q.id] || {};
        var txt = formatAnswerText(q, a);
        var epi = "";
        if (q.type === "episode" && a.episode) {
          epi = '<div class="rv-ep">' + (a.episode.mode === "reuse" ? "🎒 (재사용) " : "🆕 ") +
            '<b>' + esc(a.episode.title || "") + '</b>' +
            (a.episode.text ? "<br>" + esc(a.episode.text) : "") + '</div>';
        }
        var empty = !txt && !a.episode;
        return '<div class="rv-q">Q. ' + esc(q.text) + '</div>' +
          '<div class="rv-a">' + (empty ? '<span class="rv-none">무응답</span>' : esc(txt)) + epi + '</div>';
      }).join("");
      return '<div class="card"><h2>' + room.badge.icon + ' ' + (ri + 1) + '번 방 · ' + esc(room.title) +
        ' <span class="rv-score">' + rr.percent + '점' + (rr.badge ? " 🏅" : "") + '</span></h2>' +
        qHtml + '</div>';
    }).join("");

    app.innerHTML =
      '<div class="screen">' +
      '<div class="hud"><button class="backlink" id="backFinal">← 결과로</button>' +
      '<span class="who">📖 나의 기록</span><span></span></div>' +
      profileHtml + roomsHtml +
      '<button class="btn" id="backFinal2">결과 화면으로 돌아가기</button>' +
      '</div>';

    el("backFinal").onclick = el("backFinal2").onclick = function () {
      state.screen = "final";
      render();
    };
  }

  /* ---------- 7. PDF 리포트 (인쇄 최적화 문서) ---------- */
  function renderReportDoc() {
    var result = E.evaluateGame(C, state.answers);
    var p = state.profile || {};
    var today = new Date();
    var dateStr = today.getFullYear() + "." + (today.getMonth() + 1) + "." + today.getDate();

    // 프로필
    var profileRows =
      '<table class="p-card">' +
      '<tr><td class="k">이름</td><td>' + esc(state.nickname) + '</td>' +
      '<td class="k">작성일</td><td>' + dateStr + '</td></tr>' +
      '<tr><td class="k">학교·학과</td><td>' + (p.school ? esc(p.school.s) + (p.school.dept ? " · " + esc(p.school.dept) : "") : "-") + '</td>' +
      '<td class="k">배지</td><td>🏅 ' + result.badgeCount + ' / ' + result.totalRooms +
      ' (총점 ' + result.totalEarned + '/' + result.totalMax + ')</td></tr>' +
      '<tr><td class="k">희망 직무</td><td colspan="3">' + (p.jobsUnknown ? "미정 (상담에서 함께 찾기)" :
        (p.jobs && p.jobs.length ? p.jobs.map(function (j) { return esc(j.n); }).join(", ") : "-")) + '</td></tr>' +
      '</table>';

    // 기업분석 자료
    var compHtml = "";
    if (p.companies && p.companies.length) {
      compHtml = '<h2>🏢 희망 기업 분석 (금융감독원 공시 기준)</h2>' +
        p.companies.map(function (co) {
          if (!co.card) {
            return '<table class="p-card"><tr><td class="k">회사</td><td>' + esc(co.n) +
              (co.custom ? " (직접 입력 — 공시 정보 없음)" : " (공시 정보 미확인)") + '</td></tr></table>';
          }
          var c = co.card;
          var g = growthPct(c);
          var opMargin = (c.op != null && c.revenue) ? Math.round(c.op / c.revenue * 1000) / 10 : null;
          return '<table class="p-card">' +
            '<tr><td class="k">회사</td><td><b>' + esc(co.n) + '</b> (' + c.year + '년 사업보고서)</td>' +
            '<td class="k">매출액</td><td>' + (c.revenue != null ? fmtEok(c.revenue) + "원" : "-") +
            (g != null ? " (전년비 " + (g >= 0 ? "+" : "") + g + "%)" : "") + '</td></tr>' +
            '<tr><td class="k">영업이익</td><td>' + (c.op != null ? fmtEok(c.op) + "원" +
              (opMargin != null ? " (이익률 " + opMargin + "%)" : "") : "-") + '</td>' +
            '<td class="k">직원 수</td><td>' + (c.employees ? c.employees.toLocaleString() + "명" : "-") + '</td></tr>' +
            '<tr><td class="k">평균 근속</td><td>' + (c.tenure ? c.tenure + "년" : "-") + '</td>' +
            '<td class="k">1인 평균 급여</td><td>' + (c.salary ? Math.round(c.salary / 10000).toLocaleString() + "만원" : "-") + '</td></tr>' +
            '</table>';
        }).join("");
      var pickedQ = state.answers["r7q5"];
      if (pickedQ && pickedQ.entries && pickedQ.entries.length) {
        compHtml += '<p class="p-q">내가 면접에서 물어보고 싶은 질문</p>' +
          '<div class="p-a">' + pickedQ.entries.map(esc).join("<br>") + '</div>';
      }
    }

    // 에피소드 모음
    var epHtml = state.episodes.length
      ? '<h2>🎒 수집한 에피소드</h2>' + state.episodes.map(function (e) {
          return '<p class="p-q">「' + esc(e.title) + '」</p><div class="p-a">' + esc(e.text) + '</div>';
        }).join("")
      : "";

    // 방별 기록
    var roomsHtml = C.rooms.map(function (room, ri) {
      var rr = result.rooms[ri];
      var qHtml = room.questions.map(function (q) {
        var a = state.answers[q.id] || {};
        var full = buildFullAnswer(q, a);
        return '<p class="p-q">Q. ' + esc(q.text) + '</p>' +
          '<div class="p-a">' + (full === "(무응답)" ? '<span class="p-none">(무응답)</span>' : esc(full)) + '</div>';
      }).join("");
      return '<h2>' + room.badge.icon + ' ' + (ri + 1) + '번 방 · ' + esc(room.title) +
        ' — ' + rr.percent + '점' + (rr.badge ? " 🏅" : "") + '</h2>' + qHtml;
    }).join("");

    return '<div class="paper">' +
      '<h1>🗝️ ' + esc(C.meta.title) + ' — 나의 취업 준비 리포트</h1>' +
      '<p class="p-meta">사전 상담 게임 기록 · ' + esc(C.meta.subtitle) + '</p>' +
      profileRows + compHtml + roomsHtml + epHtml +
      '<p class="p-meta" style="margin-top:16px">본 리포트는 「' + esc(C.meta.title) +
      '」 게임 기록으로 자동 생성되었습니다. 기업 수치 출처: 금융감독원 전자공시(DART). ' + dateStr + '</p>' +
      '</div>';
  }

  function renderReport() {
    app.innerHTML =
      '<div class="screen">' +
      '<div class="hud no-print"><button class="backlink" id="backFinal">← 결과로</button>' +
      '<span class="who">📄 리포트</span><span></span></div>' +
      '<div class="card no-print"><p class="desc">아래 버튼을 누르고 인쇄 화면에서 ' +
      '<b>"대상(프린터)"을 "PDF로 저장"</b>으로 선택하면 파일로 저장됩니다.\n(휴대폰: 공유 → 인쇄 → PDF 저장)</p>' +
      '<button class="btn" id="printBtn">🖨️ 인쇄 / PDF로 저장</button></div>' +
      renderReportDoc() +
      '<button class="btn ghost no-print" id="backFinal2">← 결과 화면으로</button>' +
      '</div>';
    el("printBtn").onclick = function () { window.print(); };
    el("backFinal").onclick = el("backFinal2").onclick = function () {
      state.screen = "final";
      render();
    };
  }

  /* ---------- 시작: 자동 이어하기 ----------
     진행 기록이 있으면 자동으로 이어서 시작합니다. */
  var saved = loadState();
  if (saved) {
    state = saved;
    state.skipped = state.skipped || {};
    state.profile = state.profile || { school: null, jobs: [], jobsUnknown: false, companies: [] };
    state.profile.companies = state.profile.companies || [];
    if (state.finished) state.screen = "final";
    else if (state.screen !== "intro" && state.screen !== "room") state.screen = "hallway";
    // "room" 화면이었다면 그 방에서 그대로 재개 (답변 보존됨)
    if (state.screen === "room" && state.clearedRooms[C.rooms[state.roomIndex].id]) state.screen = "hallway";
  } else {
    state = newState();
  }
  // 인터넷이 다시 연결되면 밀린 전송 자동 재시도
  window.addEventListener("online", function () { retryPending(); });
  render();
})();
