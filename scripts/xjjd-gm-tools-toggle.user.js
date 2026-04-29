// ==UserScript==
// @name         XJJD GM按钮开关
// @namespace    http://tampermonkey.net/
// @version      1.2
// @description  显示/隐藏战斗场景中内置的 GM 按钮
// @author       xyk
// @match        https://www.wanyiwan.top/*
// @grant        none
// @run-at       document-end
// @license      MIT
// @updateURL    https://gitee.com/cbbsxx/tampermonkey/raw/master/scripts/xjjd-gm-tools-toggle.user.js
// @downloadURL  https://gitee.com/cbbsxx/tampermonkey/raw/master/scripts/xjjd-gm-tools-toggle.user.js
// ==/UserScript==

(function () {
    'use strict';

    if (window.self === window.top) return;

    var shown = false;

    function findBtnGm() {
        var stage = window.Laya && window.Laya.stage;
        var found = null;

        function walk(node) {
            if (!node || found) return;
            if (node.name === 'btn_gm') {
                found = node;
                return;
            }
            for (var i = 0, n = node.numChildren || 0; i < n; i++) {
                try { walk(node.getChildAt(i)); } catch (_) {}
            }
        }

        walk(stage);
        return found;
    }

    function toggleGm() {
        var btn = findBtnGm();
        if (!btn) return;

        shown = !shown;
        btn.visible = shown;
        btn.alpha = shown ? 1 : 0;
        btn.mouseEnabled = shown;
        if (shown) btn.zOrder = 999999;
    }

    function createToggle() {
        var size = Math.max(36, Math.round(window.innerHeight / 12));
        var btn = document.createElement('button');

        btn.textContent = 'GM';
        btn.style.cssText =
            'position:fixed;right:10px;top:10px;z-index:999999;' +
            'width:' + size + 'px;height:' + size + 'px;padding:0;' +
            'border:1px solid rgba(255,255,255,.35);border-radius:8px;' +
            'background:rgba(20,20,28,.85);color:#fff;font-weight:700;' +
            'font-size:' + Math.max(12, Math.round(size / 3)) + 'px;' +
            'line-height:' + size + 'px;text-align:center;cursor:pointer;';
        btn.onclick = toggleGm;

        document.body.appendChild(btn);
    }

    function init() {
        if (document.body) createToggle();
        else setTimeout(init, 100);
    }

    init();
}());
