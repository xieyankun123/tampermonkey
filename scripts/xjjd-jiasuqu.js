// ==UserScript==
// @name         神行百速
// @namespace    http://tampermonkey.net/
// @version      1.04
// @description  对XJJD提供变速功能
// @author       ->无语ccky
// @match        https://www.wanyiwan.top/*
// @grant        none
// @license      MIT
// @updateURL    https://gitee.com/cbbsxx/tampermonkey/raw/master/scripts/xjjd-jiasuqu.js
// @downloadURL  https://gitee.com/cbbsxx/tampermonkey/raw/master/scripts/xjjd-jiasuqu.js
// ==/UserScript==

// 仅在 iframe 内运行，顶层页面不展示变速控件
if (window.self === window.top) return;

(function () {
  "use strict";

  // ========== 时间变速核心（劫持 setTimeout/setInterval/Date） ==========
  const timeControl = (function (nativeSetTimeout, nativeClearTimeout, nativeSetInterval, nativeClearInterval, NativeDate, win) {
    const hasAddEventListener = !!win.addEventListener;
    let lastRealTime = 0;
    let virtualTime = 0;
    let rate = 1;
    const queue = {};
    let queueId = 1;
    let tickFlag = 0;

    function runTask(task) {
      const code = task.code;
      if (typeof code === "function") {
        task.arg ? code.apply(win, task.arg) : code();
      } else {
        win.eval(code);
      }
    }

    function tick() {
      const realNow = +new NativeDate();
      const delta = (realNow - lastRealTime) * rate;
      lastRealTime = realNow;
      virtualTime += delta;
      tickFlag++;

      for (const id in queue) {
        const task = queue[id];
        if (task.flag !== tickFlag) continue;
        task.sum += delta;
        if (task.repeat) {
          let runs = (task.sum / task.delay) | 0;
          if (runs > 32) runs = 32;
          while (--runs >= 0) runTask(task);
          task.sum %= task.delay;
        } else if (task.sum >= task.delay) {
          runTask(task);
          delete queue[id];
        }
      }
    }

    function addTask(code, delay, arg, repeat) {
      if (!code) return 0;
      delay = +delay || 0;
      if (delay < 1) delay = 1;
      const id = queueId++;
      queue[id] = { code, delay, arg, repeat, sum: 0, flag: tickFlag };
      return id;
    }

    function wrappedSetTimeout(fn, delay, ...arg) {
      return addTask(fn, delay, arg, false);
    }
    function wrappedClearTimeout(id) {
      if (id >= 0) delete queue[id];
    }
    function wrappedSetInterval(fn, delay, ...arg) {
      return addTask(fn, delay, arg, true);
    }
    function wrappedClearInterval(id) {
      if (id >= 0) delete queue[id];
    }
    function wrappedRequestAnimationFrame(cb) {
      return addTask(cb, 16, null, false);
    }

    // 伪造 Date，使 new Date() 等返回“虚拟时间”
    function FakeDate(a, b, c, d, e, f, g) {
      if (!(this instanceof FakeDate)) {
        return hasAddEventListener ? new FakeDate().toString() : new FakeDate().toString().replace(/UTC.+ /, "");
      }
      const n = arguments.length;
      if (n === 0) {
        const realNow = +new NativeDate();
        virtualTime += (realNow - lastRealTime) * rate;
        lastRealTime = realNow;
        return new NativeDate(virtualTime);
      }
      return new NativeDate(a, b, c, d, e, f, g);
    }
    FakeDate.UTC = NativeDate.UTC;
    FakeDate.parse = NativeDate.parse;
    FakeDate.prototype = NativeDate.prototype;
    if (NativeDate.now) {
      FakeDate.now = function () {
        const realNow = NativeDate.now();
        virtualTime += (realNow - lastRealTime) * rate;
        lastRealTime = realNow;
        return Math.round(virtualTime);
      };
    }

    const rafNames = ["requestAnimationFrame", "webkitRequestAnimationFrame", "mozRequestAnimationFrame", "msRequestAnimationFrame", "oRequestAnimationFrame"];
    const cancelNames = ["cancelAnimationFrame", "webkitCancelAnimationFrame", "mozCancelAnimationFrame", "msCancelAnimationFrame", "oCancelAnimationFrame"];
    rafNames.forEach((name, i) => {
      if (win[name]) {
        win[name] = wrappedRequestAnimationFrame;
        const cancelName = cancelNames[i];
        if (win[cancelName]) win[cancelName] = wrappedClearTimeout;
      }
    });

    // 安装：替换全局定时器与 Date，并启动 tick 循环
    win.setTimeout = wrappedSetTimeout;
    win.clearTimeout = wrappedClearTimeout;
    win.setInterval = wrappedSetInterval;
    win.clearInterval = wrappedClearInterval;
    win.Date = FakeDate;
    lastRealTime = virtualTime = +new NativeDate();
    nativeSetInterval(tick, 1);

    return {
      setRate: (r) => { rate = r; },
      rawSetTimeout: (...args) => nativeSetTimeout.apply(win, args),
      rawClearTimeout: (...args) => nativeClearTimeout.apply(win, args),
      rawSetInterval: (...args) => nativeSetInterval.apply(win, args),
      rawClearInterval: (...args) => nativeClearInterval.apply(win, args),
    };
  })(setTimeout, clearTimeout, setInterval, clearInterval, Date, this);

  const rawSetInterval = timeControl.rawSetInterval;
  const rawClearInterval = timeControl.rawClearInterval;
  const setRate = timeControl.setRate;

  // ========== UI：变速手柄与刻度条 ==========
  const doc = document;
  const docEl = doc.documentElement;
  const isIE7 = /IE 7/.test(navigator.userAgent);
  const useAddEventListener = !!window.addEventListener;
  const on = useAddEventListener
    ? (el, ev, fn) => el.addEventListener(ev, fn, false)
    : (el, ev, fn) => el.attachEvent("on" + ev, fn);
  const off = useAddEventListener
    ? (el, ev, fn) => el.removeEventListener(ev, fn, false)
    : (el, ev, fn) => el.detachEvent("on" + ev, fn);

  const assignStyle = (from, to) => { for (const k in from) to[k] = from[k]; };

  let maxX = 0;       // 手柄可移动范围宽
  let maxY = 0;       // 手柄可移动范围高
  let sliderRatio = 0; // 0~1，对应 1x~8x
  let handleLeft = 0;
  let handleTop = 0;
  const drag = { on: false, startX: 0, startY: 0 };
  let fadeOpacity = 0.7;
  const scaleSegmentStyles = [];
  let fadeTimerId = -1;
  let updateTimerId = -1;
  const isQuirks = doc.compatMode === "BackCompat";

  const HANDLE_SIZE = 52;
  const MIN_RATE = 1;
  const MAX_RATE = 8;

  const styleHandle = {
    zIndex: 9999,
    position: "fixed",
    overflow: "hidden",
    width: HANDLE_SIZE + "px",
    height: HANDLE_SIZE + "px",
    borderRadius: "14px",
    boxShadow: "0 4px 14px rgba(0,0,0,0.22)",
    background: isIE7 ? "http://www.etherdream.com/JSGear/gear.png" : "linear-gradient(180deg,#ffd43b 0%,#fab005 50%,#e67700 100%)",
    font: "600 32px system-ui,-apple-system,sans-serif",
    lineHeight: HANDLE_SIZE + "px",
    textAlign: "center",
    color: "#1a1a1a",
    cursor: "move",
    MozUserSelect: "none",
    WebkitUserSelect: "none",
    touchAction: "none",
  };

  const styleScaleBar = {
    display: "none",
    zIndex: 9998,
    position: "fixed",
    overflow: "hidden",
    left: 0,
    height: "50px",
    borderRadius: "10px",
    boxShadow: "0 4px 20px rgba(0,0,0,0.18)",
    background: "linear-gradient(180deg,#4c5c6e 0%,#3d4b5a 100%)",
    border: "1px solid rgba(255,255,255,0.1)",
    font: "600 26px system-ui,-apple-system,sans-serif",
    lineHeight: "50px",
    color: "#e9ecef",
    textAlign: "center",
    cursor: "move",
  };

  const styleBigNumber = {
    display: "none",
    zIndex: 9997,
    position: "fixed",
    left: 0,
    top: 0,
    font: "bold 100px system-ui,-apple-system,sans-serif",
    color: "#e67700",
    textAlign: "center",
    cursor: "move",
    opacity: "0.92",
    textShadow: "0 2px 24px rgba(230,119,0,0.4)",
  };

  const styleSegment = {
    position: "absolute",
    top: "2px",
    height: "46px",
    borderRadius: "6px",
    boxSizing: "border-box",
  };

  function layout() {
    const w = isQuirks ? doc.body.clientWidth : docEl.clientWidth;
    const h = isQuirks ? doc.body.clientHeight : docEl.clientHeight;
    maxY = h - HANDLE_SIZE;
    maxX = w - HANDLE_SIZE;
    setHandlePos(maxX * sliderRatio, handleTop);
    const segCount = scaleSegmentStyles.length;
    if (segCount) {
      const segW = w / segCount;
      scaleSegmentStyles.forEach((seg, i) => {
        seg.width = segW + "px";
        seg.left = i * segW + "px";
      });
    }
    scaleBarEl.style.width = w + "px";
    numberEl.style.width = w + "px";
    numberEl.style.height = numberEl.style.lineHeight = h + "px";
  }

  function setHandlePos(x, y) {
    if (x < 0) x = 0;
    if (x > maxX) x = maxX;
    if (y < 0) y = 0;
    if (y > maxY) y = maxY;
    scaleBarEl.style.top = handleEl.style.top = y + "px";
    handleEl.style.left = x + "px";
    sliderRatio = maxX ? x / maxX : 0;
    handleLeft = x;
    handleTop = y;
    if (isQuirks) updateScrollPos();
  }

  function updateScrollPos() {
    const sx = docEl.scrollLeft;
    const sy = docEl.scrollTop;
    handleEl.style.left = handleLeft + sx + "px";
    handleEl.style.top = handleTop + sy + "px";
    scaleBarEl.style.top = handleTop + sy + "px";
    numberEl.style.left = sx + "px";
    numberEl.style.top = sy + "px";
  }

  function updateRateDisplay() {
    let rate = MIN_RATE + (MAX_RATE - MIN_RATE) * sliderRatio;
    rate = Math.max(MIN_RATE, Math.min(MAX_RATE, rate));
    setRate(rate);
    const text = rate % 1 === 0 ? String(rate) : rate.toFixed(1);
    if (numberEl.innerHTML !== text) {
      numberEl.innerHTML = text;
      handleEl.innerHTML = text;
    }
  }

  function resetTo1x() {
    setHandlePos(0, handleTop);
    updateRateDisplay();
  }

  function startDrag(clientX, clientY) {
    if (drag.on) return;
    drag.on = true;
    drag.startX = clientX - handleLeft;
    drag.startY = clientY - handleTop;
    on(doc, "mousemove", onMouseMove);
    on(doc, "touchmove", onTouchMove);
    scaleBarEl.style.display = "block";
    numberEl.style.display = "block";
    fadeOpacity = 0.7;
    if (fadeTimerId >= 0) rawClearInterval(fadeTimerId);
    if (updateTimerId >= 0) rawClearInterval(updateTimerId);
    updateTimerId = rawSetInterval(updateRateDisplay, 100);
  }

  function endDrag() {
    if (!drag.on) return;
    drag.on = false;
    off(doc, "mousemove", onMouseMove);
    off(doc, "touchmove", onTouchMove);
    fadeTimerId = rawSetInterval(fadeOut, 16);
    rawClearInterval(updateTimerId);
    updateTimerId = -1;
    numberEl.style.display = "none";
  }

  function onMouseMove(e) {
    e = e || window.event;
    if (drag.on) setHandlePos(e.clientX - drag.startX, e.clientY - drag.startY);
  }

  function onTouchMove(e) {
    e = e || window.event;
    if (drag.on && e.touches[0]) {
      const t = e.touches[0];
      setHandlePos(t.clientX - drag.startX, t.clientY - drag.startY);
      e.preventDefault();
    }
  }

  function onMouseDown(e) {
    e = e || window.event;
    startDrag(e.clientX, e.clientY);
    if (e.preventDefault) e.preventDefault(); else e.returnValue = false;
  }

  function onTouchStart(e) {
    e = e || window.event;
    if (drag.on) return;
    const t = e.touches[0];
    if (t) {
      startDrag(t.clientX, t.clientY);
      e.preventDefault();
    }
  }

  function fadeOut() {
    fadeOpacity -= 0.08;
    if (fadeOpacity <= 0) {
      rawClearInterval(fadeTimerId);
      fadeTimerId = -1;
      scaleBarEl.style.display = "none";
    } else {
      scaleBarEl.style.opacity = useAddEventListener ? String(fadeOpacity) : String(Math.round(fadeOpacity * 100) / 100);
      if (!useAddEventListener) scaleBarEl.style.filter = "alpha(opacity=" + Math.round(fadeOpacity * 100) + ")";
    }
  }

  function preventDefault(e) {
    if (e.preventDefault) e.preventDefault(); else e.returnValue = false;
  }

  function onKeyDown(e) {
    if ((e.key === "r" || e.key === "R") && (!e.target || !/^(INPUT|TEXTAREA|SELECT)$/i.test(e.target.tagName))) {
      e.preventDefault();
      resetTo1x();
    }
  }

  let handleEl, scaleBarEl, numberEl;

  const waitBody = rawSetInterval(function () {
    if (!doc.body) return;
    rawClearInterval(waitBody);

    handleEl = doc.createElement("div");
    scaleBarEl = doc.createElement("div");
    numberEl = doc.createElement("div");
    assignStyle(styleHandle, handleEl.style);
    assignStyle(styleScaleBar, scaleBarEl.style);
    assignStyle(styleBigNumber, numberEl.style);

    doc.body.appendChild(scaleBarEl);
    doc.body.appendChild(handleEl);
    doc.body.appendChild(numberEl);

    handleEl.title = "1-8倍速 拖动调节 双击恢复1x";

    for (let i = 1; i <= 8; i++) {
      const seg = doc.createElement("div");
      seg.innerHTML = i;
      assignStyle(styleSegment, seg.style);
      seg.style.background = i % 2 ? "rgba(250,176,5,0.45)" : "rgba(230,119,0,0.25)";
      scaleBarEl.appendChild(seg);
      scaleSegmentStyles.push(seg.style);
    }

    if (isQuirks) {
      handleEl.style.position = scaleBarEl.style.position = numberEl.style.position = "absolute";
      on(window, "scroll", updateScrollPos);
    }

    on(window, "resize", layout);
    on(doc, "mouseup", endDrag);
    on(doc, "touchend", endDrag);
    on(window, "mouseup", endDrag);
    on(window, "touchend", endDrag);
    on(window, "blur", endDrag);
    on(handleEl, "mousedown", onMouseDown);
    on(handleEl, "touchstart", onTouchStart);
    on(handleEl, "dblclick", resetTo1x);
    on(handleEl, "selectstart", preventDefault);
    on(handleEl, "contextmenu", preventDefault);
    on(doc, "keydown", onKeyDown);

    layout();
    resetTo1x();
  }, 20);
})();
