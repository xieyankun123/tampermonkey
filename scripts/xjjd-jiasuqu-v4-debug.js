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

    var totalDrawCalls = 0;
    var totalPrimitives = 0;
    var totalTextureBinds = 0;
    var renderLastReal = 0;
    var renderLastDrawCalls = 0;
    var renderLastPrimitives = 0;
    var renderLastTextureBinds = 0;
    var renderDrawPerSec = 0;
    var renderPrimPerSec = 0;
    var renderBindPerSec = 0;

    var lagLastReal = 0;
    var lagAvg = 0;
    var lagMax = 0;

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

    function estimatePrimitives(gl, mode, count) {
        if (!gl || !count) return 0;
        switch (mode) {
            case gl.TRIANGLES: return count / 3;
            case gl.TRIANGLE_STRIP:
            case gl.TRIANGLE_FAN: return Math.max(0, count - 2);
            case gl.LINES: return count / 2;
            case gl.LINE_STRIP: return Math.max(0, count - 1);
            case gl.POINTS: return count;
            default: return 0;
        }
    }

    function hookWebGLContext(Ctor) {
        if (!Ctor || !Ctor.prototype || Ctor.prototype.__xjjdDebugHooked) return;
        Ctor.prototype.__xjjdDebugHooked = true;

        var proto = Ctor.prototype;
        var rawDrawArrays = proto.drawArrays;
        var rawDrawElements = proto.drawElements;
        var rawBindTexture = proto.bindTexture;

        if (rawDrawArrays) {
            proto.drawArrays = function (mode, first, count) {
                totalDrawCalls++;
                totalPrimitives += estimatePrimitives(this, mode, count);
                return rawDrawArrays.apply(this, arguments);
            };
        }

        if (rawDrawElements) {
            proto.drawElements = function (mode, count, type, offset) {
                totalDrawCalls++;
                totalPrimitives += estimatePrimitives(this, mode, count);
                return rawDrawElements.apply(this, arguments);
            };
        }

        if (rawBindTexture) {
            proto.bindTexture = function () {
                totalTextureBinds++;
                return rawBindTexture.apply(this, arguments);
            };
        }
    }

    function hookWebGL() {
        hookWebGLContext(window.WebGLRenderingContext);
        hookWebGLContext(window.WebGL2RenderingContext);
    }

    function sampleRenderStats(nowReal) {
        if (!renderLastReal) {
            renderLastReal = nowReal;
            renderLastDrawCalls = totalDrawCalls;
            renderLastPrimitives = totalPrimitives;
            renderLastTextureBinds = totalTextureBinds;
            return;
        }

        var elapsed = nowReal - renderLastReal;
        if (elapsed < 1000) return;

        renderDrawPerSec = (totalDrawCalls - renderLastDrawCalls) * 1000 / elapsed;
        renderPrimPerSec = (totalPrimitives - renderLastPrimitives) * 1000 / elapsed;
        renderBindPerSec = (totalTextureBinds - renderLastTextureBinds) * 1000 / elapsed;

        renderLastReal = nowReal;
        renderLastDrawCalls = totalDrawCalls;
        renderLastPrimitives = totalPrimitives;
        renderLastTextureBinds = totalTextureBinds;
    }

    function startLagProbe() {
        lagLastReal = realNow();
        rawSetInterval(function () {
            var now = realNow();
            var lag = Math.max(0, now - lagLastReal - 100);
            lagAvg = lagAvg ? lagAvg * 0.9 + lag * 0.1 : lag;
            if (lag > lagMax) lagMax = lag;
            lagLastReal = now;
        }, 100);
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
        sampleRenderStats(nowReal);

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
        html += "<div style='height:1px;background:rgba(255,255,255,0.16);margin:8px 0;'></div>";
        html += line("WebGL draws/s", renderDrawPerSec ? renderDrawPerSec.toFixed(0) : "-", "每秒 drawArrays/drawElements 次数，越高渲染压力越大");
        html += line("draws/frame", renderDrawPerSec && fps ? (renderDrawPerSec / fps).toFixed(1) : "-", "平均每帧 draw call 数");
        html += line("prims/s", renderPrimPerSec ? Math.round(renderPrimPerSec / 1000) + "k" : "-", "粗略估算的图元数量");
        html += line("bindTex/s", renderBindPerSec ? renderBindPerSec.toFixed(0) : "-", "纹理切换次数，过高可能说明批处理较差");
        html += line("loop lag", lagAvg.toFixed(1) + " / " + lagMax.toFixed(1) + "ms", "事件循环平均/最大延迟，偏高说明 JS 主线程忙");

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
        hookWebGL();
        initBaselines();
        createPanel();
        raf && raf(rafLoop);
        startLagProbe();
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
