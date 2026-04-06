// ==UserScript==
// @name         古代遗迹自动挂机
// @namespace    http://tampermonkey.net/
// @version      4.0
// @description  小鸡舰队出击 - 古代遗迹自动化（基于 Laya 引擎）
// @author       xyk
// @match        https://www.wanyiwan.top/*
// @grant        none
// @run-at       document-end
// @license      MIT
// @updateURL    https://gitee.com/cbbsxx/tampermonkey/raw/master/scripts/xjjd-ancient-ruins-bot.user.js
// @downloadURL  https://gitee.com/cbbsxx/tampermonkey/raw/master/scripts/xjjd-ancient-ruins-bot.user.js
// ==/UserScript==

(function() {
    'use strict';
    if (window.self === window.top) return;

    // ==================== Laya 引擎工具 ====================

    var layaReady = false;

    function checkLaya() {
        try {
            if (typeof Laya !== 'undefined' && Laya.stage && Laya.stage.numChildren > 0) {
                layaReady = true;
                return true;
            }
        } catch (_) {}
        return false;
    }

    function walk(node, visitor, depth) {
        if (!node) return;
        depth = depth || 0;
        visitor(node, depth);
        for (var i = 0; i < (node.numChildren || 0); i++) {
            try { walk(node.getChildAt(i), visitor, depth + 1); } catch (_) {}
        }
    }

    function isVisible(node) {
        var n = node;
        while (n) {
            if (n.visible === false || n.alpha === 0) return false;
            n = n.parent;
        }
        return true;
    }

    function getText(node) {
        if (!node) return '';
        if (typeof node.text === 'string' && node.text.trim()) return node.text.trim();
        if (node.label && typeof node.label === 'string') return node.label.trim();
        return '';
    }

    function findNode(name) {
        if (!layaReady) return null;
        var best = null, bestDepth = Infinity;
        walk(Laya.stage, function(node, depth) {
            if (node.name === name && isVisible(node) && depth < bestDepth) {
                best = node;
                bestDepth = depth;
            }
        });
        return best;
    }

    function hasNode(name) { return !!findNode(name); }

    function getGlobalCenter(node) {
        try {
            var x = 0, y = 0, n = node;
            while (n && n !== Laya.stage) { x += (n.x || 0); y += (n.y || 0); n = n.parent; }
            return { x: x + (node.width || 0) / 2, y: y + (node.height || 0) / 2 };
        } catch (_) { return null; }
    }

    function clickNode(node) {
        if (!node) return false;
        var pt = getGlobalCenter(node);
        if (!pt) return false;
        var canvas = document.querySelector('canvas');
        if (!canvas) return false;

        var rect = canvas.getBoundingClientRect();
        var clientX = rect.left + pt.x * (rect.width / Laya.stage.width);
        var clientY = rect.top + pt.y * (rect.height / Laya.stage.height);

        var types = ['mousedown', 'mouseup', 'click'];
        for (var i = 0; i < types.length; i++) {
            var evt = document.createEvent('MouseEvents');
            evt.initMouseEvent(types[i], true, true, window, 0,
                window.screenX + clientX, window.screenY + clientY,
                clientX, clientY, false, false, false, false, 0, null);
            canvas.dispatchEvent(evt);
        }
        return true;
    }

    function clickByName(name) {
        var node = findNode(name);
        if (node) {
            clickNode(node);
            var pt = getGlobalCenter(node);
            log('点击 [' + name + '] @(' + Math.round(pt.x) + ',' + Math.round(pt.y) + ')');
            return true;
        }
        return false;
    }

    function clickListItem(listName, index) {
        var listNode = findNode(listName);
        if (!listNode) return false;
        var container = null;
        for (var i = 0; i < (listNode.numChildren || 0); i++) {
            var c = listNode.getChildAt(i);
            if (c && c.numChildren > 0) { container = c; break; }
        }
        if (!container) return false;
        if (index < 0) index = container.numChildren + index;
        var target = (index >= 0 && index < container.numChildren) ? container.getChildAt(index) : null;
        if (target && isVisible(target)) {
            clickNode(target);
            var pt = getGlobalCenter(target);
            log('点击 [' + listName + '] 第' + (index + 1) + '项 @(' + Math.round(pt.x) + ',' + Math.round(pt.y) + ')');
            return true;
        }
        return false;
    }

    /** 通过 FairyGUI GList API 选择列表项 */
    function selectGListItem(listName, index) {
        var listNode = findNode(listName);
        if (!listNode) return false;
        var gobj = listNode.$owner;
        if (!gobj || !gobj.numItems) return false;
        if (index < 0) index = gobj.numItems + index;
        if (index < 0 || index >= gobj.numItems) return false;

        // 先滚动到目标项
        if (gobj.scrollToView) gobj.scrollToView(index);
        // 直接设置选中索引
        gobj.selectedIndex = index;

        // 再通过点击触发游戏事件
        var childIndex = index;
        if (gobj.itemIndexToChildIndex) childIndex = gobj.itemIndexToChildIndex(index);
        var item = gobj.getChildAt(childIndex);
        if (item && item.displayObject) {
            clickNode(item.displayObject);
        }
        log('选择 [' + listName + '] 第' + (index + 1) + '/' + gobj.numItems + '项');
        return true;
    }

    /** 找到 anchorName 节点的父容器里的 btn_close 并点击 */
    function closeSiblingBtn(anchorName) {
        var anchor = findNode(anchorName);
        if (!anchor || !anchor.parent) return false;
        var parent = anchor.parent;
        for (var i = 0; i < (parent.numChildren || 0); i++) {
            var child = parent.getChildAt(i);
            if (child.name === 'btn_close' && isVisible(child)) {
                clickNode(child);
                log('关闭弹窗 (via ' + anchorName + ')');
                return true;
            }
        }
        return false;
    }

    // ==================== 地图格子点击 ====================
    // 网格结构：多列，每列若干行，从当前行只能走到下一列的 同行/下一行/上一行

    var mapTrying = false;
    var mapLastRow = -1;

    /** 收集所有可点击格子，按列分组，每列内按行(y)排序 */
    function getMapColumns() {
        var map = findNode('view_map');
        if (!map) return [];
        var all = [];
        walk(map, function(node) {
            if (node === map) return;
            if (!node._events || !node._events.click) return;
            if (!isVisible(node)) return;
            var pt = getGlobalCenter(node);
            if (!pt) return;
            all.push({ node: node, x: pt.x, y: pt.y });
        });
        if (all.length === 0) return [];
        all.sort(function(a, b) { return a.x - b.x; });
        var columns = [], curCol = [all[0]];
        for (var i = 1; i < all.length; i++) {
            if (all[i].x - curCol[0].x > 40) {
                curCol.sort(function(a, b) { return a.y - b.y; });
                columns.push(curCol);
                curCol = [all[i]];
            } else {
                curCol.push(all[i]);
            }
        }
        curCol.sort(function(a, b) { return a.y - b.y; });
        columns.push(curCol);
        return columns;
    }

    function clickMapNode() {
        if (mapTrying) return;
        var columns = getMapColumns();
        if (columns.length === 0) return;
        var col = columns[0];

        // 构建尝试顺序：同行 → 下一行 → 上一行，首次默认第一行
        var tryRows = [];
        var r = mapLastRow < 0 ? 0 : mapLastRow;
        if (r < col.length) tryRows.push(r);
        if (r - 1 >= 0) tryRows.push(r - 1);
        if (r + 1 < col.length) tryRows.push(r + 1);
        for (var i = 0; i < col.length; i++) {
            if (tryRows.indexOf(i) < 0) tryRows.push(i);
        }

        var list = [];
        for (var j = 0; j < tryRows.length; j++) {
            list.push({ node: col[tryRows[j]].node, row: tryRows[j] });
        }

        mapTrying = true;
        tryMapNode(list, 0);
    }

    function tryMapNode(list, idx) {
        if (idx >= list.length) {
            mapTrying = false;
            log('本列格子全试完');
            return;
        }
        var item = list[idx];
        clickNode(item.node);
        log('试格子 行' + item.row + ' (' + (idx + 1) + '/' + list.length + ')');

        setTimeout(function() {
            if (detectStep() !== STEPS.MAP) {
                mapTrying = false;
                mapLastRow = item.row;
                return;
            }
            tryMapNode(list, idx + 1);
        }, 500);
    }

    // ==================== 状态机 ====================

    var STEPS = {
        IDLE:           '空闲',
        RUINS_LOBBY:    '遗迹大厅',
        LEVEL_SELECT:   '选择难度',
        MAP:            '地图选路',
        BATTLE_CONFIRM: '战斗确认',
        CAPTAIN_SELECT: '选择队长',
        UPGRADE:        '培养选择',
        VICTORY:        '战斗胜利',
        ARTIFACT:       '神器选择',
        SHOP:           '商店',
        CONFIRM:        '确认弹窗',
    };

    var currentStep = STEPS.IDLE;
    var isRunning = false;
    var timer = null;
    var sweepMode = false;

    function log(msg) {
        console.error('[遗迹Bot]', msg);
    }

    function detectStep() {
        if (!layaReady && !checkLaya()) return STEPS.IDLE;
        if (hasNode('btn_ensure') && hasNode('btn_cancel')) return STEPS.CONFIRM;
        if (hasNode('list_shop')) return STEPS.SHOP;
        if (hasNode('item1') && hasNode('item2') && hasNode('item3')) return STEPS.ARTIFACT;
        if (hasNode('panelBaseWin') && hasNode('btn_ok')) return STEPS.VICTORY;
        if (hasNode('list_public') && hasNode('btn_refresh_common')) return STEPS.UPGRADE;
        if (hasNode('list_captain') && hasNode('txt_captain_tip')) return STEPS.CAPTAIN_SELECT;
        if (hasNode('btn_challenge') && hasNode('txt_fight_type')) return STEPS.BATTLE_CONFIRM;
        if (hasNode('view_map') && hasNode('btn_give_up')) return STEPS.MAP;
        if (hasNode('list_level') && hasNode('btn_start')) return STEPS.LEVEL_SELECT;
        if (hasNode('btn_go') && hasNode('item_hero_lineup')) return STEPS.RUINS_LOBBY;
        return STEPS.IDLE;
    }

    var levelPhase = 0;

    function act() {
        if (!isRunning) return;
        var step = detectStep();
        if (step !== currentStep) {
            if (currentStep === STEPS.MAP) { mapTrying = false; mapLastRow = -1; }
            if (step === STEPS.LEVEL_SELECT) { levelPhase = 0; }
            currentStep = step;
            log('进入: ' + step);
        }

        switch (step) {
            case STEPS.RUINS_LOBBY: clickByName('btn_go'); break;
            case STEPS.LEVEL_SELECT:
                if (sweepMode && levelPhase === 0) {
                    if (!selectGListItem('list_level', 0) && !clickListItem('list_level', 0)) {
                        log('选难度1失败，跳过');
                    }
                    levelPhase = 1;
                } else if (sweepMode && levelPhase === 1) {
                    levelPhase = 2;
                } else {
                    clickByName('btn_start');
                }
                break;
            case STEPS.MAP: clickMapNode(); break;
            case STEPS.BATTLE_CONFIRM: clickByName('btn_challenge'); break;
            case STEPS.CAPTAIN_SELECT: clickListItem('list_captain', -1); break;
            case STEPS.UPGRADE: clickListItem('list_public', -1); break;
            case STEPS.VICTORY: clickByName('btn_ok'); break;
            case STEPS.ARTIFACT: clickByName('item3'); break;
            case STEPS.SHOP: closeSiblingBtn('list_shop'); break;
            case STEPS.CONFIRM: clickByName('btn_ensure'); break;
        }
    }

    function start() {
        if (isRunning) return;
        isRunning = true;
        log('▶ 启动');
        timer = setInterval(act, 2000);
    }

    function stop() {
        isRunning = false;
        if (timer) { clearInterval(timer); timer = null; }
        log('⏸ 停止');
    }

    // ==================== 场景树 Dump ====================

    function dumpTree() {
        if (!layaReady && !checkLaya()) { log('Laya 不可用'); return; }
        var lines = [];
        walk(Laya.stage, function(node, depth) {
            if (depth > 6) return;
            var indent = ''; for (var i = 0; i < depth; i++) indent += '  ';
            var type = node.constructor ? node.constructor.name : '?';
            var name = node.name ? '(' + node.name + ')' : '';
            var text = getText(node); text = text ? ' "' + text + '"' : '';
            var vis = isVisible(node) ? '' : ' [隐藏]';
            var w = Math.round(node.width || 0), h = Math.round(node.height || 0);
            var size = (w || h) ? ' ' + w + 'x' + h : '';
            var evts = node._events ? Object.keys(node._events).join(',') : '';
            evts = evts ? ' [事件:' + evts + ']' : '';
            lines.push(indent + type + name + text + size + evts + vis);
        });
        log('场景树已输出到控制台 (F12)');
        console.error('[遗迹Bot] 场景树:\n' + lines.join('\n'));
    }

    // ==================== UI 面板 ====================

    function createPanel() {
        var old = document.getElementById('rb-panel');
        if (old) old.remove();

        var panel = document.createElement('div');
        panel.id = 'rb-panel';
        panel.style.cssText = 'position:fixed;top:20vh;left:10px;z-index:99999;user-select:none;';

        panel.innerHTML =
            '<div id="rb-bar" style="display:flex;gap:0.8vw;padding:0.8vw 1.3vw;background:rgba(15,15,25,0.9);border-radius:1vw;cursor:move;box-shadow:0 2px 10px rgba(0,0,0,0.5);align-items:center;">' +
            '<span id="rb-toggle" style="cursor:pointer;font-size:2vw;line-height:1;">🏛️</span>' +
            '<span id="rb-btns" style="display:none;">' +
            '<button id="rb-go" style="padding:0.7vw 1.3vw;background:#43A047;color:#fff;border:none;border-radius:0.7vw;cursor:pointer;font-size:1.6vw;font-weight:bold;">自动</button> ' +
            '<button id="rb-sweep" style="padding:0.7vw 1.3vw;background:#555;color:#aaa;border:none;border-radius:0.7vw;cursor:pointer;font-size:1.6vw;">难度1</button> ' +
            '<button id="rb-debug" style="padding:0.7vw 1.3vw;background:#37474F;color:#ddd;border:none;border-radius:0.7vw;cursor:pointer;font-size:1.6vw;">debug</button>' +
            '</span></div>';

        document.body.appendChild(panel);

        var btns = panel.querySelector('#rb-btns');
        panel.querySelector('#rb-toggle').onclick = function() {
            btns.style.display = btns.style.display === 'none' ? 'inline' : 'none';
        };

        var goBtn = panel.querySelector('#rb-go');
        goBtn.onclick = function() {
            if (isRunning) { stop(); goBtn.textContent = '自动'; goBtn.style.background = '#43A047'; }
            else { start(); goBtn.textContent = '停止'; goBtn.style.background = '#E53935'; }
        };

        var sweepBtn = panel.querySelector('#rb-sweep');
        sweepBtn.onclick = function() {
            sweepMode = !sweepMode;
            sweepBtn.style.background = sweepMode ? '#FF8F00' : '#555';
            sweepBtn.style.color = sweepMode ? '#fff' : '#aaa';
            log('扫荡模式: ' + (sweepMode ? '开' : '关'));
        };

        panel.querySelector('#rb-debug').onclick = dumpTree;

        var dragging = false, sx, sy, bar = panel.querySelector('#rb-bar');
        bar.onmousedown = function(e) { if (e.target.tagName === 'BUTTON' || e.target.id === 'rb-toggle') return; e.preventDefault(); dragging = true; sx = e.clientX - panel.offsetLeft; sy = e.clientY - panel.offsetTop; };
        document.addEventListener('mousemove', function(e) { if (!dragging) return; panel.style.left = Math.max(0, e.clientX - sx) + 'px'; panel.style.top = Math.max(0, e.clientY - sy) + 'px'; panel.style.right = 'auto'; });
        document.addEventListener('mouseup', function() { dragging = false; });
    }

    // ==================== 初始化 ====================

    function init() {
        var hasCanvas = false;
        for (var i = 0; i < document.getElementsByTagName('canvas').length; i++) {
            if (document.getElementsByTagName('canvas')[i].width * document.getElementsByTagName('canvas')[i].height > 100) { hasCanvas = true; break; }
        }
        if (!hasCanvas) {
            var r = setInterval(function() {
                for (var i = 0; i < document.getElementsByTagName('canvas').length; i++) {
                    if (document.getElementsByTagName('canvas')[i].width * document.getElementsByTagName('canvas')[i].height > 100) { clearInterval(r); createPanel(); waitLaya(); return; }
                }
            }, 500);
            return;
        }
        createPanel();
        waitLaya();
    }

    function waitLaya() {
        var n = 0, c = setInterval(function() {
            n++;
            if (checkLaya()) { clearInterval(c); log('Laya ✓'); }
            else if (n > 30) { clearInterval(c); log('Laya 未检测到'); }
        }, 1000);
    }

    setTimeout(init, 800);
})();
