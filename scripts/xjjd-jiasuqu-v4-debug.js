// ==UserScript==
// @name         神行百速 Debug
// @namespace    http://tampermonkey.net/
// @version      4.0-debug
// @description  对XJJD的计时路径做调试统计，不参与加速
// @author       cbbsxx
// @match        https://www.wanyiwan.top/*
// @grant        none
// @run-at       document-start
// @license      MIT
// @updateURL    https://gitee.com/cbbsxx/tampermonkey/raw/master/scripts/xjjd-jiasuqu-v4-debug.js
// @downloadURL  https://gitee.com/cbbsxx/tampermonkey/raw/master/scripts/xjjd-jiasuqu-v4-debug.js
// ==/UserScript==

// 仅在 iframe 内运行
if (window.self === window.top) return;

!function () {
    var rawSetInterval = setInterval.bind(window);
    var rawClearInterval = clearInterval.bind(window);
    var rawSetTimeout = setTimeout.bind(window);
    var raf = window.requestAnimationFrame && window.requestAnimationFrame.bind(window);

    var nativeWin = null;
    var panel = null;
    var content = null;
    var collapsed = false;

    var baseReal = 0;
    var baseDate = 0;
    var basePerf = 0;
    var baseLayaTimer = null;
    var baseLayaFrame = null;

    var fpsFrames = 0;
    var fpsLastTs = 0;
    var fps = 0;

    function createNativeClock() {
        try {
            var iframe = document.createElement("iframe");
            iframe.style.cssText = "display:none!important;width:0;height:0;border:0;position:absolute;left:-9999px;top:-9999px;";
            document.documentElement.appendChild(iframe);
            nativeWin = iframe.contentWindow;
        } catch (_) {
            nativeWin = null;
        }
    }

    function realNow() {
        try {
            if (nativeWin && nativeWin.Date) return nativeWin.Date.now();
        } catch (_) {}
        return Date.now();
    }

    function perfNow() {
        try {
            return window.performance && window.performance.now ? window.performance.now() : 0;
        } catch (_) {
            return 0;
        }
    }

    function getLayaTimer() {
        return window.Laya && window.Laya.timer;
    }

    function getNumber(obj, key) {
        try {
            var value = obj && obj[key];
            return typeof value === "number" && isFinite(value) ? value : null;
        } catch (_) {
            return null;
        }
    }

    function formatMs(value) {
        return value == null ? "-" : Math.round(value) + "ms";
    }

    function formatRate(value) {
        return value == null || !isFinite(value) ? "-" : value.toFixed(2) + "x";
    }

    function formatNum(value) {
        return value == null ? "-" : String(Math.round(value));
    }

    function initBaselines() {
        baseReal = realNow();
        baseDate = Date.now();
        basePerf = perfNow();
    }

    function rafLoop(ts) {
        fpsFrames++;
        if (!fpsLastTs) fpsLastTs = ts;
        if (ts - fpsLastTs >= 1000) {
            fps = fpsFrames * 1000 / (ts - fpsLastTs);
            fpsFrames = 0;
            fpsLastTs = ts;
        }
        raf && raf(rafLoop);
    }

    function line(name, value, hint) {
        return "<div style='display:flex;justify-content:space-between;gap:12px;margin:3px 0;'>" +
            "<span style='color:#9ca3af;'>" + name + "</span>" +
            "<span title='" + (hint || "") + "' style='font-family:Menlo,Consolas,monospace;color:#e5e7eb;text-align:right;'>" + value + "</span>" +
            "</div>";
    }

    function updatePanel() {
        if (!content) return;

        var nowReal = realNow();
        var realElapsed = Math.max(1, nowReal - baseReal);
        var dateElapsed = Date.now() - baseDate;
        var perfElapsed = perfNow() - basePerf;

        var timer = getLayaTimer();
        var layaTimer = getNumber(timer, "currTimer");
        var layaFrame = getNumber(timer, "currFrame");
        var layaScale = getNumber(timer, "scale");
        var layaDelta = getNumber(timer, "delta");

        if (timer && baseLayaTimer == null && layaTimer != null) baseLayaTimer = layaTimer;
        if (timer && baseLayaFrame == null && layaFrame != null) baseLayaFrame = layaFrame;

        var layaTimerElapsed = layaTimer == null || baseLayaTimer == null ? null : layaTimer - baseLayaTimer;
        var layaFrameElapsed = layaFrame == null || baseLayaFrame == null ? null : layaFrame - baseLayaFrame;
        var layaFramePerSec = layaFrameElapsed == null ? null : layaFrameElapsed * 1000 / realElapsed;

        var html = "";
        html += line("真实耗时", formatMs(realElapsed), "隐藏 iframe 的原生 Date.now，尽量避开其他脚本劫持");
        html += line("页面 Date", formatMs(dateElapsed) + " / " + formatRate(dateElapsed / realElapsed), "当前页面 Date.now 的推进速度");
        html += line("performance", formatMs(perfElapsed) + " / " + formatRate(perfElapsed / realElapsed), "当前页面 performance.now 的推进速度");
        html += line("rAF FPS", fps ? fps.toFixed(1) : "-", "requestAnimationFrame 实际回调频率");
        html += "<div style='height:1px;background:rgba(255,255,255,0.16);margin:8px 0;'></div>";
        html += line("Laya 可用", timer ? "yes" : "no");
        html += line("Laya scale", layaScale == null ? "-" : layaScale.toFixed(2));
        html += line("Laya currTimer", formatMs(layaTimerElapsed) + " / " + formatRate(layaTimerElapsed == null ? null : layaTimerElapsed / realElapsed));
        html += line("Laya currFrame", formatNum(layaFrameElapsed) + " / " + formatRate(layaFramePerSec == null ? null : layaFramePerSec));
        html += line("Laya delta", layaDelta == null ? "-" : layaDelta.toFixed(2) + "ms");

        content.innerHTML = html;
    }

    function makeDraggable(el, handle) {
        var dragging = false;
        var dx = 0;
        var dy = 0;

        handle.addEventListener("mousedown", function (ev) {
            if (ev.target && ev.target.getAttribute("data-action")) return;
            dragging = true;
            dx = ev.clientX - el.offsetLeft;
            dy = ev.clientY - el.offsetTop;
            ev.preventDefault();
        }, false);

        document.addEventListener("mousemove", function (ev) {
            if (!dragging) return;
            el.style.left = Math.max(0, ev.clientX - dx) + "px";
            el.style.top = Math.max(0, ev.clientY - dy) + "px";
            el.style.right = "auto";
        }, false);

        document.addEventListener("mouseup", function () {
            dragging = false;
        }, false);
    }

    function createPanel() {
        panel = document.createElement("div");
        panel.id = "xjjd-speed-debug-panel";
        panel.style.cssText = [
            "position:fixed",
            "right:10px",
            "top:10px",
            "z-index:999999",
            "width:300px",
            "background:rgba(17,24,39,0.92)",
            "color:#fff",
            "border:1px solid rgba(255,255,255,0.18)",
            "border-radius:10px",
            "box-shadow:0 8px 24px rgba(0,0,0,0.32)",
            "font:13px system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif",
            "overflow:hidden",
            "user-select:none"
        ].join(";");

        var header = document.createElement("div");
        header.style.cssText = "display:flex;align-items:center;justify-content:space-between;padding:8px 10px;background:rgba(255,255,255,0.08);cursor:move;font-weight:700;";
        header.innerHTML = "<span>Speed Debug</span><button data-action='toggle' style='border:0;border-radius:5px;background:#374151;color:#fff;padding:3px 8px;'>hide</button>";

        content = document.createElement("div");
        content.style.cssText = "padding:9px 10px;";

        panel.appendChild(header);
        panel.appendChild(content);
        document.body.appendChild(panel);

        header.querySelector("button").onclick = function () {
            collapsed = !collapsed;
            content.style.display = collapsed ? "none" : "block";
            this.textContent = collapsed ? "show" : "hide";
        };

        makeDraggable(panel, header);
    }

    function init() {
        createNativeClock();
        initBaselines();
        createPanel();
        raf && raf(rafLoop);
        rawSetInterval(updatePanel, 500);
        updatePanel();
    }

    var bodyTimer = rawSetInterval(function () {
        if (!document.body) return;
        rawClearInterval(bodyTimer);
        init();
    }, 20);

    rawSetTimeout(function () {
        if (document.body && !panel) {
            rawClearInterval(bodyTimer);
            init();
        }
    }, 1000);
}();
