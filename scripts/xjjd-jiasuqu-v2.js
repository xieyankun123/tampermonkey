// ==UserScript==
// @name         神行百速
// @namespace    http://tampermonkey.net/
// @version      2.3
// @description  对XJJD提供变速功能
// @author       ->无语ccky
// @match        https://www.wanyiwan.top/*
// @grant        none
// @run-at       document-start
// @license      MIT
// @updateURL    https://gitee.com/cbbsxx/tampermonkey/raw/master/scripts/xjjd-jiasuqu-v2.js
// @downloadURL  https://gitee.com/cbbsxx/tampermonkey/raw/master/scripts/xjjd-jiasuqu-v2.js
// ==/UserScript==

// 仅在 iframe 内运行，顶层页面不展示变速控件
if (window.self === window.top) return;

!function () {

    // ── 时间加速引擎（简化版）──
    // 策略：只劫持 performance.now() 和 Date，让 Laya 每帧感知到更大的 delta time。
    // 不动 rAF / setTimeout / setInterval，主循环保持原生 60fps，手机 CPU 零额外压力。
    // 必须配合 @run-at document-start，确保 Laya 初始化时拿到的就是已劫持的版本。
    var e = (function (origDate, origPerf, win) {
        var f        = 1;  // 当前倍速
        var realBase = 0;  // 上次切速时的真实时间戳
        var virtBase = 0;  // 上次切速时积累的虚拟时间

        function realNow() {
            return origPerf ? origPerf() : +new origDate();
        }

        // 当前虚拟时间 = 上次切速时的虚拟时间 + 距今真实时间 × 倍速
        function virtualNow() {
            return virtBase + (realNow() - realBase) * f;
        }

        function setRate(rate) {
            // 切速前先把虚拟时钟推到当前，避免速度切换时时间跳变
            var rn = realNow();
            virtBase += (rn - realBase) * f;
            realBase  = rn;
            f = rate;
            // 同步 Laya 内部 timer scale（兼容部分不走 performance.now 的 Laya 版本）
            try {
                if (typeof Laya !== 'undefined') {
                    if (Laya.timer)       Laya.timer.scale       = rate;
                    if (Laya.systemTimer) Laya.systemTimer.scale = rate;
                }
            } catch (_) {}
        }

        // 初始化锚点
        realBase = virtBase = realNow();

        // 劫持 performance.now()（Laya 主循环用它计算每帧 delta time）
        if (origPerf) {
            win.performance.now = function () { return virtualNow(); };
        }

        // 劫持 Date（兜底：防止游戏里有直接用 Date.now() 计时的地方）
        function VDate(y, mo, d, h, mi, s, ms) {
            if (!(this instanceof VDate)) return new origDate(virtualNow()).toString();
            switch (arguments.length) {
                case 0:  return new origDate(virtualNow());
                case 1:  return new origDate(y);
                case 2:  return new origDate(y, mo);
                case 3:  return new origDate(y, mo, d);
                case 4:  return new origDate(y, mo, d, h);
                case 5:  return new origDate(y, mo, d, h, mi);
                case 6:  return new origDate(y, mo, d, h, mi, s);
                default: return new origDate(y, mo, d, h, mi, s, ms);
            }
        }
        origDate.now  && (VDate.now  = function () { return Math.round(virtualNow()); });
        VDate.UTC     = origDate.UTC;
        VDate.parse   = origDate.parse;
        VDate.prototype = origDate.prototype;
        win.Date = VDate;

        return {
            setRate:          setRate,
            rawSetTimeout:    setTimeout,
            rawClearTimeout:  clearTimeout,
            rawSetInterval:   setInterval,
            rawClearInterval: clearInterval
        };
    }(Date, window.performance && window.performance.now.bind(window.performance), window));


    // ── UI 部分：拖动齿轮控件 ──
    !function () {
        var n,
            t  = "BackCompat" == document.compatMode,
            o  = /IE 6/.test(navigator.userAgent),
            r  = /IE 7/.test(navigator.userAgent),
            a  = !!window.addEventListener,
            i  = document.documentElement,
            c  = a
                ? function (e, n, t) { e.addEventListener(n, t, false); }
                : function (e, n, t) { e.attachEvent("on" + n, t); },
            l  = a
                ? function (e, n, t) { e.removeEventListener(n, t, false); }
                : function (e, n, t) { e.detachEvent("on" + n, t); };

        function u(e, n) {
            for (var t in e) n[t] = e[t];
        }

        var f, s, d, p, m, v, g, w, A, h,
            k  = 0,
            T  = {},
            x  = 0,
            L  = 0,
            M  = 0.7,
            F  = [],
            I  = -1,
            b  = -1,
            sz = 80,
            y  = "http://www.etherdream.com/JSGear/gear.png";

        // 齿轮按钮样式
        var P = {
            zIndex:          9999,
            position:        "fixed",
            overflow:        "hidden",
            width:           "83px",
            height:          "83px",
            borderRadius:    "22px",
            boxShadow:       "0 4px 14px rgba(0,0,0,0.22)",
            background:      r ? y : "linear-gradient(180deg,#ff6b6b 0%,#ee5a5a 50%,#c92a2a 100%)",
            font:            "600 48px system-ui,-apple-system,sans-serif",
            lineHeight:      "83px",
            textAlign:       "center",
            color:           "#fff",
            cursor:          "move",
            MozUserSelect:   "none",
            WebkitUserSelect:"none",
            touchAction:     "none"
        };

        // 倍速条样式
        var U = {
            display:      "none",
            zIndex:       9998,
            position:     "fixed",
            overflow:     "hidden",
            left:         0,
            height:       "50px",
            borderRadius: "10px",
            boxShadow:    "0 4px 20px rgba(0,0,0,0.18)",
            background:   "linear-gradient(180deg,#4c5c6e 0%,#3d4b5a 100%)",
            border:       "1px solid rgba(255,255,255,0.1)",
            font:         "600 26px system-ui,-apple-system,sans-serif",
            lineHeight:   "50px",
            color:        "#e9ecef",
            textAlign:    "center",
            cursor:       "move"
        };

        // 全屏倍速数字显示样式
        var E = {
            display:    "none",
            zIndex:     9997,
            position:   "fixed",
            left:       0,
            top:        0,
            font:       "bold 100px system-ui,-apple-system,sans-serif",
            color:      "#4c6ef5",
            textAlign:  "center",
            cursor:     "move",
            opacity:    "0.92",
            textShadow: "0 2px 24px rgba(76,110,245,0.45)"
        };

        // 倍速刻度格子样式
        var C = {
            position:    "absolute",
            top:         "2px",
            height:      "46px",
            borderRadius:"6px",
            boxSizing:   "border-box"
        };

        // 根据窗口大小重新布局
        function X() {
            var e = t ? n.clientWidth : i.clientWidth,
                o = t ? n.clientHeight : i.clientHeight;
            sz = Math.min(e, o) * 0.12;
            p.width = p.height = sz + "px";
            p.borderRadius = Math.round(sz * 0.265) + "px";
            p.lineHeight = sz + "px";
            p.fontSize = Math.round(sz * 0.58) + "px";
            s = o - sz;
            Q((f = e - sz) * k, L);
            var r, a = F.length, c = e / a;
            for (v.width = e + "px", c = ~~(1e6 * c) / 1e6, r = 0; r < a; ++r) {
                F[r].width = c + "px";
                F[r].left = c * r + "px";
            }
            w.width = e + "px";
            w.height = w.lineHeight = o + "px";
        }

        // IE 滚动时同步控件位置
        function j() {
            var e = i.scrollLeft, n = i.scrollTop;
            p.left = x + e + "px";
            p.top = v.top = L + n + "px";
            w.left = e + "px";
            w.top = n + "px";
        }

        // 鼠标按下：开始拖动
        function q(n) {
            T.on || (
                T.on = true,
                n = n || event,
                T.x = n.clientX - x,
                T.y = n.clientY - L,
                c(document, "mousemove", H),
                v.display = "block",
                M = 0.7,
                G(),
                e.rawClearInterval(I),
                w.display = "block",
                b = e.rawSetInterval(D, 100),
                S(n)
            );
        }

        // 触摸开始
        function z(n) {
            if (!T.on) {
                T.on = true;
                var t = (n = n || event).touches[0];
                T.x = t.clientX - x;
                T.y = t.clientY - L;
                c(document, "touchmove", B);
                v.display = "block";
                M = 0.7;
                G();
                e.rawClearInterval(I);
                w.display = "block";
                b = e.rawSetInterval(D, 100);
                n.preventDefault();
            }
        }

        // 触摸移动
        function B(e) {
            if (T.on) {
                var n = (e = e || event).touches[0];
                Q(n.clientX - T.x, n.clientY - T.y);
                e.preventDefault();
            }
        }

        // 鼠标移动
        function H(e) {
            T.on && (Q((e = e || event).clientX - T.x, e.clientY - T.y), S(e));
        }

        // 鼠标/触摸释放：停止拖动，启动渐隐
        function R() {
            T.on && (
                T.on = false,
                l(document, "mousemove", H),
                l(document, "touchmove", B),
                I = e.rawSetInterval(K, 16),
                e.rawClearInterval(b),
                w.display = "none"
            );
        }

        // 双击：恢复 1x
        function Y() { Z(); }

        function S(e) {
            a ? e.preventDefault() : e.returnValue = false;
        }

        // 渐隐倍速条
        function K() {
            (M -= 0.08) > 0 ? G() : (v.display = "none", e.rawClearInterval(I));
        }

        // 根据拖动位置计算并设置倍速（左半段 0.1~1x，右半段 1~13x）
        function D() {
            var n,
                o = k <= 0.5 ? 0.1 + 1.8 * k : 1 + 24 * (k - 0.5);
            o = Math.max(0.1, Math.min(13, o));
            e.setRate(o);
            n = o % 1 === 0 ? o.toString() : o.toFixed(1);
            if (g.innerHTML != n) {
                g.innerHTML = n;
                d.innerHTML = n;
            }
        }

        // 设置倍速条透明度
        function G() {
            M = ~~(1e4 * M) / 1e4;
            A.opacity = a ? M : 100 * M;
        }

        // 恢复到居中（1x）位置
        function Z() {
            Q(f / 2, L);
            D();
        }

        // 更新控件位置，并同步倍速变量
        function Q(e, n) {
            e < 0 ? e = 0 : e > f && (e = f);
            n < 0 ? n = 0 : n > s && (n = s);
            v.top = p.top = n + "px";
            p.left = e + "px";
            k = e / f;
            x = e;
            L = n;
            o && j();
        }

        // 等待 body 就绪后初始化控件
        h = e.rawSetInterval(function () {
            (n = document.body) && (
                e.rawClearInterval(h),
                (function () {
                    d = document.createElement("div");   // 齿轮按钮
                    m = document.createElement("div");   // 倍速条
                    g = document.createElement("div");   // 全屏数字
                    p = d.style;
                    v = m.style;
                    w = g.style;
                    n.appendChild(m);
                    n.appendChild(d);
                    n.appendChild(g);
                    d.title = "1-8倍速 拖动调节 双击恢复1x";

                    // 添加 1-8 倍速刻度格子
                    for (var e = 1; e <= 8; ++e) {
                        var r = document.createElement("div"),
                            i = r.style;
                        r.innerHTML = e;
                        u(C, i);
                        i.background = e % 2
                            ? "rgba(76,110,245,0.4)"
                            : "rgba(76,110,245,0.2)";
                        m.appendChild(r);
                        F.push(r.style);
                    }

                    a ? A = v : (v.filter = "alpha", A = m.filters.alpha);
                    G();
                    u(P, p);
                    u(U, v);
                    u(E, w);

                    // IE 兼容处理
                    o && (
                        p.background = "",
                        p.filter = "progid:DXImageTransform.Microsoft.AlphaImageLoader(src=" + y + ")",
                        p.position = v.position = w.position = "absolute",
                        attachEvent("onscroll", j)
                    );

                    c(window, "resize", X);
                    c(document, "mouseup", R);
                    c(document, "touchend", R);
                    c(window, "mouseup", R);
                    c(window, "touchend", R);
                    c(window, "blur", R);
                    c(d, "mousedown", q);
                    c(d, "touchstart", z);
                    c(d, "dblclick", Y);
                    c(d, "selectstart", S);
                    c(d, "contextmenu", S);

                    // 按 R 键恢复 1x
                    c(document, "keydown", function (ev) {
                        if (
                            (ev.key === "r" || ev.key === "R") &&
                            (!ev.target || !/^(INPUT|TEXTAREA|SELECT)$/i.test(ev.target.tagName))
                        ) {
                            ev.preventDefault();
                            Z();
                        }
                    });

                    X();
                    Z();
                })()
            );
        }, 20);
    }();

}();
